import { expandModelArchives } from './model-zip.ts';
import { formatOf, loadModelFiles, type LoadedModel } from './import-model.ts';
import {
  applyPmxMaterialNames,
  convertPmxModel,
  isPmdModel,
  isPmxModel,
} from './pmx.ts';
import { convertTgaTextures } from './textures.ts';
import { detectArmRig, type ArmRig } from './pose.ts';
import { detectHumanoidRig, type HumanoidRig } from './humanoid.ts';
import { extractModel, type ExtractedModel } from './extract.ts';
import { reduceBatches } from './reduce.ts';
import { convertBatches, type BindingMode, type ConvertResult } from './convert.ts';
import { nextFrame } from './frame.ts';
import type { DoubleSidedPolicy } from './bedrock.ts';
import type { SourceBatch } from './types.ts';

/** Thrown when a newer model load superseded this one. */
export class ModelJobCancelled extends Error {
  constructor() {
    super('Model job cancelled');
    this.name = 'ModelJobCancelled';
  }
}

function assertActive(isCurrent: () => boolean) {
  if (!isCurrent()) throw new ModelJobCancelled();
}

export interface LoadModelJobOptions {
  onPhase?: (phase: string) => void;
  /** Return false when a newer load should win; the partial model is disposed. */
  isCurrent?: () => boolean;
}

export interface LoadedModelJob {
  model: LoadedModel;
  extracted: ExtractedModel;
  totalBytes: number;
  warnings: string[];
  armRig: ArmRig | null;
  /** Complete six-part rig, when the source provides one. */
  rig: HumanoidRig | null;
}

/**
 * Browser import pipeline: archives -> PMX -> TGA -> three.js load -> static
 * extraction. React, preview roots and material visibility stay with the UI.
 */
export async function loadModelJob(
  incoming: readonly File[],
  options: LoadModelJobOptions = {},
): Promise<LoadedModelJob> {
  const isCurrent = options.isCurrent ?? (() => true);
  const phase = options.onPhase ?? (() => {});
  let loaded: LoadedModel | null = null;
  try {
    phase('读取文件…');
    await nextFrame();
    const expanded = await expandModelArchives([...incoming]);
    assertActive(isCurrent);
    let files = expanded.files;
    const warnings = [...expanded.warnings];
    let pmxMaterialNames: string[] = [];

    if (files.some((file) => isPmxModel(file) || isPmdModel(file))) {
      phase('转换 PMX 模型…');
      await nextFrame();
      const pmx = await convertPmxModel(files);
      files = files
        .filter((file) => !isPmxModel(file) && !isPmdModel(file))
        .concat(pmx.file);
      pmxMaterialNames = pmx.materialNames;
      warnings.push(...pmx.warnings);
      assertActive(isCurrent);
    }

    phase('准备贴图…');
    await nextFrame();
    const textures = await convertTgaTextures(files, {
      onProgress: (done, total) => {
        if (total) phase(`准备贴图 ${done}/${total}…`);
      },
    });
    files = textures.files;
    warnings.push(...textures.warnings);
    assertActive(isCurrent);

    if (!files.some((file) => formatOf(file.name))) {
      throw new Error('没有找到支持的模型文件。支持 GLB、glTF、VRM、PMX、FBX、OBJ、DAE、STL、PLY，也可以导入包含模型和贴图的 ZIP。');
    }
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    if (totalBytes > 512 * 1024 * 1024) {
      throw new Error('文件总大小超过 512 MB，请精简贴图或先压缩模型。');
    }

    phase('解析模型…');
    loaded = await loadModelFiles(files);
    assertActive(isCurrent);
    if (pmxMaterialNames.length) {
      const applied = applyPmxMaterialNames(loaded.scene, pmxMaterialNames);
      if (!applied)
        warnings.push('PMX 材质数量与转换结果不一致，已保留通用材质名。');
    }

    const rig = detectHumanoidRig(loaded.scene, loaded.humanoidRoles);
    const armRig = detectArmRig(loaded.scene);
    const extracted = extractModel(loaded.scene, { rig });
    if (rig) {
      const classified = extracted.batches.some((batch) =>
        batch.parts?.some((part) => part !== 0));
      if (!classified)
        warnings.push('识别到人形骨骼，但网格没有可用的蒙皮权重；导出后仍会整体跟随身体，不会分部位摆动。');
    } else if (loaded.stats.triangles > 0) {
      warnings.push('未识别到完整的 VRM / 常见 MMD 人形骨骼，将使用静态整体绑定（不会随玩家动作摆动）。');
    }
    assertActive(isCurrent);
    return {
      model: loaded,
      extracted,
      totalBytes,
      warnings: [...new Set([...warnings, ...loaded.warnings, ...extracted.warnings])],
      armRig,
      rig,
    };
  } catch (cause) {
    loaded?.dispose();
    throw cause;
  }
}

export interface ConvertExtractedOptions {
  name: string;
  height: number;
  doubleSided: DoubleSidedPolicy;
  binding?: BindingMode;
  ratio: number;
  maxError: number;
  included: ReadonlySet<string>;
  weights: Readonly<Record<string, number>>;
  onPhase?: (phase: string) => void;
}

export interface ConvertExtractedResult {
  result: ConvertResult;
  /** Reduction and export warnings; caller-owned import warnings stay separate. */
  warnings: string[];
  excludedMaterials: string[];
}

/** Filter, reduce, weight and atlas an already extracted model. */
export async function convertExtractedModel(
  extracted: ExtractedModel,
  options: ConvertExtractedOptions,
): Promise<ConvertExtractedResult> {
  const phase = options.onPhase ?? (() => {});
  let batches = extracted.batches.filter((batch) => options.included.has(batch.key));
  if (!batches.length) throw new Error('请至少保留一个材质');
  const sourceTriangles = batches.reduce((sum, batch) => sum + batch.triangles, 0);

  let reductionWarnings: string[] = [];
  if (options.ratio < 0.999) {
    phase('减面…');
    await nextFrame();
    const reduced = await reduceBatches(batches, {
      ratio: options.ratio,
      maxError: options.maxError,
    });
    batches = reduced.batches;
    reductionWarnings = reduced.warnings;
  }

  batches = batches.map((batch) => {
    const weight = options.weights[batch.key] ?? 1;
    return weight === 1
      ? batch
      : { ...batch, area: batch.area * Math.max(0, weight) };
  });

  const humanoid = options.binding === 'humanoid' ? extracted.rig : null;
  if (options.binding === 'humanoid' && !humanoid)
    throw new Error('没有识别到完整的六部位人形骨骼，无法按人形绑定导出');
  const converted = await convertBatches(batches, {
    name: options.name,
    height: options.height,
    doubleSided: options.doubleSided,
    ...(humanoid ? { rig: humanoid } : {}),
    sourceTriangles,
    onPhase: phase,
  });
  const excludedMaterials = [...new Set(
    extracted.batches
      .filter((batch) => !options.included.has(batch.key))
      .map((batch) => batch.name),
  )];
  return {
    result: converted,
    warnings: [...reductionWarnings, ...converted.report.warnings],
    excludedMaterials,
  };
}

/** Final face multiplier for the current double-sided policy. */
export function backMultiplier(batch: SourceBatch, policy: DoubleSidedPolicy) {
  if (policy === 'all') return 2;
  if (policy === 'front') return 1;
  return batch.doubleSided ? 2 : 1;
}

/** Final source face count, including backfaces for the selected policy. */
export function sourceTriangleCount(
  batches: readonly SourceBatch[],
  included: ReadonlySet<string>,
  policy: DoubleSidedPolicy,
) {
  return batches
    .filter((batch) => included.has(batch.key))
    .reduce((sum, batch) => sum + batch.triangles * backMultiplier(batch, policy), 0);
}

/** Display names for duplicate material names, e.g. `Body #2`. */
export function materialLabels(batches: readonly SourceBatch[]) {
  const labels = new Map<string, string>();
  const totals = new Map<string, number>();
  for (const batch of batches) totals.set(batch.name, (totals.get(batch.name) ?? 0) + 1);
  const seen = new Map<string, number>();
  for (const batch of batches) {
    if ((totals.get(batch.name) ?? 1) <= 1) {
      labels.set(batch.key, batch.name);
      continue;
    }
    const index = (seen.get(batch.name) ?? 0) + 1;
    seen.set(batch.name, index);
    labels.set(batch.key, `${batch.name} #${index}`);
  }
  return labels;
}

export interface ModelResultKeyInput {
  name: string;
  height: number;
  rotationY: number;
  armSpread: number;
  doubleSided: DoubleSidedPolicy;
  ratio: number;
  maxError: number;
  included: Iterable<string>;
  weights: Readonly<Record<string, number>>;
  modelTriangles: number;
}

/** Signature used to mark a conversion result stale. */
export function modelResultKey(input: ModelResultKeyInput) {
  return [
    input.name.trim(),
    input.height,
    input.rotationY,
    input.armSpread,
    input.doubleSided,
    input.ratio.toFixed(2),
    input.maxError.toFixed(3),
    [...input.included].sort().join(','),
    Object.entries(input.weights)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}:${value}`)
      .join(','),
    input.modelTriangles,
  ].join('|');
}
