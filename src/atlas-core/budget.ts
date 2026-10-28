/**
 * Texel-density budget solver (research prototype).
 *
 * The production allocator turns a weighted world area into a rectangle area
 * with `(area·w)^0.85`, then lets a global packing scale decide the final
 * resolution. Two things follow: the weight is not a density control, and a
 * material merged with another one cannot be controlled at all.
 *
 * This solver instead treats each chart as a *texel budget*:
 *
 *   density target   targetArea_i ∝ w_i² · worldArea_i
 *                    ⇒ atlas texels per world unit² ∝ w_i
 *   retention target targetArea_i ∝ w_i  · sourceTexels_i
 *                    ⇒ atlas texels per native texel  ∝ w_i
 *
 * Both are linear in the user's weight for the quantity the weight names.
 * A technical minimum (`minEdge`) keeps tiny charts sampleable; the solver
 * reports exactly how much of the atlas the floors consume, because at 128²
 * floors — not weights — dominate the small-material regime.
 *
 * `solveBudget` is area-feasible only. Callers that pack rectangles should use
 * `allocateAt(scale)` and search for the largest scale that the packer accepts,
 * which accounts for fragmentation the way the production planner does.
 */
import type { PackRect } from './pack.ts';

export type BudgetTarget = 'density' | 'retention' | 'legacy';

export interface ChartDemand {
  id: string;
  /** World-space surface area of the chart's triangles. */
  worldArea: number;
  /** Native texels the chart actually samples (`Σ|uvArea| · srcW · srcH`). */
  sourceTexels: number;
  /** Native texels inside the UV bounding box. */
  bboxSourceTexels: number;
  /** Content width / height that keeps texels square. */
  aspect: number;
  /** Technical minimum edge in pixels (3 for textured charts, 1 for flat). */
  minEdge: number;
  /** User priority, 0..20, default 1. */
  weight: number;
  /** Flat materials have no texture detail to preserve. */
  flat?: boolean;
}

export interface BudgetOptions {
  size: number;
  pad: number;
  target: BudgetTarget;
  /** Use sampled UV area instead of the bounding box for retention demand. */
  coverageAware?: boolean;
  /** Total pixels the rectangles may occupy (defaults to size²). */
  capacity?: number;
}

export interface Allocation {
  id: string;
  width: number;
  height: number;
  /** True when both dimensions were clamped to `minEdge`. */
  floorBound: boolean;
}

export interface BudgetOutcome {
  allocations: Allocation[];
  /** Linear scale actually applied to the ideal demand. */
  scale: number;
  /** Ideal continuous content area per chart (before capacity scaling). */
  requestedArea: Map<string, number>;
  /** Pixels consumed by technical floors. */
  floorPixels: number;
  /** Charts whose width and height are both at the technical minimum. */
  floorBoundCharts: number;
  contentPixels: number;
  allocatedPixels: number;
}

/** Relative demand of one chart; see the file header for the units. */
export function demandOf(
  chart: ChartDemand,
  target: BudgetTarget,
  coverageAware = true,
): number {
  if (chart.flat) return 0;
  const weight = Math.max(0, chart.weight);
  if (target === 'density')
    return Math.max(0, chart.worldArea) * weight * weight;
  if (target === 'retention')
    return Math.max(0, coverageAware ? chart.sourceTexels : chart.bboxSourceTexels) * weight;
  // Legacy comparison: the production sublinear surface-area curve.
  return Math.pow(Math.max(0, chart.worldArea * weight), 0.85);
}

const clampAspect = (aspect: number) =>
  Math.min(32, Math.max(1 / 32, Number.isFinite(aspect) && aspect > 0 ? aspect : 1));

interface Prepared {
  charts: readonly ChartDemand[];
  pad: number;
  shares: number[];
  aspects: number[];
  maxEdge: number;
  capacity: number;
}

function prepare(charts: readonly ChartDemand[], options: BudgetOptions): Prepared {
  const { size, pad, target } = options;
  const capacity = Math.min(size * size, Math.max(1, options.capacity ?? size * size));
  const coverageAware = options.coverageAware ?? true;
  const demands = charts.map((chart) => demandOf(chart, target, coverageAware));
  const total = demands.reduce((sum, value) => sum + value, 0);
  const shares = demands.map((value) => (total > 0 ? value / total : 1 / charts.length));
  const aspects = charts.map((chart) => clampAspect(chart.aspect));
  return { charts, pad, shares, aspects, maxEdge: Math.max(1, size - pad * 2), capacity };
}

function dimensionsAt(
  prepared: Prepared,
  scale: number,
): { width: number; height: number }[] {
  const area = prepared.capacity * scale * scale;
  return prepared.charts.map((chart, index) => {
    if (chart.flat) return { width: 1, height: 1 };
    const target = Math.max(0, prepared.shares[index]! * area);
    const aspect = prepared.aspects[index]!;
    return {
      width: Math.min(
        prepared.maxEdge,
        Math.max(chart.minEdge, Math.round(Math.sqrt(target * aspect))),
      ),
      height: Math.min(
        prepared.maxEdge,
        Math.max(chart.minEdge, Math.round(Math.sqrt(target / aspect))),
      ),
    };
  });
}

const costOf = (
  dims: readonly { width: number; height: number }[],
  pad: number,
) =>
  dims.reduce(
    (sum, dim) => sum + (dim.width + pad * 2) * (dim.height + pad * 2),
    0,
  );

const toAllocations = (
  charts: readonly ChartDemand[],
  dims: readonly { width: number; height: number }[],
): Allocation[] =>
  charts.map((chart, index) => ({
    id: chart.id,
    width: dims[index]!.width,
    height: dims[index]!.height,
    floorBound:
      !chart.flat &&
      dims[index]!.width === chart.minEdge &&
      dims[index]!.height === chart.minEdge,
  }));

/** Integer content rectangles for one linear scale (no packing involved). */
export function allocateAt(
  charts: readonly ChartDemand[],
  options: BudgetOptions,
  scale: number,
): Allocation[] {
  if (!charts.length) return [];
  return toAllocations(charts, dimensionsAt(prepare(charts, options), scale));
}

/** Area-feasible allocation with the largest possible linear scale. */
export function solveBudget(
  charts: readonly ChartDemand[],
  options: BudgetOptions,
): BudgetOutcome {
  const { pad, size } = options;
  if (!charts.length)
    return {
      allocations: [],
      scale: 1,
      requestedArea: new Map(),
      floorPixels: 0,
      floorBoundCharts: 0,
      contentPixels: 0,
      allocatedPixels: 0,
    };
  const prepared = prepare(charts, options);
  const floorPixels = charts.reduce(
    (sum, chart) => sum + (chart.flat ? 1 : chart.minEdge * chart.minEdge),
    0,
  );
  const floorCost = charts.reduce((sum, chart) => {
    const edge = chart.flat ? 1 : chart.minEdge;
    return sum + (edge + pad * 2) * (edge + pad * 2);
  }, 0);
  if (floorCost > prepared.capacity)
    throw new Error(
      `too many charts (${charts.length}) for ${size}×${size} at pad=${pad}: technical floors need ${floorCost} px`,
    );

  let low = 0;
  let high = 2;
  for (let iteration = 0; iteration < 40; iteration++) {
    const mid = (low + high) / 2;
    if (costOf(dimensionsAt(prepared, mid), pad) <= prepared.capacity) low = mid;
    else high = mid;
  }
  const allocations = toAllocations(charts, dimensionsAt(prepared, low));
  return {
    allocations,
    scale: low,
    requestedArea: new Map(
      charts.map((chart, index) => [
        chart.id,
        prepared.shares[index]! * prepared.capacity * low * low,
      ]),
    ),
    floorPixels,
    floorBoundCharts: allocations.filter((allocation) => allocation.floorBound).length,
    contentPixels: allocations.reduce((sum, value) => sum + value.width * value.height, 0),
    allocatedPixels: allocations.reduce(
      (sum, value) => sum + (value.width + pad * 2) * (value.height + pad * 2),
      0,
    ),
  };
}

/** Convenience: build an id→rect map from a packer result. */
export const toRectMap = (rects: Map<string, PackRect>) => rects;
