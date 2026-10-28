/**
 * Real-model loader for the research harness.
 *
 * Real samples live outside git (PMX/VRM authors' licences do not allow
 * redistribution), so the harness discovers them from the local corpus and
 * records exactly which files it used. Every measurement written by the run
 * script names the file and its SHA-256, which makes a local reproduction
 * possible without pretending the corpus is public.
 */
import { createHash } from 'node:crypto';
import { readdir, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { convertPrimitiveToTriangles } from '@gltf-transform/functions';
import type { Document, Material, Node, Primitive } from '@gltf-transform/core';
import type { Transform } from '@gltf-transform/extensions';
import sharp from 'sharp';
import { importModel } from '../../../src/importer.ts';
import { linearToSrgb } from '../../../src/texture-pixels.ts';
import type { AlphaMode, ChartInput, RgbaImage } from './types.ts';

export interface RealModel {
  name: string;
  path: string;
  sha256: string;
  inputs: ChartInput[];
  stats: {
    triangles: number;
    materials: number;
    textures: number;
    textureBytes: number;
  };
  warnings: string[];
}

const decodeCache = new Map<string, RgbaImage>();

async function decodeImage(bytes: Uint8Array): Promise<RgbaImage> {
  const key = createHash('sha256').update(bytes).digest('hex');
  const cached = decodeCache.get(key);
  if (cached) return cached;
  const { data, info } = await sharp(bytes)
    .toColourspace('srgb')
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const image: RgbaImage = {
    width: info.width,
    height: info.height,
    data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    key,
  };
  decodeCache.set(key, image);
  return image;
}

interface Accumulator {
  material: Material | null;
  materialKey: string;
  name: string;
  partNames: Set<string>;
  uvs: number[];
  areas: number[];
  positions: number[];
  image: RgbaImage | null;
  color: [number, number, number];
  opacity: number;
  alphaMode: AlphaMode;
  alphaCutoff: number;
  wrap: ChartInput['wrap'];
  hasTexture: boolean;
}

/** Triangles in world space, summed over node instances of the mesh. */
function primitiveGeometry(
  primitive: Primitive,
  instances: readonly Node[],
): { areas: Float32Array; positions: Float32Array } {
  const position = primitive.getAttribute('POSITION');
  if (!position) return { areas: new Float32Array(0), positions: new Float32Array(0) };
  const indices =
    primitive.getIndices()?.getArray() ??
    Uint32Array.from({ length: position.getCount() }, (_, index) => index);
  const triangles = Math.floor(indices.length / 3);
  const areas = new Float32Array(triangles);
  const output = new Float32Array(triangles * 9);
  let first = true;
  for (const node of instances) {
    const matrix = node.getWorldMatrix();
    const count = position.getCount();
    const world = new Float32Array(count * 3);
    const value: number[] = [];
    for (let i = 0; i < count; i++) {
      position.getElement(i, value);
      world[i * 3] = matrix[0]! * value[0]! + matrix[4]! * value[1]! + matrix[8]! * value[2]! + matrix[12]!;
      world[i * 3 + 1] = matrix[1]! * value[0]! + matrix[5]! * value[1]! + matrix[9]! * value[2]! + matrix[13]!;
      world[i * 3 + 2] = matrix[2]! * value[0]! + matrix[6]! * value[1]! + matrix[10]! * value[2]! + matrix[14]!;
    }
    for (let t = 0; t < triangles; t++) {
      const a = indices[t * 3]! * 3;
      const b = indices[t * 3 + 1]! * 3;
      const c = indices[t * 3 + 2]! * 3;
      const ux = world[b]! - world[a]!;
      const uy = world[b + 1]! - world[a + 1]!;
      const uz = world[b + 2]! - world[a + 2]!;
      const vx = world[c]! - world[a]!;
      const vy = world[c + 1]! - world[a + 1]!;
      const vz = world[c + 2]! - world[a + 2]!;
      areas[t] =
        (areas[t] ?? 0) +
        Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
      if (first) {
        output[t * 9] = world[a]!;
        output[t * 9 + 1] = world[a + 1]!;
        output[t * 9 + 2] = world[a + 2]!;
        output[t * 9 + 3] = world[b]!;
        output[t * 9 + 4] = world[b + 1]!;
        output[t * 9 + 5] = world[b + 2]!;
        output[t * 9 + 6] = world[c]!;
        output[t * 9 + 7] = world[c + 1]!;
        output[t * 9 + 8] = world[c + 2]!;
      }
    }
    first = false;
  }
  return { areas, positions: output };
}

export async function loadRealModel(path: string): Promise<RealModel> {
  const absolute = resolve(path);
  const bytes = await import('node:fs/promises').then((fs) => fs.readFile(absolute));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const model = await importModel(absolute);
  const document = model.document;
  const root = document.getRoot();
  for (const mesh of root.listMeshes())
    for (const primitive of mesh.listPrimitives())
      if (primitive.getMode() !== 4) convertPrimitiveToTriangles(primitive);

  const warnings: string[] = [...model.warnings];
  const accumulators = new Map<Material | null, Accumulator>();
  let textureBytes = 0;
  const textures = new Set<string>();

  const materialList = root.listMaterials();
  const createAccumulator = async (material: Material | null): Promise<Accumulator> => {
    const texture = material?.getBaseColorTexture();
    const image = texture?.getImage();
    let decoded: RgbaImage | null = null;
    if (image && image.byteLength) {
      decoded = await decodeImage(image);
      textures.add(decoded.key);
      textureBytes += image.byteLength;
    }
    const info = material?.getBaseColorTextureInfo();
    const factor = material?.getBaseColorFactor() ?? [1, 1, 1, 1];
    const wrapCode = (code: number | undefined) =>
      (code ?? 10497) === 33071 ? 'clamp' : (code ?? 10497) === 33648 ? 'mirror' : 'repeat';
    return {
      material,
      materialKey: `m${material ? materialList.indexOf(material) : -1}:${material?.getName() ?? '(default)'}`,
      name: material?.getName() ?? '(default)',
      partNames: new Set<string>(),
      uvs: [],
      areas: [],
      positions: [],
      image: decoded,
      color: [
        linearToSrgb(factor[0]!),
        linearToSrgb(factor[1]!),
        linearToSrgb(factor[2]!),
      ],
      opacity: factor[3]!,
      alphaMode: (material?.getAlphaMode() as AlphaMode | undefined) ?? 'OPAQUE',
      alphaCutoff: material?.getAlphaCutoff() ?? 0.5,
      wrap: [wrapCode(info?.getWrapS()), wrapCode(info?.getWrapT())] as ChartInput['wrap'],
      hasTexture: !!decoded,
    };
  };

  for (const mesh of root.listMeshes()) {
    const instances = root.listNodes().filter((node) => node.getMesh() === mesh);
    for (const primitive of mesh.listPrimitives()) {
      const material = primitive.getMaterial();
      const accumulator = accumulators.get(material) ?? (await createAccumulator(material));
      accumulators.set(material, accumulator);
      accumulator.partNames.add(mesh.getName() || 'mesh');

      const info = material?.getBaseColorTextureInfo();
      const transform = info?.getExtension<Transform>('KHR_texture_transform');
      const coordinate = transform?.getTexCoord() ?? info?.getTexCoord() ?? 0;
      const uv = primitive.getAttribute(`TEXCOORD_${coordinate}`) ?? primitive.getAttribute('TEXCOORD_0');
      const position = primitive.getAttribute('POSITION');
      if (!position) continue;
      const indices =
        primitive.getIndices()?.getArray() ??
        Uint32Array.from({ length: position.getCount() }, (_, index) => index);
      const geometry = primitiveGeometry(primitive, instances);
      const areas = geometry.areas;
      const triangles = Math.floor(indices.length / 3);
      const offset = transform?.getOffset() ?? [0, 0];
      const scaling = transform?.getScale() ?? [1, 1];
      const angle = transform?.getRotation() ?? 0;
      for (let t = 0; t < triangles; t++) {
        for (let corner = 0; corner < 3; corner++) {
          const vertex = indices[t * 3 + corner]!;
          const value: number[] = [];
          uv?.getElement(vertex, value);
          const x = (value[0] ?? 0.5) * scaling[0]!;
          const y = (value[1] ?? 0.5) * scaling[1]!;
          const u = offset[0]! + Math.cos(angle) * x - Math.sin(angle) * y;
          const v = offset[1]! + Math.sin(angle) * x + Math.cos(angle) * y;
          accumulator.uvs.push(Number.isFinite(u) ? u : 0.5, Number.isFinite(v) ? v : 0.5);
        }
        accumulator.areas.push(areas[t] ?? 0);
        for (let i = 0; i < 9; i++)
          accumulator.positions.push(geometry.positions[t * 9 + i] ?? 0);
      }
    }
  }

  const inputs: ChartInput[] = [];
  for (const [index, accumulator] of [...accumulators.values()].entries()) {
    const textured = accumulator.hasTexture && accumulator.uvs.length > 0;
    let bounds: [number, number, number, number] | null = null;
    if (textured) {
      const low: [number, number] = [Infinity, Infinity];
      const high: [number, number] = [-Infinity, -Infinity];
      for (let i = 0; i < accumulator.uvs.length; i += 2) {
        low[0] = Math.min(low[0], accumulator.uvs[i]!);
        low[1] = Math.min(low[1], accumulator.uvs[i + 1]!);
        high[0] = Math.max(high[0], accumulator.uvs[i]!);
        high[1] = Math.max(high[1], accumulator.uvs[i + 1]!);
      }
      bounds = [low[0], low[1], high[0], high[1]];
    }
    inputs.push({
      id: `m${index}`,
      material: accumulator.name,
      materialKey: accumulator.materialKey,
      part: [...accumulator.partNames].join('+'),
      texture: textured ? accumulator.image : null,
      color: accumulator.color,
      opacity: accumulator.opacity,
      alphaMode: accumulator.alphaMode,
      alphaCutoff: accumulator.alphaCutoff,
      wrap: accumulator.wrap,
      bounds,
      uvs: textured ? Float32Array.from(accumulator.uvs) : null,
      positions: Float32Array.from(accumulator.positions),
      triangleAreas: textured ? Float32Array.from(accumulator.areas) : null,
      area: accumulator.areas.reduce((sum, value) => sum + value, 0),
    });
  }
  if (inputs.length !== accumulators.size) warnings.push('material count mismatch');

  return {
    name: basename(absolute).replace(/\.[^.]+$/, ''),
    path: absolute,
    sha256,
    inputs,
    stats: {
      triangles: inputs.reduce((sum, input) => sum + (input.uvs ? input.uvs.length / 6 : 0), 0),
      materials: inputs.length,
      textures: textures.size,
      textureBytes,
    },
    warnings: [...new Set(warnings)],
  };
}

/** Discover the local real-model corpus without hard-coding a single machine path. */
export async function findRealSamples(): Promise<string[]> {
  const configured = process.env.ATLAS_SAMPLES;
  if (configured)
    return configured
      .split(';')
      .map((entry) => entry.trim())
      .filter(Boolean);
  const roots = [
    'video/remotion/public/models',
    'outputs/demo-model',
    '4dgen-data/sources/uploads',
  ];
  const found: string[] = [];
  for (const root of roots) {
    let entries: string[];
    try {
      entries = await readdir(root);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!/\.(glb|gltf|vrm)$/i.test(entry)) continue;
      const path = join(root, entry);
      try {
        const info = await stat(path);
        if (info.size < 64 * 1024) continue; // icons / thumbnails
        found.push(path);
      } catch {
        /* ignore */
      }
    }
  }
  return found.sort();
}
