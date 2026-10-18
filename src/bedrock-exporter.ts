import sharp from 'sharp';
import type { StaticBinding } from './bone-mapper.ts';
import { bindStatic } from './bone-mapper.ts';
import type { BedrockBone, BedrockGeometryFile, PolyMesh, V2, V3, VertexRef } from './bedrock-types.ts';
import { isGeometryIdentifier } from './bedrock-types.ts';
import { validateGeometry } from './geometry-validator.ts';

export interface ExportOptions {
  identifier: string;
  /** Optional final skin atlas edge; normalized UVs stay unchanged. */
  skinTextureSize?: 64 | 128;
  /** Duplicate back-facing triangles when glTF material is double-sided (default). */
  doubleSided?: 'duplicate' | 'front-only';
}

class Stream<T extends number[]> {
  readonly values: T[] = [];
  private readonly indices = new Map<string, number>();
  add(value: T): number {
    const clean = value.map((v) => Object.is(v, -0) ? 0 : v) as T;
    const key = clean.join(',');
    const existing = this.indices.get(key);
    if (existing !== undefined) return existing;
    const index = this.values.length;
    this.values.push(clean); this.indices.set(key, index); return index;
  }
}
const mirror = (v: V3): V3 => [-v[0] || 0, v[1], v[2]];

/** Legacy 1.8.0, indexed poly_mesh only. Does not create a SkinPack or assert client support. */
export async function exportBedrockGeometry(binding: StaticBinding, options: ExportOptions) {
  if (!isGeometryIdentifier(options.identifier)) throw new Error('Invalid geometry identifier');
  const doubleSided = options.doubleSided ?? 'duplicate';
  if (!['duplicate', 'front-only'].includes(doubleSided)) throw new Error('Invalid doubleSided policy');
  // Recheck the model even if a caller mutated it after bindStatic returned.
  bindStatic(binding.model, { bone: binding.meshBone, position: binding.position });
  const root = binding.model.document.getRoot();
  const primitives = root.listMeshes().flatMap((mesh) => mesh.listPrimitives());
  const textures = new Set(primitives.map((p) => p.getMaterial()?.getBaseColorTexture()));
  if (textures.size !== 1 || textures.has(null) || textures.has(undefined)) throw new Error('Export requires one baked base-color atlas');
  const texture = [...textures][0]!;
  let image = texture.getImage();
  if (!image) throw new Error('Atlas image is missing');
  let metadata = await sharp(image).metadata();
  if (metadata.format !== 'png' || !metadata.width || !metadata.height) throw new Error('Export requires a valid PNG atlas');
  const resized = options.skinTextureSize !== undefined &&
    (metadata.width !== options.skinTextureSize || metadata.height !== options.skinTextureSize);
  if (resized) {
    image = await sharp(image).resize(options.skinTextureSize!, options.skinTextureSize!).png().toBuffer();
    metadata = await sharp(image).metadata();
  }
  const positions = new Stream<V3>(), normals = new Stream<V3>(), uvs = new Stream<V2>();
  const pm: PolyMesh = { normalized_uvs: true, positions: positions.values, normals: normals.values, uvs: uvs.values, polys: [] };
  const warnings = [...binding.model.warnings];
  if (resized) warnings.push(`Final skin atlas resized to ${options.skinTextureSize}x${options.skinTextureSize} for client compatibility; normalized UVs preserved, downsampling can reduce detail.`);
  let sourceTriangles = 0, addedBackfaces = 0, ignoredBackfaces = 0;
  for (const p of primitives) {
    const material = p.getMaterial()!, info = material.getBaseColorTextureInfo()!;
    if (material.getBaseColorFactor().some((v) => v !== 1) || info.getTexCoord() !== 0 || info.getExtension('KHR_texture_transform')) throw new Error('Material factors and texture transforms must be baked before export');
    if (material.getNormalTexture() || material.getMetallicRoughnessTexture() || material.getOcclusionTexture() || material.getEmissiveTexture() || material.listExtensions().length || material.getMetallicFactor() !== 0 || material.getRoughnessFactor() !== 1 || material.getEmissiveFactor().some((v) => v !== 0)) throw new Error('PBR effects must be explicitly handled by texture preparation before export');
    if (p.getAttribute('COLOR_0')) throw new Error('Vertex colors must be baked before export');
    const position = p.getAttribute('POSITION')!, normal = p.getAttribute('NORMAL'), uv = p.getAttribute('TEXCOORD_0');
    if (!normal || !uv) throw new Error('Export requires NORMAL and TEXCOORD_0');
    const indices = p.getIndices()?.getArray() ?? Uint32Array.from({ length: position.getCount() }, (_, i) => i);
    const refs = new Map<number, VertexRef>(), backRefs = new Map<number, VertexRef>();
    const ref = (index: number, back: boolean): VertexRef => {
      const cache = back ? backRefs : refs;
      const cached = cache.get(index); if (cached) return [...cached];
      const v: number[] = [], n: number[] = [], t: number[] = [];
      position.getElement(index, v); normal.getElement(index, n); uv.getElement(index, t);
      const length = Math.hypot(...n);
      if (!(length > 0)) throw new Error('Cannot export a zero-length normal');
      const sign = back ? -1 : 1;
      const tuple: VertexRef = [
        positions.add(mirror([v[0]! + binding.position[0], v[1]! + binding.position[1], v[2]! + binding.position[2]])),
        normals.add(mirror([sign * n[0]! / length, sign * n[1]! / length, sign * n[2]! / length])),
        uvs.add([t[0]!, 1 - t[1]!]), // glTF/image top origin -> legacy poly_mesh bottom origin.
      ];
      cache.set(index, tuple); return [...tuple];
    };
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i]!, b = indices[i + 1]!, c = indices[i + 2]!;
      // Mirror into Bedrock's handedness; preserve source corner order as in legacy skin data.
      // Pad a triangle with its last corner rather than emitting an unrelated fourth index.
      const first = [ref(a, false), ref(b, false), ref(c, false), ref(c, false)] as [VertexRef, VertexRef, VertexRef, VertexRef];
      pm.polys.push(first); sourceTriangles++;
      if (material.getDoubleSided()) {
        if (doubleSided === 'duplicate') { pm.polys.push([ref(c, true), ref(b, true), ref(a, true), ref(a, true)]); addedBackfaces++; }
        else ignoredBackfaces++;
      }
    }
  }
  if (addedBackfaces) warnings.push(`Added ${addedBackfaces} explicit back-facing triangles for double-sided source materials; final poly_mesh count includes them.`);
  if (ignoredBackfaces) warnings.push(`Omitted ${ignoredBackfaces} back-facing triangles by front-only policy; back-side appearance is not preserved.`);
  const bones: BedrockBone[] = binding.bones.map((bone) => ({ name: bone.name,
    ...(bone.parent !== undefined ? { parent: bone.parent } : {}), pivot: mirror(bone.pivot),
    ...(bone.name === binding.meshBone ? { poly_mesh: pm } : {}) }));
  const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
  for (const v of positions.values) for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i]!, v[i]!); max[i] = Math.max(max[i]!, v[i]!); }
  const file: BedrockGeometryFile = { format_version: '1.8.0' };
  file[options.identifier] = {
    texturewidth: metadata.width, textureheight: metadata.height,
    visible_bounds_width: Math.max(max[0] - min[0], max[2] - min[2]) / 16 + 0.25,
    visible_bounds_height: (max[1] - min[1]) / 16 + 0.25,
    visible_bounds_offset: min.map((v, i) => (v + max[i]!) / 32) as V3, bones,
  };
  const validation = validateGeometry(file, { expectedIdentifier: options.identifier,
    textureSize: { width: metadata.width, height: metadata.height }, atlasUVs: true });
  return { file, png: Uint8Array.from(image), report: { identifier: options.identifier, sourceTriangles,
    addedBackfaces, ignoredBackfaces, triangles: sourceTriangles + addedBackfaces,
    positions: positions.values.length, normals: normals.values.length, uvs: uvs.values.length,
    texture: { width: metadata.width, height: metadata.height }, meshBone: binding.meshBone,
    validation: validation.geometries[0]!, warnings } };
}
