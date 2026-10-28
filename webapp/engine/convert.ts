import type { BedrockGeometryFile } from '../../src/bedrock-types.ts';
import { buildSkinPack } from '../../src/skin-pack-files.ts';
import { planAtlas, remapUvs, renderAtlas, measureAtlasUsage, type AtlasInput } from './atlas.ts';
import {
  buildBedrockGeometry,
  type DoubleSidedPolicy,
  type GeometryReport,
  type GeometryRig,
} from './bedrock.ts';
import { canvasPng } from './canvas.ts';
import { nextFrame } from './frame.ts';
import { validateName } from './names.ts';
import { reporter, type ProgressHandler } from './progress.ts';
import type { HumanoidPart, SourceBatch } from './types.ts';

export type BindingMode = 'static' | 'humanoid';

export interface ConvertOptions {
  name: string;
  height: number;
  doubleSided: DoubleSidedPolicy;
  rig?: GeometryRig;
  /** Pre-reduction triangle count, for the report only. */
  sourceTriangles?: number;
  /** Astage updates for the busy UI. */
  onProgress?: ProgressHandler;
  /** Legacy browser planner (default) or the shared texel-budget planner. */
  textureMode?: 'legacy' | 'budget';
  /** Budget objective when `textureMode` is budget. */
  textureTarget?: 'density' | 'retention';
  /** Relative material quality multipliers, keyed by stable material key. */
  materialWeights?: Readonly<Record<string, number>>;
  /** Reuse rectangles only for bit-identical charts. */
  atlasSharing?: boolean;
  /** Charge retention demand for sampled UV area. */
  coverageAware?: boolean;
}

export interface AtlasRegion {
  /** Unique rectangle key. */
  key: string;
  /** Display names joined for shared rectangles. */
  name: string;
  /** Stable material key for a single-owner rectangle. */
  materialKey?: string;
  /** All stable material keys that sample this rectangle. */
  materialKeys?: string[];
  /** All display names that sample this rectangle. */
  materials?: string[];
  x: number;
  y: number;
  width: number;
  height: number;
  pad: number;
  /** Content pixels excluding padding. */
  contentPixels: number;
  /** Source texture size, when the material has a texture. */
  sourceWidth?: number;
  sourceHeight?: number;
  /** Continuous source UV bounds, when available. */
  bounds?: [number, number, number, number];
  /** True for untextured materials that only need a solid color sample. */
  flat: boolean;
}

export interface TextureMaterialReport {
  key: string;
  name: string;
  /** Pixels covered by a non-transparent triangle (per material). */
  pixels: number;
  /** Triangle-covered pixels, including transparent texels. */
  uvPixels?: number;
  /** Pixels sampled by this material and another material. */
  sharedPixels?: number;
  /** Sampled pixels no other material covers. */
  uniquePixels?: number;
  /** Unique content pixels attributed to this material. */
  rectPixels?: number;
  /** Attributed content not covered by a triangle. */
  wastePixels?: number;
  /** Exact continuous atlas texels this material's triangles map to. */
  atlasTexels?: number;
  sourceTexels?: number;
  texelDensity?: number;
  floorCharts?: number;
  targetArea?: number;
  actualArea?: number;
}

export interface TextureReport {
  /** Pixels inside the atlas, including per-rectangle padding. */
  allocatedUtilization: number;
  /** Pixels actually covered by a non-transparent triangle. */
  sampledUtilization: number;
  /** Triangle-covered pixels, including transparent texels. */
  uvUtilization?: number;
  /** Content rectangles without padding. */
  contentUtilization?: number;
  sampledPixels?: number;
  uvPixels?: number;
  contentPixels?: number;
  allocatedPixels?: number;
  gutterPixels?: number;
  emptyPixels?: number;
  gutterUtilization?: number;
  emptyUtilization?: number;
  /** Share of content-rectangle pixels covered by a triangle. */
  chartCoverage?: number | undefined;
  /** Budget-mode-only: unique content pixels never sampled. */
  unusedContentPixels?: number;
  /** Budget-mode-only: pixels sampled by two or more materials. */
  overlapPixels?: number;
  /** Budget-mode-only: content pixels inside shared rectangles. */
  sharedContentPixels?: number;
  /** Planner used for this output. */
  mode?: 'legacy' | 'budget';
  target?: 'density' | 'retention';
  shared?: { charts: number; savedPixels: number };
  size: number;
  /** Pixel count per material key; shared pixels count for every material. */
  materials: TextureMaterialReport[];
  /** Per-part texture demand when triangle-level part ids were available. */
  parts?: { id: string; name: string; triangles: number; atlasTexels: number }[];
  /** Per-island atlas rectangles, for the texture inspector. */
  regions?: AtlasRegion[];
}

export interface ConvertResult {
  files: Record<string, Uint8Array>;
  geometry: BedrockGeometryFile;
  png: Uint8Array;
  report: GeometryReport;
  textureReport: TextureReport;
  textureCoverage: number;
  textureUrl: string;
  /** Atlas with unused rectangle pixels tinted, for the inspector. */
  coverageUrl?: string;
  triangles: number;
  binding: BindingMode;
  parts?: Partial<Record<HumanoidPart, number>>;
  /** Wall time for the whole convert action, filled by the studio. */
  elapsedMs?: number;
  /** Material names excluded before conversion, filled by the studio. */
  excludedMaterials?: string[];
  /** Stable keys matching `excludedMaterials`. */
  excludedMaterialKeys?: string[];
}

export async function convertBatches(
  source: readonly SourceBatch[],
  options: ConvertOptions,
): Promise<ConvertResult> {
  validateName(options.name);
  if (!source.length) throw new Error('没有可导出的材质');
  // UVs are rewritten for the atlas, so keep the extracted batches reusable.
  const batches = source.map((batch) => ({ ...batch }));
  const inputs: AtlasInput[] = batches.map((batch) => ({
    key: batch.key,
    materialName: batch.name,
    materialKey: batch.materialKey ?? batch.key,
    texture: batch.texture,
    uvBounds: batch.uvBounds,
    uvs: batch.uvs,
    triangleAreas: triangleAreas(batch),
    color: batch.color,
    opacity: batch.opacity,
    alphaMode: batch.alphaMode,
    alphaCutoff: batch.alphaCutoff,
    area: batch.area,
    ...(batch.sourceParts ? { partIndex: batch.sourceParts } : {}),
    ...(batch.sourcePartTable ? { parts: batch.sourcePartTable } : {}),
  }));
  const batchByInput = new Map(inputs.map((input, index) => [input.key, batches[index]!]));
  const inputByKey = new Map(inputs.map((input) => [input.key, input]));

  const report = reporter(options.onProgress);
  report('规划 128×128 图集…', `${inputs.length} 个材质`);
  await nextFrame();
  const budget = options.textureMode === 'budget';
  const layout = planAtlas(
    inputs,
    128,
    1,
    budget
      ? {
          budget: options.textureTarget === 'density' ? 'texel-density' : 'texel-retention',
          ...(options.materialWeights && Object.keys(options.materialWeights).length
            ? { weights: options.materialWeights }
            : {}),
          ...(options.atlasSharing ? { sharing: 'safe' as const } : {}),
        }
      : {},
  );
  report('绘制 128×128 贴图图集…', `${layout.charts.length} 个 UV 岛`);
  await nextFrame();
  const atlas = renderAtlas(inputs, layout);
  report('重映射 UV…', `${layout.charts.length} 个 UV 岛`);
  await nextFrame();
  const remapped = new Map<string, Float32Array>();
  for (const chart of layout.charts) {
    const batch = batchByInput.get(chart.inputKey);
    if (!batch) continue;
    let uvs = remapped.get(batch.key);
    if (!uvs) {
      uvs = batch.uvs
        ? new Float32Array(batch.uvs)
        : new Float32Array(batch.triangles * 6);
      remapped.set(batch.key, uvs);
    }
    remapUvs(
      uvs,
      chart.bounds,
      chart.rect,
      layout.size,
      chart.triangles.length ? chart.triangles : undefined,
    );
  }
  for (const batch of batches) {
    const uvs = remapped.get(batch.key);
    if (uvs) batch.uvs = uvs;
  }
  const usage = await measureAtlasUsage(atlas.canvas, batches, layout.size, {
    onProgress: (done, total, name) =>
      report(
        '统计贴图覆盖率…',
        name ? `${done + 1}/${total} 个材质` : undefined,
      ),
  });
  report('汇总贴图报告…');
  const summary = layout.budget?.report ?? null;
  const totalPixels = layout.size * layout.size;
  let contentPixels = 0;
  if (summary) contentPixels = summary.contentPixels;
  else
    for (const chart of layout.charts)
      contentPixels +=
        Math.max(1, chart.rect.width - chart.rect.pad * 2) *
        Math.max(1, chart.rect.height - chart.rect.pad * 2);
  const allocatedPixels = summary
    ? summary.allocatedPixels
    : layout.charts.reduce(
        (sum, chart) => sum + chart.rect.width * chart.rect.height,
        0,
      );
  const gutterPixels = Math.max(0, allocatedPixels - contentPixels);
  const emptyPixels = Math.max(0, totalPixels - allocatedPixels);
  const usageByKey = new Map(usage.materials.map((material) => [material.key, material]));

  const regions: AtlasRegion[] = [];
  const rectRegions = new Map<string, AtlasRegion>();
  for (const chart of layout.charts) {
    const input = inputByKey.get(chart.inputKey);
    const batch = batchByInput.get(chart.inputKey);
    const contentWidth = Math.max(1, chart.rect.width - chart.rect.pad * 2);
    const contentHeight = Math.max(1, chart.rect.height - chart.rect.pad * 2);
    const rectKey = `${chart.rect.x},${chart.rect.y},${chart.rect.width},${chart.rect.height}`;
    const existing = rectRegions.get(rectKey);
    if (existing) {
      // Shared charts point at one rectangle: list every material once.
      if (!existing.materials?.includes(batch?.name ?? '未知材质'))
        existing.materials = [...(existing.materials ?? []), batch?.name ?? '未知材质'];
      if (chart.inputKey && !existing.materialKeys?.includes(chart.inputKey))
        existing.materialKeys = [...(existing.materialKeys ?? []), chart.inputKey];
      existing.name = existing.materials.join(' / ');
      continue;
    }
    const region: AtlasRegion = {
      key: rectKey,
      name: batch?.name ?? '未知材质',
      materialKey: chart.inputKey,
      materialKeys: [chart.inputKey],
      materials: [batch?.name ?? '未知材质'],
      x: chart.rect.x,
      y: chart.rect.y,
      width: chart.rect.width,
      height: chart.rect.height,
      pad: chart.rect.pad,
      contentPixels: contentWidth * contentHeight,
      ...(input?.texture
        ? { sourceWidth: input.texture.width, sourceHeight: input.texture.height }
        : {}),
      ...(chart.bounds ? { bounds: chart.bounds } : {}),
      flat: !chart.bounds,
    };
    rectRegions.set(rectKey, region);
    regions.push(region);
  }

  const materials = summary
    ? summary.materials.map((material) => {
        const measured = usageByKey.get(material.materialKey);
        return {
          key: material.materialKey,
          name: material.material,
          pixels: measured?.pixels ?? material.uvPixels,
          uvPixels: material.uvPixels,
          sharedPixels: material.sharedPixels,
          uniquePixels: material.uniquePixels,
          rectPixels: material.rectPixels,
          wastePixels: material.wastePixels,
          atlasTexels: material.atlasTexels,
          sourceTexels: material.sourceTexels,
          texelDensity: material.texelDensity,
          floorCharts: material.floorCharts,
          targetArea: material.targetArea,
          actualArea: material.actualArea,
        };
      })
    : usage.materials.map((material) => ({
        key: material.key,
        name: material.name,
        pixels: material.pixels,
        ...(material.uvPixels !== undefined ? { uvPixels: material.uvPixels } : {}),
      }));

  const textureReport: TextureReport = {
    allocatedUtilization: allocatedPixels / totalPixels,
    sampledUtilization: usage.sampledUtilization,
    uvUtilization: summary ? summary.uvUtilization : usage.uvUtilization,
    contentUtilization: contentPixels / totalPixels,
    sampledPixels: usage.sampledPixels,
    uvPixels: summary ? summary.uvPixels : usage.uvPixels,
    contentPixels,
    allocatedPixels,
    gutterPixels,
    emptyPixels,
    gutterUtilization: gutterPixels / totalPixels,
    emptyUtilization: emptyPixels / totalPixels,
    chartCoverage: summary ? summary.chartCoverage : contentPixels > 0 ? usage.uvPixels / contentPixels : undefined,
    ...(summary
      ? {
          unusedContentPixels: summary.unusedContentPixels,
          overlapPixels: summary.overlapPixels,
          sharedContentPixels: summary.sharedContentPixels,
          shared: {
            charts: summary.sharedCharts,
            savedPixels: summary.sharedSavedPixels,
          },
        }
      : {}),
    mode: budget ? 'budget' : 'legacy',
    ...(budget
      ? { target: options.textureTarget === 'density' ? 'density' : 'retention' }
      : {}),
    size: layout.size,
    materials,
    ...(summary?.parts.length ? { parts: summary.parts } : {}),
    regions,
  };

  report('编码 128×128 PNG…');
  await nextFrame();
  const png = await canvasPng(atlas.canvas);
  const coverageUrl = (() => {
    const overlay = document.createElement('canvas');
    overlay.width = layout.size;
    overlay.height = layout.size;
    const context = overlay.getContext('2d');
    if (!context) return undefined;
    context.drawImage(atlas.canvas, 0, 0);
    const image = context.getImageData(0, 0, layout.size, layout.size);
    for (let index = 0; index < usage.uvMask.length; index++) {
      if (usage.uvMask[index]) continue;
      const offset = index * 4;
      image.data[offset] = 255;
      image.data[offset + 1] = 90;
      image.data[offset + 2] = 90;
      image.data[offset + 3] = 150;
    }
    context.putImageData(image, 0, 0);
    return overlay.toDataURL('image/png');
  })();
  report('导出 4D 骨骼几何…', `${batches.reduce((sum, batch) => sum + batch.triangles, 0).toLocaleString('zh-CN')} 面`);
  await nextFrame();
  const binding: BindingMode = options.rig ? 'humanoid' : 'static';
  const { file, report: geometryReport } = buildBedrockGeometry(batches, {
    height: options.height,
    doubleSided: options.doubleSided,
    ...(options.sourceTriangles !== undefined
      ? { sourceTriangles: options.sourceTriangles }
      : {}),
    ...(options.rig ? { rig: options.rig } : {}),
  });
  report('打包皮肤包…', `${geometryReport.triangles.toLocaleString('zh-CN')} 面`);
  await nextFrame();
  const files = buildSkinPack({
    geometry: file,
    png,
    identifier: 'geometry.skin0',
    packName: options.name.trim(),
  });
  return {
    files,
    geometry: file,
    png,
    report: geometryReport,
    textureReport,
    textureCoverage: atlas.coverage,
    textureUrl: atlas.canvas.toDataURL('image/png'),
    ...(coverageUrl ? { coverageUrl } : {}),
    triangles: geometryReport.triangles,
    binding,
    ...(geometryReport.parts ? { parts: geometryReport.parts } : {}),
  };
}

/**
 * World-space area per triangle, scaled so the sum matches `batch.area`
 * (which already includes the UI's material weight). Chart demand therefore
 * follows the same surface-area curve as the desktop atlas.
 */
function triangleAreas(batch: SourceBatch): Float32Array | null {
  const count = Math.floor(batch.positions.length / 9);
  if (!count) return null;
  const areas = new Float32Array(count);
  let total = 0;
  for (let triangle = 0; triangle < count; triangle++) {
    const offset = triangle * 9;
    const ax = batch.positions[offset]!;
    const ay = batch.positions[offset + 1]!;
    const az = batch.positions[offset + 2]!;
    const abx = batch.positions[offset + 3]! - ax;
    const aby = batch.positions[offset + 4]! - ay;
    const abz = batch.positions[offset + 5]! - az;
    const acx = batch.positions[offset + 6]! - ax;
    const acy = batch.positions[offset + 7]! - ay;
    const acz = batch.positions[offset + 8]! - az;
    const area =
      Math.hypot(
        aby * acz - abz * acy,
        abz * acx - abx * acz,
        abx * acy - aby * acx,
      ) / 2;
    areas[triangle] = area;
    total += area;
  }
  if (total > 0) {
    const scale = batch.area / total;
    for (let i = 0; i < areas.length; i++) areas[i] = areas[i]! * scale;
  } else if (batch.area > 0) {
    areas.fill(batch.area / count);
  }
  return areas;
}
