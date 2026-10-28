import {
  bakeBaseColorPixels,
  resolveAlpha,
  srgbToLinear,
  type AlphaMode,
} from '../../src/texture-pixels.ts';
import {
  buildUvCharts,
  normalizeWrapMode,
  sampleWrappedRgba,
  unwrapChartBounds,
  type WrapMode,
} from '../../src/texture-chart-math.ts';
import {
  planAtlasBudget,
  type AtlasBudgetOptions,
} from '../../src/atlas-core/plan.ts';
import type { ChartInput as CoreChartInput } from '../../src/atlas-core/types.ts';
import { yieldToBrowser } from './progress.ts';
import type { AtlasBuild, AtlasRect, TextureSource, Vec3 } from './types.ts';

export interface AtlasInput {
  key: string;
  texture: TextureSource | null;
  /** Continuous, unwrapped UV rectangle of the material (may leave 0..1). */
  uvBounds: [number, number, number, number] | null;
  /** Flat per-triangle UVs: u0,v0,u1,v1,u2,v2 for each triangle. */
  uvs?: Float32Array | null;
  /** World-space area per triangle; island demand falls back to `area`. */
  triangleAreas?: Float32Array | null;
  /** sRGB tint, 0..1. */
  color: Vec3;
  opacity: number;
  /** glTF alpha semantics; defaults to BLEND when omitted. */
  alphaMode?: AlphaMode;
  alphaCutoff?: number;
  /** Used to apportion atlas space when per-triangle areas are absent. */
  area: number;
}

/** One packed UV island. Flat materials get one chart with `bounds: null`. */
export interface AtlasChart {
  /** Unique within the layout. */
  key: string;
  /** `AtlasInput.key` this island belongs to. */
  inputKey: string;
  rect: AtlasRect;
  /** Continuous unwrapped bounds, null for a flat / untextured chart. */
  bounds: [number, number, number, number] | null;
  /** Whole-tile span, capped at 16 (diagnostic / allocation safety). */
  tiles: [number, number];
  wrap: [WrapMode, WrapMode];
  /** Triangle indices inside the input's UV list. */
  triangles: number[];
  /** Surface area used for this island's demand. */
  area: number;
}

export interface AtlasLayout {
  size: number;
  rects: Map<string, AtlasRect>;
  charts: AtlasChart[];
  /** Applied demand scale after shrinking to fit, 1 when everything fit immediately. */
  scale: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Sublinear demand keeps one dominant island from crowding out small details. */
const ALLOCATION_POWER = 0.85;
/** Minimum content edge for textured charts; small eye highlights stay sampleable. */
const MIN_CHART = 3;
/** Flat materials only need one sampleable texel. */
const MIN_FLAT = 1;
const MAX_ASPECT = 32;

interface PendingChart {
  key: string;
  inputKey: string;
  bounds: [number, number, number, number] | null;
  tiles: [number, number];
  wrap: [WrapMode, WrapMode];
  triangles: number[];
  area: number;
  aspect: number;
  textured: boolean;
}

interface AtlasBox {
  key: string;
  width: number;
  height: number;
}

const boxArea = (box: AtlasBox) => box.width * box.height;
const boxOrder = (order: string, box: AtlasBox) => {
  switch (order) {
    case 'height':
      return box.height;
    case 'width':
      return box.width;
    case 'max':
      return Math.max(box.width, box.height);
    default:
      return boxArea(box);
  }
};

/** Rectangle-only MaxRects-style packer. Boxes are content size; `pad` is added here. */
function packBoxes(
  boxes: readonly AtlasBox[],
  size: number,
  pad: number,
  orders: readonly string[],
): { rects: Map<string, AtlasRect>; score: number } | null {
  let best: { rects: Map<string, AtlasRect>; score: number } | null = null;
  for (const order of orders) {
    let free: AtlasRect[] = [{ x: 0, y: 0, width: size, height: size, pad: 0 }];
    const rects = new Map<string, AtlasRect>();
    let usedRight = 0,
      usedBottom = 0;
    let failed = false;
    for (const box of [...boxes].sort(
      (a, b) => boxOrder(order, b) - boxOrder(order, a) || a.key.localeCompare(b.key),
    )) {
      const width = box.width + pad * 2;
      const height = box.height + pad * 2;
      if (width > size || height > size) {
        failed = true;
        break;
      }
      const choices = free
        .filter((rect) => width <= rect.width && height <= rect.height)
        .sort(
          (a, b) =>
            Math.min(a.width - width, a.height - height) -
              Math.min(b.width - width, b.height - height) ||
            Math.max(a.width - width, a.height - height) -
              Math.max(b.width - width, b.height - height) ||
            a.y - b.y ||
            a.x - b.x,
        );
      const fit = choices[0];
      if (!fit) {
        failed = true;
        break;
      }
      const used = { x: fit.x, y: fit.y, width, height };
      rects.set(box.key, { ...used, pad });
      usedRight = Math.max(usedRight, used.x + used.width);
      usedBottom = Math.max(usedBottom, used.y + used.height);
      const next: AtlasRect[] = [];
      for (const rect of free) {
        if (
          used.x >= rect.x + rect.width ||
          used.x + used.width <= rect.x ||
          used.y >= rect.y + rect.height ||
          used.y + used.height <= rect.y
        ) {
          next.push(rect);
          continue;
        }
        if (used.x > rect.x) next.push({ ...rect, width: used.x - rect.x });
        if (used.x + used.width < rect.x + rect.width)
          next.push({
            ...rect,
            x: used.x + used.width,
            width: rect.x + rect.width - used.x - used.width,
          });
        if (used.y > rect.y) next.push({ ...rect, height: used.y - rect.y });
        if (used.y + used.height < rect.y + rect.height)
          next.push({
            ...rect,
            y: used.y + used.height,
            height: rect.y + rect.height - used.y - used.height,
          });
      }
      free = next.filter(
        (rect, index) =>
          !next.some(
            (other, otherIndex) =>
              index !== otherIndex &&
              other.x <= rect.x &&
              other.y <= rect.y &&
              other.x + other.width >= rect.x + rect.width &&
              other.y + other.height >= rect.y + rect.height &&
              (other.x !== rect.x ||
                other.y !== rect.y ||
                other.width !== rect.width ||
                other.height !== rect.height ||
                otherIndex < index),
          ),
      );
    }
    if (failed) continue;
    const score = Math.max(usedRight, usedBottom) * size + usedRight + usedBottom;
    if (!best || score < best.score) best = { rects, score };
  }
  return best;
}

/**
 * Build the UV islands for one input. Materials with triangle UVs use the
 * shared desktop chart splitter; legacy flat inputs keep their single rect.
 */
function chartsFor(input: AtlasInput): PendingChart[] {
  const wrap: [WrapMode, WrapMode] = [
    normalizeWrapMode(input.texture?.wrapS ?? 1000),
    normalizeWrapMode(input.texture?.wrapT ?? 1000),
  ];
  const single = (
    bounds: [number, number, number, number] | null,
    triangles: number[],
  ): PendingChart => {
    const unwrapped = bounds
      ? unwrapChartBounds(bounds[0], bounds[1], bounds[2], bounds[3])
      : null;
    return {
      key: `${input.key}#0`,
      inputKey: input.key,
      bounds: unwrapped?.bounds ?? null,
      tiles: unwrapped?.tiles ?? [1, 1],
      wrap,
      triangles,
      area: input.area,
      aspect: aspectOf(input, bounds),
      textured: !!input.texture && !!bounds,
    };
  };

  const uvs = input.uvs;
  const allTriangles = uvs
    ? Array.from({ length: Math.floor(uvs.length / 6) }, (_, index) => index)
    : [];
  if (!input.texture || !input.uvBounds) return [single(null, allTriangles)];
  if (!uvs || uvs.length < 6) return [single(input.uvBounds, allTriangles)];
  const charts = buildUvCharts(uvs);
  if (!charts.length) return [single(input.uvBounds, allTriangles)];
  const triangleAreas = input.triangleAreas;
  const perTriangle = input.area / Math.max(1, Math.floor(uvs.length / 6));
  return charts.map((chart, index) => {
    const unwrapped = unwrapChartBounds(
      chart.minU,
      chart.minV,
      chart.maxU,
      chart.maxV,
    );
    let area = 0;
    if (triangleAreas && triangleAreas.length >= chart.triangles.length) {
      for (const triangle of chart.triangles) area += triangleAreas[triangle] ?? 0;
    } else area = perTriangle * chart.triangles.length;
    const bounds = unwrapped.bounds;
    return {
      key: `${input.key}#${index}`,
      inputKey: input.key,
      bounds,
      tiles: unwrapped.tiles,
      wrap,
      triangles: chart.triangles,
      area,
      aspect: aspectOf(input, bounds),
      textured: true,
    };
  });
}

function aspectOf(input: AtlasInput, bounds: [number, number, number, number] | null) {
  if (!input.texture || !bounds) return 1;
  const width = Math.max(0, bounds[2] - bounds[0]) * input.texture.width;
  const height = Math.max(0, bounds[3] - bounds[1]) * input.texture.height;
  if (!(width > 1e-6) || !(height > 1e-6)) return 1;
  return clamp(width / height, 1 / MAX_ASPECT, MAX_ASPECT);
}

/**
 * Opt-in planner selection for the browser.
 *
 * The default path is the historical browser planner. `budget` switches to the
 * shared `src/atlas-core` planner that the desktop adapter uses, so both
 * platforms produce the same rectangles for the same input.
 */
export interface AtlasPlanOptions {
  budget?: 'texel-density' | 'texel-retention';
  /** Priority by `AtlasInput.key`, default 1. */
  weights?: Record<string, number>;
  /** Overlay charts that read exactly the same source pixels. */
  sharing?: 'safe';
}

function planWithBudget(
  inputs: readonly AtlasInput[],
  size: number,
  pad: number,
  options: AtlasPlanOptions,
): AtlasLayout {
  const unique: AtlasInput[] = [];
  const usedKeys = new Set<string>();
  for (const input of inputs) {
    let key = input.key;
    let suffix = 1;
    while (usedKeys.has(key)) key = `${input.key}~${suffix++}`;
    usedKeys.add(key);
    unique.push(key === input.key ? input : { ...input, key });
  }
  const coreInputs: CoreChartInput[] = unique.map((input) => ({
    id: input.key,
    material: input.key,
    materialKey: input.key,
    texture: input.texture
      ? { width: input.texture.width, height: input.texture.height, key: input.texture.key }
      : null,
    color: input.color,
    opacity: input.opacity,
    alphaMode: input.alphaMode ?? 'BLEND',
    alphaCutoff: input.alphaCutoff ?? 0.5,
    wrap: [
      normalizeWrapMode(input.texture?.wrapS ?? 1000),
      normalizeWrapMode(input.texture?.wrapT ?? 1000),
    ],
    bounds: input.uvBounds,
    uvs: input.uvs ?? null,
    triangleAreas: input.triangleAreas ?? null,
    area: input.area,
  }));
  const budgetOptions: AtlasBudgetOptions = {
    size,
    pad,
    target: options.budget === 'texel-density' ? 'density' : 'retention',
    coverageAware: false,
    sharing: options.sharing ?? 'none',
    merge: 'production',
    ...(options.weights ? { weights: options.weights } : {}),
  };
  const planned = planAtlasBudget(coreInputs, budgetOptions);
  const byKey = new Map(unique.map((input) => [input.key, input]));
  const charts: AtlasChart[] = planned.plan.charts.map((chart) => {
    const input = byKey.get(chart.inputId)!;
    const group = chart.triangles?.find((entry) => entry.inputId === chart.inputId);
    const triangles = group?.triangles ?? [];
    let area = 0;
    if (input.triangleAreas?.length) {
      for (const triangle of triangles) area += input.triangleAreas[triangle] ?? 0;
    } else if (triangles.length && input.uvs?.length) {
      area = (input.area * triangles.length) / Math.max(1, input.uvs.length / 6);
    } else area = input.area;
    return {
      key: chart.chartId,
      inputKey: chart.inputId,
      rect: chart.rect,
      bounds: chart.bounds,
      tiles: chart.tiles,
      wrap: chart.wrap,
      triangles,
      area,
    };
  });
  const rects = new Map<string, AtlasRect>();
  const perInput = new Map<string, AtlasChart[]>();
  for (const chart of charts) {
    const group = perInput.get(chart.inputKey) ?? [];
    group.push(chart);
    perInput.set(chart.inputKey, group);
  }
  for (const [inputKey, group] of perInput) {
    if (group.length === 1) rects.set(inputKey, group[0]!.rect);
    else for (const chart of group) rects.set(chart.key, chart.rect);
  }
  return { size, rects, charts, scale: planned.plan.scale };
}

/**
 * Plan the 128 px atlas per UV island. Islands use the desktop's sublinear
 * surface-area demand, 3×3 minimum and unwrapped aspect; flat materials keep a
 * single sampleable texel. Packing stays deterministic and unit-testable.
 */
export function planAtlas(
  inputs: readonly AtlasInput[],
  size = 128,
  pad = 1,
  options: AtlasPlanOptions = {},
): AtlasLayout {
  if (options.budget) return planWithBudget(inputs, size, pad, options);
  const charts = inputs.flatMap(chartsFor);
  if (!charts.length) return { size, rects: new Map(), charts: [], scale: 1 };
  // Duplicate material keys must not collide inside the rect map.
  const usedKeys = new Set<string>();
  for (const chart of charts) {
    let key = chart.key;
    let suffix = 1;
    while (usedKeys.has(key)) key = `${chart.key}~${suffix++}`;
    chart.key = key;
    usedKeys.add(key);
  }

  const contentLimit = Math.max(1, size - pad * 2);
  const usable = contentLimit * contentLimit;
  const demand = charts.map((chart) =>
    chart.textured ? Math.pow(Math.max(1e-8, chart.area), ALLOCATION_POWER) : 0,
  );
  const totalDemand = demand.reduce((sum, value) => sum + value, 0);
  const dimensionsAt = (scale: number): AtlasBox[] =>
    charts.map((chart, index) => {
      if (!chart.textured)
        return { key: chart.key, width: MIN_FLAT, height: MIN_FLAT };
      const share = totalDemand > 0 ? demand[index]! / totalDemand : 0;
      const target = Math.max(MIN_CHART * MIN_CHART, usable * share * scale);
      const width = clamp(
        Math.round(Math.sqrt(target * chart.aspect)),
        MIN_CHART,
        contentLimit,
      );
      const height = clamp(
        Math.round(Math.sqrt(target / chart.aspect)),
        MIN_CHART,
        contentLimit,
      );
      return { key: chart.key, width, height };
    });

  const orders = ['area', 'max', 'height', 'width'] as const;
  const attempt = (scale: number): AtlasLayout | null => {
    const packed = packBoxes(dimensionsAt(scale), size, pad, orders);
    if (!packed) return null;
    const placed: AtlasChart[] = charts.map((chart) => ({
      key: chart.key,
      inputKey: chart.inputKey,
      rect: packed.rects.get(chart.key)!,
      bounds: chart.bounds,
      tiles: chart.tiles,
      wrap: chart.wrap,
      triangles: chart.triangles,
      area: chart.area,
    }));
    const rects = new Map<string, AtlasRect>();
    const perInput = new Map<string, AtlasChart[]>();
    for (const chart of placed) {
      const group = perInput.get(chart.inputKey) ?? [];
      group.push(chart);
      perInput.set(chart.inputKey, group);
    }
    // Keep the historical one-key-per-material map for single-island inputs;
    // multi-island materials are keyed per chart (and `charts` carries them).
    for (const [inputKey, group] of perInput)
      if (group.length === 1) rects.set(inputKey, group[0]!.rect);
      else for (const chart of group) rects.set(chart.key, chart.rect);
    return { size, rects, charts: placed, scale };
  };

  const full = attempt(1);
  if (full) return full;
  let best = attempt(0);
  if (!best)
    throw new Error('材质与 UV 岛数量超过 128×128 图集可安全容纳的数量');
  let low = 0,
    high = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (low + high) / 2;
    const layout = attempt(mid);
    if (layout) {
      best = layout;
      low = mid;
    } else high = mid;
  }
  return best;
}

/** Decoded source pixels, reused by wrap-aware charts of the same texture. */
interface TexturePixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

const MAX_CACHED_TEXTURE_PIXELS = 24 * 1024 * 1024;
const MAX_CACHED_TEXTURES = 4;

/** Painter for the planned atlas. Tints and opacity are baked into pixels. */
export function renderAtlas(inputs: readonly AtlasInput[], layout: AtlasLayout): AtlasBuild {
  const { size, rects } = layout;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('当前浏览器无法创建 2D 画布');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';

  const byKey = new Map<string, AtlasInput>();
  for (const input of inputs) if (!byKey.has(input.key)) byKey.set(input.key, input);

  // A full texture read is only needed when a chart leaves 0..1. Cache the
  // decoded pixels per texture, not per material, and evict old entries so a
  // texture-heavy model does not keep every 4K image in memory at once.
  const pixelCache = new Map<string, TexturePixels>();
  let cachedPixels = 0;
  const texturePixels = (texture: TextureSource): TexturePixels | null => {
    const hit = pixelCache.get(texture.key);
    if (hit) {
      pixelCache.delete(texture.key);
      pixelCache.set(texture.key, hit);
      return hit;
    }
    const scratch = document.createElement('canvas');
    scratch.width = Math.max(1, texture.width);
    scratch.height = Math.max(1, texture.height);
    const scratchContext = scratch.getContext('2d', { willReadFrequently: true });
    if (!scratchContext) return null;
    scratchContext.drawImage(texture.image, 0, 0, scratch.width, scratch.height);
    const image = scratchContext.getImageData(0, 0, scratch.width, scratch.height);
    const pixels: TexturePixels = {
      width: image.width,
      height: image.height,
      data: image.data,
    };
    while (
      (cachedPixels + pixels.width * pixels.height > MAX_CACHED_TEXTURE_PIXELS ||
        pixelCache.size >= MAX_CACHED_TEXTURES) &&
      pixelCache.size
    ) {
      const oldest = pixelCache.keys().next().value;
      if (oldest === undefined) break;
      const evicted = pixelCache.get(oldest)!;
      cachedPixels -= evicted.width * evicted.height;
      pixelCache.delete(oldest);
    }
    pixelCache.set(texture.key, pixels);
    cachedPixels += pixels.width * pixels.height;
    return pixels;
  };

  for (const chart of layout.charts) {
    const input = byKey.get(chart.inputKey);
    if (!input) continue;
    const rect = chart.rect;
    const innerX = rect.x + rect.pad;
    const innerY = rect.y + rect.pad;
    const innerWidth = Math.max(1, rect.width - rect.pad * 2);
    const innerHeight = Math.max(1, rect.height - rect.pad * 2);
    const alphaMode = input.alphaMode ?? 'BLEND';
    const alphaCutoff = input.alphaCutoff ?? 0.5;
    const texture = input.texture;
    const bounds = chart.bounds;
    let image: ImageData | null = null;

    if (texture && bounds) {
      const spanU = bounds[2] - bounds[0];
      const spanV = bounds[3] - bounds[1];
      const inRange =
        bounds[0] >= 0 &&
        bounds[1] >= 0 &&
        bounds[2] <= 1 &&
        bounds[3] <= 1;
      if (inRange && spanU * texture.width >= 0.5 && spanV * texture.height >= 0.5) {
        // Fast and high quality: let the browser resample the source rect.
        const sx = clamp(bounds[0] * texture.width, 0, texture.width);
        const sy = clamp(bounds[1] * texture.height, 0, texture.height);
        const sw = Math.max(0, (bounds[2] - bounds[0]) * texture.width);
        const sh = Math.max(0, (bounds[3] - bounds[1]) * texture.height);
        context.clearRect(innerX, innerY, innerWidth, innerHeight);
        context.drawImage(
          texture.image,
          sx,
          sy,
          sw,
          sh,
          innerX,
          innerY,
          innerWidth,
          innerHeight,
        );
        image = context.getImageData(innerX, innerY, innerWidth, innerHeight);
      } else {
        // Negative / seam-crossing UVs: sample the source sampler virtually.
        const pixels = texturePixels(texture);
        if (pixels) {
          const sampled = context.createImageData(innerWidth, innerHeight);
          const out = [0, 0, 0, 0];
          for (let y = 0; y < innerHeight; y++) {
            const v =
              spanV > 1e-9
                ? bounds[1] + ((y + 0.5) / innerHeight) * spanV
                : (bounds[1] + bounds[3]) / 2;
            for (let x = 0; x < innerWidth; x++) {
              const u =
                spanU > 1e-9
                  ? bounds[0] + ((x + 0.5) / innerWidth) * spanU
                  : (bounds[0] + bounds[2]) / 2;
              sampleWrappedRgba(
                pixels.data,
                pixels.width,
                pixels.height,
                u,
                v,
                chart.wrap[0],
                chart.wrap[1],
                out,
              );
              const target = (y * innerWidth + x) * 4;
              sampled.data[target] = out[0]!;
              sampled.data[target + 1] = out[1]!;
              sampled.data[target + 2] = out[2]!;
              sampled.data[target + 3] = out[3]!;
            }
          }
          image = sampled;
        }
      }
    }

    if (!image) {
      context.clearRect(
        innerX - rect.pad,
        innerY - rect.pad,
        innerWidth + rect.pad * 2,
        innerHeight + rect.pad * 2,
      );
      context.fillStyle = rgba(
        input.color,
        resolveAlpha(input.opacity, alphaMode, alphaCutoff),
      );
      context.fillRect(
        innerX - rect.pad,
        innerY - rect.pad,
        innerWidth + rect.pad * 2,
        innerHeight + rect.pad * 2,
      );
      continue;
    }

    // Bake the base-color factor and alpha mode exactly like the Node atlas.
    bakeBaseColorPixels(image.data, {
      factor: [
        srgbToLinear(input.color[0]),
        srgbToLinear(input.color[1]),
        srgbToLinear(input.color[2]),
        input.opacity,
      ],
      alphaMode,
      alphaCutoff,
    });
    // Extend the chart edge into its pad. This keeps linear filtering from
    // sampling a neighboring chart or transparent atlas space at UV edges.
    const paddedWidth = innerWidth + rect.pad * 2;
    const paddedHeight = innerHeight + rect.pad * 2;
    const padded = context.createImageData(paddedWidth, paddedHeight);
    for (let y = 0; y < paddedHeight; y++) {
      const sy = clamp(y - rect.pad, 0, innerHeight - 1);
      for (let x = 0; x < paddedWidth; x++) {
        const sx = clamp(x - rect.pad, 0, innerWidth - 1);
        const source = (sy * innerWidth + sx) * 4;
        const target = (y * paddedWidth + x) * 4;
        for (let channel = 0; channel < 4; channel++)
          padded.data[target + channel] = image.data[source + channel]!;
      }
    }
    context.putImageData(padded, innerX - rect.pad, innerY - rect.pad);
  }

  return { canvas, size, rects, coverage: coverageOf(context, size) };
}

export interface AtlasMaterialUsage {
  name: string;
  /** Non-transparent pixels covered by this material's triangles. */
  pixels: number;
  /** Triangle-covered pixels, including transparent texels. */
  uvPixels?: number;
}

export interface AtlasUsage {
  /** Share of atlas pixels covered by at least one non-transparent triangle. */
  sampledUtilization: number;
  /** Share of atlas pixels covered by a triangle, including transparent texels. */
  uvUtilization: number;
  sampledPixels: number;
  uvPixels: number;
  /** 1 when a triangle covers the atlas pixel, including transparent texels. */
  uvMask: Uint8Array;
  /** Pixel count per material name; shared pixels count for every material. */
  materials: AtlasMaterialUsage[];
}

export interface AtlasUsageOptions {
  /** Called before each material is rasterized, so the UI can show `3/12`. */
  onProgress?: (done: number, total: number, name: string) => void;
}

/**
 * Rasterize the final atlas UVs to measure how many pixels each material
 * actually covers. Mirrors the desktop workbench's texture report.
 */
export async function measureAtlasUsage(
  canvas: HTMLCanvasElement,
  batches: readonly { name: string; positions: Float32Array; uvs: Float32Array | null }[],
  size: number,
  options: AtlasUsageOptions = {},
): Promise<AtlasUsage> {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return { sampledUtilization: 0, uvUtilization: 0, sampledPixels: 0, uvPixels: 0, uvMask: new Uint8Array(size * size), materials: [] };
  const alpha = context.getImageData(0, 0, size, size).data;
  const used = new Uint8Array(size * size);
  const uvUsed = new Uint8Array(size * size);
  const masks = new Map<string, Uint8Array>();
  const uvMasks = new Map<string, Uint8Array>();
  const maskFor = (name: string, uv: boolean) => {
    const map = uv ? uvMasks : masks;
    let mask = map.get(name);
    if (!mask) {
      mask = new Uint8Array(size * size);
      map.set(name, mask);
    }
    return mask;
  };

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex]!;
    options.onProgress?.(batchIndex, batches.length, batch.name);
    await yieldToBrowser();
    const mask = maskFor(batch.name, false);
    const uvMask = maskFor(batch.name, true);
    const uvs = batch.uvs;
    if (!uvs) continue;
    const triangles = Math.min(batch.positions.length / 9, uvs.length / 6);
    for (let t = 0; t < triangles; t++) {
      const a = t * 3;
      const ax = uvs[a * 2]! * size;
      const ay = uvs[a * 2 + 1]! * size;
      const bx = uvs[(a + 1) * 2]! * size;
      const by = uvs[(a + 1) * 2 + 1]! * size;
      const cx = uvs[(a + 2) * 2]! * size;
      const cy = uvs[(a + 2) * 2 + 1]! * size;
      const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      if (Math.abs(area) < 1e-8) {
        const x = Math.max(0, Math.min(size - 1, Math.floor((ax + bx + cx) / 3)));
        const y = Math.max(0, Math.min(size - 1, Math.floor((ay + by + cy) / 3)));
        const index = y * size + x;
        uvMask[index] = 1;
        uvUsed[index] = 1;
        if (alpha[index * 4 + 3]! !== 0) {
          mask[index] = 1;
          used[index] = 1;
        }
        continue;
      }
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
      const x1 = Math.min(size - 1, Math.ceil(Math.max(ax, bx, cx)));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy)));
      const y1 = Math.min(size - 1, Math.ceil(Math.max(ay, by, cy)));
      // Edge functions are linear, so step them along each scanline instead of
      // recomputing three cross products per pixel.
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
          const index = y * size + x;
          uvMask[index] = 1;
          uvUsed[index] = 1;
          if (alpha[index * 4 + 3]! === 0) continue;
          mask[index] = 1;
          used[index] = 1;
        }
      }
    }
  }

  let covered = 0;
  for (const value of used) covered += value;
  let uvCovered = 0;
  for (const value of uvUsed) uvCovered += value;
  return {
    sampledUtilization: covered / (size * size),
    uvUtilization: uvCovered / (size * size),
    sampledPixels: covered,
    uvPixels: uvCovered,
    uvMask: uvUsed,
    materials: [...masks].map(([name, mask]) => ({
      name,
      pixels: mask.reduce((sum, value) => sum + value, 0),
      uvPixels: uvMasks.get(name)!.reduce((sum, value) => sum + value, 0),
    })),
  };
}

const rgba = (color: Vec3, alpha: number) =>
  `rgba(${Math.round(color[0] * 255)},${Math.round(color[1] * 255)},${Math.round(color[2] * 255)},${clamp(alpha, 0, 1)})`;

function coverageOf(context: CanvasRenderingContext2D, size: number) {
  const data = context.getImageData(0, 0, size, size).data;
  let used = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i]! > 0) used++;
  return used / (size * size);
}

/**
 * Rewrite image-space UVs into atlas space. Mutates the supplied array.
 * `triangles` limits the work to one island; no 0..1 clamp is applied because
 * the island bounds are already continuous and unwrapped.
 */
export function remapUvs(
  uvs: Float32Array,
  bounds: [number, number, number, number] | null,
  rect: AtlasRect,
  size: number,
  triangles?: readonly number[],
) {
  const innerX = rect.x + rect.pad;
  const innerY = rect.y + rect.pad;
  const innerWidth = Math.max(1, rect.width - rect.pad * 2);
  const innerHeight = Math.max(1, rect.height - rect.pad * 2);
  const spanU = bounds ? bounds[2] - bounds[0] : 0;
  const spanV = bounds ? bounds[3] - bounds[1] : 0;
  const mapCorner = (index: number) => {
    const u = bounds && spanU > 1e-6 ? (uvs[index]! - bounds[0]) / spanU : 0.5;
    const v = bounds && spanV > 1e-6 ? (uvs[index + 1]! - bounds[1]) / spanV : 0.5;
    uvs[index] = (innerX + u * innerWidth) / size;
    uvs[index + 1] = (innerY + v * innerHeight) / size;
  };
  if (triangles) {
    for (const triangle of triangles)
      for (let corner = 0; corner < 3; corner++) mapCorner((triangle * 3 + corner) * 2);
  } else {
    for (let i = 0; i < uvs.length; i += 2) mapCorner(i);
  }
}
