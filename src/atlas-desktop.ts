/**
 * Desktop adapter for the shared texel-budget planner.
 *
 * Opt-in (`TextureOptions.atlasBudget`). It builds the neutral `ChartInput[]`
 * from the glTF document, plans with `src/atlas-core`, paints the atlas from
 * the decoded source pixels, rewrites UVs and keeps every material's identity
 * (no cross-material merging). The legacy compact path is untouched.
 */
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type { Material, Primitive } from '@gltf-transform/core';
import type { Transform } from '@gltf-transform/extensions';
import { cloneDocument } from '@gltf-transform/functions';
import { planAtlasBudget } from './atlas-core/plan.ts';
import { summarizePlan } from './atlas-core/report.ts';
import { sampleArea, type RgbaImage } from './atlas-core/sample.ts';
import type { ChartInput } from './atlas-core/types.ts';
import { inspectModel } from './inspect.ts';
import { validateModel } from './validate-model.ts';
import type { IntermediateModel } from './model.ts';
import { materialKeyMap, readPartExtra } from './parts.ts';
import { normalizeWrapMode, type WrapMode } from './texture-chart-math.ts';
import {
  bakeBaseColorPixels,
  linearToSrgb,
  srgbToLinear,
} from './texture-pixels.ts';

export interface AtlasBudgetTextureOptions {
  /** Atlas edge in pixels. */
  size?: number;
  /** Gutter in pixels per side. */
  padding?: number;
  /** Allocation target shared with the browser planner. */
  target: 'texel-density' | 'texel-retention';
  /** Priority by material name, default 1. */
  materialWeights?: Record<string, number>;
  /** Merge only materials that read exactly the same source pixels. */
  sharing?: boolean;
  filter?: 'nearest' | 'lanczos3';
  /** Charge retention demand for sampled UV area instead of the bounding box. */
  coverageAware?: boolean;
}

interface Copy {
  primitive: Primitive;
  /** World area per triangle. */
  areas: Float32Array;
  /** Original transformed UVs, per vertex. */
  uvs: Float32Array;
  original: Float32Array;
}

interface Batch {
  material: Material | null;
  id: string;
  name: string;
  key: string;
  image: RgbaImage | null;
  textureKey: string | null;
  color: [number, number, number];
  opacity: number;
  alphaMode: 'OPAQUE' | 'MASK' | 'BLEND';
  alphaCutoff: number;
  wrap: [WrapMode, WrapMode];
  uvs: number[];
  areas: number[];
  owners: { primitive: Primitive; triangle: number }[];
  copies: Map<Primitive, Copy>;
  /** Part index per triangle, and the part table it indexes. */
  partIds: number[];
  partTable: { id: string; name: string }[];
  partIndexByPrimitive: Map<Primitive, number>;
  area: number;
}

const innerRect = (rect: { x: number; y: number; width: number; height: number; pad: number }) => ({
  x: rect.x + rect.pad,
  y: rect.y + rect.pad,
  width: Math.max(1, rect.width - rect.pad * 2),
  height: Math.max(1, rect.height - rect.pad * 2),
});

export async function optimizeTexturesWithBudget(
  input: IntermediateModel,
  options: AtlasBudgetTextureOptions,
) {
  validateModel(input);
  const size = options.size ?? 128;
  const padding = options.padding ?? 1;
  const filter = options.filter ?? 'lanczos3';
  if (!Number.isSafeInteger(size) || size < 1 || size > 8192)
    throw new Error('atlas size must be an integer in [1, 8192]');
  if (!Number.isSafeInteger(padding) || padding < 1 || padding > 64)
    throw new Error('padding must be an integer in [1, 64]');

  const inspection = await inspectModel(input);
  const model: IntermediateModel = {
    ...input,
    document: cloneDocument(input.document),
    source: { ...input.source },
    warnings: [...inspection.warnings],
  };
  const doc = model.document;
  const root = doc.getRoot();

  const decodeCache = new Map<string, RgbaImage>();
  const decode = async (bytes: Uint8Array): Promise<RgbaImage> => {
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
    };
    decodeCache.set(key, image);
    return image;
  };

  const materialKeyById = materialKeyMap(doc);
  const batches = new Map<Material | null, Batch>();
  for (const mesh of root.listMeshes()) {
    const instances = root.listNodes().filter((node) => node.getMesh() === mesh);
    for (const primitive of mesh.listPrimitives()) {
      const material = primitive.getMaterial();
      let batch = batches.get(material);
      if (!batch) {
        const texture = material?.getBaseColorTexture();
        const imageBytes = texture?.getImage();
        const image =
          imageBytes && imageBytes.byteLength ? await decode(imageBytes) : null;
        const info = material?.getBaseColorTextureInfo();
        const factor = material?.getBaseColorFactor() ?? [1, 1, 1, 1];
        const name = material?.getName() || '(default)';
        batch = {
          material,
          id: `m${batches.size}`,
          name,
          key: material
            ? (materialKeyById.get(material) ?? `m:${name}#1`)
            : 'm:(default)#0',
          image,
          textureKey: imageBytes
            ? createHash('sha256').update(imageBytes).digest('hex')
            : null,
          color: [
            linearToSrgb(factor[0]!),
            linearToSrgb(factor[1]!),
            linearToSrgb(factor[2]!),
          ],
          opacity: factor[3]!,
          alphaMode: (material?.getAlphaMode() as Batch['alphaMode']) ?? 'OPAQUE',
          alphaCutoff: material?.getAlphaCutoff() ?? 0.5,
          wrap: [
            normalizeWrapMode(info?.getWrapS() ?? 10497),
            normalizeWrapMode(info?.getWrapT() ?? 10497),
          ],
          uvs: [],
          areas: [],
          owners: [],
          copies: new Map(),
          partIds: [],
          partTable: [],
          partIndexByPrimitive: new Map(),
          area: 0,
        };
        batches.set(material, batch);
      }

      const info = material?.getBaseColorTextureInfo();
      const transform = info?.getExtension<Transform>('KHR_texture_transform');
      const coordinate = transform?.getTexCoord() ?? info?.getTexCoord() ?? 0;
      const uv =
        primitive.getAttribute(`TEXCOORD_${coordinate}`) ??
        primitive.getAttribute('TEXCOORD_0');
      const position = primitive.getAttribute('POSITION');
      if (!position) continue;
      const indices =
        primitive.getIndices()?.getArray() ??
        Uint32Array.from({ length: position.getCount() }, (_, index) => index);
      const triangles = Math.floor(indices.length / 3);
      const vertexUvs = new Float32Array(position.getCount() * 2);
      const offset = transform?.getOffset() ?? [0, 0];
      const scaling = transform?.getScale() ?? [1, 1];
      const angle = transform?.getRotation() ?? 0;
      const value: number[] = [];
      for (let i = 0; i < position.getCount(); i++) {
        uv?.getElement(i, value);
        const x = (value[0] ?? 0.5) * scaling[0]!;
        const y = (value[1] ?? 0.5) * scaling[1]!;
        vertexUvs[i * 2] =
          offset[0]! + Math.cos(angle) * x - Math.sin(angle) * y;
        vertexUvs[i * 2 + 1] =
          offset[1]! + Math.sin(angle) * x + Math.cos(angle) * y;
        value.length = 0;
      }
      const areas = new Float32Array(triangles);
      const world = new Float32Array(position.getCount() * 3);
      for (const node of instances) {
        const matrix = node.getWorldMatrix();
        for (let i = 0; i < position.getCount(); i++) {
          position.getElement(i, value);
          world[i * 3] = matrix[0]! * value[0]! + matrix[4]! * value[1]! + matrix[8]! * value[2]! + matrix[12]!;
          world[i * 3 + 1] = matrix[1]! * value[0]! + matrix[5]! * value[1]! + matrix[9]! * value[2]! + matrix[13]!;
          world[i * 3 + 2] = matrix[2]! * value[0]! + matrix[6]! * value[1]! + matrix[10]! * value[2]! + matrix[14]!;
          value.length = 0;
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
      const extra = readPartExtra(primitive.getExtras());
      let partIndex = batch.partIndexByPrimitive.get(primitive);
      if (partIndex === undefined) {
        partIndex = batch.partTable.length;
        batch.partTable.push({
          id: extra?.id ?? `${batch.key}#${partIndex}`,
          name: extra?.name ?? `${batch.name}#${partIndex}`,
        });
        batch.partIndexByPrimitive.set(primitive, partIndex);
      }
      for (let t = 0; t < triangles; t++) {
        for (let corner = 0; corner < 3; corner++) {
          const vertex = indices[t * 3 + corner]!;
          batch.uvs.push(vertexUvs[vertex * 2]!, vertexUvs[vertex * 2 + 1]!);
        }
        batch.areas.push(areas[t] ?? 0);
        batch.partIds.push(partIndex);
        batch.owners.push({ primitive, triangle: t });
        batch.area += areas[t] ?? 0;
      }
      batch.copies.set(primitive, { primitive, areas, uvs: vertexUvs, original: Float32Array.from(vertexUvs) });
    }
  }

  const boundsOf = (uvs: number[]): [number, number, number, number] | null => {
    if (!uvs.length) return null;
    const low: [number, number] = [Infinity, Infinity];
    const high: [number, number] = [-Infinity, -Infinity];
    for (let i = 0; i < uvs.length; i += 2) {
      low[0] = Math.min(low[0], uvs[i]!);
      low[1] = Math.min(low[1], uvs[i + 1]!);
      high[0] = Math.max(high[0], uvs[i]!);
      high[1] = Math.max(high[1], uvs[i + 1]!);
    }
    return [low[0], low[1], high[0], high[1]];
  };

  const inputs: ChartInput[] = [...batches.values()].map((batch) => ({
    id: batch.id,
    material: batch.name,
    materialKey: batch.key,
    texture: batch.image && batch.textureKey
      ? { width: batch.image.width, height: batch.image.height, key: batch.textureKey }
      : null,
    color: batch.color,
    opacity: batch.opacity,
    alphaMode: batch.alphaMode,
    alphaCutoff: batch.alphaCutoff,
    wrap: batch.wrap,
    bounds: batch.image ? boundsOf(batch.uvs) : null,
    uvs: batch.uvs.length ? Float32Array.from(batch.uvs) : null,
    triangleAreas: batch.areas.length ? Float32Array.from(batch.areas) : null,
    area: batch.area,
    partIndex: batch.partIds.length ? Uint16Array.from(batch.partIds) : null,
    parts: batch.partTable,
  }));

  const planned = planAtlasBudget(inputs, {
    size,
    pad: padding,
    target: options.target === 'texel-density' ? 'density' : 'retention',
    coverageAware: options.coverageAware ?? false,
    sharing: options.sharing ? 'safe' : 'none',
    merge: 'production',
    ...(options.materialWeights ? { weights: options.materialWeights } : {}),
  });

  const atlas = Buffer.alloc(size * size * 4);
  const batchById = new Map([...batches.values()].map((batch) => [batch.id, batch]));
  const written = new Set<string>();

  for (const chart of planned.plan.charts) {
    const batch = batchById.get(chart.inputId);
    if (!batch) continue;
    const rectKey = `${chart.rect.x},${chart.rect.y},${chart.rect.width},${chart.rect.height}`;
    const inner = innerRect(chart.rect);
    if (!written.has(rectKey)) {
      written.add(rectKey);
      const innerPixels = Buffer.alloc(inner.width * inner.height * 4);
      if (!batch.image || !chart.bounds) {
        const alpha = batch.alphaMode === 'OPAQUE' ? 1 : batch.opacity;
        const color = [
          Math.round(Math.min(1, Math.max(0, batch.color[0])) * 255),
          Math.round(Math.min(1, Math.max(0, batch.color[1])) * 255),
          Math.round(Math.min(1, Math.max(0, batch.color[2])) * 255),
          Math.round(alpha * 255),
        ];
        for (let i = 0; i < innerPixels.length; i += 4) {
          innerPixels[i] = color[0]!;
          innerPixels[i + 1] = color[1]!;
          innerPixels[i + 2] = color[2]!;
          innerPixels[i + 3] = color[3]!;
        }
      } else {
        let offset = 0;
        for (let y = 0; y < inner.height; y++) {
          const v0 = chart.map.v + (y / inner.height) * chart.map.spanV;
          const v1 = chart.map.v + ((y + 1) / inner.height) * chart.map.spanV;
          for (let x = 0; x < inner.width; x++) {
            const u0 = chart.map.u + (x / inner.width) * chart.map.spanU;
            const u1 = chart.map.u + ((x + 1) / inner.width) * chart.map.spanU;
            const sample = sampleArea(
              batch.image,
              u0,
              v0,
              u1,
              v1,
              batch.wrap[0],
              batch.wrap[1],
            );
            innerPixels[offset] = Math.round(sample[0]);
            innerPixels[offset + 1] = Math.round(sample[1]);
            innerPixels[offset + 2] = Math.round(sample[2]);
            innerPixels[offset + 3] = Math.round(sample[3]);
            offset += 4;
          }
        }
      }
      bakeBaseColorPixels(innerPixels, {
        factor: [
          srgbToLinear(batch.color[0]),
          srgbToLinear(batch.color[1]),
          srgbToLinear(batch.color[2]),
          batch.opacity,
        ],
        alphaMode: batch.alphaMode,
        alphaCutoff: batch.alphaCutoff,
      });
      for (let y = -padding; y < inner.height + padding; y++)
        for (let x = -padding; x < inner.width + padding; x++) {
          const sx = Math.min(inner.width - 1, Math.max(0, x));
          const sy = Math.min(inner.height - 1, Math.max(0, y));
          const src = (sy * inner.width + sx) * 4;
          const dx = inner.x + x;
          const dy = inner.y + y;
          if (dx < 0 || dy < 0 || dx >= size || dy >= size) continue;
          const dst = (dy * size + dx) * 4;
          atlas[dst] = innerPixels[src]!;
          atlas[dst + 1] = innerPixels[src + 1]!;
          atlas[dst + 2] = innerPixels[src + 2]!;
          atlas[dst + 3] = innerPixels[src + 3]!;
        }
    }

    // Remap this chart's triangles into the atlas.
    if (!chart.bounds) {
      // Flat material: all of its UVs collapse to the centre of the 1×1 chart
      // so the baked atlas texel is sampled everywhere.
      const centreU = (inner.x + inner.width / 2) / size;
      const centreV = (inner.y + inner.height / 2) / size;
      for (const copy of batch.copies.values())
        for (let i = 0; i < copy.uvs.length; i += 2) {
          copy.uvs[i] = centreU;
          copy.uvs[i + 1] = centreV;
        }
      continue;
    }
    const group = chart.triangles?.find((entry) => entry.inputId === chart.inputId);
    if (!group) continue;
    const spanU = chart.map.spanU;
    const spanV = chart.map.spanV;
    for (const triangle of group.triangles) {
      const owner = batch.owners[triangle];
      if (!owner) continue;
      const copy = batch.copies.get(owner.primitive);
      if (!copy) continue;
      const indices =
        owner.primitive.getIndices()?.getArray() ??
        Uint32Array.from({ length: owner.primitive.getAttribute('POSITION')!.getCount() }, (_, i) => i);
      for (let corner = 0; corner < 3; corner++) {
        const vertex = indices[owner.triangle * 3 + corner]!;
        const u = copy.original[vertex * 2]!;
        const v = copy.original[vertex * 2 + 1]!;
        const local = spanU > 1e-9 ? (u - chart.map.u) / spanU : 0.5;
        const localV = spanV > 1e-9 ? (v - chart.map.v) / spanV : 0.5;
        copy.uvs[vertex * 2] = (inner.x + local * inner.width) / size;
        copy.uvs[vertex * 2 + 1] = (inner.y + localV * inner.height) / size;
      }
    }
  }

  for (const batch of batches.values())
    for (const copy of batch.copies.values()) {
      const accessor = doc
        .createAccessor()
        .setType('VEC2')
        .setArray(Float32Array.from(copy.uvs))
        .setBuffer(root.listBuffers()[0] ?? doc.createBuffer());
      copy.primitive.setAttribute('TEXCOORD_0', accessor);
    }

  const png = await sharp(atlas, { raw: { width: size, height: size, channels: 4 } })
    .png()
    .toBuffer();
  const texture = doc
    .createTexture('atlas')
    .setImage(new Uint8Array(png))
    .setMimeType('image/png')
    .setURI('atlas.png');

  for (const batch of batches.values()) {
    const material = batch.material ?? doc.createMaterial('default');
    for (const extension of material.listExtensions()) extension.dispose();
    material
      .setNormalTexture(null)
      .setMetallicRoughnessTexture(null)
      .setOcclusionTexture(null)
      .setEmissiveTexture(null)
      .setEmissiveFactor([0, 0, 0])
      .setMetallicFactor(0)
      .setRoughnessFactor(1)
      .setBaseColorFactor([1, 1, 1, 1])
      .setBaseColorTexture(texture);
    const info = material.getBaseColorTextureInfo()!;
    for (const extension of info.listExtensions()) extension.dispose();
    info
      .setTexCoord(0)
      .setWrapS(33071)
      .setWrapT(33071)
      .setMinFilter(filter === 'nearest' ? 9728 : 9729)
      .setMagFilter(filter === 'nearest' ? 9728 : 9729);
  }

  for (const material of root.listMaterials())
    if (
      !root
        .listMeshes()
        .some((mesh) =>
          mesh.listPrimitives().some((primitive) => primitive.getMaterial() === material),
        )
    )
      material.dispose();
  for (const old of root.listTextures())
    if (old !== texture && old.listParents().length === 1) old.dispose();
  for (const accessor of root.listAccessors())
    if (accessor.listParents().length === 1) accessor.dispose();

  model.warnings.push(
    'Atlas preserves base color and alpha only; PBR lighting/shader effects are not reproduced.',
  );
  validateModel(model);

  const floorBound = new Set(
    planned.charts.filter((chart) => chart.floorBound).map((chart) => chart.chartId),
  );
  const targetArea = new Map(
    planned.charts.map((chart) => [chart.chartId, chart.targetArea]),
  );
  const summary = summarizePlan(inputs, planned.plan, {
    floorBound,
    targetArea,
    sharedSavedPixels: planned.budget.sharedSavedPixels,
  });
  const chartIndex = new Map(
    planned.plan.charts.map((chart, index) => [chart.chartId, index]),
  );
  return {
    model,
    png,
    report: {
      originalTextures: inspection.textures.map((entry) => ({
        width: entry.width,
        height: entry.height,
        bytes: entry.bytes,
      })),
      atlas: {
        width: size,
        height: size,
        bytes: png.length,
        sampledUtilization: undefined,
        uvUtilization: summary.uvUtilization,
        contentUtilization: summary.contentUtilization,
        allocatedUtilization: summary.allocatedUtilization,
        sampledPixels: undefined,
        uvPixels: summary.uvPixels,
        contentPixels: summary.contentPixels,
        allocatedPixels: summary.allocatedPixels,
        gutterPixels: summary.gutterPixels,
        emptyPixels: summary.emptyPixels,
        gutterUtilization: summary.gutterPixels / (size * size),
        emptyUtilization: summary.emptyPixels / (size * size),
        chartCoverage: summary.chartCoverage,
      },
      filter,
      padding,
      allocation: options.target,
      materialWeights: options.materialWeights ?? {},
      shared: {
        charts: summary.sharedCharts,
        savedPixels: summary.sharedSavedPixels,
      },
      materials: summary.materials.map((material) => ({
        name: material.material,
        key: material.materialKey,
        pixels: material.uvPixels,
        uvPixels: material.uvPixels,
        regions: material.chartIds
          .map((id) => chartIndex.get(id))
          .filter((index): index is number => index !== undefined),
        atlasTexels: material.atlasTexels,
        sourceTexels: material.sourceTexels,
        texelDensity: material.texelDensity,
        floorCharts: material.floorCharts,
        rectPixels: material.rectPixels,
        wastePixels: material.wastePixels,
        targetArea: material.targetArea,
        actualArea: material.actualArea,
      })),
      parts: summary.parts,
      regions: planned.plan.charts.map((chart, index) => {
        const inner = innerRect(chart.rect);
        const batch = batchById.get(chart.inputId);
        return {
          id: index,
          material: chart.materials.join(' / ') || '(default)',
          materialKey: chart.materialKeys?.[0] ?? null,
          materials: chart.materials,
          surfaceAreas: {} as Record<string, number>,
          weightedArea: 0,
          x: inner.x,
          y: inner.y,
          width: inner.width,
          height: inner.height,
          source: batch?.image ? { width: batch.image.width, height: batch.image.height } : null,
          resized: { width: inner.width, height: inner.height },
          tiles: chart.tiles,
          crop: undefined,
        };
      }),
      warnings: model.warnings,
    },
  };
}
