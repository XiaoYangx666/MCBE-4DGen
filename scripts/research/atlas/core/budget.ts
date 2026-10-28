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
 * Everything is integer-exact and deterministic.
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

/**
 * Allocate integer content rectangles that fit `size²` including gutters.
 * Throws when the technical floors alone cannot fit.
 */
export function solveBudget(
  charts: readonly ChartDemand[],
  options: BudgetOptions,
): BudgetOutcome {
  const { size, pad, target } = options;
  const coverageAware = options.coverageAware ?? true;
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

  const demands = charts.map((chart) => demandOf(chart, target, coverageAware));
  const total = demands.reduce((sum, value) => sum + value, 0);
  const shares = demands.map((value) =>
    total > 0 ? value / total : 1 / charts.length,
  );
  const aspects = charts.map((chart) => clampAspect(chart.aspect));
  const maxEdge = Math.max(1, size - pad * 2);

  const dimensionsAt = (scale: number): { width: number; height: number }[] => {
    const area = size * size * scale * scale;
    return charts.map((chart, index) => {
      if (chart.flat) return { width: 1, height: 1 };
      const target = Math.max(0, shares[index]! * area);
      const aspect = aspects[index]!;
      const width = Math.min(
        maxEdge,
        Math.max(chart.minEdge, Math.round(Math.sqrt(target * aspect))),
      );
      const height = Math.min(
        maxEdge,
        Math.max(chart.minEdge, Math.round(Math.sqrt(target / aspect))),
      );
      return { width, height };
    });
  };

  const costOf = (dims: readonly { width: number; height: number }[]) =>
    dims.reduce(
      (sum, dim) => sum + (dim.width + pad * 2) * (dim.height + pad * 2),
      0,
    );

  const floors = charts.map((chart) =>
    chart.flat ? 1 : chart.minEdge * chart.minEdge,
  );
  const floorPixels = floors.reduce((sum, value) => sum + value, 0);
  const floorCost = charts.reduce(
    (sum, chart, index) => {
      const edge = chart.flat ? 1 : chart.minEdge;
      return sum + (edge + pad * 2) * (edge + pad * 2);
    },
    0,
  );
  if (floorCost > size * size)
    throw new Error(
      `too many charts (${charts.length}) for ${size}×${size} at pad=${pad}: technical floors need ${floorCost} px`,
    );

  // Largest linear scale that fits. Floors make the cost function flat at the
  // bottom, so start the search just above the feasible floor scale.
  let low = 0;
  let high = 2;
  for (let iteration = 0; iteration < 40; iteration++) {
    const mid = (low + high) / 2;
    if (costOf(dimensionsAt(mid)) <= size * size) low = mid;
    else high = mid;
  }
  const dims = dimensionsAt(low);
  const allocations: Allocation[] = charts.map((chart, index) => ({
    id: chart.id,
    width: dims[index]!.width,
    height: dims[index]!.height,
    floorBound:
      !chart.flat &&
      dims[index]!.width === chart.minEdge &&
      dims[index]!.height === chart.minEdge,
  }));

  const requestedArea = new Map(
    charts.map((chart, index) => [chart.id, shares[index]! * size * size * low * low]),
  );
  return {
    allocations,
    scale: low,
    requestedArea,
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
