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
import type { HumanoidPart, SourceBatch } from './types.ts';

export type BindingMode = 'static' | 'humanoid';

export interface ConvertOptions {
  name: string;
  height: number;
  doubleSided: DoubleSidedPolicy;
  rig?: GeometryRig;
  /** Pre-reduction triangle count, for the report only. */
  sourceTriangles?: number;
  onPhase?: (phase: string) => void;
}

export interface TextureReport {
  /** Pixels inside the atlas, including per-rectangle padding. */
  allocatedUtilization: number;
  /** Pixels actually covered by a non-transparent triangle. */
  sampledUtilization: number;
  size: number;
  /** Pixel count per material name; shared pixels count for every material. */
  materials: { name: string; pixels: number }[];
}

export interface ConvertResult {
  files: Record<string, Uint8Array>;
  geometry: BedrockGeometryFile;
  png: Uint8Array;
  report: GeometryReport;
  textureReport: TextureReport;
  textureCoverage: number;
  textureUrl: string;
  triangles: number;
  binding: BindingMode;
  parts?: Partial<Record<HumanoidPart, number>>;
  /** Wall time for the whole convert action, filled by the studio. */
  elapsedMs?: number;
  /** Material names excluded before conversion, filled by the studio. */
  excludedMaterials?: string[];
}

export async function convertBatches(
  source: readonly SourceBatch[],
  options: ConvertOptions,
): Promise<ConvertResult> {
  validateName(options.name);
  if (!source.length) throw new Error('没有可导出的材质');
  // UVs are rewritten for the atlas, so keep the extracted batches reusable.
  const batches = source.map((batch) => ({ ...batch }));
  const atlasKey = (batch: SourceBatch) => [
    batch.texture?.key ?? 'solid',
    batch.uvBounds?.map((value) => value.toFixed(4)).join(',') ?? 'none',
    batch.color.map((value) => value.toFixed(3)).join(','),
    batch.opacity.toFixed(3),
  ].join('|');
  const inputs: AtlasInput[] = batches.map((batch) => ({
    key: atlasKey(batch),
    texture: batch.texture,
    uvBounds: batch.uvBounds,
    color: batch.color,
    opacity: batch.opacity,
    area: batch.area,
  }));

  options.onPhase?.('构建 128×128 贴图图集…');
  await nextFrame();
  const layout = planAtlas(inputs, 128, 1);
  const atlas = renderAtlas(inputs, layout);
  for (const batch of batches) {
    const rect = layout.rects.get(atlasKey(batch));
    if (!rect) continue;
    const uvs = batch.uvs ? new Float32Array(batch.uvs) : new Float32Array(batch.triangles * 6);
    remapUvs(uvs, batch.uvBounds, rect, layout.size);
    batch.uvs = uvs;
  }
  const usage = measureAtlasUsage(atlas.canvas, batches, layout.size);
  const allocated = [...layout.rects.values()]
    .reduce((sum, rect) => sum + rect.width * rect.height, 0) / (layout.size * layout.size);
  const textureReport: TextureReport = {
    allocatedUtilization: Math.min(1, allocated),
    sampledUtilization: usage.sampledUtilization,
    size: layout.size,
    materials: usage.materials,
  };

  options.onPhase?.('导出 4D 骨骼几何…');
  await nextFrame();
  const png = await canvasPng(atlas.canvas);
  const binding: BindingMode = options.rig ? 'humanoid' : 'static';
  const { file, report } = buildBedrockGeometry(batches, {
    height: options.height,
    doubleSided: options.doubleSided,
    ...(options.sourceTriangles !== undefined
      ? { sourceTriangles: options.sourceTriangles }
      : {}),
    ...(options.rig ? { rig: options.rig } : {}),
  });
  options.onPhase?.('打包皮肤包…');
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
    report,
    textureReport,
    textureCoverage: atlas.coverage,
    textureUrl: atlas.canvas.toDataURL('image/png'),
    triangles: report.triangles,
    binding,
    ...(report.parts ? { parts: report.parts } : {}),
  };
}
