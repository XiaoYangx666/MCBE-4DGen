import type { Material, Primitive } from '@gltf-transform/core';
import type { Transform } from '@gltf-transform/extensions';
import { cloneDocument } from '@gltf-transform/functions';
import sharp from 'sharp';
import type { IntermediateModel } from './model.ts';
import { inspectModel } from './inspect.ts';
import { validateModel } from './validate-model.ts';

export interface TextureOptions {
  /** Maximum dimension of each source image, preserving aspect ratio. Omit for Original. */
  maxTextureSize?: number;
  /** Explicit square atlas size. Omit for automatic power-of-two size up to 8192. */
  atlasSize?: number;
  filter?: 'nearest' | 'lanczos3';
  padding?: number;
}
interface Rect { x: number; y: number; width: number; height: number }
interface Region {
  material: Material | null; primitives: Primitive[]; uv: Map<Primitive, Float32Array>;
  min: [number, number]; tiles: [number, number]; width: number; height: number;
  source: { width: number; height: number } | null; wrap: [number, number];
}

/** Best-short-side free rectangle packing. No rotation, so UV orientation stays unchanged. */
function pack(regions: Region[], size: number, padding: number): Rect[] | null {
  let free: Rect[] = [{ x: 0, y: 0, width: size, height: size }];
  const result: Rect[] = Array(regions.length);
  const order = regions.map((r, id) => ({ id, width: r.width + padding * 2, height: r.height + padding * 2 }))
    .sort((a, b) => b.width * b.height - a.width * a.height || a.id - b.id);
  for (const item of order) {
    const fit = free.filter((r) => item.width <= r.width && item.height <= r.height)
      .sort((a, b) => Math.min(a.width - item.width, a.height - item.height) - Math.min(b.width - item.width, b.height - item.height))[0];
    if (!fit) return null;
    const used = { x: fit.x, y: fit.y, width: item.width, height: item.height };
    result[item.id] = used;
    const next: Rect[] = [];
    for (const r of free) {
      if (used.x >= r.x + r.width || used.x + used.width <= r.x || used.y >= r.y + r.height || used.y + used.height <= r.y) { next.push(r); continue; }
      if (used.x > r.x) next.push({ ...r, width: used.x - r.x });
      if (used.x + used.width < r.x + r.width) next.push({ ...r, x: used.x + used.width, width: r.x + r.width - used.x - used.width });
      if (used.y > r.y) next.push({ ...r, height: used.y - r.y });
      if (used.y + used.height < r.y + r.height) next.push({ ...r, y: used.y + used.height, height: r.y + r.height - used.y - used.height });
    }
    free = next.filter((r, i) => !next.some((s, j) => i !== j && s.x <= r.x && s.y <= r.y && s.x + s.width >= r.x + r.width && s.y + s.height >= r.y + r.height &&
      (s.x !== r.x || s.y !== r.y || s.width !== r.width || s.height !== r.height || j < i)));
  }
  return result;
}

const linear = (v: number) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
const srgb = (v: number) => v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
function sampleIndex(i: number, size: number, mode: number): number {
  if (mode === 33071) return Math.min(size - 1, Math.max(0, i));
  if (mode === 33648) { const v = ((i % (size * 2)) + size * 2) % (size * 2); return v < size ? v : size * 2 - 1 - v; }
  return ((i % size) + size) % size;
}

export async function optimizeTextures(input: IntermediateModel, options: TextureOptions = {}) {
  const filter = options.filter ?? 'lanczos3', padding = options.padding ?? 2;
  if (filter !== 'nearest' && filter !== 'lanczos3') throw new Error('filter must be nearest or lanczos3');
  if (!Number.isSafeInteger(padding) || padding < 1 || padding > 64) throw new Error('padding must be an integer in [1, 64]');
  for (const size of [options.maxTextureSize, options.atlasSize]) {
    if (size !== undefined && (!Number.isSafeInteger(size) || size < 1 || size > 8192)) throw new Error('Texture dimensions must be integers in [1, 8192]');
  }
  validateModel(input);
  const inspection = await inspectModel(input);
  const model: IntermediateModel = { ...input, document: cloneDocument(input.document), source: { ...input.source }, warnings: [...inspection.warnings] };
  const doc = model.document, root = doc.getRoot();
  const grouped = new Map<Material | null, Primitive[]>();
  for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) {
    if (p.getAttribute('COLOR_0')) throw new Error('Vertex-color baking is not implemented; refusing to silently lose COLOR_0.');
    const material = p.getMaterial();
    if (!grouped.has(material)) grouped.set(material, []);
    grouped.get(material)!.push(p);
  }
  const regions: Region[] = [];
  for (const [material, primitives] of grouped) {
    const texture = material?.getBaseColorTexture();
    const image = texture?.getImage();
    const metadata = image ? await sharp(image).metadata() : null;
    const source = metadata ? { width: metadata.width!, height: metadata.height! } : null;
    const scale = source && options.maxTextureSize ? Math.min(1, options.maxTextureSize / Math.max(source.width, source.height)) : 1;
    const w = source ? Math.max(1, Math.round(source.width * scale)) : 4;
    const h = source ? Math.max(1, Math.round(source.height * scale)) : 4;
    const info = material?.getBaseColorTextureInfo();
    const transform = info?.getExtension<Transform>('KHR_texture_transform');
    const coordinate = transform?.getTexCoord() ?? info?.getTexCoord() ?? 0;
    const uv = new Map<Primitive, Float32Array>();
    const low = [Infinity, Infinity], high = [-Infinity, -Infinity];
    for (const p of primitives) {
      const count = p.getAttribute('POSITION')!.getCount(), values = new Float32Array(count * 2);
      const accessor = p.getAttribute(`TEXCOORD_${coordinate}`);
      if (image && !accessor) throw new Error(`Textured primitive is missing TEXCOORD_${coordinate}`);
      const offset = transform?.getOffset() ?? [0, 0], scaling = transform?.getScale() ?? [1, 1], angle = transform?.getRotation() ?? 0;
      for (let i = 0; i < count; i++) {
        const value: number[] = []; accessor?.getElement(i, value);
        const x = (value[0] ?? 0.5) * scaling[0]!, y = (value[1] ?? 0.5) * scaling[1]!;
        const u = image ? offset[0]! + Math.cos(angle) * x - Math.sin(angle) * y : 0.5;
        const v = image ? offset[1]! + Math.sin(angle) * x + Math.cos(angle) * y : 0.5;
        if (!Number.isFinite(u) || !Number.isFinite(v)) throw new Error('Texture transform produced invalid UV');
        values[i * 2] = u; values[i * 2 + 1] = v;
        low[0] = Math.min(low[0]!, u); low[1] = Math.min(low[1]!, v);
        high[0] = Math.max(high[0]!, u); high[1] = Math.max(high[1]!, v);
      }
      uv.set(p, values);
    }
    // sin/cos at 90° can put an exact tile edge a few ulps outside its integer.
    // Stabilize the allocation bounds only; keep actual UVs unchanged for sampling.
    const tileEdge = (v: number) => Math.abs(v - Math.round(v)) < 1e-7 ? Math.round(v) : v;
    const min: [number, number] = [Math.floor(tileEdge(low[0]!)), Math.floor(tileEdge(low[1]!))];
    const tiles: [number, number] = [Math.max(1, Math.ceil(tileEdge(high[0]!)) - min[0]), Math.max(1, Math.ceil(tileEdge(high[1]!)) - min[1])];
    if (tiles.some((v) => v > 16)) throw new Error('UV span exceeds 16 tiles; reduce tiling before atlas baking.');
    regions.push({ material, primitives, uv, min, tiles, width: w * tiles[0], height: h * tiles[1], source,
      wrap: [info?.getWrapS() ?? 10497, info?.getWrapT() ?? 10497] });
  }
  let size = options.atlasSize ?? 8;
  let layout = pack(regions, size, padding);
  while (!layout && options.atlasSize === undefined && size < 8192) { size *= 2; layout = pack(regions, size, padding); }
  if (!layout) throw new Error(`Texture atlas capacity exceeded (${size}×${size}). Increase atlasSize or reduce maxTextureSize; padded regions: ${regions.map((r) => `${r.width + padding * 2}×${r.height + padding * 2}`).join(', ')}. No textures were discarded.`);
  const atlas = Buffer.alloc(size * size * 4);
  const reportRegions = [];
  for (const [id, region] of regions.entries()) {
    const rect = layout[id]!, w = region.width / region.tiles[0], h = region.height / region.tiles[1];
    const image = region.material?.getBaseColorTexture()?.getImage();
    const pixels = image ? await sharp(image).toColourspace('srgb').ensureAlpha().resize(w, h, { kernel: filter }).raw().toBuffer() : Buffer.alloc(4 * w * h, 255);
    const factor = region.material?.getBaseColorFactor() ?? [1, 1, 1, 1];
    if (factor.some((v) => !Number.isFinite(v) || v < 0 || v > 1)) throw new Error('Invalid base-color factor');
    const mode = region.material?.getAlphaMode() ?? 'OPAQUE', cutoff = region.material?.getAlphaCutoff() ?? 0.5;
    for (let i = 0; i < pixels.length; i += 4) {
      for (let c = 0; c < 3; c++) pixels[i + c] = Math.round(srgb(linear(pixels[i + c]! / 255) * factor[c]!) * 255);
      const alpha = pixels[i + 3]! / 255 * factor[3]!;
      pixels[i + 3] = mode === 'OPAQUE' ? 255 : mode === 'MASK' ? (alpha >= cutoff ? 255 : 0) : Math.round(alpha * 255);
    }
    // Fill both repeated/clamped/mirrored UV span and gutters with the source sampler's behavior.
    for (let y = -padding; y < region.height + padding; y++) for (let x = -padding; x < region.width + padding; x++) {
      const sx = sampleIndex(x + region.min[0] * w, w, region.wrap[0]), sy = sampleIndex(y + region.min[1] * h, h, region.wrap[1]);
      const src = (sy * w + sx) * 4, dst = ((rect.y + y + padding) * size + rect.x + x + padding) * 4;
      for (let c = 0; c < 4; c++) atlas[dst + c] = pixels[src + c]!;
    }
    for (const p of region.primitives) {
      const values = region.uv.get(p)!;
      for (let i = 0; i < values.length; i += 2) {
        values[i] = (rect.x + padding + (values[i]! - region.min[0]) / region.tiles[0] * region.width) / size;
        values[i + 1] = (rect.y + padding + (values[i + 1]! - region.min[1]) / region.tiles[1] * region.height) / size;
      }
      p.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(Float32Array.from(values)).setBuffer(root.listBuffers()[0] ?? doc.createBuffer()));
    }
    reportRegions.push({ id, material: region.material?.getName() ?? '(default)', x: rect.x + padding, y: rect.y + padding,
      width: region.width, height: region.height, source: region.source, resized: { width: w, height: h }, tiles: region.tiles });
  }
  const png = await sharp(atlas, { raw: { width: size, height: size, channels: 4 } }).png().toBuffer();
  const texture = doc.createTexture('atlas').setImage(Uint8Array.from(png)).setMimeType('image/png').setURI('atlas.png');
  for (const region of regions) {
    const material = region.material ?? doc.createMaterial('default');
    for (const p of region.primitives) p.setMaterial(material);
    for (const ext of material.listExtensions()) ext.dispose();
    material.setNormalTexture(null).setMetallicRoughnessTexture(null).setOcclusionTexture(null).setEmissiveTexture(null)
      .setEmissiveFactor([0, 0, 0]).setMetallicFactor(0).setRoughnessFactor(1).setBaseColorFactor([1, 1, 1, 1]).setBaseColorTexture(texture);
    const info = material.getBaseColorTextureInfo()!;
    for (const ext of info.listExtensions()) ext.dispose();
    info.setTexCoord(0).setWrapS(33071).setWrapT(33071).setMinFilter(filter === 'nearest' ? 9728 : 9729).setMagFilter(filter === 'nearest' ? 9728 : 9729);
  }
  // Dispose unused materials/textures, after all material extension references have been removed.
  for (const material of root.listMaterials()) if (!root.listMeshes().some((m) => m.listPrimitives().some((p) => p.getMaterial() === material))) material.dispose();
  for (const old of root.listTextures()) if (old !== texture && old.listParents().length === 1) old.dispose();
  for (const accessor of root.listAccessors()) if (accessor.listParents().length === 1) accessor.dispose();
  model.warnings.push('Atlas preserves base color and alpha only; PBR lighting/shader effects are not reproduced.');
  validateModel(model);
  return { model, png, report: { originalTextures: inspection.textures.map((t) => ({ width: t.width, height: t.height, bytes: t.bytes })),
    atlas: { width: size, height: size, bytes: png.length }, filter, padding, regions: reportRegions, warnings: model.warnings } };
}
