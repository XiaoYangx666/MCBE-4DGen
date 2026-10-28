/**
 * Candidate planners for the texture-allocation research (Stage 3).
 *
 * Pipeline: geometry/UV analysis → per-chart demand → independent budget →
 * optional safe sharing → packing → remap map. No cross-material demand is
 * ever pooled, and nothing is cropped: UV bounds map directly to the content
 * rectangle, which removes the ±1 texel quantisation and tile-floor waste of
 * the desktop crop path.
 */
import {
  buildUvCharts,
  splitUvIslands,
  mergeUvCharts,
  unwrapChartBounds,
} from '../texture-chart-math.ts';
import { allocateAt, demandOf, type BudgetTarget, type ChartDemand } from './budget.ts';
import { packBoxes } from './pack.ts';
import type { AtlasPlan, ChartInput, PlannedChart } from './types.ts';

export type MergePolicy = 'none' | 'strict' | 'production';

export interface AtlasBudgetOptions {
  size?: number;
  pad?: number;
  target?: BudgetTarget;
  /** Priority by material key, falling back to the display name. */
  weights?: Record<string, number>;
  /** Charge retention demand for sampled UV area instead of the bbox. */
  coverageAware?: boolean;
  /** Overlay charts that read exactly the same source pixels. */
  sharing?: 'none' | 'safe';
  merge?: MergePolicy;
  minEdge?: number;
  /** Recursively split charts whose triangles cover little of their bbox. */
  splitSparse?: SparseSplitOptions;
}

interface Analysis {
  chartId: string;
  inputId: string;
  material: string;
  materialKey: string;
  textureKey: string | null;
  bounds: [number, number, number, number] | null;
  tiles: [number, number];
  triangles: number[];
  worldArea: number;
  uvArea: number;
  sourceTexels: number;
  bboxSourceTexels: number;
  aspect: number;
  coverage: number;
  weight: number;
  minEdge: number;
  flat: boolean;
  /** Per-triangle UVs of this chart, used for exact sharing checks. */
  uvs: Float32Array | null;
  /** Exact, full-precision bounds key (no rounding). */
  boundsKey: string;
}

const clampAspect = (value: number) =>
  Math.min(32, Math.max(1 / 32, Number.isFinite(value) && value > 0 ? value : 1));

const uvTriangleArea = (uvs: Float32Array, triangle: number) => {
  const ax = uvs[triangle * 6] ?? 0;
  const ay = uvs[triangle * 6 + 1] ?? 0;
  const bx = uvs[triangle * 6 + 2] ?? 0;
  const by = uvs[triangle * 6 + 3] ?? 0;
  const cx = uvs[triangle * 6 + 4] ?? 0;
  const cy = uvs[triangle * 6 + 5] ?? 0;
  return Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) / 2;
};

function islandsFor(input: ChartInput, merge: MergePolicy) {
  if (!input.texture || !input.uvs || !input.bounds) return null;
  const uvs = input.uvs;
  const charts =
    merge === 'none'
      ? splitUvIslands(uvs)
      : merge === 'strict'
        ? mergeUvCharts(splitUvIslands(uvs), {
            mergeGrowth: 0.05,
            coverageRetention: 0.9,
            coverageFloor: 0.1,
          })
        : buildUvCharts(uvs);
  return charts;
}

export interface SparseSplitOptions {
  /** Split a chart while its triangles cover less than this share of its bbox. */
  minCoverage: number;
  /** Maximum number of pieces (rounded down to a power of two by depth). */
  maxPieces: number;
  /** Never split charts with fewer triangles than this. */
  minTriangles: number;
}

const uvPoint = (uvs: Float32Array, triangle: number, corner: number): [number, number] => [
  uvs[triangle * 6 + corner * 2] ?? 0,
  uvs[triangle * 6 + corner * 2 + 1] ?? 0,
];

function boundsOf(uvs: Float32Array, triangles: readonly number[]) {
  let minU = Infinity;
  let minV = Infinity;
  let maxU = -Infinity;
  let maxV = -Infinity;
  for (const triangle of triangles)
    for (let corner = 0; corner < 3; corner++) {
      const [u, v] = uvPoint(uvs, triangle, corner);
      if (u < minU) minU = u;
      if (v < minV) minV = v;
      if (u > maxU) maxU = u;
      if (v > maxV) maxV = v;
    }
  return { minU, minV, maxU, maxV };
}

/**
 * Recursively cut a sparse chart at the median of its triangle centroids along
 * the longer UV axis. This is shape-adaptive: a diagonal ribbon is cut into
 * shorter segments, so each piece's bounding box wastes far less area than a
 * uniform grid would.
 */
export function splitSparseTriangles(
  uvs: Float32Array,
  triangles: readonly number[],
  options: SparseSplitOptions,
): number[][] {
  const maxDepth = Math.max(0, Math.ceil(Math.log2(Math.max(1, options.maxPieces))));
  const leaves: number[][] = [];
  const recurse = (tris: readonly number[], depth: number) => {
    if (leaves.length + 1 >= options.maxPieces || depth >= maxDepth) {
      leaves.push([...tris]);
      return;
    }
    const bounds = boundsOf(uvs, tris);
    const width = Math.max(0, bounds.maxU - bounds.minU);
    const height = Math.max(0, bounds.maxV - bounds.minV);
    let area = 0;
    for (const triangle of tris) area += uvTriangleArea(uvs, triangle);
    const coverage = width * height > 0 ? area / (width * height) : 0;
    if (coverage >= options.minCoverage || tris.length < options.minTriangles) {
      leaves.push([...tris]);
      return;
    }
    const axis = width >= height ? 0 : 1;
    const centroid = (triangle: number) => {
      let sum = 0;
      for (let corner = 0; corner < 3; corner++) sum += uvPoint(uvs, triangle, corner)[axis];
      return sum / 3;
    };
    const sorted = [...tris].sort((a, b) => centroid(a) - centroid(b) || a - b);
    const mid = Math.floor(sorted.length / 2);
    if (mid <= 0 || mid >= sorted.length) {
      leaves.push([...tris]);
      return;
    }
    recurse(sorted.slice(0, mid), depth + 1);
    recurse(sorted.slice(mid), depth + 1);
  };
  recurse(triangles, 0);
  return leaves.filter((leaf) => leaf.length > 0);
}

function analyse(input: ChartInput, options: AtlasBudgetOptions): Analysis[] {
  const merge = options.merge ?? 'production';
  const minEdge = options.minEdge ?? 3;
  const weight =
    options.weights?.[input.materialKey] ?? options.weights?.[input.material] ?? 1;
  const texture = input.texture;
  if (!texture || !input.uvs || !input.bounds) {
    return [
      {
        chartId: `${input.id}#flat`,
        inputId: input.id,
        material: input.material,
        materialKey: input.materialKey,
        textureKey: null,
        bounds: null,
        tiles: [1, 1],
        triangles: [],
        worldArea: input.area,
        uvArea: 0,
        sourceTexels: 0,
        bboxSourceTexels: 0,
        aspect: 1,
        coverage: 0,
        weight,
        minEdge: 1,
        flat: true,
        uvs: null,
        boundsKey: 'flat',
      },
    ];
  }
  const charts = islandsFor(input, merge) ?? [];
  if (!charts.length) return [];
  const results: Analysis[] = [];
  charts.forEach((chart, chartIndex) => {
    const pieces = options.splitSparse
      ? splitSparseTriangles(input.uvs!, chart.triangles, options.splitSparse)
      : [[...chart.triangles]];
    pieces.forEach((triangles, pieceIndex) => {
      const bounds = boundsOf(input.uvs!, triangles);
      const unwrapped = unwrapChartBounds(bounds.minU, bounds.minV, bounds.maxU, bounds.maxV);
      const boundsTuple: [number, number, number, number] = [
        bounds.minU,
        bounds.minV,
        bounds.maxU,
        bounds.maxV,
      ];
      let worldArea = 0;
      for (const triangle of triangles) worldArea += input.triangleAreas?.[triangle] ?? 0;
      let uvArea = 0;
      for (const triangle of triangles) uvArea += uvTriangleArea(input.uvs!, triangle);
      const spanU = Math.max(0, boundsTuple[2] - boundsTuple[0]);
      const spanV = Math.max(0, boundsTuple[3] - boundsTuple[1]);
      const sourceTexels = uvArea * texture.width * texture.height;
      const bboxSourceTexels = spanU * spanV * texture.width * texture.height;
      const chartUvs = new Float32Array(triangles.length * 6);
      let cursor = 0;
      for (const triangle of triangles)
        for (let corner = 0; corner < 3; corner++) {
          chartUvs[cursor++] = input.uvs![triangle * 6 + corner * 2]!;
          chartUvs[cursor++] = input.uvs![triangle * 6 + corner * 2 + 1]!;
        }
      results.push({
        chartId:
          pieces.length > 1
            ? `${input.id}#${chartIndex}.${pieceIndex}`
            : `${input.id}#${chartIndex}`,
        inputId: input.id,
        material: input.material,
        materialKey: input.materialKey,
        textureKey: texture.key,
        bounds: boundsTuple,
        tiles: [unwrapped.tiles[0], unwrapped.tiles[1]],
        triangles: [...triangles],
        worldArea,
        uvArea,
        sourceTexels,
        bboxSourceTexels,
        aspect: clampAspect(
          spanU * texture.width / Math.max(1e-9, spanV * texture.height),
        ),
        coverage: spanU * spanV > 0 ? Math.min(1, uvArea / (spanU * spanV)) : 0,
        weight,
        minEdge,
        flat: false,
        uvs: chartUvs,
        boundsKey: boundsTuple.map((value) => value.toString()).join(','),
      });
    });
  });
  return results;
}

interface Slot {
  id: string;
  demand: ChartDemand;
  members: Analysis[];
}

const boundsKey = (chart: Analysis) => chart.boundsKey;

/** Exact per-triangle UV equality; bitwise, no epsilon. */
function sameUv(a: Analysis, b: Analysis): boolean {
  if (a.uvs === null || b.uvs === null) return a.uvs === b.uvs;
  if (a.uvs.length !== b.uvs.length) return false;
  for (let i = 0; i < a.uvs.length; i++) if (a.uvs[i] !== b.uvs[i]) return false;
  return true;
}

const toDemand = (chart: Analysis): ChartDemand => ({
  id: chart.chartId,
  worldArea: chart.worldArea,
  sourceTexels: chart.sourceTexels,
  bboxSourceTexels: chart.bboxSourceTexels,
  aspect: chart.aspect,
  minEdge: chart.minEdge,
  weight: chart.weight,
  flat: chart.flat,
});

function groupSlots(
  charts: Analysis[],
  inputs: readonly ChartInput[],
  options: AtlasBudgetOptions,
  target: BudgetTarget,
): Slot[] {
  if (options.sharing !== 'safe')
    return charts.map((chart) => ({
      id: chart.chartId,
      demand: toDemand(chart),
      members: [chart],
    }));

  const byId = new Map(inputs.map((input) => [input.id, input]));
  const samplerKey = (input: ChartInput) =>
    [
      input.color.join(','),
      input.opacity,
      input.alphaMode,
      input.alphaCutoff,
      input.wrap.join(','),
    ].join('|');

  // Safe sharing: identical source pixels, identical sampler, identical UV
  // mapping and identical demand. The bounding box alone is not enough: two
  // charts can share a box while sampling different pixels inside it.
  const groups = new Map<string, Analysis[]>();
  for (const chart of charts) {
    const input = byId.get(chart.inputId);
    if (!input) continue;
    const key = [
      chart.textureKey ?? 'none',
      boundsKey(chart),
      chart.flat ? 'flat' : 'tex',
      samplerKey(input),
      chart.triangles.length,
      chart.uvs?.length ?? 0,
    ].join('|');
    const list = groups.get(key) ?? [];
    list.push(chart);
    groups.set(key, list);
  }

  const slots: Slot[] = [];
  for (const members of groups.values()) {
    // Partition by exact per-triangle UV equality. `sameUv` is bitwise, so
    // near-equal bounds or a shared bbox with different triangle layout never
    // share a rectangle.
    const classes: Analysis[][] = [];
    for (const chart of members) {
      const found = classes.find((cls) => sameUv(cls[0]!, chart));
      if (found) found.push(chart);
      else classes.push([chart]);
    }
    for (const cls of classes) {
      if (cls.length === 1) {
        const chart = cls[0]!;
        slots.push({ id: chart.chartId, demand: toDemand(chart), members: [chart] });
        continue;
      }
      const demands = cls.map((chart) =>
        demandOf(toDemand(chart), target, options.coverageAware ?? true),
      );
      const max = Math.max(...demands);
      const min = Math.min(...demands);
      if (max > 0 && min / max < 0.999) {
        // Different priorities: sharing would pool them. Keep independent.
        for (const chart of cls)
          slots.push({ id: chart.chartId, demand: toDemand(chart), members: [chart] });
        continue;
      }
      const first = cls[0]!;
      slots.push({ id: first.chartId, demand: toDemand(first), members: cls });
    }
  }
  return slots;
}

export interface AtlasBudgetResult {
  plan: AtlasPlan;
  budget: {
    scale: number;
    floorBoundCharts: number;
    floorPixels: number;
    contentPixels: number;
    allocatedPixels: number;
    slots: number;
    charts: number;
    sharedCharts: number;
    sharedSavedPixels: number;
  };
  charts: {
    chartId: string;
    inputId: string;
    coverage: number;
    worldArea: number;
    sourceTexels: number;
    weight: number;
    targetArea: number;
    width: number;
    height: number;
    floorBound: boolean;
    shared: boolean;
  }[];
}

export function planAtlasBudget(
  inputs: readonly ChartInput[],
  options: AtlasBudgetOptions = {},
): AtlasBudgetResult {
  const size = options.size ?? 128;
  const pad = options.pad ?? 1;
  const target = options.target ?? 'retention';
  const charts = inputs.flatMap((input) => analyse(input, options));
  const slots = groupSlots(charts, inputs, options, target);

  const demands = slots.map((slot) => slot.demand);
  const budgetOptions = {
    size,
    pad,
    target,
    coverageAware: options.coverageAware ?? true,
  };
  const attempt = (scale: number) => {
    const allocations = allocateAt(demands, budgetOptions, scale);
    const boxes = allocations.map((allocation) => {
      const base = { width: allocation.width, height: allocation.height };
      const variants =
        !allocation.floorBound && allocation.width > 4 && allocation.height > 4
          ? [
              base,
              {
                width: Math.max(3, Math.round(allocation.width * 1.1)),
                height: Math.max(3, Math.round(allocation.height / 1.1)),
              },
              {
                width: Math.max(3, Math.round(allocation.width / 1.1)),
                height: Math.max(3, Math.round(allocation.height * 1.1)),
              },
            ]
          : [base];
      return { key: allocation.id, ...base, variants };
    });
    const packed = packBoxes(boxes, size, pad);
    if (!packed) return null;
    for (const allocation of allocations) {
      const chosen = packed.chosen.get(allocation.id);
      if (chosen) {
        allocation.width = chosen.width;
        allocation.height = chosen.height;
      }
    }
    return { allocations, packed, scale };
  };
  // Packing is part of the search: the largest scale that both fits the area
  // and survives rectangle fragmentation, exactly like the production planner.
  let best = attempt(0);
  if (!best)
    throw new Error(`candidate planner cannot fit ${slots.length} charts at minimum size`);
  let low = 0;
  let high = 2;
  for (let iteration = 0; iteration < 30; iteration++) {
    const mid = (low + high) / 2;
    const candidate = attempt(mid);
    if (candidate) {
      best = candidate;
      low = mid;
    } else high = mid;
  }
  const allocations = best.allocations;
  const packed = best.packed;
  const totalDemand = demands.reduce(
    (sum, demand) => sum + demandOf(demand, target, options.coverageAware ?? true),
    0,
  );
  const requestedArea = new Map(
    demands.map((demand) => {
      const share =
        totalDemand > 0
          ? demandOf(demand, target, options.coverageAware ?? true) / totalDemand
          : 1 / demands.length;
      return [demand.id, share * size * size * best.scale * best.scale];
    }),
  );
  const floorBoundCharts = allocations.filter((allocation) => allocation.floorBound).length;
  const floorPixels = demands.reduce(
    (sum, demand) => sum + (demand.flat ? 1 : demand.minEdge * demand.minEdge),
    0,
  );
  const contentPixels = allocations.reduce(
    (sum, allocation) => sum + allocation.width * allocation.height,
    0,
  );
  const allocatedPixels = allocations.reduce(
    (sum, allocation) =>
      sum + (allocation.width + pad * 2) * (allocation.height + pad * 2),
    0,
  );

  const allocationById = new Map(allocations.map((allocation) => [allocation.id, allocation]));
  const planned: PlannedChart[] = [];
  const chartReports: AtlasBudgetResult['charts'] = [];
  let sharedCharts = 0;
  let sharedSavedPixels = 0;

  for (const slot of slots) {
    const allocation = allocationById.get(slot.id)!;
    const rect = packed.rects.get(slot.id)!;
    const shared = slot.members.length > 1;
    const materials = [...new Set(slot.members.map((chart) => chart.material))];
    const materialKeys = [...new Set(slot.members.map((chart) => chart.materialKey))];
    const slotArea = slot.members.reduce((sum, chart) => sum + chart.uvArea, 0);
    const slotTarget = requestedArea.get(slot.id) ?? 0;
    if (shared) {
      sharedCharts += slot.members.length;
      sharedSavedPixels +=
        (slot.members.length - 1) * (allocation.width + pad * 2) * (allocation.height + pad * 2);
    }
    for (const member of slot.members) {
      // A shared slot has one requested area. Split it by UV area so per-material
      // reports sum back to the slot instead of repeating the target per member.
      const share =
        slotArea > 0 ? member.uvArea / slotArea : 1 / slot.members.length;
      planned.push({
        chartId: member.chartId,
        inputId: member.inputId,
        rect: { ...rect, pad },
        bounds: member.bounds,
        tiles: member.tiles,
        triangles: [{ inputId: member.inputId, triangles: member.triangles }],
        map: member.bounds
          ? {
              u: member.bounds[0],
              v: member.bounds[1],
              spanU: member.bounds[2] - member.bounds[0],
              spanV: member.bounds[3] - member.bounds[1],
            }
          : { u: 0, v: 0, spanU: 0, spanV: 0 },
        wrap: inputs.find((input) => input.id === member.inputId)?.wrap ?? ['repeat', 'repeat'],
        origin: shared ? 'shared' : member.flat ? 'material' : 'island',
        materials: [...materials],
        materialKeys,
        coverage: member.coverage,
      });
      chartReports.push({
        chartId: member.chartId,
        inputId: member.inputId,
        coverage: member.coverage,
        worldArea: member.worldArea,
        sourceTexels: member.sourceTexels,
        weight: member.weight,
        targetArea: slotTarget * share,
        width: allocation.width,
        height: allocation.height,
        floorBound: allocation.floorBound,
        shared,
      });
    }
  }

  const plan: AtlasPlan = {
    size,
    pad,
    charts: planned,
    scale: best.scale,
    notes: [
      `target=${target}`,
      `coverageAware=${options.coverageAware ?? true}`,
      `sharing=${options.sharing ?? 'none'}`,
      `merge=${options.merge ?? 'production'}`,
      `slots=${slots.length}`,
      `floorBound=${floorBoundCharts}`,
    ],
  };
  return {
    plan,
    budget: {
      scale: best.scale,
      floorBoundCharts,
      floorPixels,
      contentPixels,
      allocatedPixels,
      slots: slots.length,
      charts: charts.length,
      sharedCharts,
      sharedSavedPixels,
    },
    charts: chartReports,
  };
}
