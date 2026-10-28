/**
 * Plan diagnostics shared by every adapter.
 *
 * Counts are computed from the plan and the remapped UVs, without touching
 * pixels, so the desktop and browser paths report the same numbers for the
 * same plan. Shared rectangles are counted once for atlas totals and split
 * between materials by their UV area, never double-counted.
 */
import { innerRect, remapPlan } from './remap.ts';
import type { AtlasPlan, ChartInput } from './types.ts';

export interface MaterialPlanReport {
  material: string;
  materialKey: string;
  inputId: string;
  charts: number;
  floorCharts: number;
  worldArea: number;
  sourceTexels: number;
  atlasTexels: number;
  texelDensity: number;
  sourceRatio: number;
  /** Pixels covered by this material's triangles (shared pixels count for each). */
  uvPixels: number;
  /** Sampled pixels also covered by another material. */
  sharedPixels: number;
  /** Sampled pixels no other material covers. */
  uniquePixels: number;
  /** Content pixels attributed to this material, partitioned across materials. */
  rectPixels: number;
  /** Attributed content not covered by a triangle, clamped at zero. */
  wastePixels: number;
  /** Continuous area the budget requested for this material's charts. */
  targetArea: number;
  /** Integer content area actually attributed. */
  actualArea: number;
  /** Chart ids that belong to this material. */
  chartIds: string[];
}

export interface PartPlanReport {
  id: string;
  name: string;
  triangles: number;
  atlasTexels: number;
}

export interface PlanReport {
  size: number;
  pad: number;
  charts: number;
  slots: number;
  sharedCharts: number;
  sharedSavedPixels: number;
  /** Unique content pixels inside every rectangle, counted once. */
  contentPixels: number;
  allocatedPixels: number;
  gutterPixels: number;
  emptyPixels: number;
  /** Unique atlas pixels covered by at least one triangle. */
  uvPixels: number;
  /** Atlas pixels sampled by two or more materials. */
  overlapPixels: number;
  /** Unique content pixels that no triangle samples. */
  unusedContentPixels: number;
  /** Unique content pixels belonging to shared rectangles. */
  sharedContentPixels: number;
  /** Content pixels not attributed to any material (normally zero). */
  unattributedPixels: number;
  contentUtilization: number;
  allocatedUtilization: number;
  uvUtilization: number;
  chartCoverage: number;
  materials: MaterialPlanReport[];
  parts: PartPlanReport[];
}

export interface SummarizeOptions {
  /** Chart ids clamped to the technical minimum. */
  floorBound?: ReadonlySet<string>;
  /** Requested continuous area per chart id. */
  targetArea?: ReadonlyMap<string, number>;
  /** Pixels saved by overlaying identical charts. */
  sharedSavedPixels?: number;
}


const uvTriangleArea = (uvs: Float32Array, triangle: number): number => {
  const ax = uvs[triangle * 6] ?? 0;
  const ay = uvs[triangle * 6 + 1] ?? 0;
  const bx = uvs[triangle * 6 + 2] ?? 0;
  const by = uvs[triangle * 6 + 3] ?? 0;
  const cx = uvs[triangle * 6 + 4] ?? 0;
  const cy = uvs[triangle * 6 + 5] ?? 0;
  return Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) / 2;
};

const raster = (
  points: readonly [number, number][],
  size: number,
  onPixel: (index: number) => void,
) => {
  const [a, b, c] = points;
  if (!a || !b || !c) return;
  const ax = a[0] * size;
  const ay = a[1] * size;
  const bx = b[0] * size;
  const by = b[1] * size;
  const cx = c[0] * size;
  const cy = c[1] * size;
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
      if (!((e0 >= 0 && e1 >= 0 && e2 >= 0) || (e0 <= 0 && e1 <= 0 && e2 <= 0)))
        continue;
      onPixel(y * size + x);
    }
  }
};

const uvAt = (uvs: Float32Array, triangle: number, corner: number): [number, number] => {
  const index = triangle * 6 + corner * 2;
  return [uvs[index] ?? 0.5, uvs[index + 1] ?? 0.5];
};

interface RectAccumulator {
  content: number;
  allocated: number;
  /** Continuous UV area per material inside this rectangle. */
  areas: Map<string, number>;
  target: number;
  charts: number;
}

/** Split an integer content area into per-material integers that sum exactly. */
function partitionContent(content: number, areas: ReadonlyMap<string, number>) {
  const result = new Map<string, number>();
  const keys = [...areas.keys()].sort();
  if (!keys.length) return result;
  const total = keys.reduce((sum, key) => sum + (areas.get(key) ?? 0), 0);
  const exact = keys.map((key) => {
    const share = total > 0 ? (areas.get(key) ?? 0) / total : 1 / keys.length;
    return { key, value: content * share };
  });
  const values = new Map<string, number>();
  let assigned = 0;
  for (const entry of exact) {
    const whole = Math.floor(entry.value + 1e-9);
    values.set(entry.key, whole);
    assigned += whole;
  }
  const order = exact
    .map((entry, index) => ({
      key: entry.key,
      index,
      fraction: entry.value - Math.floor(entry.value + 1e-9),
    }))
    .sort((a, b) => b.fraction - a.fraction || a.key.localeCompare(b.key));
  for (let add = 0; add < content - assigned; add++) {
    const target = order[add % order.length]!;
    values.set(target.key, values.get(target.key)! + 1);
  }
  for (const key of keys) result.set(key, values.get(key) ?? 0);
  return result;
}

/** Summarize a plan into atlas and per-material/part numbers. */
export function summarizePlan(
  inputs: readonly ChartInput[],
  plan: AtlasPlan,
  options: SummarizeOptions = {},
): PlanReport {
  const size = plan.size;
  const atlasUvs = remapPlan(inputs, plan);
  const byId = new Map(inputs.map((input) => [input.id, input]));
  const materialIndex = new Map<string, number>();
  const materialOrder: string[] = [];
  for (const input of inputs) {
    const key = input.materialKey;
    if (!materialIndex.has(key)) {
      materialIndex.set(key, materialOrder.length);
      materialOrder.push(key);
    }
  }

  const materialUv = new Map<string, Uint8Array>();
  const materialWorld = new Map<string, number>();
  const materialSource = new Map<string, number>();
  const materialAtlas = new Map<string, number>();
  const materialCharts = new Map<string, number>();
  const materialChartIds = new Map<string, string[]>();
  const materialFloor = new Map<string, number>();
  const materialRect = new Map<string, number>();
  const materialTarget = new Map<string, number>();
  const partAtlas = new Map<string, PartPlanReport>();
  const maskFor = (key: string) => {
    let mask = materialUv.get(key);
    if (!mask) {
      mask = new Uint8Array(size * size);
      materialUv.set(key, mask);
    }
    return mask;
  };

  const flatInputs = new Set(
    plan.charts
      .filter((chart) => chart.bounds === null)
      .map((chart) => chart.inputId),
  );

  for (const input of inputs) {
    const key = input.materialKey;
    materialWorld.set(key, (materialWorld.get(key) ?? 0) + input.area);
    maskFor(key);
    // Flat inputs are not remapped: their original UVs do not describe where
    // the solid texel lives in the atlas, so they are accounted below.
    if (flatInputs.has(input.id)) continue;
    const atlas = atlasUvs.get(input.id);
    if (!atlas || !input.uvs) continue;
    const count = Math.floor(input.uvs.length / 6);
    for (let triangle = 0; triangle < count; triangle++) {
      const atlasArea = uvTriangleArea(atlas, triangle);
      const sourceArea = uvTriangleArea(input.uvs, triangle);
      const texels = atlasArea * size * size;
      materialAtlas.set(key, (materialAtlas.get(key) ?? 0) + texels);
      materialSource.set(
        key,
        (materialSource.get(key) ?? 0) +
          sourceArea * (input.texture?.width ?? 0) * (input.texture?.height ?? 0),
      );
      if (input.partIndex && input.parts) {
        const part = input.parts[input.partIndex[triangle] ?? 0];
        if (part) {
          const existing = partAtlas.get(part.id) ?? {
            id: part.id,
            name: part.name,
            triangles: 0,
            atlasTexels: 0,
          };
          existing.triangles++;
          existing.atlasTexels += texels;
          partAtlas.set(part.id, existing);
        }
      }
    }
  }

  const uvMask = new Uint8Array(size * size);
  const owner = new Int16Array(size * size);
  let overlapPixels = 0;
  const rects = new Map<string, RectAccumulator>();

  const markPixel = (pixel: number, key: string) => {
    const index = materialIndex.get(key)!;
    uvMask[pixel] = 1;
    maskFor(key)[pixel] = 1;
    const previous = owner[pixel]!;
    if (previous === 0) owner[pixel] = index + 1;
    else if (previous > 0 && previous !== index + 1) {
      owner[pixel] = -1;
      overlapPixels++;
    }
  };

  for (const chart of plan.charts) {
    const inner = innerRect(chart.rect);
    const rectKey = `${chart.rect.x},${chart.rect.y},${chart.rect.width},${chart.rect.height}`;
    const rect = rects.get(rectKey) ?? {
      content: inner.width * inner.height,
      allocated: chart.rect.width * chart.rect.height,
      areas: new Map<string, number>(),
      target: 0,
      charts: 0,
    };
    rect.charts++;
    // Chart targets are already split between shared members by the planner,
    // so summing them recovers the slot target once.
    rect.target += options.targetArea?.get(chart.chartId) ?? 0;
    rects.set(rectKey, rect);

    const groups =
      chart.triangles ?? [{ inputId: chart.inputId, triangles: null as number[] | null }];
    for (const group of groups) {
      const input = byId.get(group.inputId);
      if (!input) continue;
      const key = input.materialKey;
      const atlas = atlasUvs.get(group.inputId);
      if (!atlas) continue;

      if (!chart.bounds) {
        // A flat material samples one solid texel; attribute exactly one pixel
        // instead of the whole rectangle or the original UV triangles.
        const centre =
          (inner.y + Math.floor(inner.height / 2)) * size +
          inner.x +
          Math.floor(inner.width / 2);
        markPixel(centre, key);
        rect.areas.set(key, (rect.areas.get(key) ?? 0) + 1);
        materialAtlas.set(key, (materialAtlas.get(key) ?? 0) + 1);
        // Flat parts still own triangles even though they share one texel.
        if (input.partIndex && input.parts) {
          for (const index of input.partIndex) {
            const part = input.parts[index] ?? input.parts[0];
            if (!part) continue;
            const existing = partAtlas.get(part.id) ?? {
              id: part.id,
              name: part.name,
              triangles: 0,
              atlasTexels: 0,
            };
            existing.triangles++;
            partAtlas.set(part.id, existing);
          }
        }
      } else {
        const count = Math.floor(atlas.length / 6);
        const triangles =
          group.triangles ?? Array.from({ length: count }, (_, triangle) => triangle);
        let uvArea = 0;
        for (const triangle of triangles) {
          if (triangle < 0 || triangle >= count) continue;
          uvArea += uvTriangleArea(atlas, triangle);
          raster(
            [uvAt(atlas, triangle, 0), uvAt(atlas, triangle, 1), uvAt(atlas, triangle, 2)],
            size,
            (pixel) => markPixel(pixel, key),
          );
        }
        rect.areas.set(key, (rect.areas.get(key) ?? 0) + uvArea);
      }

      materialCharts.set(key, (materialCharts.get(key) ?? 0) + 1);
      const ids = materialChartIds.get(key) ?? [];
      if (!ids.includes(chart.chartId)) ids.push(chart.chartId);
      materialChartIds.set(key, ids);
      if (options.floorBound?.has(chart.chartId))
        materialFloor.set(key, (materialFloor.get(key) ?? 0) + 1);
    }
  }

  // Partition every rectangle once. Shared rectangles give each material a
  // share of the same content instead of full content for every member.
  let sharedContentPixels = 0;
  for (const rect of rects.values()) {
    if (rect.charts > 1 || rect.areas.size > 1) sharedContentPixels += rect.content;
    const shares = partitionContent(rect.content, rect.areas);
    for (const [key, pixels] of shares)
      materialRect.set(key, (materialRect.get(key) ?? 0) + pixels);
    const totalArea = [...rect.areas.values()].reduce((sum, value) => sum + value, 0);
    for (const key of rect.areas.keys()) {
      const share =
        totalArea > 0
          ? (rect.areas.get(key) ?? 0) / totalArea
          : 1 / rect.areas.size;
      materialTarget.set(key, (materialTarget.get(key) ?? 0) + rect.target * share);
    }
  }

  let uvPixels = 0;
  for (const value of uvMask) uvPixels += value ? 1 : 0;
  const contentPixels = [...rects.values()].reduce((sum, rect) => sum + rect.content, 0);
  const allocatedPixels = [...rects.values()].reduce(
    (sum, rect) => sum + rect.allocated,
    0,
  );
  const attributedPixels = [...materialRect.values()].reduce((sum, value) => sum + value, 0);

  // Pixels covered by this material and at least one other material. Walking
  // the owner map once keeps the count independent of raster order.
  const sharedByMaterial = new Map<string, number>();
  for (let pixel = 0; pixel < owner.length; pixel++) {
    if (owner[pixel] !== -1) continue;
    for (const [key, mask] of materialUv)
      if (mask[pixel]) sharedByMaterial.set(key, (sharedByMaterial.get(key) ?? 0) + 1);
  }

  const materials: MaterialPlanReport[] = materialOrder.map((key) => {
    const input = inputs.find((entry) => entry.materialKey === key)!;
    const worldArea = materialWorld.get(key) ?? 0;
    const atlasTexels = materialAtlas.get(key) ?? 0;
    const sourceTexels = materialSource.get(key) ?? 0;
    let pixels = 0;
    const mask = materialUv.get(key);
    if (mask) for (const value of mask) pixels += value ? 1 : 0;
    const rectPixels = materialRect.get(key) ?? 0;
    const sharedPixels = sharedByMaterial.get(key) ?? 0;
    return {
      material: input.material,
      materialKey: key,
      inputId: input.id,
      charts: materialCharts.get(key) ?? 0,
      floorCharts: materialFloor.get(key) ?? 0,
      worldArea,
      sourceTexels,
      atlasTexels,
      texelDensity: worldArea > 0 ? atlasTexels / worldArea : 0,
      sourceRatio: sourceTexels > 0 ? atlasTexels / sourceTexels : 0,
      uvPixels: pixels,
      sharedPixels,
      uniquePixels: Math.max(0, pixels - sharedPixels),
      rectPixels,
      wastePixels: Math.max(0, rectPixels - Math.min(pixels, rectPixels)),
      targetArea: materialTarget.get(key) ?? 0,
      actualArea: rectPixels,
      chartIds: materialChartIds.get(key) ?? [],
    };
  });

  return {
    size,
    pad: plan.pad,
    charts: plan.charts.length,
    slots: rects.size,
    sharedCharts: plan.charts.filter((chart) => chart.origin === 'shared').length,
    sharedSavedPixels: options.sharedSavedPixels ?? 0,
    contentPixels,
    allocatedPixels,
    gutterPixels: Math.max(0, allocatedPixels - contentPixels),
    emptyPixels: Math.max(0, size * size - allocatedPixels),
    uvPixels,
    overlapPixels,
    unusedContentPixels: Math.max(0, contentPixels - uvPixels),
    sharedContentPixels,
    unattributedPixels: Math.max(0, contentPixels - attributedPixels),
    contentUtilization: contentPixels / (size * size),
    allocatedUtilization: allocatedPixels / (size * size),
    uvUtilization: uvPixels / (size * size),
    chartCoverage: contentPixels > 0 ? uvPixels / contentPixels : 0,
    materials,
    parts: [...partAtlas.values()].sort((a, b) => b.atlasTexels - a.atlasTexels),
  };
}
