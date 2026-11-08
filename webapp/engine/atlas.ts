import {
  bakeBaseColorPixels,
  resolveAlpha,
  srgbToLinear,
  type AlphaMode,
} from '../../src/texture-pixels.ts';
import {
  buildUvCharts,
  normalizeWrapMode,
  unwrapChartBounds,
  type WrapMode,
} from '../../src/texture-chart-math.ts';
import { sampleArea } from '../../src/atlas-core/sample.ts';
import {
  planAtlasBudget,
  type AtlasBudgetOptions,
  type AtlasBudgetResult,
} from '../../src/atlas-core/plan.ts';
import type { AtlasPlan, ChartInput as CoreChartInput } from '../../src/atlas-core/types.ts';
import type { PlanReport } from '../../src/atlas-core/report.ts';
import { summarizePlan } from '../../src/atlas-core/report.ts';
import { yieldToBrowser } from './progress.ts';
import type { AtlasBuild, AtlasRect, SourcePart, TextureSource, Vec3 } from './types.ts';

export interface AtlasInput {
  key: string;
  /** Display name; duplicate names are allowed. */
  materialName?: string;
  /** Stable material identity; defaults to `key`. */
  materialKey?: string;
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
  /** Per-triangle part index, optional; indexes `parts`. */
  partIndex?: Uint16Array | null;
  /** Part table for `partIndex`. */
  parts?: SourcePart[];
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
  /** True when this chart was moved into another chart's unused pixels. */
  overlap?: boolean;
}

export interface AtlasLayout {
  size: number;
  rects: Map<string, AtlasRect>;
  charts: AtlasChart[];
  /** Applied demand scale after shrinking to fit, 1 when everything fit immediately. */
  scale: number;
  /** Present when the shared texel-budget planner produced this layout. */
  budget?: {
    plan: AtlasPlan;
    charts: AtlasBudgetResult['charts'];
    floorBound: Set<string>;
    targetArea: Map<string, number>;
    sharedSavedPixels: number;
    report: PlanReport | null;
  };
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
  budget?: 'texel-density' | 'texel-retention' | 'texel-balanced';
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
    material: input.materialName ?? input.materialKey ?? input.key,
    materialKey: input.materialKey ?? input.key,
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
    ...(input.partIndex ? { partIndex: input.partIndex } : {}),
    ...(input.parts ? { parts: input.parts.map((part) => ({ id: part.id, name: part.name })) } : {}),
  }));
  const budgetOptions: AtlasBudgetOptions = {
    size,
    pad,
    target:
      options.budget === 'texel-density'
        ? 'density'
        : options.budget === 'texel-retention'
          ? 'retention'
          : 'balanced',
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
  const floorBound = new Set(
    planned.charts.filter((chart) => chart.floorBound).map((chart) => chart.chartId),
  );
  const targetArea = new Map(
    planned.charts.map((chart) => [chart.chartId, chart.targetArea]),
  );
  // Keep the planner pure: the browser adapter applies hole filling after
  // this returns, so the web plan still matches the shared core plan.
  const report = summarizePlan(coreInputs, planned.plan, {
    floorBound,
    targetArea,
    sharedSavedPixels: planned.budget.sharedSavedPixels,
  });
  return {
    size,
    rects,
    charts,
    scale: planned.plan.scale,
    budget: {
      plan: planned.plan,
      charts: planned.charts,
      floorBound,
      targetArea,
      sharedSavedPixels: planned.budget.sharedSavedPixels,
      report,
    },
  };
}

/** Mark a triangle's atlas pixels in a 0/1 mask. */
function rasterTriangle(
  mask: Uint8Array,
  width: number,
  height: number,
  points: readonly [number, number][],
  value: 0 | 1,
) {
  const [a, b, c] = points;
  if (!a || !b || !c) return;
  const ax = a[0];
  const ay = a[1];
  const bx = b[0];
  const by = b[1];
  const cx = c[0];
  const cy = c[1];
  const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  if (Math.abs(area) < 1e-8) {
    const x = Math.max(0, Math.min(width - 1, Math.floor((ax + bx + cx) / 3)));
    const y = Math.max(0, Math.min(height - 1, Math.floor((ay + by + cy) / 3)));
    mask[y * width + x] = value;
    return;
  }
  const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
  const x1 = Math.min(width - 1, Math.ceil(Math.max(ax, bx, cx)));
  const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy)));
  const y1 = Math.min(height - 1, Math.ceil(Math.max(ay, by, cy)));
  for (let y = y0; y <= y1; y++) {
    const py = y + 0.5;
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5;
      const e0 = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
      const e1 = (cx - bx) * (py - by) - (cy - by) * (px - bx);
      const e2 = (ax - cx) * (py - cy) - (ay - cy) * (px - cx);
      if (
        (e0 >= 0 && e1 >= 0 && e2 >= 0) ||
        (e0 <= 0 && e1 <= 0 && e2 <= 0)
      )
        mask[y * width + x] = value;
    }
  }
}

/** Mark a chart's triangle coverage, or its whole rect for flat materials. */
function markChartMask(
  chart: AtlasChart,
  input: AtlasInput,
  size: number,
  mask: Uint8Array,
  value: 0 | 1,
  fullRect: boolean,
) {
  const rect = chart.rect;
  if (fullRect || !chart.bounds || !input.uvs) {
    for (let y = Math.max(0, rect.y); y < Math.min(size, rect.y + rect.height); y++)
      for (let x = Math.max(0, rect.x); x < Math.min(size, rect.x + rect.width); x++)
        mask[y * size + x] = value;
    return;
  }
  const innerX = rect.x + rect.pad;
  const innerY = rect.y + rect.pad;
  const innerWidth = Math.max(1, rect.width - rect.pad * 2);
  const innerHeight = Math.max(1, rect.height - rect.pad * 2);
  const spanU = chart.bounds[2] - chart.bounds[0];
  const spanV = chart.bounds[3] - chart.bounds[1];
  const uvs = input.uvs;
  for (const triangle of chart.triangles) {
    const points: [number, number][] = [];
    for (let corner = 0; corner < 3; corner++) {
      const index = (triangle * 3 + corner) * 2;
      const u = spanU > 1e-6 ? (uvs[index]! - chart.bounds[0]) / spanU : 0.5;
      const v = spanV > 1e-6 ? (uvs[index + 1]! - chart.bounds[1]) / spanV : 0.5;
      points.push([innerX + u * innerWidth, innerY + v * innerHeight]);
    }
    rasterTriangle(mask, size, size, points, value);
  }
}

/** Tight pixel bounds of a chart's triangles inside its rectangle. */
function chartContentBounds(
  chart: AtlasChart,
  input: AtlasInput,
): { x: number; y: number; w: number; h: number; offsetX: number; offsetY: number } | null {
  if (!chart.bounds || !input.uvs || !chart.triangles.length) return null;
  const rect = chart.rect;
  const innerX = rect.x + rect.pad;
  const innerY = rect.y + rect.pad;
  const innerWidth = Math.max(1, rect.width - rect.pad * 2);
  const innerHeight = Math.max(1, rect.height - rect.pad * 2);
  const spanU = chart.bounds[2] - chart.bounds[0];
  const spanV = chart.bounds[3] - chart.bounds[1];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const triangle of chart.triangles) {
    for (let corner = 0; corner < 3; corner++) {
      const index = (triangle * 3 + corner) * 2;
      const u = spanU > 1e-6 ? (input.uvs[index]! - chart.bounds[0]) / spanU : 0.5;
      const v = spanV > 1e-6 ? (input.uvs[index + 1]! - chart.bounds[1]) / spanV : 0.5;
      const x = innerX + u * innerWidth;
      const y = innerY + v * innerHeight;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  const x0 = Math.max(rect.x, Math.floor(minX));
  const y0 = Math.max(rect.y, Math.floor(minY));
  const x1 = Math.min(rect.x + rect.width, Math.ceil(maxX));
  const y1 = Math.min(rect.y + rect.height, Math.ceil(maxY));
  return {
    x: x0,
    y: y0,
    w: Math.max(1, x1 - x0),
    h: Math.max(1, y1 - y0),
    offsetX: x0 - rect.x,
    offsetY: y0 - rect.y,
  };
}

/** Triangle coverage inside a chart's inner rectangle, for masked painting. */
function chartInnerMask(
  chart: AtlasChart,
  input: AtlasInput,
): Uint8Array | null {
  if (!chart.bounds || !input.uvs || !chart.triangles.length) return null;
  const rect = chart.rect;
  const innerWidth = Math.max(1, rect.width - rect.pad * 2);
  const innerHeight = Math.max(1, rect.height - rect.pad * 2);
  const spanU = chart.bounds[2] - chart.bounds[0];
  const spanV = chart.bounds[3] - chart.bounds[1];
  const mask = new Uint8Array(innerWidth * innerHeight);
  for (const triangle of chart.triangles) {
    const points: [number, number][] = [];
    for (let corner = 0; corner < 3; corner++) {
      const index = (triangle * 3 + corner) * 2;
      const u = spanU > 1e-6 ? (input.uvs[index]! - chart.bounds[0]) / spanU : 0.5;
      const v = spanV > 1e-6 ? (input.uvs[index + 1]! - chart.bounds[1]) / spanV : 0.5;
      points.push([u * innerWidth, v * innerHeight]);
    }
    rasterTriangle(mask, innerWidth, innerHeight, points, 1);
  }
  return mask;
}

function maskSat(mask: Uint8Array, size: number): Int32Array {
  const stride = size + 1;
  const sat = new Int32Array(stride * stride);
  for (let y = 0; y < size; y++) {
    let row = 0;
    for (let x = 0; x < size; x++) {
      row += mask[y * size + x]!;
      sat[(y + 1) * stride + (x + 1)] =
        sat[y * stride + (x + 1)]! + row;
    }
  }
  return sat;
}

function maskSum(
  sat: Int32Array,
  size: number,
  x: number,
  y: number,
  width: number,
  height: number,
): number {
  const stride = size + 1;
  return (
    sat[(y + height) * stride + (x + width)]! -
    sat[y * stride + (x + width)]! -
    sat[(y + height) * stride + x]! +
    sat[y * stride + x]!
  );
}

/**
 * Move and grow small charts into any triangle-free pixels of the atlas.
 * A host chart keeps its own rect and UVs, so its resolution is unchanged;
 * the small chart gets the previously wasted pixels. A few passes let the
 * rectangle freed by one chart feed the next, which is the recursive part of
 * the packing problem.
 */
export function fillAtlasHoles(
  charts: AtlasChart[],
  byKey: ReadonlyMap<string, AtlasInput>,
  size: number,
) {
  if (charts.length < 2) return;
  const used = new Uint8Array(size * size);
  for (const chart of charts) {
    const input = byKey.get(chart.inputKey);
    if (!input) continue;
    markChartMask(chart, input, size, used, 1, !chart.bounds || !input.uvs);
  }

  const ordered = [...charts].sort(
    (a, b) => a.rect.width * a.rect.height - b.rect.width * b.rect.height,
  );
  const SCALES = [16, 12, 10, 8, 6, 4, 3, 2, 1.5, 1];
  for (let pass = 0; pass < 3; pass++) {
    let moves = 0;
    for (const chart of ordered) {
      const input = byKey.get(chart.inputKey);
      if (!input) continue;
      const content = chartContentBounds(chart, input);
      if (!content) continue;
      const oldX = content.x;
      const oldY = content.y;
      markChartMask(chart, input, size, used, 0, false);
      const sat = maskSat(used, size);
      let found: { x: number; y: number; width: number; height: number } | null = null;
      for (const scale of SCALES) {
        const newWidth = Math.max(1, Math.round(chart.rect.width * scale));
        const newHeight = Math.max(1, Math.round(chart.rect.height * scale));
        if (newWidth > size || newHeight > size) continue;
        const scaleX = newWidth / chart.rect.width;
        const scaleY = newHeight / chart.rect.height;
        const width = Math.max(1, Math.ceil(content.w * scaleX) + 1);
        const height = Math.max(1, Math.ceil(content.h * scaleY) + 1);
        if (width > size || height > size) continue;
        const offsetX = Math.round(content.offsetX * scaleX);
        const offsetY = Math.round(content.offsetY * scaleY);
        for (let y = 0; y + height <= size && !found; y++) {
          for (let x = 0; x + width <= size; x++) {
            // Keep the exact old placement for a pure move; scale-ups may
            // overlap their own freed content and grow in place.
            if (scale === 1 && x === oldX && y === oldY) continue;
            if (maskSum(sat, size, x, y, width, height) !== 0) continue;
            const newX = x - offsetX;
            const newY = y - offsetY;
            if (
              newX < 0 ||
              newY < 0 ||
              newX + newWidth > size ||
              newY + newHeight > size
            )
              continue;
            found = { x: newX, y: newY, width: newWidth, height: newHeight };
            break;
          }
        }
        if (found) break;
      }
      if (found) {
        chart.rect.x = found.x;
        chart.rect.y = found.y;
        chart.rect.width = found.width;
        chart.rect.height = found.height;
        chart.overlap = true;
        moves++;
      }
      markChartMask(chart, input, size, used, 1, false);
    }
    if (!moves) break;
  }
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
/** Keep about two source samples per atlas texel when a chart is downscaled. */
const SAMPLE_SUPERSAMPLE = 2;

const isFastRect = (bounds: [number, number, number, number], texture: TextureSource) =>
  bounds[0] >= 0 &&
  bounds[1] >= 0 &&
  bounds[2] <= 1 &&
  bounds[3] <= 1 &&
  (bounds[2] - bounds[0]) * texture.width >= 0.5 &&
  (bounds[3] - bounds[1]) * texture.height >= 0.5;

/**
 * Source resolution each texture actually needs for its wrap-sampled charts.
 * Canvas `drawImage` already resamples the in-range fast path, so only charts
 * that leave 0..1 read pixels. Downscaling those to roughly twice their atlas
 * footprint keeps a 4K texture from occupying 64 MB for a 128 px atlas while
 * preserving small, magnified UV regions at native resolution.
 */
function samplingTargets(
  layout: AtlasLayout,
  byKey: ReadonlyMap<string, AtlasInput>,
): Map<string, { width: number; height: number }> {
  const targets = new Map<string, { width: number; height: number }>();
  for (const chart of layout.charts) {
    const input = byKey.get(chart.inputKey);
    const texture = input?.texture;
    const bounds = chart.bounds;
    if (!texture || !bounds || isFastRect(bounds, texture)) continue;
    const innerWidth = Math.max(1, chart.rect.width - chart.rect.pad * 2);
    const innerHeight = Math.max(1, chart.rect.height - chart.rect.pad * 2);
    const spanU = Math.abs(bounds[2] - bounds[0]);
    const spanV = Math.abs(bounds[3] - bounds[1]);
    const requestWidth = spanU > 1e-9
      ? Math.min(texture.width, Math.ceil((innerWidth * SAMPLE_SUPERSAMPLE) / spanU))
      : texture.width;
    const requestHeight = spanV > 1e-9
      ? Math.min(texture.height, Math.ceil((innerHeight * SAMPLE_SUPERSAMPLE) / spanV))
      : texture.height;
    const target = targets.get(texture.key);
    if (target) {
      target.width = Math.max(target.width, requestWidth);
      target.height = Math.max(target.height, requestHeight);
    } else {
      targets.set(texture.key, { width: requestWidth, height: requestHeight });
    }
  }
  return targets;
}

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

  // Fast path: in-range charts let the browser's image pipeline resample the
  // source rectangle directly into the atlas.
  // Draw moved charts last: their rectangles overlap a larger chart's
  // rectangle, and their clip keeps the paint inside their own triangles.
  const fastCharts = [...layout.charts].sort(
    (a, b) => Number(!!a.overlap) - Number(!!b.overlap),
  );
  for (const chart of fastCharts) {
    const input = byKey.get(chart.inputKey);
    const texture = input?.texture;
    const bounds = chart.bounds;
    if (!texture || !bounds || !isFastRect(bounds, texture)) continue;
    const rect = chart.rect;
    const innerX = rect.x + rect.pad;
    const innerY = rect.y + rect.pad;
    const innerWidth = Math.max(1, rect.width - rect.pad * 2);
    const innerHeight = Math.max(1, rect.height - rect.pad * 2);
    const clip = chart.overlap ? new Path2D() : null;
    let clipped = false;
    if (clip && input.uvs && chart.triangles.length) {
      const spanU = bounds[2] - bounds[0];
      const spanV = bounds[3] - bounds[1];
      for (const triangle of chart.triangles) {
        for (let corner = 0; corner < 3; corner++) {
          const index = (triangle * 3 + corner) * 2;
          const u = spanU > 1e-6 ? (input.uvs[index]! - bounds[0]) / spanU : 0.5;
          const v = spanV > 1e-6 ? (input.uvs[index + 1]! - bounds[1]) / spanV : 0.5;
          const x = innerX + u * innerWidth;
          const y = innerY + v * innerHeight;
          if (corner === 0) clip.moveTo(x, y);
          else clip.lineTo(x, y);
        }
        clip.closePath();
        clipped = true;
      }
    }
    context.save();
    if (clip && clipped) context.clip(clip);
    context.drawImage(
      texture.image,
      clamp(bounds[0] * texture.width, 0, texture.width),
      clamp(bounds[1] * texture.height, 0, texture.height),
      Math.max(0, (bounds[2] - bounds[0]) * texture.width),
      Math.max(0, (bounds[3] - bounds[1]) * texture.height),
      innerX,
      innerY,
      innerWidth,
      innerHeight,
    );
    context.restore();
  }

  // One readback for the whole atlas. Wrapped charts and flat fills are
  // written into this buffer, so a texture with many islands no longer costs
  // one getImageData + putImageData pair per chart.
  const image = context.getImageData(0, 0, size, size);
  const data = image.data;
  const targets = samplingTargets(layout, byKey);
  const pixelCache = new Map<string, TexturePixels>();
  let cachedPixels = 0;

  const texturePixels = (texture: TextureSource): TexturePixels | null => {
    const target = targets.get(texture.key) ?? {
      width: texture.width,
      height: texture.height,
    };
    const cacheKey = `${texture.key}@${target.width}x${target.height}`;
    const hit = pixelCache.get(cacheKey);
    if (hit) {
      pixelCache.delete(cacheKey);
      pixelCache.set(cacheKey, hit);
      return hit;
    }
    const scratch = document.createElement('canvas');
    scratch.width = Math.max(1, target.width);
    scratch.height = Math.max(1, target.height);
    const scratchContext = scratch.getContext('2d', { willReadFrequently: true });
    if (!scratchContext) return null;
    scratchContext.imageSmoothingEnabled = true;
    scratchContext.imageSmoothingQuality = 'high';
    scratchContext.drawImage(texture.image, 0, 0, scratch.width, scratch.height);
    const decoded = scratchContext.getImageData(0, 0, scratch.width, scratch.height);
    const pixels: TexturePixels = {
      width: decoded.width,
      height: decoded.height,
      data: decoded.data,
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
    pixelCache.set(cacheKey, pixels);
    cachedPixels += pixels.width * pixels.height;
    return pixels;
  };

  const bake = (
    input: AtlasInput,
    innerX: number,
    innerY: number,
    innerWidth: number,
    innerHeight: number,
    mask?: Uint8Array | null,
  ) => {
    const options = {
      factor: [
        srgbToLinear(input.color[0]),
        srgbToLinear(input.color[1]),
        srgbToLinear(input.color[2]),
        input.opacity,
      ] as const,
      alphaMode: input.alphaMode ?? ('BLEND' as AlphaMode),
      alphaCutoff: input.alphaCutoff ?? 0.5,
    };
    if (mask) {
      for (let y = 0; y < innerHeight; y++)
        for (let x = 0; x < innerWidth; x++) {
          if (!mask[y * innerWidth + x]) continue;
          const start = ((innerY + y) * size + innerX + x) * 4;
          bakeBaseColorPixels(data.subarray(start, start + 4), options);
        }
      return;
    }
    for (let y = 0; y < innerHeight; y++) {
      const start = ((innerY + y) * size + innerX) * 4;
      bakeBaseColorPixels(data.subarray(start, start + innerWidth * 4), options);
    }
  };

  const fillFlat = (input: AtlasInput, rect: AtlasRect) => {
    const alpha = resolveAlpha(
      input.opacity,
      input.alphaMode ?? 'BLEND',
      input.alphaCutoff ?? 0.5,
    );
    const red = Math.round(clamp(input.color[0], 0, 1) * 255);
    const green = Math.round(clamp(input.color[1], 0, 1) * 255);
    const blue = Math.round(clamp(input.color[2], 0, 1) * 255);
    const value = Math.round(clamp(alpha, 0, 1) * 255);
    for (let y = rect.y; y < rect.y + rect.height; y++)
      for (let x = rect.x; x < rect.x + rect.width; x++) {
        const offset = (y * size + x) * 4;
        data[offset] = red;
        data[offset + 1] = green;
        data[offset + 2] = blue;
        data[offset + 3] = value;
      }
  };

  const extrude = (
    rect: AtlasRect,
    innerX: number,
    innerY: number,
    innerWidth: number,
    innerHeight: number,
  ) => {
    if (rect.pad <= 0) return;
    for (let y = -rect.pad; y < innerHeight + rect.pad; y++) {
      const sourceY = clamp(y, 0, innerHeight - 1);
      for (let x = -rect.pad; x < innerWidth + rect.pad; x++) {
        if (x >= 0 && x < innerWidth && y >= 0 && y < innerHeight) continue;
        const sourceX = clamp(x, 0, innerWidth - 1);
        const source = ((innerY + sourceY) * size + innerX + sourceX) * 4;
        const target = ((innerY + y) * size + innerX + x) * 4;
        data[target] = data[source]!;
        data[target + 1] = data[source + 1]!;
        data[target + 2] = data[source + 2]!;
        data[target + 3] = data[source + 3]!;
      }
    }
  };

  for (const chart of layout.charts) {
    const input = byKey.get(chart.inputKey);
    if (!input) continue;
    const rect = chart.rect;
    const innerX = rect.x + rect.pad;
    const innerY = rect.y + rect.pad;
    const innerWidth = Math.max(1, rect.width - rect.pad * 2);
    const innerHeight = Math.max(1, rect.height - rect.pad * 2);
    const texture = input.texture;
    const bounds = chart.bounds;

    if (!texture || !bounds) {
      fillFlat(input, rect);
      continue;
    }

    // Only hole-filled charts need a mask: their rectangle overlaps another
    // chart, so the paint must stay inside their own triangles. A normal chart
    // owns its whole rectangle; masking it leaves transparent cracks between
    // the UV triangles, which shows up as seams in wrapped (tiling) materials
    // such as hair. The fast path above already paints the full rectangle.
    const innerMask = chart.overlap ? chartInnerMask(chart, input) : null;
    if (!isFastRect(bounds, texture)) {
      const pixels = texturePixels(texture);
      if (!pixels) {
        fillFlat(input, rect);
        continue;
      }
      const spanU = bounds[2] - bounds[0];
      const spanV = bounds[3] - bounds[1];
      for (let y = 0; y < innerHeight; y++) {
        const v0 = bounds[1] + (y / innerHeight) * spanV;
        const v1 = bounds[1] + ((y + 1) / innerHeight) * spanV;
        for (let x = 0; x < innerWidth; x++) {
          if (innerMask && !innerMask[y * innerWidth + x]) continue;
          const u0 = bounds[0] + (x / innerWidth) * spanU;
          const u1 = bounds[0] + ((x + 1) / innerWidth) * spanU;
          const sample = sampleArea(
            pixels,
            u0,
            v0,
            u1,
            v1,
            chart.wrap[0],
            chart.wrap[1],
          );
          const offset = ((innerY + y) * size + innerX + x) * 4;
          data[offset] = Math.round(sample[0]);
          data[offset + 1] = Math.round(sample[1]);
          data[offset + 2] = Math.round(sample[2]);
          data[offset + 3] = Math.round(sample[3]);
        }
      }
    }

    bake(input, innerX, innerY, innerWidth, innerHeight, innerMask);
    extrude(rect, innerX, innerY, innerWidth, innerHeight);
  }

  context.putImageData(image, 0, 0);
  let used = 0;
  for (let index = 3; index < data.length; index += 4) if (data[index]! > 0) used++;
  return { canvas, size, rects, coverage: used / (size * size) };
}

export interface AtlasMaterialUsage {
  /** Stable material key. */
  key: string;
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
  batches: readonly { key?: string; name: string; positions: Float32Array; uvs: Float32Array | null }[],
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
  const names = new Map<string, string>();
  const maskFor = (key: string, uv: boolean) => {
    const map = uv ? uvMasks : masks;
    let mask = map.get(key);
    if (!mask) {
      mask = new Uint8Array(size * size);
      map.set(key, mask);
    }
    return mask;
  };

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex]!;
    options.onProgress?.(batchIndex, batches.length, batch.name);
    // Coverage is a diagnostic pass; repaint at ~12 fps instead of at every
    // material so a 30-material model does not spend a frame per batch.
    await yieldToBrowser(80);
    const key = batch.key ?? batch.name;
    names.set(key, batch.name);
    const mask = maskFor(key, false);
    const uvMask = maskFor(key, true);
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
    materials: [...masks].map(([key, mask]) => ({
      key,
      name: names.get(key) ?? key,
      pixels: mask.reduce((sum, value) => sum + value, 0),
      uvPixels: uvMasks.get(key)!.reduce((sum, value) => sum + value, 0),
    })),
  };
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
