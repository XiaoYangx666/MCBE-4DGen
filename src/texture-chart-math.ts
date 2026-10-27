/**
 * UV chart math shared by the Node atlas (`src/texture-charts.ts`) and the
 * browser atlas (`webapp/engine/atlas.ts`).
 *
 * Everything here is pure: no three.js, no @gltf-transform, no DOM and no Node
 * APIs. Charts are found from flat per-triangle UVs, merged with the desktop
 * heuristic, and un-wrapped so negative / seam-crossing UVs keep their real
 * extent instead of being clamped to 0..1.
 */

export const UV_EPSILON = 1e-6;

/** Adjacent charts save one gutter, but a merge may only grow the box slightly. */
export const MERGE_GROWTH = 0.2;
/** Keep most of the UV coverage the separate charts had. */
export const COVERAGE_RETENTION = 0.8;
export const COVERAGE_FLOOR = 0.05;
export const COVERAGE_GRID = 32;

/** Source images may repeat this many times before atlas baking refuses the span. */
export const MAX_TILE_SPAN = 16;

/** glTF / three.js sampler wrap values collapsed to one canonical vocabulary. */
export type WrapMode = 'repeat' | 'clamp' | 'mirror';

/** glTF repeat/clamp/mirror, plus three.js Repeat/ClampToEdge/MirroredRepeat. */
export function normalizeWrapMode(code: number | null | undefined): WrapMode {
  switch (code) {
    case 33071:
    case 1001:
      return 'clamp';
    case 33648:
    case 1002:
      return 'mirror';
    default:
      return 'repeat';
  }
}

/**
 * One connected UV island. `triangles` indexes the per-triangle UV list passed
 * to `splitUvIslands`; `coverageArea` is the part of the bounding box that the
 * triangles actually cover.
 */
export interface UvChart {
  triangles: number[];
  minU: number;
  minV: number;
  maxU: number;
  maxV: number;
  /** Covered UV area in UV units², estimated on a COVERAGE_GRID² raster. */
  coverageArea: number;
  /** Material names present in this chart, used by the merge heuristic. */
  materials: string[];
}

export interface SplitUvIslandsOptions {
  /** Material name per triangle, indexed like the triangles. */
  materials?: readonly string[];
}

export interface MergeUvChartsOptions {
  mergeGrowth?: number;
  coverageRetention?: number;
  coverageFloor?: number;
  grid?: number;
}

const chartArea = (chart: {
  minU: number;
  minV: number;
  maxU: number;
  maxV: number;
}) =>
  Math.max(0, chart.maxU - chart.minU) * Math.max(0, chart.maxV - chart.minV);

/** Stable key for a UV corner, matching the desktop chart splitter. */
const uvKey = (u: number, v: number) =>
  `${Math.round(u / UV_EPSILON)},${Math.round(v / UV_EPSILON)}`;

/**
 * Split a flat triangle list (`u0,v0,u1,v1,u2,v2` per triangle) into UV
 * islands that share at least one UV corner. Union-find with epsilon keys is
 * the same rule the desktop atlas has always used.
 */
export function splitUvIslands(
  uvs: ArrayLike<number>,
  options: SplitUvIslandsOptions = {},
): UvChart[] {
  const count = Math.floor(uvs.length / 6);
  if (count <= 0) return [];
  const parent = new Int32Array(count);
  for (let i = 0; i < count; i++) parent[i] = i;
  const find = (value: number): number => {
    let n = value;
    while (parent[n] !== n) {
      parent[n] = parent[parent[n]!]!;
      n = parent[n]!;
    }
    return n;
  };
  const union = (a: number, b: number) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent[rootB] = rootA;
  };

  const owner = new Map<string, number>();
  const materials = options.materials;
  for (let triangle = 0; triangle < count; triangle++) {
    const offset = triangle * 6;
    for (let corner = 0; corner < 3; corner++) {
      const key = uvKey(uvs[offset + corner * 2]!, uvs[offset + corner * 2 + 1]!);
      const previous = owner.get(key);
      if (previous === undefined) owner.set(key, triangle);
      else union(triangle, previous);
    }
  }

  const roots = new Map<number, number>();
  const charts: UvChart[] = [];
  for (let triangle = 0; triangle < count; triangle++) {
    const root = find(triangle);
    let index = roots.get(root);
    if (index === undefined) {
      index = charts.length;
      roots.set(root, index);
      charts.push({
        triangles: [],
        minU: Infinity,
        minV: Infinity,
        maxU: -Infinity,
        maxV: -Infinity,
        coverageArea: 0,
        materials: [],
      });
    }
    const chart = charts[index]!;
    chart.triangles.push(triangle);
    const offset = triangle * 6;
    for (let corner = 0; corner < 3; corner++) {
      const u = uvs[offset + corner * 2]!;
      const v = uvs[offset + corner * 2 + 1]!;
      if (u < chart.minU) chart.minU = u;
      if (v < chart.minV) chart.minV = v;
      if (u > chart.maxU) chart.maxU = u;
      if (v > chart.maxV) chart.maxV = v;
    }
  }

  for (const chart of charts) {
    const set = new Set<string>();
    for (const triangle of chart.triangles)
      set.add(materials?.[triangle] ?? '(default)');
    chart.materials = [...set];
    chart.coverageArea = coverageOfChart(uvs, chart);
  }
  return charts;
}

/** Port of the desktop coverage estimate: rasterize the chart into a 32² grid. */
function coverageOfChart(
  uvs: ArrayLike<number>,
  chart: UvChart,
  grid = COVERAGE_GRID,
): number {
  const width = chart.maxU - chart.minU;
  const height = chart.maxV - chart.minV;
  if (!(width > 0) || !(height > 0)) return 0;
  const mask = new Uint8Array(grid * grid);
  const edge2 = (px: number, py: number, qx: number, qy: number, x: number, y: number) =>
    (qx - px) * (y - py) - (qy - py) * (x - px);
  for (const triangle of chart.triangles) {
    const offset = triangle * 6;
    const ax = ((uvs[offset]! - chart.minU) / width) * grid;
    const ay = ((uvs[offset + 1]! - chart.minV) / height) * grid;
    const bx = ((uvs[offset + 2]! - chart.minU) / width) * grid;
    const by = ((uvs[offset + 3]! - chart.minV) / height) * grid;
    const cx = ((uvs[offset + 4]! - chart.minU) / width) * grid;
    const cy = ((uvs[offset + 5]! - chart.minV) / height) * grid;
    if (Math.abs(edge2(ax, ay, bx, by, cx, cy)) < 1e-12) continue;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
    const x1 = Math.min(grid - 1, Math.ceil(Math.max(ax, bx, cx)));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy)));
    const y1 = Math.min(grid - 1, Math.ceil(Math.max(ay, by, cy)));
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const e0 = edge2(ax, ay, bx, by, x + 0.5, y + 0.5);
        const e1 = edge2(bx, by, cx, cy, x + 0.5, y + 0.5);
        const e2 = edge2(cx, cy, ax, ay, x + 0.5, y + 0.5);
        if ((e0 >= 0 && e1 >= 0 && e2 >= 0) || (e0 <= 0 && e1 <= 0 && e2 <= 0))
          mask[y * grid + x] = 1;
      }
  }
  let occupied = 0;
  for (const value of mask) occupied += value;
  return (occupied / mask.length) * (width * height);
}

/**
 * Merge charts with the same heuristic as the desktop atlas: allow a little
 * bounding-box growth while keeping most of the covered UV area. Charts with
 * different material sets may only merge when their UV areas already overlap.
 */
export function mergeUvCharts(
  charts: readonly UvChart[],
  options: MergeUvChartsOptions = {},
): UvChart[] {
  if (charts.length <= 1) return charts.map((chart) => cloneChart(chart));
  const mergeGrowth = options.mergeGrowth ?? MERGE_GROWTH;
  const coverageRetention = options.coverageRetention ?? COVERAGE_RETENTION;
  const coverageFloor = options.coverageFloor ?? COVERAGE_FLOOR;
  const parent = new Int32Array(charts.length);
  for (let i = 0; i < charts.length; i++) parent[i] = i;
  const find = (value: number): number => {
    let n = value;
    while (parent[n] !== n) {
      parent[n] = parent[parent[n]!]!;
      n = parent[n]!;
    }
    return n;
  };
  const boxes = charts.map((chart) => ({
    minU: chart.minU,
    minV: chart.minV,
    maxU: chart.maxU,
    maxV: chart.maxV,
  }));
  const areas = charts.map((chart) => chart.coverageArea);
  const materials = charts.map((chart) => new Set(chart.materials));

  const entries = charts
    .map((_, index) => index)
    .sort((a, b) => chartArea(boxes[b]!) - chartArea(boxes[a]!) || a - b);

  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (let i = 0; i < entries.length; i++)
      for (let j = 0; j < i; j++) {
        const a = find(entries[i]!);
        const b = find(entries[j]!);
        if (a === b) continue;
        const x = boxes[a]!;
        const y = boxes[b]!;
        const joined = {
          minU: Math.min(x.minU, y.minU),
          minV: Math.min(x.minV, y.minV),
          maxU: Math.max(x.maxU, y.maxU),
          maxV: Math.max(x.maxV, y.maxV),
        };
        const overlap =
          Math.max(0, Math.min(x.maxU, y.maxU) - Math.max(x.minU, y.minU)) *
          Math.max(0, Math.min(x.maxV, y.maxV) - Math.max(x.minV, y.minV));
        const unionArea = chartArea(x) + chartArea(y) - overlap;
        const areaA = areas[a] ?? 0;
        const areaB = areas[b] ?? 0;
        const separateCoverage = unionArea > 0 ? (areaA + areaB) / unionArea : 0;
        const joinedArea = chartArea(joined);
        const mergedCoverage = joinedArea > 0 ? (areaA + areaB) / joinedArea : 0;
        const materialsA = materials[a] ?? new Set<string>();
        const materialsB = materials[b] ?? new Set<string>();
        let sharesMaterial = false;
        for (const name of materialsA)
          if (materialsB.has(name)) {
            sharesMaterial = true;
            break;
          }
        const overlapsUv =
          overlap >= 0.5 * Math.min(chartArea(x), chartArea(y)) ||
          joinedArea <= unionArea * 1.02;
        if (
          (sharesMaterial || overlapsUv) &&
          joinedArea <= (1 + mergeGrowth) * unionArea + 1e-12 &&
          mergedCoverage >= coverageFloor &&
          mergedCoverage >= coverageRetention * separateCoverage
        ) {
          parent[b] = a;
          boxes[a] = joined;
          areas[a] = areaA + areaB;
          materials[a] = new Set([...materialsA, ...materialsB]);
          changed = true;
        }
      }
    if (!changed) break;
  }

  const groups = new Map<number, number>();
  const merged: UvChart[] = [];
  for (let chartIndex = 0; chartIndex < charts.length; chartIndex++) {
    const root = find(chartIndex);
    let index = groups.get(root);
    if (index === undefined) {
      index = merged.length;
      groups.set(root, index);
      merged.push({
        triangles: [],
        minU: boxes[root]!.minU,
        minV: boxes[root]!.minV,
        maxU: boxes[root]!.maxU,
        maxV: boxes[root]!.maxV,
        coverageArea: areas[root] ?? 0,
        materials: [...(materials[root] ?? [])],
      });
    }
    const target = merged[index]!;
    const chart = charts[chartIndex]!;
    for (const triangle of chart.triangles) target.triangles.push(triangle);
  }
  for (const chart of merged) chart.triangles.sort((a, b) => a - b);
  return merged;
}

function cloneChart(chart: UvChart): UvChart {
  return {
    triangles: [...chart.triangles],
    minU: chart.minU,
    minV: chart.minV,
    maxU: chart.maxU,
    maxV: chart.maxV,
    coverageArea: chart.coverageArea,
    materials: [...chart.materials],
  };
}

/** Split and merge in one call; this is what both atlas builders should use. */
export function buildUvCharts(
  uvs: ArrayLike<number>,
  options: SplitUvIslandsOptions = {},
): UvChart[] {
  return mergeUvCharts(splitUvIslands(uvs, options));
}

export interface UnwrappedChartBounds {
  /** Continuous UV rectangle, never clamped to 0..1. */
  bounds: [number, number, number, number];
  /** Whole-tile origin, as used by the desktop allocation crop. */
  min: [number, number];
  /** Whole-tile span, capped at MAX_TILE_SPAN. */
  tiles: [number, number];
  /** Span before the cap; compare with MAX_TILE_SPAN. */
  span: [number, number];
  exceedsTileSpan: boolean;
}

/** sin/cos near 90° can leave an exact tile edge a few ulps outside its integer. */
export const tileEdge = (value: number) =>
  Math.abs(value - Math.round(value)) < 1e-7 ? Math.round(value) : value;

/**
 * Unwrap a chart's continuous bounds. The returned `bounds` stay in UV units
 * (negative and >1 are valid); `min`/`tiles` describe the whole tiles the
 * desktop baker crops, with the 16-tile safety cap.
 */
export function unwrapChartBounds(
  minU: number,
  minV: number,
  maxU: number,
  maxV: number,
): UnwrappedChartBounds {
  const min: [number, number] = [
    Math.floor(tileEdge(minU)),
    Math.floor(tileEdge(minV)),
  ];
  const span: [number, number] = [
    Math.max(1, Math.ceil(tileEdge(maxU)) - min[0]),
    Math.max(1, Math.ceil(tileEdge(maxV)) - min[1]),
  ];
  return {
    bounds: [minU, minV, maxU, maxV],
    min,
    tiles: [Math.min(MAX_TILE_SPAN, span[0]), Math.min(MAX_TILE_SPAN, span[1])],
    span,
    exceedsTileSpan: span[0] > MAX_TILE_SPAN || span[1] > MAX_TILE_SPAN,
  };
}

/** Index of a wrapped texel, mirroring the desktop `sampleIndex` semantics. */
export function wrapIndex(index: number, size: number, mode: WrapMode): number {
  if (size <= 0) return 0;
  if (mode === 'clamp') return Math.min(size - 1, Math.max(0, index));
  if (mode === 'mirror') {
    const value = ((index % (size * 2)) + size * 2) % (size * 2);
    return value < size ? value : size * 2 - 1 - value;
  }
  return ((index % size) + size) % size;
}

/**
 * Bilinear sample of an unpremultiplied RGBA image with wrap modes.
 * `u`/`v` are in UV units and may be negative or larger than one. The result
 * is written as straight (unpremultiplied) RGBA bytes into `out`; blending is
 * done with premultiplied alpha so transparent texels do not bleed color.
 */
export function sampleWrappedRgba(
  pixels: ArrayLike<number>,
  width: number,
  height: number,
  u: number,
  v: number,
  wrapU: WrapMode,
  wrapV: WrapMode,
  out: number[] | Float32Array | Uint8ClampedArray,
): void {
  if (width <= 0 || height <= 0) {
    out[0] = out[1] = out[2] = out[3] = 0;
    return;
  }
  const x = u * width - 0.5;
  const y = v * height - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  let red = 0;
  let green = 0;
  let blue = 0;
  let alpha = 0;
  for (let dy = 0; dy < 2; dy++) {
    const wy = dy === 0 ? 1 - fy : fy;
    const sy = wrapIndex(y0 + dy, height, wrapV);
    for (let dx = 0; dx < 2; dx++) {
      const weight = (dx === 0 ? 1 - fx : fx) * wy;
      if (weight === 0) continue;
      const sx = wrapIndex(x0 + dx, width, wrapU);
      const index = (sy * width + sx) * 4;
      const a = (pixels[index + 3] ?? 0) / 255;
      const premultiplied = a * weight;
      red += (pixels[index] ?? 0) * premultiplied;
      green += (pixels[index + 1] ?? 0) * premultiplied;
      blue += (pixels[index + 2] ?? 0) * premultiplied;
      alpha += premultiplied;
    }
  }
  if (alpha > 0) {
    out[0] = Math.round(red / alpha);
    out[1] = Math.round(green / alpha);
    out[2] = Math.round(blue / alpha);
    out[3] = Math.round(alpha * 255);
  } else {
    out[0] = out[1] = out[2] = out[3] = 0;
  }
}
