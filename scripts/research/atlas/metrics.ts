/**
 * Atlas diagnostics: measured pixels, exact texel accounting and sampling
 * error, all from the same remapped UVs and rendered atlas.
 *
 * Definitions used throughout the research report:
 * - `allocatedPixels`: rectangle area including gutters, i.e. atlas space the
 *   plan reserved.
 * - `contentPixels`: rectangle area without gutters.
 * - `uvPixels`: content pixels a triangle actually covers.
 * - `opaquePixels`: of those, pixels whose atlas alpha is non-zero.
 * - `atlasTexels`: sum of triangle UV area times size², i.e. exactly how many
 *   texels the material's geometry maps to.
 * - `sourceTexels`: sum of source UV area times source resolution. Comparing it
 *   with `atlasTexels` yields the sampling ratio: >1 is supersampling, <1 is
 *   real detail loss.
 */
import type { WrapMode } from '../../../src/texture-chart-math.ts';
import { bakeSample, sampleAtlasLinear, sampleBilinear, type Rgba } from './sample.ts';
import { innerRect, remapPlan } from './remap.ts';
import { renderPlan } from './render.ts';
import type { AtlasPlan, ChartInput, RgbaImage } from './types.ts';

export interface ChartDiagnostic {
  chartId: string;
  inputId: string;
  materials: string[];
  x: number;
  y: number;
  width: number;
  height: number;
  pad: number;
  contentPixels: number;
  allocatedPixels: number;
  coveredPixels: number;
  chartCoverage: number;
  /** Exact UV area divided by the bounds area: 1 for dense charts. */
  uvAreaRatio: number;
  atlasTexels: number;
}

export interface MaterialDiagnostic {
  material: string;
  inputIds: string[];
  charts: number;
  worldArea: number;
  sourceTexels: number;
  atlasTexels: number;
  /** Atlas texels per world unit². */
  texelDensity: number;
  /** Atlas texels / native source texels. */
  sourceRatio: number;
  /** Area-weighted median of the per-triangle sampling ratio. */
  sourceRatioP50: number;
  /** 5th percentile: the worst-off triangles of this material. */
  sourceRatioP05: number;
  densityP50: number;
  uvPixels: number;
  opaquePixels: number;
  rectPixels: number;
  wastePixels: number;
  bboxUtilization: number;
}

export interface ErrorStats {
  samples: number;
  meanAbs: number;
  p95: number;
  maxAbs: number;
  alphaMean: number;
  /** Samples strictly inside a triangle (interior quality). */
  interiorSamples: number;
  interiorMeanAbs: number;
  /** Samples 2% inside an edge (gutter / seam / bleed quality). */
  edgeSamples: number;
  edgeMeanAbs: number;
}

export interface ErrorDiagnostic extends ErrorStats {
  perMaterial: { material: string; samples: number; meanAbs: number; p95: number }[];
}

export interface AtlasDiagnostics {
  size: number;
  pad: number;
  charts: number;
  contentPixels: number;
  allocatedPixels: number;
  gutterPixels: number;
  emptyPixels: number;
  uvPixels: number;
  opaquePixels: number;
  overlapPixels: number;
  contentUtilization: number;
  allocatedUtilization: number;
  uvUtilization: number;
  opaqueUtilization: number;
  chartCoverage: number;
  materials: MaterialDiagnostic[];
  chartDetails: ChartDiagnostic[];
  error: ErrorDiagnostic;
}

interface RasterTarget {
  size: number;
  uvMask: Uint8Array;
  opaqueMask: Uint8Array;
  /** 0 = free, >0 = material index + 1, -1 = overlap between materials. */
  owner: Int16Array;
  overlapPixels: number;
}

function rasterTriangles(
  points: readonly [number, number][],
  size: number,
  onPixel: (index: number) => void,
) {
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
}

const uvAt = (uvs: Float32Array, triangle: number, corner: number): [number, number] => {
  const index = triangle * 6 + corner * 2;
  return [uvs[index] ?? 0.5, uvs[index + 1] ?? 0.5];
};

const triangleUvArea = (
  uvs: Float32Array,
  triangle: number,
): number => {
  const [ax, ay] = uvAt(uvs, triangle, 0);
  const [bx, by] = uvAt(uvs, triangle, 1);
  const [cx, cy] = uvAt(uvs, triangle, 2);
  return Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) / 2;
};

function markOwner(target: RasterTarget, index: number, materialIndex: number) {
  const previous = target.owner[index]!;
  if (previous === 0) target.owner[index] = materialIndex + 1;
  else if (previous > 0 && previous !== materialIndex + 1) {
    target.owner[index] = -1;
    target.overlapPixels++;
  }
}

const percentile = (sorted: number[], share: number): number => {
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(share * (sorted.length - 1))));
  return sorted[index]!;
};

export interface MeasureOptions {
  /** Max sampling-error probes; keeps real character models bounded. */
  maxErrorSamples?: number;
  /** Skip sampling-error analysis (fast layout-only runs). */
  skipError?: boolean;
}

export function measurePlan(
  inputs: readonly ChartInput[],
  plan: AtlasPlan,
  options: MeasureOptions = {},
): { diagnostics: AtlasDiagnostics; atlas: RgbaImage; atlasUvs: Map<string, Float32Array> } {
  const atlasUvs = remapPlan(inputs, plan);
  const atlas = renderPlan(inputs, plan);
  const size = plan.size;
  const byId = new Map(inputs.map((input) => [input.id, input]));
  const materialIndex = new Map<string, number>();
  const materialOrder: string[] = [];
  for (const input of inputs)
    if (!materialIndex.has(input.material)) {
      materialIndex.set(input.material, materialOrder.length);
      materialOrder.push(input.material);
    }
  const materialUv = new Map<string, Uint8Array>();
  const materialOpaque = new Map<string, Uint8Array>();
  const materialRect = new Map<string, number>();
  const materialChartCount = new Map<string, number>();
  const materialAtlasTexels = new Map<string, number>();
  const materialSourceTexels = new Map<string, number>();
  const materialWorldArea = new Map<string, number>();
  const materialTriangles = new Map<string, { density: number[]; ratio: number[] }>();
  const bboxArea = new Map<string, number>();
  const materialUvArea = new Map<string, number>();

  const target: RasterTarget = {
    size,
    uvMask: new Uint8Array(size * size),
    opaqueMask: new Uint8Array(size * size),
    owner: new Int16Array(size * size),
    overlapPixels: 0,
  };
  const chartDetails: ChartDiagnostic[] = [];
  const uniqueRects = new Map<string, { content: number; allocated: number }>();

  // Per-input totals first, so charts can distribute their cost by area share.
  for (const input of inputs) {
    if (!materialUv.has(input.material)) {
      materialUv.set(input.material, new Uint8Array(size * size));
      materialOpaque.set(input.material, new Uint8Array(size * size));
      materialRect.set(input.material, 0);
      materialChartCount.set(input.material, 0);
      materialAtlasTexels.set(input.material, 0);
      materialSourceTexels.set(input.material, 0);
      materialWorldArea.set(input.material, 0);
      materialTriangles.set(input.material, { density: [], ratio: [] });
      bboxArea.set(input.material, 0);
      materialUvArea.set(input.material, 0);
    }
    const material = input.material;
    materialWorldArea.set(material, materialWorldArea.get(material)! + input.area);
    const source = input.texture;
    const atlasUv = atlasUvs.get(input.id);
    if (!atlasUv || !input.uvs) continue;
    const count = Math.floor(input.uvs.length / 6);
    for (let triangle = 0; triangle < count; triangle++) {
      const sourceArea = triangleUvArea(input.uvs, triangle);
      const atlasArea = triangleUvArea(atlasUv, triangle);
      materialAtlasTexels.set(
        material,
        materialAtlasTexels.get(material)! + atlasArea * size * size,
      );
      if (source)
        materialSourceTexels.set(
          material,
          materialSourceTexels.get(material)! +
            sourceArea * source.width * source.height,
        );
      const world = input.triangleAreas?.[triangle] ?? 0;
      if (world > 1e-12) {
        materialTriangles.get(material)!.density.push((atlasArea * size * size) / world);
        if (source) {
          const native = sourceArea * source.width * source.height;
          if (native > 1e-12)
            materialTriangles.get(material)!.ratio.push(
              (atlasArea * size * size) / native,
            );
        }
      }
    }
    if (input.bounds) {
      bboxArea.set(
        material,
        bboxArea.get(material)! +
          Math.max(0, input.bounds[2] - input.bounds[0]) *
            Math.max(0, input.bounds[3] - input.bounds[1]),
      );
    }
  }

  for (const chart of plan.charts) {
    const inner = innerRect(chart.rect);
    const contentPixels = inner.width * inner.height;
    const allocatedPixels = chart.rect.width * chart.rect.height;
    let covered = 0;
    let atlasTexels = 0;
    let uvArea = 0;
    const chartMask = new Uint8Array(size * size);
    const groups =
      chart.triangles ?? [
        { inputId: chart.inputId, triangles: null as number[] | null },
      ];
    for (const group of groups) {
      const input = byId.get(group.inputId);
      const uv = atlasUvs.get(group.inputId);
      if (!input || !uv) continue;
      const material = input.material;
      const index = materialIndex.get(material)!;
      const count = Math.floor(uv.length / 6);
      const triangles =
        group.triangles ?? Array.from({ length: count }, (_, triangle) => triangle);
      for (const triangle of triangles) {
        if (triangle < 0 || triangle >= count) continue;
        atlasTexels += triangleUvArea(uv, triangle) * size * size;
        if (chart.bounds && input.uvs) {
          const area = triangleUvArea(input.uvs, triangle);
          uvArea += area;
          materialUvArea.set(material, (materialUvArea.get(material) ?? 0) + area);
        }
        rasterTriangles(
          [uvAt(uv, triangle, 0), uvAt(uv, triangle, 1), uvAt(uv, triangle, 2)],
          size,
          (pixel) => {
            if (!chartMask[pixel]) {
              chartMask[pixel] = 1;
              covered++;
            }
            target.uvMask[pixel] = 1;
            materialUv.get(material)![pixel] = 1;
            markOwner(target, pixel, index);
            if (atlas.data[pixel * 4 + 3]! > 0) {
              target.opaqueMask[pixel] = 1;
              materialOpaque.get(material)![pixel] = 1;
            }
          },
        );
      }
    }
    const spanU = chart.bounds ? chart.bounds[2] - chart.bounds[0] : 0;
    const spanV = chart.bounds ? chart.bounds[3] - chart.bounds[1] : 0;
    const boundsArea = Math.max(0, spanU) * Math.max(0, spanV);
    uniqueRects.set(
      `${chart.rect.x},${chart.rect.y},${chart.rect.width},${chart.rect.height}`,
      { content: contentPixels, allocated: allocatedPixels },
    );
    chartDetails.push({
      chartId: chart.chartId,
      inputId: chart.inputId,
      materials: chart.materials,
      x: chart.rect.x,
      y: chart.rect.y,
      width: chart.rect.width,
      height: chart.rect.height,
      pad: chart.rect.pad,
      contentPixels,
      allocatedPixels,
      coveredPixels: covered,
      chartCoverage: contentPixels > 0 ? covered / contentPixels : 0,
      uvAreaRatio: boundsArea > 0 ? Math.min(1, uvArea / boundsArea) : 0,
      atlasTexels,
    });
    for (const material of new Set(chart.materials))
      materialChartCount.set(material, (materialChartCount.get(material) ?? 0) + 1);
    const chartWorld = groups.reduce(
      (sum, group) => sum + (byId.get(group.inputId)?.area ?? 0),
      0,
    );
    // Shared charts have one rectangle for several materials; split it by the
    // UV area each material actually occupies, which keeps the waste number
    // meaningful instead of silently rewarding the biggest part.
    const groupUvAreas = groups.map((group) => {
      const uv = atlasUvs.get(group.inputId);
      const count = uv ? Math.floor(uv.length / 6) : 0;
      const triangles =
        group.triangles ?? Array.from({ length: count }, (_, index) => index);
      let area = 0;
      for (const triangle of triangles)
        if (triangle >= 0 && triangle < count) area += triangleUvArea(uv!, triangle);
      return area;
    });
    const uvSum = groupUvAreas.reduce((sum, value) => sum + value, 0);
    groups.forEach((group, groupIndex) => {
      const input = byId.get(group.inputId);
      if (!input) return;
      const share =
        uvSum > 1e-12
          ? groupUvAreas[groupIndex]! / uvSum
          : chartWorld > 0
            ? input.area / chartWorld
            : 1 / groups.length;
      materialRect.set(
        input.material,
        (materialRect.get(input.material) ?? 0) + contentPixels * share,
      );
    });
  }

  const materials: MaterialDiagnostic[] = materialOrder.map((material) => {
    const density = materialTriangles.get(material)?.density ?? [];
    const ratio = materialTriangles.get(material)?.ratio ?? [];
    const sortedRatio = [...ratio].sort((a, b) => a - b);
    const sortedDensity = [...density].sort((a, b) => a - b);
    const worldArea = materialWorldArea.get(material) ?? 0;
    const atlasTexels = materialAtlasTexels.get(material) ?? 0;
    const sourceTexels = materialSourceTexels.get(material) ?? 0;
    const uvPixels = countMask(materialUv.get(material));
    const rectPixels = materialRect.get(material) ?? 0;
    return {
      material,
      inputIds: inputs.filter((input) => input.material === material).map((input) => input.id),
      charts: materialChartCount.get(material) ?? 0,
      worldArea,
      sourceTexels,
      atlasTexels,
      texelDensity: worldArea > 0 ? atlasTexels / worldArea : 0,
      sourceRatio: sourceTexels > 0 ? atlasTexels / sourceTexels : 0,
      sourceRatioP50: percentile(sortedRatio, 0.5),
      sourceRatioP05: percentile(sortedRatio, 0.05),
      densityP50: percentile(sortedDensity, 0.5),
      uvPixels,
      opaquePixels: countMask(materialOpaque.get(material)),
      rectPixels,
      wastePixels: Math.max(0, rectPixels - uvPixels),
      bboxUtilization:
        (bboxArea.get(material) ?? 0) > 0
          ? Math.min(1, (materialUvArea.get(material) ?? 0) / bboxArea.get(material)!)
          : 0,
    };
  });

  const contentPixels = [...uniqueRects.values()].reduce((sum, rect) => sum + rect.content, 0);
  const allocatedPixels = [...uniqueRects.values()].reduce(
    (sum, rect) => sum + rect.allocated,
    0,
  );
  const uvPixels = countMask(target.uvMask);
  const opaquePixels = countMask(target.opaqueMask);
  const error = options.skipError
    ? emptyError()
    : measureError(inputs, atlasUvs, atlas, options.maxErrorSamples ?? 120_000);

  return {
    diagnostics: {
      size,
      pad: plan.pad,
      charts: plan.charts.length,
      contentPixels,
      allocatedPixels,
      gutterPixels: Math.max(0, allocatedPixels - contentPixels),
      emptyPixels: Math.max(0, size * size - allocatedPixels),
      uvPixels,
      opaquePixels,
      overlapPixels: target.overlapPixels,
      contentUtilization: contentPixels / (size * size),
      allocatedUtilization: allocatedPixels / (size * size),
      uvUtilization: uvPixels / (size * size),
      opaqueUtilization: opaquePixels / (size * size),
      chartCoverage: contentPixels > 0 ? uvPixels / contentPixels : 0,
      materials,
      chartDetails,
      error,
    },
    atlas,
    atlasUvs,
  };
}

function countMask(mask: Uint8Array | undefined): number {
  if (!mask) return 0;
  let total = 0;
  for (const value of mask) total += value ? 1 : 0;
  return total;
}

function emptyError(): ErrorDiagnostic {
  return {
    samples: 0,
    meanAbs: 0,
    p95: 0,
    maxAbs: 0,
    alphaMean: 0,
    interiorSamples: 0,
    interiorMeanAbs: 0,
    edgeSamples: 0,
    edgeMeanAbs: 0,
    perMaterial: [],
  };
}

const BARYCENTRIC: { weights: [number, number, number]; edge: boolean }[] = [
  { weights: [1 / 3, 1 / 3, 1 / 3], edge: false },
  { weights: [0.6, 0.2, 0.2], edge: false },
  { weights: [0.2, 0.6, 0.2], edge: false },
  { weights: [0.2, 0.2, 0.6], edge: false },
  { weights: [0.49, 0.49, 0.02], edge: true },
  { weights: [0.02, 0.49, 0.49], edge: true },
  { weights: [0.49, 0.02, 0.49], edge: true },
];

/**
 * Compare the atlas against the original sampler at barycentric probe points.
 * Colours are compared in linear space, alpha is compared after the material's
 * alpha mode has been applied to both sides.
 */
function measureError(
  inputs: readonly ChartInput[],
  atlasUvs: Map<string, Float32Array>,
  atlas: RgbaImage,
  budget: number,
): ErrorDiagnostic {
  let triangles = 0;
  for (const input of inputs) triangles += Math.floor((input.uvs?.length ?? 0) / 6);
  const stride = Math.max(1, Math.ceil((triangles * BARYCENTRIC.length) / budget));
  const errors: number[] = [];
  const alphaErrors: number[] = [];
  const interior: number[] = [];
  const edge: number[] = [];
  const perMaterial = new Map<string, { errors: number[]; alpha: number[] }>();
  let samples = 0;

  for (const input of inputs) {
    const source = input.texture;
    const original = input.uvs;
    const mapped = atlasUvs.get(input.id);
    if (!source || !original || !mapped) continue;
    const count = Math.floor(original.length / 6);
    const bucket = perMaterial.get(input.material) ?? { errors: [], alpha: [] };
    perMaterial.set(input.material, bucket);
    for (let triangle = 0; triangle < count; triangle += stride) {
      for (const probe of BARYCENTRIC) {
        const [w0, w1, w2] = probe.weights;
        const su =
          w0 * (original[triangle * 6] ?? 0) +
          w1 * (original[triangle * 6 + 2] ?? 0) +
          w2 * (original[triangle * 6 + 4] ?? 0);
        const sv =
          w0 * (original[triangle * 6 + 1] ?? 0) +
          w1 * (original[triangle * 6 + 3] ?? 0) +
          w2 * (original[triangle * 6 + 5] ?? 0);
        const au =
          w0 * (mapped[triangle * 6] ?? 0) +
          w1 * (mapped[triangle * 6 + 2] ?? 0) +
          w2 * (mapped[triangle * 6 + 4] ?? 0);
        const av =
          w0 * (mapped[triangle * 6 + 1] ?? 0) +
          w1 * (mapped[triangle * 6 + 3] ?? 0) +
          w2 * (mapped[triangle * 6 + 5] ?? 0);
        const expected = bakeSample(
          sampleBilinear(source, su, sv, input.wrap[0], input.wrap[1]),
          {
            color: input.color,
            opacity: input.opacity,
            alphaMode: input.alphaMode,
            alphaCutoff: input.alphaCutoff,
          },
        );
        const actual = sampleAtlasLinear(atlas, au, av);
        const difference =
          (Math.abs(expected[0] - actual[0]) +
            Math.abs(expected[1] - actual[1]) +
            Math.abs(expected[2] - actual[2])) /
          3;
        const alphaDifference = Math.abs(expected[3] - actual[3]);
        errors.push(difference);
        alphaErrors.push(alphaDifference);
        (probe.edge ? edge : interior).push(difference);
        bucket.errors.push(difference);
        bucket.alpha.push(alphaDifference);
        samples++;
      }
    }
  }

  errors.sort((a, b) => a - b);
  alphaErrors.sort((a, b) => a - b);
  const mean = (values: number[]) =>
    values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  return {
    samples,
    meanAbs: mean(errors),
    p95: percentile(errors, 0.95),
    maxAbs: errors.length ? errors[errors.length - 1]! : 0,
    alphaMean: mean(alphaErrors),
    interiorSamples: interior.length,
    interiorMeanAbs: mean(interior),
    edgeSamples: edge.length,
    edgeMeanAbs: mean(edge),
    perMaterial: [...perMaterial].map(([material, bucket]) => {
      const sorted = [...bucket.errors].sort((a, b) => a - b);
      return {
        material,
        samples: sorted.length,
        meanAbs: mean(sorted),
        p95: percentile(sorted, 0.95),
      };
    }),
  };
}
