/**
 * Faithful port of the production browser planner (`webapp/engine/atlas.ts`).
 *
 * The production module imports DOM-only code and cannot be loaded by the Node
 * research scripts or by the Node tsconfig. `tests/webapp-research-atlas.test.ts`
 * asserts that this port produces byte-identical rectangles for every fixture,
 * so drift is caught by the test suite rather than by inspection.
 */
import {
  buildUvCharts,
  unwrapChartBounds,
  type WrapMode,
} from '../../../src/texture-chart-math.ts';
import type { AtlasPlan, ChartInput, PlannedChart } from './types.ts';

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const ALLOCATION_POWER = 0.85;
const MIN_CHART = 3;
const MIN_FLAT = 1;
const MAX_ASPECT = 32;

interface Pending {
  chartId: string;
  inputId: string;
  bounds: [number, number, number, number] | null;
  tiles: [number, number];
  wrap: [WrapMode, WrapMode];
  triangles: number[];
  area: number;
  aspect: number;
  textured: boolean;
  coverage: number;
  material: string;
}

const bboxArea = (bounds: [number, number, number, number]) =>
  Math.max(0, bounds[2] - bounds[0]) * Math.max(0, bounds[3] - bounds[1]);

function aspectOf(
  input: ChartInput,
  bounds: [number, number, number, number] | null,
): number {
  if (!input.texture || !bounds) return 1;
  const width = Math.max(0, bounds[2] - bounds[0]) * input.texture.width;
  const height = Math.max(0, bounds[3] - bounds[1]) * input.texture.height;
  if (!(width > 1e-6) || !(height > 1e-6)) return 1;
  return clamp(width / height, 1 / MAX_ASPECT, MAX_ASPECT);
}

function chartsFor(input: ChartInput): Pending[] {
  const single = (
    bounds: [number, number, number, number] | null,
    triangles: number[],
    textured: boolean,
    coverage: number,
  ): Pending => {
    const unwrapped = bounds
      ? unwrapChartBounds(bounds[0], bounds[1], bounds[2], bounds[3])
      : null;
    return {
      chartId: `${input.id}#0`,
      inputId: input.id,
      bounds: unwrapped?.bounds ?? null,
      tiles: unwrapped?.tiles ?? [1, 1],
      wrap: input.wrap,
      triangles,
      area: input.area,
      aspect: aspectOf(input, unwrapped?.bounds ?? null),
      textured,
      coverage,
      material: input.material,
    };
  };

  const uvs = input.uvs;
  const allTriangles = uvs
    ? Array.from({ length: Math.floor(uvs.length / 6) }, (_, index) => index)
    : [];
  if (!input.texture || !input.bounds) return [single(null, allTriangles, false, 0)];
  if (!uvs || uvs.length < 6) return [single(input.bounds, allTriangles, true, 0)];
  const charts = buildUvCharts(uvs);
  if (!charts.length) return [single(input.bounds, allTriangles, true, 0)];
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
      chartId: `${input.id}#${index}`,
      inputId: input.id,
      bounds,
      tiles: unwrapped.tiles,
      wrap: input.wrap,
      triangles: chart.triangles,
      area,
      aspect: aspectOf(input, bounds),
      textured: true,
      coverage: bboxArea(bounds) > 0 ? chart.coverageArea / bboxArea(bounds) : 0,
      material: input.material,
    };
  });
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

/** Rectangle-only MaxRects packer, copied from the production planner. */
function packBoxes(
  boxes: readonly AtlasBox[],
  size: number,
  pad: number,
  orders: readonly string[],
): { rects: Map<string, { x: number; y: number; width: number; height: number }>; score: number } | null {
  let best: {
    rects: Map<string, { x: number; y: number; width: number; height: number }>;
    score: number;
  } | null = null;
  for (const order of orders) {
    let free = [{ x: 0, y: 0, width: size, height: size }];
    const rects = new Map<string, { x: number; y: number; width: number; height: number }>();
    let usedRight = 0;
    let usedBottom = 0;
    let failed = false;
    for (const box of [...boxes].sort(
      (a, b) =>
        boxOrder(order, b) - boxOrder(order, a) ||
        a.key.localeCompare(b.key),
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
      rects.set(box.key, used);
      usedRight = Math.max(usedRight, used.x + used.width);
      usedBottom = Math.max(usedBottom, used.y + used.height);
      const next: typeof free = [];
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

/** Port of `planAtlas(inputs, size, pad)`. */
export function planBaselineWeb(
  inputs: readonly ChartInput[],
  size = 128,
  pad = 1,
): AtlasPlan {
  const pending = inputs.flatMap(chartsFor);
  if (!pending.length) return { size, pad, charts: [], scale: 1, notes: [] };
  const contentLimit = Math.max(1, size - pad * 2);
  const usable = contentLimit * contentLimit;
  const demand = pending.map((chart) =>
    chart.textured ? Math.pow(Math.max(1e-8, chart.area), ALLOCATION_POWER) : 0,
  );
  const totalDemand = demand.reduce((sum, value) => sum + value, 0);
  const dimensionsAt = (scale: number): AtlasBox[] =>
    pending.map((chart, index) => {
      if (!chart.textured) return { key: chart.chartId, width: MIN_FLAT, height: MIN_FLAT };
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
      return { key: chart.chartId, width, height };
    });

  const orders = ['area', 'max', 'height', 'width'] as const;
  const attempt = (scale: number): AtlasPlan | null => {
    const packed = packBoxes(dimensionsAt(scale), size, pad, orders);
    if (!packed) return null;
    const charts: PlannedChart[] = pending.map((chart) => ({
      chartId: chart.chartId,
      inputId: chart.inputId,
      rect: { ...packed.rects.get(chart.chartId)!, pad },
      bounds: chart.bounds,
      tiles: chart.tiles,
      map: chart.bounds
        ? {
            u: chart.bounds[0],
            v: chart.bounds[1],
            spanU: chart.bounds[2] - chart.bounds[0],
            spanV: chart.bounds[3] - chart.bounds[1],
          }
        : { u: 0, v: 0, spanU: 0, spanV: 0 },
      triangles: [{ inputId: chart.inputId, triangles: chart.triangles }],
      wrap: chart.wrap,
      origin: chart.textured ? 'island' : 'material',
      materials: [chart.material],
      coverage: chart.coverage,
    }));
    return { size, pad, charts, scale, notes: [] };
  };

  const full = attempt(1);
  if (full) return full;
  let best = attempt(0);
  if (!best)
    throw new Error('材质与 UV 岛数量超过 128×128 图集可安全容纳的数量');
  let low = 0;
  let high = 1;
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
