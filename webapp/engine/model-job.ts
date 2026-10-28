import { expandModelArchives } from './model-zip.ts';
import type * as THREE from 'three';
import { defaultRotationYDegrees } from '../../src/model-orientation.ts';
import { formatOf, loadModelFiles, modelFilePath, type LoadedModel } from './import-model.ts';
import {
  listModelCandidates,
  modelFormatOf,
  type ModelCandidate,
} from '../../src/model-candidates.ts';
import {
  applyPmxMaterials,
  convertPmxModel,
  isPmdModel,
  isPmxModel,
} from './pmx.ts';
import { PMX_MATERIAL_MISMATCH, type PmxMaterialSource } from '../../src/pmx-materials.ts';
import { convertTgaTextures } from './textures.ts';
import { detectArmRig, type ArmRig } from './pose.ts';
import { detectHumanoidRig, type HumanoidRig } from './humanoid.ts';
import { extractModel, type ExtractedModel } from './extract.ts';
import { filterBatchParts } from './parts.ts';
export { extractedParts, type ExtractedPart } from './parts.ts';
import { reduceBatches } from './reduce.ts';
import { convertBatches, type BindingMode, type ConvertResult } from './convert.ts';
import { nextFrame } from './frame.ts';
import {
  reporter,
  type ProgressHandler,
} from './progress.ts';
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

function isPreparedInput(
  input: readonly File[] | PreparedModelInput,
): input is PreparedModelInput {
  return !Array.isArray(input);
}

export interface LoadModelJobOptions {
  /** Overall progress for the import pipeline. */
  onProgress?: ProgressHandler;
  /** Return false when a newer load should win; the partial model is disposed. */
  isCurrent?: () => boolean;
  /** Candidate path picked in the UI; omitted means auto-pick. */
  main?: string;
}

export interface PreparedModelInput {
  /** Unpacked files; archive-relative paths live on `webkitRelativePath`. */
  files: File[];
  /** Every model file found, best candidate first. */
  candidates: ModelCandidate[];
  warnings: string[];
}

/**
 * Unpack archives and list the models inside. The UI shows this list when an
 * archive holds more than one model, then passes the picked path back to
 * `loadModelJob` so nothing is unpacked twice.
 */
export async function prepareModelInput(
  incoming: readonly File[],
): Promise<PreparedModelInput> {
  const expanded = await expandModelArchives([...incoming]);
  const candidates = listModelCandidates(
    expanded.files.map((file) => ({ path: modelFilePath(file), bytes: file.size })),
  );
  if (!candidates.length)
    throw new Error('没有找到支持的模型文件。支持 GLB、glTF、VRM、PMX、FBX、OBJ、DAE、STL、PLY，也可以导入包含模型和贴图的 ZIP。');
  return { files: expanded.files, candidates, warnings: expanded.warnings };
}

export interface LoadedModelJob {
  model: LoadedModel;
  extracted: ExtractedModel;
  totalBytes: number;
  warnings: string[];
  armRig: ArmRig | null;
  /** Complete six-part rig, when the source provides one. */
  rig: HumanoidRig | null;
  /** 默认 Y 轴朝向：MMD 来源 180°，其余 0°，与桌面工作台一致。 */
  defaultRotationY: number;
}

/** 场景节点名，包含挂在骨骼链上但不在场景图里的关节。 */
function sceneNodeNames(root: THREE.Object3D): string[] {
  const names: string[] = [];
  const seen = new Set<THREE.Object3D>();
  const collect = (object: THREE.Object3D) => {
    if (seen.has(object)) return;
    seen.add(object);
    if (object.name) names.push(object.name);
  };
  root.traverse((object) => {
    collect(object);
    const skinned = object as THREE.SkinnedMesh;
    if (skinned.isSkinnedMesh)
      for (const bone of skinned.skeleton?.bones ?? []) collect(bone);
  });
  return names;
}

/**
 * Browser import pipeline: archives -> PMX -> TGA -> three.js load -> static
 * extraction. React, preview roots and material visibility stay with the UI.
 */
export async function loadModelJob(
  input: readonly File[] | PreparedModelInput,
  options: LoadModelJobOptions = {},
): Promise<LoadedModelJob> {
  const isCurrent = options.isCurrent ?? (() => true);
  const report = reporter(options.onProgress);
  let loaded: LoadedModel | null = null;
  try {
    report('读取文件…');
    await nextFrame();
    const prepared = isPreparedInput(input) ? input : await prepareModelInput(input);
    assertActive(isCurrent);
    let files = prepared.files;
    const warnings = [...prepared.warnings];
    let pmxMaterials: PmxMaterialSource[] = [];
    let main: string | File | undefined = options.main;

    if (options.main !== undefined && modelFormatOf(options.main) === 'pmd')
      throw new Error('暂不支持 PMD，请先转换为 PMX 2.0/2.1。');

    const hasPmx = files.some((file) => isPmxModel(file) || isPmdModel(file));
    const wantsPmx = options.main === undefined || modelFormatOf(options.main) === 'pmx';
    if (hasPmx && wantsPmx) {
      await nextFrame();
      const pmx = await convertPmxModel(files, {
        ...(options.main === undefined ? {} : { main: options.main }),
        ...(options.onProgress ? { onProgress: options.onProgress } : {}),
      });
      files = files
        .filter((file) => !isPmxModel(file) && !isPmdModel(file))
        .concat(pmx.file);
      pmxMaterials = pmx.materials;
      warnings.push(...pmx.warnings);
      // Load exactly the converted model, not another GLB inside the archive.
      main = pmx.file;
      assertActive(isCurrent);
    }

    report('准备贴图…');
    await nextFrame();
    const textures = await convertTgaTextures(files, {
      onProgress: (done, total) => {
        if (total)
          report('准备贴图…', `${done}/${total} 张 TGA`);
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

    report('解析模型…', `${(totalBytes / 1024 / 1024).toFixed(1)} MB，大模型需要十几秒`);
    loaded = await loadModelFiles(files, main === undefined ? {} : { main });
    assertActive(isCurrent);
    if (pmxMaterials.length) {
      const applied = applyPmxMaterials(loaded.scene, pmxMaterials);
      if (!applied) warnings.push(PMX_MATERIAL_MISMATCH);
    }

    report('识别骨骼…');
    await nextFrame();
    const rig = detectHumanoidRig(loaded.scene, loaded.humanoidRoles);
    const armRig = detectArmRig(loaded.scene);
    report('提取网格…', `${loaded.stats.triangles.toLocaleString('zh-CN')} 个三角面`);
    await nextFrame();
    const extracted = extractModel(loaded.scene, { rig });
    await nextFrame();
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
      defaultRotationY: defaultRotationYDegrees(sceneNodeNames(loaded.scene)),
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
  /** Part ids to keep; omitted means every part of the included materials. */
  includedParts?: ReadonlySet<string>;
  weights: Readonly<Record<string, number>>;
  textureMode?: 'legacy' | 'budget';
  textureTarget?: 'density' | 'retention';
  atlasSharing?: boolean;
  onProgress?: ProgressHandler;
}

export interface ConvertExtractedResult {
  result: ConvertResult;
  /** Reduction and export warnings; caller-owned import warnings stay separate. */
  warnings: string[];
  excludedMaterials: string[];
  excludedMaterialKeys: string[];
}

/** Filter, reduce, weight and atlas an already extracted model. */
export async function convertExtractedModel(
  extracted: ExtractedModel,
  options: ConvertExtractedOptions,
): Promise<ConvertExtractedResult> {
  const report = reporter(options.onProgress);
  let batches = extracted.batches.filter((batch) => options.included.has(batch.key));
  if (options.includedParts) {
    const kept: typeof batches = [];
    for (const batch of batches) {
      const filtered = filterBatchParts(batch, options.includedParts);
      if (filtered) kept.push(filtered);
    }
    batches = kept;
  }
  if (!batches.length) throw new Error('请至少保留一个材质或部件');
  // Materials that lost every triangle to the part filter still count as
  // excluded, otherwise the report would claim they were exported.
  const keptMaterialKeys = new Set(batches.map((batch) => batch.key));
  const sourceTriangles = batches.reduce((sum, batch) => sum + batch.triangles, 0);

  let reductionWarnings: string[] = [];
  if (options.ratio < 0.999) {
    report('减面…', `${batches.length} 个材质`);
    await nextFrame();
    const reduced = await reduceBatches(batches, {
      ratio: options.ratio,
      maxError: options.maxError,
      onProgress: (done, total, name) =>
        report(`减面 ${done + 1}/${total}`, name),
    });
    batches = reduced.batches;
    reductionWarnings = reduced.warnings;
  }

  // Legacy allocation reads demand from `area`; the budget planner receives the
  // relative multipliers directly and must not apply them twice.
  if (options.textureMode !== 'budget')
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
    ...(options.textureMode ? { textureMode: options.textureMode } : {}),
    ...(options.textureTarget ? { textureTarget: options.textureTarget } : {}),
    ...(options.weights ? { materialWeights: options.weights } : {}),
    ...(options.atlasSharing ? { atlasSharing: true } : {}),
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
  });
  const excludedBatches = extracted.batches.filter(
    (batch) => !options.included.has(batch.key) || !keptMaterialKeys.has(batch.key),
  );
  const excludedMaterials = excludedBatches.map((batch) => batch.name);
  const excludedMaterialKeys = excludedBatches.map((batch) => batch.key);
  return {
    result: converted,
    warnings: [...reductionWarnings, ...converted.report.warnings],
    excludedMaterials,
    excludedMaterialKeys,
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
  /** Part ids included in the conversion; omitted means all parts. */
  includedParts?: Iterable<string>;
  weights: Readonly<Record<string, number>>;
  modelTriangles: number;
  textureMode?: 'legacy' | 'budget';
  textureTarget?: 'density' | 'retention';
  atlasSharing?: boolean;
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
    input.includedParts ? [...input.includedParts].sort().join(',') : '*',
    input.textureMode ?? 'legacy',
    input.textureTarget ?? 'retention',
    input.atlasSharing ? 'share' : 'no-share',
    Object.entries(input.weights)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}:${value}`)
      .join(','),
    input.modelTriangles,
  ].join('|');
}
