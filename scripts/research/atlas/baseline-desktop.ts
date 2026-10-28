/**
 * Faithful port of the production desktop compact allocator
 * (`src/texture-optimizer.ts`, `options.compactSize` branch).
 *
 * Grouping, chart splitting/merging, crop, weighted surface-area demand, the
 * 0.85 power, the flexible packer, the scale binary search and the final
 * tile-floor adjustment are copied step by step. The only input difference is
 * that UVs arrive already transformed (KHR_texture_transform baked in), which
 * is what both production adapters do before charting.
 *
 * `tests/research-atlas.test.ts` runs the real `optimizeTextures` on real
 * models and compares its reported rectangles with this port.
 */
import {
  buildUvCharts,
  tileEdge,
  unwrapChartBounds,
  type WrapMode,
} from '../../../src/texture-chart-math.ts';
import { innerRect } from './remap.ts';
import type {
  AtlasPlan,
  ChartInput,
  ChartRect,
  ChartTriangles,
  PlannedChart,
} from './types.ts';

const ALLOCATION_POWER = 0.85;
const MAX_STRETCH = 1.2;

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Region {
  group: string;
  inputId: string;
  material: string;
  materials: string[];
  owners: { inputId: string; triangle: number }[];
  min: [number, number];
  tiles: [number, number];
  width: number;
  height: number;
  source: { width: number; height: number } | null;
  wrap: [WrapMode, WrapMode];
  crop?: Rect;
  areas: Record<string, number>;
  weightedArea: number;
  bounds: [number, number, number, number];
  coverage: number;
}

interface PackItem {
  id: number;
  width: number;
  height: number;
}

/** Best-short-side free rectangle packing, copied from the production baker. */
function pack(
  regions: Region[],
  size: number,
  padding: number,
  flexible = false,
): Rect[] | null {
  let free: Rect[] = [{ x: 0, y: 0, width: size, height: size }];
  const result: Rect[] = Array(regions.length);
  const items: PackItem[] = regions
    .map((region, id) => ({
      id,
      width: region.width + padding * 2,
      height: region.height + padding * 2,
    }))
    .sort((a, c) => c.width * c.height - a.width * a.height || a.id - c.id);
  for (const item of items) {
    const originalW = item.width - 2 * padding;
    const originalH = item.height - 2 * padding;
    const candidates =
      flexible && regions[item.id]!.crop
        ? [1, MAX_STRETCH, 1 / MAX_STRETCH]
            .map((factor) => {
              const width = Math.max(3, Math.round(originalW * factor));
              const height = Math.max(
                3,
                Math.round((originalW * originalH) / width),
              );
              return {
                width: width + 2 * padding,
                height: height + 2 * padding,
                penalty: Math.abs(Math.log(factor)),
              };
            })
            .filter(
              (candidate) =>
                (candidate.width - 2 * padding) *
                  (candidate.height - 2 * padding) <=
                originalW * originalH * 1.08,
            )
        : [{ width: item.width, height: item.height, penalty: 0 }];
    const choices = free.flatMap((rect) =>
      candidates
        .filter((candidate) => candidate.width <= rect.width && candidate.height <= rect.height)
        .map((candidate) => ({ rect, ...candidate })),
    );
    choices.sort(
      (a, b) =>
        Math.min(a.rect.width - a.width, a.rect.height - a.height) -
          Math.min(b.rect.width - b.width, b.rect.height - b.height) ||
        a.penalty - b.penalty,
    );
    const fit = choices[0];
    if (!fit) return null;
    const used = { x: fit.rect.x, y: fit.rect.y, width: fit.width, height: fit.height };
    regions[item.id]!.width = fit.width - 2 * padding;
    regions[item.id]!.height = fit.height - 2 * padding;
    result[item.id] = used;
    const next: Rect[] = [];
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
  return result;
}

export interface DesktopBaselineOptions {
  weights?: Record<string, number>;
  allocation?: 'surface-area' | 'source-area';
  padding?: number;
}

interface Group {
  key: string;
  texture: ChartInput['texture'];
  inputs: ChartInput[];
}

const groupKey = (input: ChartInput): string =>
  JSON.stringify([
    input.texture?.key ?? null,
    input.color[0],
    input.color[1],
    input.color[2],
    input.opacity,
    input.alphaMode,
    input.alphaCutoff,
    input.wrap[0],
    input.wrap[1],
  ]);

/**
 * Port of the compact desktop plan. Returns regions exactly as the production
 * code lays them out (including gutters and unused padding).
 */
export function planBaselineDesktop(
  inputs: readonly ChartInput[],
  size = 128,
  options: DesktopBaselineOptions = {},
): AtlasPlan {
  const padding = options.padding ?? 2;
  const weights = options.weights ?? {};
  const allocation = options.allocation ?? 'surface-area';
  const groups = new Map<string, Group>();
  for (const input of inputs) {
    const key = groupKey(input);
    const group = groups.get(key) ?? { key, texture: input.texture, inputs: [] };
    group.inputs.push(input);
    groups.set(key, group);
  }

  const regions: Region[] = [];
  for (const group of groups.values()) {
    const uvs: number[] = [];
    const materials: string[] = [];
    const owners: { inputId: string; triangle: number }[] = [];
    for (const input of group.inputs) {
      if (!input.uvs) continue;
      const count = Math.floor(input.uvs.length / 6);
      for (let triangle = 0; triangle < count; triangle++) {
        for (let corner = 0; corner < 3; corner++) {
          uvs.push(input.uvs[triangle * 6 + corner * 2]!, input.uvs[triangle * 6 + corner * 2 + 1]!);
        }
        materials.push(input.material);
        owners.push({ inputId: input.id, triangle });
      }
    }
    const first = group.inputs[0]!;
    if (!uvs.length) {
      regions.push({
        group: group.key,
        inputId: first.id,
        material: first.material,
        materials: [first.material],
        owners: [],
        min: [0, 0],
        tiles: [1, 1],
        width: 1,
        height: 1,
        source: null,
        wrap: first.wrap,
        areas: Object.create(null) as Record<string, number>,
        weightedArea: 0,
        bounds: [0.5, 0.5, 0.5, 0.5],
        coverage: 0,
      });
      continue;
    }
    const charts = buildUvCharts(uvs, { materials });
    for (const chart of charts) {
      const low: [number, number] = [chart.minU, chart.minV];
      const high: [number, number] = [chart.maxU, chart.maxV];
      const unwrapped = unwrapChartBounds(low[0], low[1], high[0], high[1]);
      if (unwrapped.exceedsTileSpan)
        throw new Error('UV span exceeds 16 tiles; reduce tiling before atlas baking.');
      const min: [number, number] = [unwrapped.min[0], unwrapped.min[1]];
      const tiles: [number, number] = [unwrapped.tiles[0], unwrapped.tiles[1]];
      const source = group.texture
        ? { width: group.texture.width, height: group.texture.height }
        : null;
      let crop: Rect | undefined;
      if (source) {
        const boundedX = tileEdge(low[0]) >= 0 && tileEdge(high[0]) <= 1;
        const boundedY = tileEdge(low[1]) >= 0 && tileEdge(high[1]) <= 1;
        const x = Math.max(
          boundedX ? 0 : -Infinity,
          Math.floor(tileEdge(low[0]) * source.width) - 1,
        );
        const y = Math.max(
          boundedY ? 0 : -Infinity,
          Math.floor(tileEdge(low[1]) * source.height) - 1,
        );
        const width = Math.max(
          1,
          Math.min(
            boundedX ? source.width : Infinity,
            Math.ceil(tileEdge(high[0]) * source.width) + 1,
          ) - x,
        );
        const height = Math.max(
          1,
          Math.min(
            boundedY ? source.height : Infinity,
            Math.ceil(tileEdge(high[1]) * source.height) + 1,
          ) - y,
        );
        if (width * height <= 64 * 1024 * 1024) {
          crop = { x, y, width, height };
          min[0] = x / source.width;
          min[1] = y / source.height;
          tiles[0] = width / source.width;
          tiles[1] = height / source.height;
        }
      }
      const areas: Record<string, number> = Object.create(null) as Record<string, number>;
      const chartOwners: { inputId: string; triangle: number }[] = [];
      for (const triangle of chart.triangles) {
        const owner = owners[triangle]!;
        const input = group.inputs.find((candidate) => candidate.id === owner.inputId)!;
        const area = input.triangleAreas?.[owner.triangle] ?? 0;
        areas[input.material] = (areas[input.material] ?? 0) + area;
        chartOwners.push(owner);
      }
      const weightedArea = source
        ? Object.entries(areas).reduce(
            (sum, [name, area]) =>
              sum +
              area * (Object.hasOwn(weights, name) ? (weights[name] ?? 1) : 1),
            0,
          )
        : 0;
      const chartMaterials = [...new Set(chartOwners.map((owner) => group.inputs.find((i) => i.id === owner.inputId)!.material))];
      regions.push({
        group: group.key,
        inputId: first.id,
        material: chartMaterials[0] ?? first.material,
        materials: chartMaterials,
        owners: chartOwners,
        min,
        tiles,
        width: Math.max(1, Math.round((source?.width ?? 4) * tiles[0])),
        height: Math.max(1, Math.round((source?.height ?? 4) * tiles[1])),
        source,
        wrap: first.wrap,
        ...(crop ? { crop } : {}),
        areas,
        weightedArea,
        bounds: [chart.minU, chart.minV, chart.maxU, chart.maxV],
        coverage:
          (chart.maxU - chart.minU) * (chart.maxV - chart.minV) > 0
            ? chart.coverageArea /
              ((chart.maxU - chart.minU) * (chart.maxV - chart.minV))
            : 0,
      });
    }
  }

  // Allocation.
  const totalArea = regions.reduce(
    (sum, region) => sum + Math.pow(Math.max(0, region.weightedArea), ALLOCATION_POWER),
    0,
  );
  const dimensions = regions.map((region) => {
    if (allocation === 'source-area') return [region.width, region.height] as [number, number];
    const demand =
      Math.max(
        1e-8,
        Math.pow(Math.max(0, region.weightedArea), ALLOCATION_POWER) /
          Math.max(totalArea, 1e-8),
      ) *
      size *
      size;
    const aspect = Math.max(1 / 32, Math.min(32, region.width / region.height));
    return [
      Math.sqrt(demand * aspect),
      Math.sqrt(demand / aspect),
    ] as [number, number];
  });
  const minChart = 3;
  const attempt = (scale: number): Rect[] | null => {
    regions.forEach((region, index) => {
      region.width = Math.max(
        region.crop ? minChart : region.tiles[0],
        Math.round(dimensions[index]![0] * scale),
      );
      region.height = Math.max(
        region.crop ? minChart : region.tiles[1],
        Math.round(dimensions[index]![1] * scale),
      );
    });
    return pack(regions, size, padding, true);
  };
  let low = 0;
  let high = size;
  if (!attempt(0))
    throw new Error(
      'Too many UV charts for final atlas with safe gutters; increase compactSize',
    );
  for (let i = 0; i < 24; i++) {
    const mid = (low + high) / 2;
    if (attempt(mid)) low = mid;
    else high = mid;
  }
  const layout = attempt(low);
  if (!layout) throw new Error('desktop baseline failed to pack');
  for (const region of regions)
    if (!region.crop) {
      region.width = Math.floor(region.width / region.tiles[0]) * region.tiles[0];
      region.height = Math.floor(region.height / region.tiles[1]) * region.tiles[1];
    }

  const charts: PlannedChart[] = regions.map((region, index) => {
    const rect: ChartRect = { ...layout[index]!, pad: padding };
    const grouped = new Map<string, number[]>();
    for (const owner of region.owners) {
      const list = grouped.get(owner.inputId) ?? [];
      list.push(owner.triangle);
      grouped.set(owner.inputId, list);
    }
    const triangles: ChartTriangles[] = [...grouped].map(([inputId, list]) => ({
      inputId,
      triangles: list.sort((a, b) => a - b),
    }));
    return {
      chartId: `desktop#${index}`,
      inputId: region.inputId,
      rect,
      bounds: region.bounds,
      tiles: region.tiles,
      map: { u: region.min[0], v: region.min[1], spanU: region.tiles[0], spanV: region.tiles[1] },
      triangles: triangles.length ? triangles : null,
      wrap: region.wrap,
      origin: region.materials.length > 1 ? 'merged' : 'island',
      materials: region.materials,
      coverage: region.coverage,
    };
  });
  return {
    size,
    pad: padding,
    charts,
    scale: low,
    notes: [`groups=${groups.size}`, `regions=${regions.length}`],
  };
}

/** Expose the content rect size a desktop chart will actually paint. */
export const desktopContent = (rect: ChartRect) => innerRect(rect);
