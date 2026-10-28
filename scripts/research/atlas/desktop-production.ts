/**
 * Runs the real production desktop pipeline (`optimizeTextures` with
 * `compactSize`) and measures the atlas it actually wrote.
 *
 * Nothing is re-implemented here: the numbers come from the production code
 * path plus a post-hoc analysis of the exported GLB and PNG. Sampling error is
 * obtained by inverting the remap documented in `report.regions` (the crop
 * rectangle determines the source interval exactly).
 */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import sharp from 'sharp';
import type { Document, Node, Primitive } from '@gltf-transform/core';
import { importModel } from '../../../src/importer.ts';
import { optimizeTextures } from '../../../src/texture-optimizer.ts';
import { linearToSrgb } from '../../../src/texture-pixels.ts';
import { bakeSample, sampleAtlasLinear, sampleBilinear } from './sample.ts';
import type { AlphaMode, RgbaImage } from './types.ts';

export interface ProductionTextureInfo {
  name: string;
  image: RgbaImage | null;
  color: [number, number, number];
  opacity: number;
  alphaMode: AlphaMode;
  alphaCutoff: number;
  wrap: [number, number];
}

export interface ProductionRegion {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  min: [number, number] | null;
  tiles: [number, number];
  source: { width: number; height: number } | null;
  materials: string[];
}

export interface OutputPrimitive {
  mesh: string;
  material: string;
  /** Atlas UVs, per vertex. */
  uvs: Float32Array;
  /** World-space triangle areas. */
  areas: Float32Array;
}

export interface ProductionRun {
  name: string;
  elapsedMs: number;
  peakRssKb: number;
  report: Awaited<ReturnType<typeof optimizeTextures>>['report'];
  atlas: RgbaImage;
  regions: ProductionRegion[];
  primitives: OutputPrimitive[];
  sources: Map<string, ProductionTextureInfo>;
  warnings: string[];
}

const decodeCache = new Map<string, RgbaImage>();

async function decode(bytes: Uint8Array): Promise<RgbaImage> {
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

export interface ProductionOptions {
  compactSize?: number;
  padding?: number;
  weights?: Record<string, number>;
  allocation?: 'surface-area' | 'source-area';
}

/** Run production conversion and capture everything needed for analysis. */
export async function runProduction(
  path: string,
  options: ProductionOptions = {},
): Promise<ProductionRun> {
  const model = await importModel(path);
  const sources = new Map<string, ProductionTextureInfo>();
  for (const material of model.document.getRoot().listMaterials()) {
    const name = material.getName() || '(default)';
    if (sources.has(name)) continue;
    const texture = material.getBaseColorTexture();
    const image = texture?.getImage();
    const info = material.getBaseColorTextureInfo();
    const factor = material.getBaseColorFactor();
    sources.set(name, {
      name,
      image: image && image.byteLength ? await decode(image) : null,
      color: [linearToSrgb(factor[0]!), linearToSrgb(factor[1]!), linearToSrgb(factor[2]!)],
      opacity: factor[3]!,
      alphaMode: material.getAlphaMode() as AlphaMode,
      alphaCutoff: material.getAlphaCutoff(),
      wrap: [info?.getWrapS() ?? 10497, info?.getWrapT() ?? 10497],
    });
  }

  const started = performance.now();
  const result = await optimizeTextures(model, {
    compactSize: options.compactSize ?? 128,
    padding: options.padding ?? 2,
    filter: 'lanczos3',
    ...(options.weights ? { materialWeights: options.weights } : {}),
    ...(options.allocation ? { allocation: options.allocation } : {}),
  });
  const elapsedMs = performance.now() - started;
  const peakRssKb = process.resourceUsage().maxRSS;

  const { data, info } = await sharp(Buffer.from(result.png))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const atlas: RgbaImage = {
    width: info.width,
    height: info.height,
    data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    key: 'production-atlas',
  };

  const regions: ProductionRegion[] = result.report.regions.map((region) => {
    const crop = region.crop;
    return {
      id: region.id,
      x: region.x,
      y: region.y,
      width: region.width,
      height: region.height,
      min:
        crop && region.source
          ? [crop.x / region.source.width, crop.y / region.source.height]
          : null,
      tiles: [region.tiles[0], region.tiles[1]],
      source: region.source,
      materials: region.materials,
    };
  });

  const primitives = collectPrimitives(result.model.document);
  return {
    name: path,
    elapsedMs,
    peakRssKb,
    report: result.report,
    atlas,
    regions,
    primitives,
    sources,
    warnings: result.report.warnings,
  };
}

function collectPrimitives(document: Document): OutputPrimitive[] {
  const root = document.getRoot();
  const output: OutputPrimitive[] = [];
  for (const mesh of root.listMeshes()) {
    const instances: Node[] = root.listNodes().filter((node) => node.getMesh() === mesh);
    for (const primitive of mesh.listPrimitives()) {
      const uv = primitive.getAttribute('TEXCOORD_0');
      const position = primitive.getAttribute('POSITION');
      if (!uv || !position) continue;
      const uvs = new Float32Array(uv.getCount() * 2);
      const value: number[] = [];
      for (let i = 0; i < uv.getCount(); i++) {
        uv.getElement(i, value);
        uvs[i * 2] = value[0] ?? 0;
        uvs[i * 2 + 1] = value[1] ?? 0;
      }
      const areas = worldAreas(primitive, instances);
      output.push({
        mesh: mesh.getName() || 'mesh',
        material: primitive.getMaterial()?.getName() || '(default)',
        uvs,
        areas,
      });
    }
  }
  return output;
}

function worldAreas(primitive: Primitive, instances: readonly Node[]): Float32Array {
  const position = primitive.getAttribute('POSITION')!;
  const indices =
    primitive.getIndices()?.getArray() ??
    Uint32Array.from({ length: position.getCount() }, (_, index) => index);
  const triangles = Math.floor(indices.length / 3);
  const areas = new Float32Array(triangles);
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
    }
  }
  return areas;
}

export interface ProductionAnalysis {
  atlasSize: number;
  charts: number;
  contentPixels: number;
  allocatedPixels: number;
  uvPixels: number;
  opaquePixels: number;
  overlapPixels: number;
  contentUtilization: number;
  allocatedUtilization: number;
  uvUtilization: number;
  opaqueUtilization: number;
  materials: {
    material: string;
    worldArea: number;
    atlasTexels: number;
    sourceTexels: number;
    texelDensity: number;
    sourceRatio: number;
    uvPixels: number;
    opaquePixels: number;
    rectPixels: number;
  }[];
  error: {
    samples: number;
    meanAbs: number;
    p95: number;
    maxAbs: number;
    edgeMeanAbs: number;
    interiorMeanAbs: number;
  };
}

/** Measure coverage, texel density and sampling error of a production run. */
export function analyzeProduction(run: ProductionRun, sampleBudget = 120_000): ProductionAnalysis {
  const size = run.atlas.width;
  const regionAt = new Int32Array(size * size).fill(-1);
  for (const region of run.regions)
    for (let y = region.y; y < region.y + region.height; y++)
      for (let x = region.x; x < region.x + region.width; x++) {
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        regionAt[y * size + x] = region.id;
      }

  const byRegion = new Map<number, ProductionRegion>();
  for (const region of run.regions) byRegion.set(region.id, region);

  const uvMask = new Uint8Array(size * size);
  const opaqueMask = new Uint8Array(size * size);
  const materialUv = new Map<string, Uint8Array>();
  const materialOpaque = new Map<string, Uint8Array>();
  const materialAtlasTexels = new Map<string, number>();
  const materialWorldArea = new Map<string, number>();
  const materialRect = new Map<string, number>();
  let overlapPixels = 0;
  const owner = new Int16Array(size * size);
  const materialIndex = new Map<string, number>();

  const materialMask = (material: string, uv: boolean) => {
    const map = uv ? materialUv : materialOpaque;
    let mask = map.get(material);
    if (!mask) {
      mask = new Uint8Array(size * size);
      map.set(material, mask);
    }
    return mask;
  };

  for (const primitive of run.primitives) {
    const material = primitive.material;
    if (!materialIndex.has(material)) materialIndex.set(material, materialIndex.size);
    const index = materialIndex.get(material)!;
    const uvMaskFor = materialMask(material, true);
    const opaqueMaskFor = materialMask(material, false);
    const uvs = primitive.uvs;
    const triangles = Math.floor(uvs.length / 6);
    for (let t = 0; t < triangles; t++) {
      const ax = uvs[t * 6]! * size;
      const ay = uvs[t * 6 + 1]! * size;
      const bx = uvs[t * 6 + 2]! * size;
      const by = uvs[t * 6 + 3]! * size;
      const cx = uvs[t * 6 + 4]! * size;
      const cy = uvs[t * 6 + 5]! * size;
      const area2 = Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) / 2;
      materialAtlasTexels.set(material, (materialAtlasTexels.get(material) ?? 0) + area2);
      materialWorldArea.set(material, (materialWorldArea.get(material) ?? 0) + (primitive.areas[t] ?? 0));
      const callbacks = (pixel: number) => {
        uvMask[pixel] = 1;
        uvMaskFor[pixel] = 1;
        const previous = owner[pixel]!;
        if (previous === 0) owner[pixel] = index + 1;
        else if (previous > 0 && previous !== index + 1) {
          owner[pixel] = -1;
          overlapPixels++;
        }
        if (run.atlas.data[pixel * 4 + 3]! > 0) {
          opaqueMask[pixel] = 1;
          opaqueMaskFor[pixel] = 1;
        }
        const region = regionAt[pixel];
        if (region !== undefined && region >= 0) {
          const rect = byRegion.get(region)!;
          materialRect.set(material, (materialRect.get(material) ?? 0) + 1);
        }
      };
      raster(ax, ay, bx, by, cx, cy, size, callbacks);
    }
  }

  // Source texel demand: invert the remap per triangle and sample the source.
  const errors: number[] = [];
  const interior: number[] = [];
  const edge: number[] = [];
  const alphaErrors: number[] = [];
  const materialSourceTexels = new Map<string, number>();
  let triangles = 0;
  for (const primitive of run.primitives) triangles += Math.floor(primitive.uvs.length / 6);
  const stride = Math.max(1, Math.ceil((triangles * 4) / sampleBudget));
  const probes: { w: [number, number, number]; edge: boolean }[] = [
    { w: [1 / 3, 1 / 3, 1 / 3], edge: false },
    { w: [0.6, 0.2, 0.2], edge: false },
    { w: [0.2, 0.6, 0.2], edge: false },
    { w: [0.49, 0.49, 0.02], edge: true },
  ];

  for (const primitive of run.primitives) {
    const source = run.sources.get(primitive.material);
    const material = primitive.material;
    const uvs = primitive.uvs;
    const count = Math.floor(uvs.length / 6);
    for (let t = 0; t < count; t += stride) {
      const centroidX = (uvs[t * 6]! + uvs[t * 6 + 2]! + uvs[t * 6 + 4]!) / 3;
      const centroidY = (uvs[t * 6 + 1]! + uvs[t * 6 + 3]! + uvs[t * 6 + 5]!) / 3;
      const regionId = regionAt[
        Math.max(0, Math.min(size - 1, Math.floor(centroidY * size))) * size +
          Math.max(0, Math.min(size - 1, Math.floor(centroidX * size)))
      ]!;
      const region = regionId >= 0 ? byRegion.get(regionId) : undefined;
      if (!region || !region.min || !source?.image) continue;
      for (const probe of probes) {
        const [w0, w1, w2] = probe.w;
        const au =
          w0 * uvs[t * 6]! + w1 * uvs[t * 6 + 2]! + w2 * uvs[t * 6 + 4]!;
        const av =
          w0 * uvs[t * 6 + 1]! + w1 * uvs[t * 6 + 3]! + w2 * uvs[t * 6 + 5]!;
        const px = au * size;
        const py = av * size;
        const su = region.min[0] + ((px - region.x) / region.width) * region.tiles[0];
        const sv = region.min[1] + ((py - region.y) / region.height) * region.tiles[1];
        const wrapU = wrapMode(source.wrap[0]);
        const wrapV = wrapMode(source.wrap[1]);
        const expected = bakeSample(sampleBilinear(source.image, su, sv, wrapU, wrapV), {
          color: source.color,
          opacity: source.opacity,
          alphaMode: source.alphaMode,
          alphaCutoff: source.alphaCutoff,
        });
        const actual = sampleAtlasLinear(run.atlas, au, av);
        const difference =
          (Math.abs(expected[0] - actual[0]) +
            Math.abs(expected[1] - actual[1]) +
            Math.abs(expected[2] - actual[2])) /
          3;
        errors.push(difference);
        alphaErrors.push(Math.abs(expected[3] - actual[3]));
        (probe.edge ? edge : interior).push(difference);
      }
      // Exact source texel demand for this triangle.
      if (source?.image && region.min) {
        const su0 = region.min[0] + ((uvs[t * 6]! * size - region.x) / region.width) * region.tiles[0];
        const sv0 = region.min[1] + ((uvs[t * 6 + 1]! * size - region.y) / region.height) * region.tiles[1];
        const su1 = region.min[0] + ((uvs[t * 6 + 2]! * size - region.x) / region.width) * region.tiles[0];
        const sv1 = region.min[1] + ((uvs[t * 6 + 3]! * size - region.y) / region.height) * region.tiles[1];
        const su2 = region.min[0] + ((uvs[t * 6 + 4]! * size - region.x) / region.width) * region.tiles[0];
        const sv2 = region.min[1] + ((uvs[t * 6 + 5]! * size - region.y) / region.height) * region.tiles[1];
        const sourceArea =
          Math.abs((su1 - su0) * (sv2 - sv0) - (sv1 - sv0) * (su2 - su0)) / 2;
        materialSourceTexels.set(
          material,
          (materialSourceTexels.get(material) ?? 0) +
            sourceArea * source.image.width * source.image.height,
        );
      }
    }
  }

  const sortedErrors = [...errors].sort((a, b) => a - b);
  const mean = (values: number[]) =>
    values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  const count = (mask: Uint8Array | undefined) => {
    if (!mask) return 0;
    let total = 0;
    for (const value of mask) total += value ? 1 : 0;
    return total;
  };

  const materials = [...materialIndex.keys()].map((material) => {
    const worldArea = materialWorldArea.get(material) ?? 0;
    const atlasTexels = materialAtlasTexels.get(material) ?? 0;
    const sourceTexels = materialSourceTexels.get(material) ?? 0;
    return {
      material,
      worldArea,
      atlasTexels,
      sourceTexels,
      texelDensity: worldArea > 0 ? atlasTexels / worldArea : 0,
      sourceRatio: sourceTexels > 0 ? atlasTexels / sourceTexels : 0,
      uvPixels: count(materialUv.get(material)),
      opaquePixels: count(materialOpaque.get(material)),
      rectPixels: materialRect.get(material) ?? 0,
    };
  });

  const contentPixels = run.regions.reduce((sum, region) => sum + region.width * region.height, 0);
  const allocatedPixels = run.regions.reduce(
    (sum, region) => sum + (region.width + 2 * (run.report.padding ?? 2)) * (region.height + 2 * (run.report.padding ?? 2)),
    0,
  );
  const uvPixels = count(uvMask);
  const opaquePixels = count(opaqueMask);
  return {
    atlasSize: size,
    charts: run.regions.length,
    contentPixels,
    allocatedPixels,
    uvPixels,
    opaquePixels,
    overlapPixels,
    contentUtilization: contentPixels / (size * size),
    allocatedUtilization: allocatedPixels / (size * size),
    uvUtilization: uvPixels / (size * size),
    opaqueUtilization: opaquePixels / (size * size),
    materials,
    error: {
      samples: errors.length,
      meanAbs: mean(errors),
      p95: sortedErrors.length
        ? sortedErrors[Math.min(sortedErrors.length - 1, Math.floor(sortedErrors.length * 0.95))]!
        : 0,
      maxAbs: sortedErrors.length ? sortedErrors[sortedErrors.length - 1]! : 0,
      edgeMeanAbs: mean(edge),
      interiorMeanAbs: mean(interior),
    },
  };
}

const wrapMode = (code: number) =>
  code === 33071 ? 'clamp' : code === 33648 ? 'mirror' : 'repeat';

function raster(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  size: number,
  onPixel: (pixel: number) => void,
) {
  const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  if (Math.abs(area) < 1e-9) {
    const x = Math.max(0, Math.min(size - 1, Math.floor((ax + bx + cx) / 3)));
    const y = Math.max(0, Math.min(size - 1, Math.floor((ay + by + cy) / 3)));
    onPixel(y * size + x);
    return;
  }
  const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
  const x1 = Math.min(size - 1, Math.ceil(Math.max(ax, bx, cx)));
  const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy)));
  const y1 = Math.min(size - 1, Math.ceil(Math.max(ay, by, cy)));
  const e0dx = ay - by;
  const e1dx = by - cy;
  const e2dx = cy - ay;
  const startX = x0 + 0.5;
  for (let y = y0; y <= y1; y++) {
    const py = y + 0.5;
    let e0 = (bx - ax) * (py - ay) - (by - ay) * (startX - ax);
    let e1 = (cx - bx) * (py - by) - (cy - by) * (startX - bx);
    let e2 = (ax - cx) * (py - cy) - (ay - cy) * (startX - cx);
    for (let x = x0; x <= x1; x++, e0 += e0dx, e1 += e1dx, e2 += e2dx) {
      if (!((e0 >= 0 && e1 >= 0 && e2 >= 0) || (e0 <= 0 && e1 <= 0 && e2 <= 0))) continue;
      onPixel(y * size + x);
    }
  }
}

/** Decode a PNG written by a research run (used by report tooling). */
export async function loadPng(path: string): Promise<RgbaImage> {
  const bytes = await readFile(path);
  const { data, info } = await sharp(bytes)
    .toColourspace('srgb')
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    width: info.width,
    height: info.height,
    data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    key: path,
  };
}
