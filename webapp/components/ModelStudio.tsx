import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import * as THREE from 'three';
import { DropZone } from './DropZone';
import { DownloadButtons, WarningList } from './Common';
import { Icon } from '../../web/shared/Icons';
import { Viewport } from './Viewport';
import { MODEL_ACCEPT, type LoadedModel } from '../engine/import-model';
import { SKIN_NAME_MAX_LENGTH } from '../../src/skin-pack-files.ts';
import { applyArmPose, armRigFromHumanoid, type ArmRig } from '../engine/pose';
import type { HumanoidRig } from '../engine/humanoid';
import type { BindingMode, ConvertResult } from '../engine/convert';
import { finalizeConvertResult } from '../engine/convert';
import {
  applyMaterialVisibility,
  collectMaterialVisibility,
  restoreMaterialVisibility,
} from '../lib/material-visibility';
import { extractModel, stableMaterialKeyMap, type ExtractedModel } from '../engine/extract';
import type { DoubleSidedPolicy } from '../engine/bedrock';
import { nextFrame } from '../engine/frame';
import { preparePreviewMaterials } from '../engine/preview-materials';
import type { TaskProgress } from '../engine/progress';
import {
  loadModelJob,
  materialLabels as buildMaterialLabels,
  modelResultKey,
  ModelJobCancelled,
  prepareConvertedBatches,
  prepareModelInput,
  renderConvertedBatches,
  sourceTriangleCount,
  type PreparedConvertedBatches,
  type PreparedModelInput,
} from '../engine/model-job';
import {
  defaultModelCandidate,
  type ModelFormat,
} from '../../src/model-candidates.ts';
import { ModelCandidateList } from '../../web/shared/ModelCandidateList';
import { Dialog } from '../../web/shared/Dialog';
import { buildGeometryPreview } from '../lib/output-preview';
import { useSkinPack } from '../lib/pack-context';
import type { TextureSource } from '../engine/types';
import { RatioField } from '../../web/shared/RatioField';
import { ConversionReport } from './ConversionReport';
import { formatBytes } from '../../web/shared/format';
import { useCompactViewport } from '../lib/use-compact-viewport';
import { PoseControls } from '../../web/shared/PoseControls';
import { MaterialBrowser, type MaterialPixelInfo } from '../../web/shared/MaterialBrowser';
import { MaterialList } from '../../web/shared/MaterialList';
import { PartBrowser } from '../../web/shared/PartBrowser';
import { AtlasInspector } from '../../web/shared/AtlasInspector';
import { MaterialCandidates, type MaterialCandidate } from '../../web/shared/MaterialCandidates';
import { WorkspaceTabs, STUDIO_WORKSPACES, type StudioWorkspace } from '../../web/shared/WorkspaceTabs';
import { useResizableWidth } from '../../web/shared/use-resizable';
import type {
  StudioMaterial,
  StudioPart,
  TextureMode,
  TextureTarget,
} from '../../web/shared/texture-types';
import { createPartPreview } from '../lib/part-visibility';
import { extractedParts } from '../engine/parts';

const DEFAULT_NAME = '我的 4D 皮肤';
/** Formats the browser build cannot open; the picker lists them as unavailable. */
const WEB_UNAVAILABLE_FORMATS: readonly ModelFormat[] = ['pmd'];
const thumbnailCache = new Map<string, string | null>();

function textureThumbnail(texture: TextureSource | null): string | null {
  if (!texture) return null;
  if (thumbnailCache.has(texture.key)) return thumbnailCache.get(texture.key)!;
  let result: string | null = null;
  try {
    const size = 40;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (context) {
      const scale = Math.max(size / texture.width, size / texture.height);
      const width = texture.width * scale;
      const height = texture.height * scale;
      context.drawImage(texture.image, (size - width) / 2, (size - height) / 2, width, height);
      result = canvas.toDataURL('image/png');
    }
  } catch {
    result = null;
  }
  thumbnailCache.set(texture.key, result);
  return result;
}

export function ModelStudio({ onOpenMenu }: { onOpenMenu?: () => void } = {}) {
  const [model, setModel] = useState<LoadedModel | null>(null);
  const [sourceBytes, setSourceBytes] = useState(0);
  const [name, setName] = useState(DEFAULT_NAME);
  const [height, setHeight] = useState(32);
  const [heightText, setHeightText] = useState('32');
  const [ratio, setRatio] = useState(0.2);
  const [maxError, setMaxError] = useState(0.03);
  const [doubleSided, setDoubleSided] = useState<DoubleSidedPolicy>('source');
  const [rotationY, setRotationY] = useState(0);
  const [armSpread, setArmSpread] = useState(0);
  const [armAvailable, setArmAvailable] = useState(false);
  const [binding, setBinding] = useState<BindingMode>('static');
  const [rigAvailable, setRigAvailable] = useState(false);
  const [source, setSource] = useState<ExtractedModel | null>(null);
  const [included, setIncluded] = useState<Set<string>>(new Set());
  /** One editing session, three task-specific workspaces. */
  const [workspace, setWorkspace] = useState<StudioWorkspace>('model');
  const [mobileTextureView, setMobileTextureView] = useState<'materials' | 'preview' | 'atlas'>('materials');
  const [previewPhase, setPreviewPhase] = useState<'idle' | 'queued' | 'running'>('idle');
  const [candidates, setCandidates] = useState<MaterialCandidate[] | null>(null);
  const [maximizePreview, setMaximizePreview] = useState(false);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const leftPanel = useResizableWidth(300, 240, 440, 'left');
  const rightPanel = useResizableWidth(360, 280, 520, 'right');
  /** CSS fullscreen for the 3D stage: keeps the floating buttons visible. */
  const [stageFullscreen, setStageFullscreen] = useState(false);
  const compact = useCompactViewport();
  const [previewRoot, setPreviewRoot] = useState<THREE.Group | null>(null);
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [textureMode, setTextureMode] = useState<TextureMode>('legacy');
  const [textureTarget, setTextureTarget] = useState<TextureTarget>('retention');
  const [includedParts, setIncludedParts] = useState<Set<string>>(new Set());
  const [selectedPart, setSelectedPart] = useState<string | null>(null);
  const [showKeptParts, setShowKeptParts] = useState(true);
  /** Pixel difference versus the previous conversion of the same model. */
  const [materialDeltas, setMaterialDeltas] = useState<Map<string, number>>(new Map());
  const [soloKey, setSoloKey] = useState<string | null>(null);
  const sourcePose = useRef('0|0');
  const armRig = useRef<ArmRig | null>(null);
  const humanoidRig = useRef<HumanoidRig | null>(null);
  const previewRootRef = useRef<THREE.Group | null>(null);
  const partPreview = useRef<ReturnType<typeof createPartPreview> | null>(null);
  const convertRun = useRef(0);
  const preparedCache = useRef<{ key: string; prepared: PreparedConvertedBatches } | null>(null);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewQueued = useRef(false);
  const previewRunning = useRef(false);
  const convertRef = useRef<((preview: boolean) => Promise<void>) | null>(null);
  const keyRef = useRef('');
  const resultRef = useRef<ConvertResult | null>(null);
  const originalVisibility = useRef(new Map<THREE.Material, boolean>());
  const [result, setResult] = useState<ConvertResult | null>(null);
  const [resultKey, setResultKey] = useState('');
  const [preview, setPreview] = useState<THREE.Object3D | null>(null);
  const [viewMode, setViewMode] = useState<'source' | 'output'>('source');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Latest pipeline step; keeps the overlay informative on large models. */
  const [progress, setProgress] = useState<TaskProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [packBusy, setPackBusy] = useState(false);
  const [packMessage, setPackMessage] = useState('');
  const [packError, setPackError] = useState('');
  /** Archive with several models: the picker waits for the user's choice. */
  const [pending, setPending] = useState<{ input: PreparedModelInput; main: string } | null>(null);
  const { addSkin } = useSkinPack();
  const modelRef = useRef<LoadedModel | null>(null);
  const loadId = useRef(0);
  const customName = useRef(false);
  /** 用户手动改过朝向之后，加载新模型不再自动套用默认旋转。 */
  const customRotation = useRef(false);
  const modelInput = useRef<HTMLInputElement>(null);

  /** Both desktop and mobile route to the standalone 获取模型 page. */
  const gotoSources = useCallback(() => {
    history.replaceState(null, '', '#sources');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }, []);

  // Leaving the model page must not keep the stage fullscreen.
  useEffect(() => {
    if (!compact) setStageFullscreen(false);
  }, [compact]);
  useEffect(() => () => setStageFullscreen(false), []);

  useEffect(() => () => {
    modelRef.current?.dispose();
    modelRef.current = null;
  }, []);

  useEffect(() => {
    setPackMessage('');
    setPackError('');
  }, [result]);

  useEffect(() => {
    if (!result) {
      setPreview(null);
      return;
    }
    const created = buildGeometryPreview(result.geometry, result.textureUrl);
    setPreview(created.object);
    return () => created.dispose();
  }, [result]);

  useEffect(() => {
    if (!previewRoot) return;
    previewRoot.rotation.y = (rotationY * Math.PI) / 180;
    previewRoot.updateMatrixWorld(true);
  }, [previewRoot, rotationY]);

  useEffect(() => {
    const rig = armRig.current;
    if (!model || !rig) return;
    applyArmPose(rig, armSpread);
  }, [model, armSpread]);

  useEffect(() => {
    if (!previewRoot) return;
    applyMaterialVisibility(previewRoot, soloKey, included, originalVisibility.current);
  }, [previewRoot, soloKey, included]);

  useEffect(() => {
    const preview = partPreview.current;
    if (!preview) return;
    preview.apply(showKeptParts ? includedParts : null, selectedPart);
  }, [previewRoot, includedParts, selectedPart, showKeptParts]);

  useEffect(() => () => {
    partPreview.current?.restore();
    partPreview.current = null;
  }, []);

  const materialThumbs = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const batch of source?.batches ?? []) {
      if (map.has(batch.key)) continue;
      map.set(batch.key, textureThumbnail(batch.texture));
    }
    return map;
  }, [source]);

  const resetLoadState = () => {
    setResult(null);
    setViewMode('source');
    setWarnings([]);
    setSource(null);
    setSourceBytes(0);
    setIncluded(new Set());
    setRotationY(0);
    setArmSpread(0);
    setArmAvailable(false);
    setRigAvailable(false);
    setBinding('static');
    setWeights({});
    setTextureMode('legacy');
    setTextureTarget('retention');
    setIncludedParts(new Set());
    setSelectedPart(null);
    setShowKeptParts(true);
    setMaterialDeltas(new Map());
    setSoloKey(null);
    setCandidates(null);
    setWorkspace('model');
    setPreviewPhase('idle');
    setMaximizePreview(false);
    setLeftOpen(true);
    setRightOpen(true);
    preparedCache.current = null;
    previewQueued.current = false;
    previewRunning.current = false;
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = null;
    partPreview.current?.restore();
    partPreview.current = null;
    originalVisibility.current = new Map();
    armRig.current = null;
    humanoidRig.current = null;
    previewRootRef.current = null;
    setPreviewRoot(null);
    // The import already extracted the bind pose without rotation or arm spread,
    // so the first convert of a static model can reuse it instead of repeating
    // the whole extraction. Key shape matches convert(): rotation|spread|binding.
    sourcePose.current = '0|0|static';
    customRotation.current = false;
    modelRef.current?.dispose();
    modelRef.current = null;
    setModel(null);
  };

  /** Parse an already unpacked input with the chosen model file. */
  const runJob = async (prepared: PreparedModelInput, main: string | undefined) => {
    const token = ++loadId.current;
    setError(null);
    setLoading(true);
    setProgress({ label: '读取文件…' });
    resetLoadState();
    try {
      const job = await loadModelJob(prepared, {
        ...(main === undefined ? {} : { main }),
        onProgress: setProgress,
        isCurrent: () => token === loadId.current,
      });
      if (token !== loadId.current) {
        job.model.dispose();
        return;
      }
      // Same preview material rules as the desktop workbench: blended
      // opaque-alpha materials become cutouts instead of translucent films.
      preparePreviewMaterials(job.model.scene);
      originalVisibility.current = collectMaterialVisibility(job.model.scene);
      humanoidRig.current = job.rig;
      setRigAvailable(!!job.rig);
      setBinding(job.rig ? 'humanoid' : 'static');
      armRig.current = armRigFromHumanoid(job.rig) ?? job.armRig;
      setArmAvailable(!!armRig.current);
      const root = new THREE.Group();
      root.add(job.model.scene);
      previewRootRef.current = root;
      setPreviewRoot(root);
      modelRef.current = job.model;
      setModel(job.model);
      setSourceBytes(job.totalBytes);
      setSource(job.extracted);
      setIncluded(new Set(job.extracted.batches.map((batch) => batch.key)));
      setIncludedParts(new Set(extractedParts(job.extracted).map((part) => part.id)));
      partPreview.current = createPartPreview(job.model.scene);
      setWarnings(job.warnings);
      if (!customName.current) setName(job.model.name.slice(0, 60) || DEFAULT_NAME);
      // MMD 来源默认转 180°，与桌面工作台一致；用户手动改过就保留。
      if (!customRotation.current) setRotationY(job.defaultRotationY);
    } catch (cause) {
      if (!(cause instanceof ModelJobCancelled) && token === loadId.current)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (token === loadId.current) {
        setLoading(false);
        setProgress(null);
      }
    }
  };

  const choose = async (incoming: File[]) => {
    if (!incoming.length) return;
    const token = ++loadId.current;
    setError(null);
    setLoading(true);
    setProgress({ label: '读取文件…' });
    setPending(null);
    try {
      const prepared = await prepareModelInput(incoming);
      if (token !== loadId.current) return;
      const candidate = defaultModelCandidate(prepared.candidates, WEB_UNAVAILABLE_FORMATS);
      if (!candidate) throw new Error('没有找到支持的模型文件。');
      if (prepared.candidates.length > 1) {
        // Let the user pick instead of silently loading the first model.
        setPending({ input: prepared, main: candidate.path });
        setLoading(false);
        setProgress(null);
        return;
      }
      await runJob(prepared, candidate.path);
    } catch (cause) {
      if (token === loadId.current) {
        setError(cause instanceof Error ? cause.message : String(cause));
        setLoading(false);
        setProgress(null);
      }
    }
  };

  const loadPending = () => {
    if (!pending) return;
    const { input, main } = pending;
    setPending(null);
    void runJob(input, main);
  };

  const key = useMemo(() => [
    binding,
    modelResultKey({
      name,
      height,
      rotationY,
      armSpread,
      doubleSided,
      ratio,
      maxError,
      included,
      includedParts,
      weights,
      textureMode,
      textureTarget,
      modelTriangles: model?.stats.triangles ?? 0,
    }),
  ].join('|'), [binding, name, height, rotationY, armSpread, doubleSided, ratio, maxError, included, includedParts, weights, textureMode, textureTarget, model?.stats.triangles]);
  keyRef.current = key;
  resultRef.current = result;

  /** Geometry-affecting settings; changing only weights keeps this stable. */
  const geometryKey = useMemo(() => JSON.stringify({
    binding,
    height,
    doubleSided,
    ratio,
    maxError,
    rotationY,
    armSpread,
    included: [...included].sort(),
    includedParts: [...includedParts].sort(),
    triangles: model?.stats.triangles ?? 0,
  }), [binding, height, doubleSided, ratio, maxError, rotationY, armSpread, included, includedParts, model?.stats.triangles]);

  const runConversion = async (previewMode: boolean) => {
    if (!model) return;
    if (loading) return;
    if (previewMode && busy) {
      previewQueued.current = true;
      setPreviewPhase('queued');
      return;
    }
    if (!previewMode && busy) return;
    const run = ++convertRun.current;
    const runKey = keyRef.current;
    const before = resultRef.current;
    if (previewMode) {
      previewRunning.current = true;
      setPreviewPhase('running');
    } else {
      setBusy(true);
    }
    setError(null);
    setProgress({ label: previewMode ? '更新纹理预览…' : '提取网格…' });
    const startedAt = performance.now();
    try {
      await nextFrame();
      let extracted = source;
      const poseKey = `${rotationY}|${armSpread}|${binding}`;
      if (!extracted || sourcePose.current !== poseKey) {
        setProgress({
          label: '按当前姿势重新提取网格…',
          detail: `${model.stats.triangles.toLocaleString('zh-CN')} 个三角面`,
        });
        await nextFrame();
        const root = previewRootRef.current;
        const saved = root?.rotation.y ?? 0;
        partPreview.current?.restore();
        if (root) {
          root.rotation.y = 0;
          restoreMaterialVisibility(root, originalVisibility.current);
          root.updateMatrixWorld(true);
        }
        try {
          if (armRig.current) applyArmPose(armRig.current, armSpread);
          model.scene.updateMatrixWorld(true);
          extracted = extractModel(model.scene, {
            rotationYDegrees: rotationY,
            bakeSkinning: binding === 'humanoid' || armSpread !== 0,
            rig: binding === 'humanoid' ? humanoidRig.current : null,
          });
        } finally {
          if (root) {
            root.rotation.y = saved;
            applyMaterialVisibility(root, soloKey, included, originalVisibility.current);
            root.updateMatrixWorld(true);
          }
          partPreview.current?.apply(showKeptParts ? includedParts : null, selectedPart);
        }
        sourcePose.current = poseKey;
        preparedCache.current = null;
        setSource(extracted);
        // New extraction keeps the same stable part ids; never let a stale
        // selection from another model survive.
        const ids = new Set(extractedParts(extracted).map((part) => part.id));
        setIncludedParts((current) => {
          if (!current.size) return ids;
          const kept = new Set([...current].filter((id) => ids.has(id)));
          return kept.size ? kept : ids;
        });
      }
      if (run !== convertRun.current) return;
      const merged = [...new Set([...model.warnings, ...extracted.warnings])];
      if (armSpread !== 0) merged.push(`已按 ${armSpread}° 调整手臂，并烘焙到静态网格。`);
      setWarnings(merged);

      let prepared = preparedCache.current?.key === geometryKey
        ? preparedCache.current.prepared
        : null;
      if (!prepared) {
        prepared = await prepareConvertedBatches(extracted, {
          included,
          includedParts,
          ratio,
          maxError,
          onProgress: setProgress,
        });
        if (run !== convertRun.current) return;
        preparedCache.current = { key: geometryKey, prepared };
      }
      const converted = await renderConvertedBatches(prepared, {
        name: name.trim(),
        height,
        doubleSided,
        binding,
        ratio,
        maxError,
        included,
        includedParts,
        weights,
        textureMode,
        textureTarget,
        atlasSharing: textureMode === 'budget',
        preview: previewMode,
        rig: extracted.rig,
        onProgress: setProgress,
      });
      if (run !== convertRun.current) return;
      const previous = new Map(
        (before?.textureReport.materials ?? []).map((material) => [
          material.key,
          material.pixels,
        ]),
      );
      const nextDeltas = new Map<string, number>();
      for (const material of converted.result.textureReport.materials)
        if (previous.has(material.key))
          nextDeltas.set(material.key, material.pixels - previous.get(material.key)!);
      setMaterialDeltas(nextDeltas);
      const nextResult: ConvertResult = {
        ...converted.result,
        elapsedMs: performance.now() - startedAt,
        excludedMaterials: converted.excludedMaterials,
        excludedMaterialKeys: converted.excludedMaterialKeys,
        materialWeights: { ...weights },
      };
      setResult(nextResult);
      resultRef.current = nextResult;
      setResultKey(runKey);
      setWarnings([...new Set([...merged, ...converted.warnings])]);
      if (!previewMode) {
        setViewMode('output');
        setWorkspace('export');
      }
    } catch (cause) {
      if (run === convertRun.current)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (run === convertRun.current) {
        setBusy(false);
        setProgress(null);
        setPreviewPhase('idle');
      }
      previewRunning.current = false;
      if (previewMode && previewQueued.current) {
        previewQueued.current = false;
        if (run === convertRun.current)
          window.setTimeout(() => void convertRef.current?.(true), 0);
      }
    }
  };
  convertRef.current = runConversion;

  const stale = !!result && resultKey !== key;
  const previewStatus: 'idle' | 'queued' | 'running' | 'stale' =
    previewPhase !== 'idle' ? previewPhase : stale ? 'stale' : 'idle';

  // Continuous texture tuning: debounce, latest-wins. A running preview never
  // blocks the sliders; changes queue one follow-up run with the newest state.
  useEffect(() => {
    if (workspace !== 'texture' || !source || !model) return;
    if (!included.size || !includedParts.size || loading || busy) return;
    if (result && resultKey === key) return;
    setPreviewPhase('queued');
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(() => {
      previewTimer.current = null;
      if (previewRunning.current) {
        previewQueued.current = true;
        return;
      }
      void convertRef.current?.(true);
    }, 550);
    return () => {
      if (previewTimer.current) {
        clearTimeout(previewTimer.current);
        previewTimer.current = null;
      }
    };
  }, [workspace, key, source, model, included.size, includedParts.size, loading, busy, result, resultKey]);

  /** Build the final pack from the exact preview, or recompute when stale. */
  const exportFinal = async () => {
    if (!model) return;
    if (result?.preview && resultKey === key) {
      const final = finalizeConvertResult(result, name.trim() || DEFAULT_NAME);
      setResult(final);
      resultRef.current = final;
      setResultKey(key);
      setViewMode('output');
      setWorkspace('export');
      return;
    }
    await runConversion(false);
  };

  const addToPack = async () => {
    if (!result || packBusy) return;
    setPackBusy(true);
    setPackError('');
    try {
      const added = await addSkin({
        name: name.trim() || '模型皮肤',
        geometry: result.geometry,
        png: result.png,
        triangles: result.report.triangles,
        source: 'model',
      });
      setPackMessage(
        added.createdPack
          ? `已创建「${added.packName}」并加入，共 ${added.count} 个皮肤`
          : `已加入「${added.packName}」，共 ${added.count} 个皮肤`,
      );
    } catch (cause) {
      setPackError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPackBusy(false);
    }
  };
  const viewObject = viewMode === 'output' && preview ? preview : previewRoot ?? model?.scene ?? null;
  const totalBytes = sourceBytes;
  const heightValue = Number(heightText);
  const heightValid = heightText.trim() !== '' && Number.isFinite(heightValue) && heightValue >= 1 && heightValue <= 128;
  const sourceTriangles = source
    ? sourceTriangleCount(source.batches, included, doubleSided)
    : model?.stats.triangles ?? 0;
  const targetFaces = Math.max(1, Math.round(sourceTriangles * ratio));
  const actualFaces = result && !stale ? result.report.triangles : null;
  const selectedMaterial = source?.batches.find((batch) => batch.key === soloKey)?.name ?? null;
  const materialLabels = useMemo(
    () => source ? buildMaterialLabels(source.batches) : new Map<string, string>(),
    [source],
  );
  const studioParts = useMemo<StudioPart[]>(() => {
    if (!source) return [];
    const parts = extractedParts(source);
    const byMaterial = new Map<string, { id: string; name: string }[]>();
    for (const part of parts) {
      const list = byMaterial.get(part.materialKey) ?? [];
      list.push({ id: part.id, name: part.name });
      byMaterial.set(part.materialKey, list);
    }
    return parts.map((part) => {
      const label = materialLabels.get(part.materialKey) ?? part.materialName;
      return {
        id: part.id,
        name: part.name,
        group: part.mesh?.trim() || '模型结构',
        meta: `${part.triangles.toLocaleString('zh-CN')} 面 · ${label}`,
        materials: [label],
        materialKey: part.materialKey,
        sharedWith: (byMaterial.get(part.materialKey) ?? [])
          .filter((entry) => entry.id !== part.id)
          .map((entry) => entry.name),
      };
    });
  }, [source, materialLabels]);
  const studioMaterials = useMemo<StudioMaterial[]>(() => {
    if (!source) return [];
    const measured = new Map(
      (result?.textureReport.materials ?? []).map((material) => [material.key, material]),
    );
    return source.batches.map((batch, index) => {
      const material = measured.get(batch.key);
      const related = studioParts.filter((part) => part.materialKey === batch.key);
      const kept = related.filter((part) => includedParts.has(part.id)).length;
      const partText = related.length
        ? kept === related.length
          ? ` · ${related.length} 部件`
          : ` · 保留 ${kept}/${related.length} 部件`
        : '';
      const delta = materialDeltas.get(batch.key);
      const pixels = material?.pixels;
      return {
        id: batch.key,
        name: materialLabels.get(batch.key) ?? batch.name,
        meta: `${batch.triangles.toLocaleString('zh-CN')} 面${partText}${
          batch.texture ? ` · ${batch.texture.width}×${batch.texture.height}` : ' · 纯色'
        }${related.length > 0 && kept === 0 ? ' · 无保留部件' : ''}`,
        thumbnail: materialThumbs.get(batch.key) ?? null,
        color: `rgb(${batch.color.map((value) => Math.round(value * 255)).join(' ')})`,
        included: included.has(batch.key),
        weight: weights[batch.key] ?? 1,
        quality: weights[batch.key] ?? 1,
        selected: soloKey === batch.key,
        lastPixels: pixels ?? null,
        deltaPixels: delta ?? null,
        floorCharts: material?.floorCharts ?? 0,
        flat: !batch.texture,
        limited: (material?.floorCharts ?? 0) > 0,
        ...(pixels !== undefined
          ? {
              status: `${pixels.toLocaleString('zh-CN')} px${
                (material?.floorCharts ?? 0) > 0 ? ' · 触底' : ''
              }`,
            }
          : {}),
      };
    });
  }, [source, result, weights, included, includedParts, soloKey, materialDeltas, materialLabels, studioParts, materialThumbs]);
  const atlasMaterials = useMemo(() => {
    if (!result) return [];
    const regions = result.textureReport.regions ?? [];
    const weightsByKey = new Map(
      (source?.batches ?? []).map((batch) => [batch.key, weights[batch.key] ?? 1]),
    );
    return (result.textureReport.materials ?? []).map((material) => ({
      id: material.key,
      name: materialLabels.get(material.key) ?? material.name,
      allocated: regions
        .filter((region) => region.materialKeys?.includes(material.key))
        .reduce((sum, region) => sum + region.contentPixels, 0),
      used: material.pixels,
      uv: material.uvPixels ?? null,
      weight: weightsByKey.get(material.key),
      flat: regions
        .filter((region) => region.materialKeys?.includes(material.key))
        .every((region) => region.flat),
      shared: material.sharedPixels ?? null,
      floorCharts: material.floorCharts,
      rectPixels: material.rectPixels,
      wastePixels: material.wastePixels,
      mode: result.textureReport.mode,
    }));
  }, [result, source, weights, materialLabels]);
  const atlasRegionsUi = useMemo(
    () =>
      (result?.textureReport.regions ?? []).map((region) => ({
        id: region.key,
        material: region.name,
        ...(region.materialKey ? { materialKey: region.materialKey } : {}),
        ...(region.materialKeys ? { materialKeys: region.materialKeys } : {}),
        ...(region.materials ? { materials: region.materials } : {}),
        x: region.x,
        y: region.y,
        width: region.width,
        height: region.height,
        contentPixels: region.contentPixels,
        shared: (region.materialKeys?.length ?? 0) > 1,
        ...(region.sourceWidth
          ? { source: `${region.sourceWidth}×${region.sourceHeight}` }
          : {}),
      })),
    [result],
  );
  const materialKeyByUuid = useMemo(
    () => (model ? stableMaterialKeyMap(model.scene) : new Map<string, string>()),
    [model],
  );
  const studioMaterialByKey = useMemo(
    () => new Map(studioMaterials.map((material) => [material.id, material])),
    [studioMaterials],
  );
  const candidateItems = (ids: readonly string[]): MaterialCandidate[] =>
    ids.map((id) => {
      const material = studioMaterialByKey.get(id);
      return {
        id,
        name: material?.name ?? id,
        ...(material?.meta ? { meta: material.meta } : {}),
        ...(material?.color ? { color: material.color } : {}),
      };
    });

  const selectMaterial = (id: string | null) => {
    setSoloKey(id);
    setCandidates(null);
  };

  const handlePick = (materials: THREE.Material[]) => {
    const keys = [
      ...new Set(
        materials
          .map((material) => materialKeyByUuid.get(material.uuid))
          .filter((key): key is string => !!key),
      ),
    ];
    if (!keys.length) return;
    if (keys.length === 1) {
      selectMaterial(keys[0]!);
      return;
    }
    // Several visible surfaces share the click point: never guess.
    setCandidates(candidateItems(keys));
  };

  const pixelInfo = (material: StudioMaterial): MaterialPixelInfo => {
    const pixels = material.lastPixels ?? null;
    if (pixels == null) return { pixels: null, state: 'none' };
    const actual = !!result && resultKey === key;
    if (actual) {
      return {
        pixels,
        state: 'actual',
        delta: material.deltaPixels ?? null,
        floorCharts: material.floorCharts ?? 0,
        flat: material.flat === true,
      };
    }
    const previousWeight = result?.materialWeights?.[material.id] ?? 1;
    const currentWeight = weights[material.id] ?? 1;
    const ratio = previousWeight > 0 ? currentWeight / previousWeight : 1;
    return {
      pixels: Math.max(0, Math.round(pixels * Math.max(0.05, ratio))),
      state: previewStatus === 'running' || previewStatus === 'queued' ? 'pending' : 'estimate',
      delta: material.deltaPixels ?? null,
      floorCharts: material.floorCharts ?? 0,
      flat: material.flat === true,
    };
  };

  const modelMaterialItems = studioMaterials.map((material) => ({
    id: material.id,
    name: material.name,
    meta: material.meta,
    thumbnail: material.thumbnail ?? null,
    ...(material.color ? { color: material.color } : {}),
    included: material.included,
    weight: material.weight,
    selected: material.id === soloKey,
    ...(material.status ? { status: material.status } : {}),
    ...(material.limited ? { limited: true } : {}),
  }));

  const tabs = [
    {
      ...STUDIO_WORKSPACES[0]!,
      badge: studioParts.length || null,
    },
    {
      ...STUDIO_WORKSPACES[1]!,
      badge: studioMaterials.length || null,
      attention: previewStatus !== 'idle',
    },
    {
      ...STUDIO_WORKSPACES[2]!,
      badge: stale ? '过期' : result ? (result.preview ? '预览' : '已生成') : null,
      attention: stale,
    },
  ];

  const previewNote = result
    ? `上次计算：${
        result.textureReport.mode === 'budget'
          ? result.textureReport.target === 'density'
            ? '预算·密度'
            : '预算·细节保留'
          : '旧版算法'
      }${result.preview ? ' · 预览结果' : ' · 最终结果'}`
    : undefined;

  const selectedMaterialName = studioMaterialByKey.get(soloKey ?? '')?.name ?? null;

  return (
    <div className={`studio-layout model-layout workspace-shell ${compact ? 'compact' : ''}`}>
      <input
        ref={modelInput}
        className="mobile-model-input"
        type="file"
        accept={MODEL_ACCEPT}
        multiple
        disabled={loading || busy}
        onChange={(event) => {
          const next = event.target.files ? [...event.target.files] : [];
          event.target.value = '';
          if (next.length) void choose(next);
        }}
      />

      <header className="workspace-header">
        <div className="workspace-project">
          <span className="eyebrow">4DGen / 模型编辑</span>
          <h2>{model?.name ?? '模型工作台'}</h2>
          <small>
            {model
              ? `${model.stats.triangles.toLocaleString('zh-CN')} 三角面 · ${model.stats.materials} 材质 · ${formatBytes(totalBytes)}`
              : '导入模型后开始编辑；切换工作区不会丢失配置。'}
          </small>
        </div>
        <WorkspaceTabs
          value={workspace}
          tabs={tabs}
          onChange={(next) => {
            setWorkspace(next);
            setCandidates(null);
            if (next === 'export' && result) setViewMode('output');
            if (next === 'model') setViewMode('source');
          }}
        />
        <div className="workspace-global">
          {stale && <span className="workspace-stale">结果已过期</span>}
          {previewStatus === 'running' && <span className="workspace-working">正在更新预览…</span>}
          {previewStatus === 'queued' && <span className="workspace-working">预览排队中…</span>}
          {model && (
            <button
              type="button"
              className="button-link"
              disabled={loading || busy}
              onClick={() => modelInput.current?.click()}
            >
              <Icon name="upload" size={14} /> 更换模型
            </button>
          )}
        </div>
      </header>

      <div className="workspace-body">
        {workspace === 'model' && (
          <div className="model-workspace">
            <aside className="workspace-panel model-left">
              {!compact && (
                <>
                  <DropZone
                    accept={MODEL_ACCEPT}
                    multiple
                    compact={!!model}
                    title={model ? '重新选择模型' : '拖入模型或 ZIP，或点击选择'}
                    hint={model ? `${model.name} · ${formatBytes(totalBytes)}` : 'GLB / glTF / VRM / PMX / FBX / OBJ / DAE / STL / PLY，或含贴图的 ZIP'}
                    icon="cube"
                    onFiles={(next) => void choose(next)}
                    disabled={loading || busy}
                  />
                  <div className="model-source-entry">
                    <button type="button" className="button-link" onClick={() => gotoSources()}>
                      获取模型 <Icon name="arrow" size={13} />
                    </button>
                  </div>
                </>
              )}
              {source ? (
                <>
                  <PartBrowser
                    parts={studioParts}
                    includedParts={includedParts}
                    onTogglePart={(id) => {
                      setIncludedParts((previous) => {
                        const next = new Set(previous);
                        if (next.has(id)) next.delete(id);
                        else next.add(id);
                        return next;
                      });
                      if (selectedPart === id) setSelectedPart(null);
                    }}
                    onSetParts={(ids) => {
                      setIncludedParts(new Set(ids));
                      if (selectedPart && !ids.includes(selectedPart)) setSelectedPart(null);
                    }}
                    selectedPart={selectedPart}
                    onSelectPart={setSelectedPart}
                    showKeptOnly={showKeptParts}
                    onShowKeptOnly={setShowKeptParts}
                    disabled={loading || busy}
                    title="模型部件"
                  />
                  <div className="model-material-include">
                    <div className="texture-studio-section-title static">
                      <span>参与转换的材质</span>
                      <small>{included.size}/{studioMaterials.length}</small>
                    </div>
                    <MaterialList
                      items={modelMaterialItems}
                      disabled={loading || busy}
                      showWeight={false}
                      onToggle={(id) => {
                        const willInclude = !included.has(id);
                        setIncluded((previous) => {
                          const next = new Set(previous);
                          if (willInclude) next.add(id);
                          else next.delete(id);
                          return next;
                        });
                        if (!willInclude && soloKey === id) setSoloKey(null);
                      }}
                      onSelect={selectMaterial}
                      onWeight={() => {}}
                    />
                    <p className="field-help">
                      清晰度权重与图集诊断在「纹理」工作区；这里只控制材质是否参与转换。
                    </p>
                  </div>
                </>
              ) : (
                <p className="field-help">导入模型后可以在这里筛选部件和材质。</p>
              )}
            </aside>

            <section className={`workspace-preview${stageFullscreen ? ' fullscreen' : ''}`}>
              <div className="workspace-toolbar">
                <span>
                  {model
                    ? viewMode === 'output' && result
                      ? '4D 输出预览'
                      : '源模型预览'
                    : '模型预览'}
                </span>
                <span className="grow" />
                {model && (
                  <button
                    type="button"
                    className={viewMode === 'source' ? 'active' : ''}
                    onClick={() => setViewMode('source')}
                  >
                    源模型
                  </button>
                )}
                {result && (
                  <button
                    type="button"
                    className={viewMode === 'output' ? 'active' : ''}
                    onClick={() => setViewMode('output')}
                  >
                    4D 输出
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setStageFullscreen((value) => !value)}
                >
                  {stageFullscreen ? '退出全屏' : '全屏预览'}
                </button>
              </div>
              <div className="model-stage">
                {viewObject ? (
                  <Viewport
                    object={viewObject}
                    grid={viewMode === 'output'}
                    facing={viewMode === 'source' ? 'source' : 'output'}
                    showFrontCheck={false}
                    {...(viewMode === 'source' ? { onPick: handlePick } : {})}
                  />
                ) : (
                  <div className="empty-state compact">
                    {loading ? (
                      <>
                        <span className="spinner" />
                        <h2>{progress?.label || '正在解析模型…'}</h2>
                        <p>{progress?.detail ? `${progress.detail}，` : ''}大模型需要十几秒，请保持页面打开。</p>
                      </>
                    ) : (
                      <>
                        <Icon name="cube" size={42} />
                        <h2>还没有导入模型</h2>
                        <p>拖入模型或 ZIP，或从「获取模型」页进入站点目录。</p>
                        <button type="button" className="button-link" onClick={() => modelInput.current?.click()}>
                          选择模型文件
                        </button>
                      </>
                    )}
                  </div>
                )}
                {(busy || loading) && viewObject && (
                  <div className="busy-overlay">
                    <span className="spinner" />
                    <b>{progress?.label || (busy ? '正在转换…' : '正在读取文件…')}</b>
                    <small>{progress?.detail ? `${progress.detail}，` : ''}大模型需要十几秒，请保持页面打开。</small>
                  </div>
                )}
                {candidates && (
                  <MaterialCandidates
                    candidates={candidates}
                    onPick={(id) => selectMaterial(id)}
                    onClose={() => setCandidates(null)}
                  />
                )}
              </div>
            </section>

            <aside className="workspace-panel model-right">
              <div className="panel-heading">
                <div className="template-icon"><Icon name="cube" size={26} /></div>
                <h2>转换设置</h2>
              </div>
              <div className="panel-scroll">
                <fieldset disabled={loading || busy}>
                  <div className="settings-section" data-section="basic">
                    <div className="settings-section-title">基础配置</div>
                    <label className="field-label">
                      皮肤名称
                      <input
                        value={name}
                        maxLength={SKIN_NAME_MAX_LENGTH}
                        onChange={(event) => {
                          customName.current = true;
                          setName(event.target.value);
                        }}
                        placeholder="输入皮肤名称"
                      />
                    </label>
                    <label className="field-label">
                      绑定方式
                      <select
                        value={binding}
                        disabled={!rigAvailable}
                        onChange={(event) => setBinding(event.target.value as BindingMode)}
                      >
                        <option value="humanoid" disabled={!rigAvailable}>六部位人形（随动作摆动）</option>
                        <option value="static">静态整体（不与动作联动）</option>
                      </select>
                    </label>
                    <p className="field-help">
                      {rigAvailable
                        ? binding === 'humanoid'
                          ? '已识别完整人形骨骼：头、躯干、双臂、双腿会跟随玩家动作。'
                          : '当前按静态整体导出；切换为六部位后需要重新转换。'
                        : '未识别到完整的 VRM / 常见 MMD 人形骨骼，只能按静态整体导出。'}
                    </p>
                    <label className="field-label">
                      模型高度
                      <input
                        type="number"
                        min={1}
                        max={128}
                        value={heightText}
                        aria-invalid={!heightValid}
                        onChange={(event) => {
                          const next = event.target.value;
                          setHeightText(next);
                          const value = Number(next);
                          if (next.trim() !== '' && Number.isFinite(value) && value >= 1 && value <= 128)
                            setHeight(value);
                        }}
                      />
                    </label>
                    <input
                      className="height-range"
                      type="range"
                      min={1}
                      max={128}
                      step={1}
                      value={height}
                      aria-label="模型高度"
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        setHeight(value);
                        setHeightText(String(value));
                      }}
                    />
                    {!heightValid && <p className="field-help error-text">模型高度需为 1–128</p>}
                    <div className="settings-group">
                      <RatioField
                        ratio={ratio}
                        onChange={setRatio}
                        sourceTriangles={sourceTriangles}
                        targetFaces={targetFaces}
                        actualFaces={actualFaces}
                        disabled={loading || busy}
                        showBudget={!!model}
                      />
                      <details className="advanced-settings">
                        <summary>高级减面</summary>
                        <label className="field-label">
                          形状变化容限
                          <input
                            type="number"
                            min={0}
                            max={1}
                            step={0.005}
                            value={maxError}
                            onChange={(event) => {
                              const value = Number(event.target.value);
                              if (Number.isFinite(value) && value >= 0 && value <= 1) setMaxError(value);
                            }}
                          />
                        </label>
                        <p className="field-help">默认 0.03。调小更保形，可能减不到目标；调大减得更多，但更容易丢轮廓。</p>
                      </details>
                    </div>
                    <label className="field-label">
                      双面渲染
                      <select
                        value={doubleSided}
                        onChange={(event) => setDoubleSided(event.target.value as DoubleSidedPolicy)}
                      >
                        <option value="source">跟随源材质</option>
                        <option value="all">全部双面</option>
                        <option value="front">全部单面</option>
                      </select>
                    </label>
                  </div>
                  <div className="settings-section" data-section="pose">
                    <div className="settings-section-title">姿势与朝向</div>
                    <PoseControls
                      rotationY={rotationY}
                      onRotationY={(value) => {
                        customRotation.current = true;
                        setRotationY(value);
                      }}
                      armSpread={armSpread}
                      onArmSpread={setArmSpread}
                      showArm={!!model}
                      armAvailable={armAvailable}
                      disabled={loading || busy}
                      rotationHelp="源模型实时旋转，转换时按这个朝向导出；用「正面检查」确认角色朝向绿色箭头。"
                    />
                  </div>
                </fieldset>
                {error && <p className="error-message" role="alert"><Icon name="alert" size={15} />{error}</p>}
                {!included.size && source && (
                  <p className="field-help error-text">至少保留一个材质</p>
                )}
                {!includedParts.size && source && studioParts.length > 0 && (
                  <p className="field-help error-text">至少保留一个部件，或点「全部保留」。</p>
                )}
                {(busy || loading) && (
                  <p className="task-step" role="status">
                    {progress?.label ?? (busy ? '正在转换…' : '正在读取文件…')}
                    {progress?.detail ? ` · ${progress.detail}` : ''}
                  </p>
                )}
              </div>
              <div className="settings-footer">
                <button
                  type="button"
                  className="primary"
                  disabled={!model || busy || loading || !name.trim() || !heightValid || !included.size || !includedParts.size}
                  onClick={() => void exportFinal()}
                >
                  <Icon name={busy ? 'reset' : 'spark'} size={15} className={busy ? 'spin' : undefined} />
                  {busy ? '正在转换…' : result ? '生成 / 更新 4D 皮肤' : '转换为 4D 皮肤'}
                </button>
                <p className="field-help">转换参数与纹理微调分开；纹理工作区会持续更新预览。</p>
              </div>
            </aside>
          </div>
        )}

        {workspace === 'texture' && (
          <div
            className={`texture-workspace${maximizePreview ? ' preview-max' : ''}`}
            data-mobile-view={mobileTextureView}
            style={{
              '--texture-left': leftOpen ? `${leftPanel.width}px` : '0px',
              '--texture-right': rightOpen ? `${rightPanel.width}px` : '0px',
            } as CSSProperties}
          >
            <aside className="texture-side left">
              {source ? (
                <>
                  <MaterialBrowser
                    materials={studioMaterials}
                    selectedMaterial={soloKey}
                    onSelectMaterial={selectMaterial}
                    onToggleMaterial={(id) => {
                      const willInclude = !included.has(id);
                      setIncluded((previous) => {
                        const next = new Set(previous);
                        if (willInclude) next.add(id);
                        else next.delete(id);
                        return next;
                      });
                      if (!willInclude && soloKey === id) setSoloKey(null);
                    }}
                    onWeight={(id, value) => {
                      setWeights((previous) => ({ ...previous, [id]: value }));
                    }}
                    onResetWeight={(id) => {
                      setWeights((previous) => {
                        const next = { ...previous };
                        delete next[id];
                        return next;
                      });
                    }}
                    onResetAllWeights={() => setWeights({})}
                    disabled={loading || busy}
                    mode={textureMode}
                    target={textureTarget}
                    onMode={setTextureMode}
                    onTarget={setTextureTarget}
                    pixelInfo={pixelInfo}
                    previewState={previewStatus}
                    previewNote={previewNote}
                  />
                  <PartBrowser
                    compact
                    parts={studioParts}
                    includedParts={includedParts}
                    onTogglePart={(id) => {
                      setIncludedParts((previous) => {
                        const next = new Set(previous);
                        if (next.has(id)) next.delete(id);
                        else next.add(id);
                        return next;
                      });
                      if (selectedPart === id) setSelectedPart(null);
                    }}
                    onSetParts={(ids) => {
                      setIncludedParts(new Set(ids));
                      if (selectedPart && !ids.includes(selectedPart)) setSelectedPart(null);
                    }}
                    selectedPart={selectedPart}
                    onSelectPart={setSelectedPart}
                    showKeptOnly={showKeptParts}
                    onShowKeptOnly={setShowKeptParts}
                    disabled={loading || busy}
                    title="关联部件"
                  />
                </>
              ) : (
                <p className="field-help">导入模型后可以在这里搜索材质并调整清晰度。</p>
              )}
            </aside>
            {leftOpen && !maximizePreview && (
              <div className="workspace-splitter" aria-hidden="true" {...leftPanel.handleProps} />
            )}

            <section className="texture-center">
              <div className="workspace-toolbar">
                <div className="texture-mobile-tabs" role="tablist" aria-label="纹理工作区视图">
                  {([
                    ['materials', '材质'],
                    ['preview', '3D 模型'],
                    ['atlas', '图集'],
                  ] as const).map(([key, label]) => (
                    <button
                      type="button"
                      key={key}
                      role="tab"
                      aria-selected={mobileTextureView === key}
                      className={mobileTextureView === key ? 'active' : ''}
                      onClick={() => setMobileTextureView(key)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className={viewMode === 'source' ? 'active' : ''}
                  onClick={() => setViewMode('source')}
                >
                  源模型
                </button>
                <button
                  type="button"
                  className={viewMode === 'output' ? 'active' : ''}
                  disabled={!result}
                  onClick={() => setViewMode('output')}
                >
                  最新图集
                </button>
                <span className={`preview-status ${previewStatus}`} role="status">
                  {previewStatus === 'running'
                    ? '正在计算实际分配…'
                    : previewStatus === 'queued'
                      ? '预览排队中…'
                      : previewStatus === 'stale'
                        ? '显示的是上一次结果'
                        : result
                          ? '预览与当前配置一致'
                          : '等待首次预览'}
                </span>
                <span className="grow" />
                {selectedMaterialName && <span className="selected-material">已选：{selectedMaterialName}</span>}
                <button type="button" onClick={() => setLeftOpen((value) => !value)}>
                  {leftOpen ? '收起材质' : '展开材质'}
                </button>
                <button type="button" onClick={() => setRightOpen((value) => !value)}>
                  {rightOpen ? '收起图集' : '展开图集'}
                </button>
                <button type="button" onClick={() => setMaximizePreview((value) => !value)}>
                  {maximizePreview ? '还原布局' : '最大化预览'}
                </button>
              </div>
              <div className="model-stage">
                {viewObject ? (
                  <Viewport
                    object={viewObject}
                    grid={viewMode === 'output'}
                    facing={viewMode === 'source' ? 'source' : 'output'}
                    showFrontCheck={false}
                    {...(viewMode === 'source' ? { onPick: handlePick } : {})}
                  />
                ) : (
                  <div className="empty-state compact">
                    <Icon name="cube" size={42} />
                    <h2>还没有可预览的模型</h2>
                    <p>先在模型工作区导入模型。</p>
                  </div>
                )}
                {soloKey && (
                  <div className="texture-selection-note">
                    正在只看所选材质。
                    <button type="button" onClick={() => selectMaterial(null)}>显示全部材质</button>
                  </div>
                )}
                {candidates && (
                  <MaterialCandidates
                    candidates={candidates}
                    onPick={(id) => selectMaterial(id)}
                    onClose={() => setCandidates(null)}
                  />
                )}
                {(busy || loading) && viewObject && (
                  <div className="busy-overlay">
                    <span className="spinner" />
                    <b>{progress?.label || '正在处理…'}</b>
                    <small>{progress?.detail ?? ''}</small>
                  </div>
                )}
              </div>
            </section>

            {rightOpen && !maximizePreview && (
              <div className="workspace-splitter" aria-hidden="true" {...rightPanel.handleProps} />
            )}
            <aside className="texture-side right">
              {result ? (
                <AtlasInspector
                  src={result.textureUrl}
                  size={result.textureReport.size}
                  regions={atlasRegionsUi}
                  materials={atlasMaterials}
                  summary={result.textureReport}
                  selected={soloKey}
                  onSelect={selectMaterial}
                  onSelectCandidates={(ids) => setCandidates(candidateItems(ids))}
                  variant="panel"
                  {...(result.coverageUrl ? { coverageSrc: result.coverageUrl } : {})}
                />
              ) : (
                <div className="workspace-empty">
                  {previewStatus === 'running' || previewStatus === 'queued'
                    ? '正在生成第一张图集预览…'
                    : '图集会在纹理工作区自动生成；也可以先在模型工作区转换。'}
                </div>
              )}
            </aside>
          </div>
        )}

        {workspace === 'export' && (
          <div className="export-workspace">
            <section className={`workspace-preview${stageFullscreen ? ' fullscreen' : ''}`}>
              <div className="workspace-toolbar">
                <span>{result ? '结果预览' : '模型预览'}</span>
                <span className="grow" />
                {model && (
                  <button
                    type="button"
                    className={viewMode === 'source' ? 'active' : ''}
                    onClick={() => setViewMode('source')}
                  >
                    源模型
                  </button>
                )}
                {result && (
                  <button
                    type="button"
                    className={viewMode === 'output' ? 'active' : ''}
                    onClick={() => setViewMode('output')}
                  >
                    4D 输出
                  </button>
                )}
                <button type="button" onClick={() => setStageFullscreen((value) => !value)}>
                  {stageFullscreen ? '退出全屏' : '全屏预览'}
                </button>
              </div>
              <div className="model-stage">
                {viewObject ? (
                  <Viewport
                    object={viewObject}
                    grid={viewMode === 'output'}
                    facing={viewMode === 'source' ? 'source' : 'output'}
                    showFrontCheck={false}
                  />
                ) : (
                  <div className="empty-state compact">
                    <Icon name="cube" size={42} />
                    <h2>还没有生成结果</h2>
                    <p>在模型工作区完成转换后，这里会显示最终结果。</p>
                  </div>
                )}
                {(busy || loading) && viewObject && (
                  <div className="busy-overlay">
                    <span className="spinner" />
                    <b>{progress?.label || '正在处理…'}</b>
                    <small>{progress?.detail ?? ''}</small>
                  </div>
                )}
              </div>
            </section>

            <aside className="export-side">
              <div className="export-status-card">
                <h2>结果与导出</h2>
                <p>
                  {model
                    ? `当前配置：${height}px 高 · ${binding === 'humanoid' ? '六部位人形' : '静态整体'} · ${
                        textureMode === 'budget'
                          ? textureTarget === 'density'
                            ? '预算·密度'
                            : '预算·细节保留'
                          : '旧版算法'
                      } · ${Object.keys(weights).length} 项权重调整`
                    : '导入模型后开始。'}
                </p>
                {result ? (
                  <>
                    <div className={`result-kind ${result.preview ? 'preview' : 'final'}`}>
                      {result.preview ? '预览结果' : '最终结果'}
                      {stale ? ' · 配置已改变' : ' · 与当前配置一致'}
                    </div>
                    {stale && (
                      <p className="stale-note" role="status">
                        <Icon name="alert" size={14} /> 当前配置已改变，下面的图集和报告来自上一次计算。请重新生成后再导出。
                      </p>
                    )}
                    {result.preview && !stale && (
                      <p className="inline-note">
                        模型与图集预览已经更新，但还没有打包。生成最终皮肤包会直接复用这张图集，不会重新计算。
                      </p>
                    )}
                  </>
                ) : (
                  <p className="inline-note">还没有生成结果。先在模型工作区转换，或在纹理工作区调整后回来导出。</p>
                )}
                <div className="export-actions">
                  <button
                    type="button"
                    className="primary"
                    disabled={!model || busy || loading || !included.size || !includedParts.size}
                    onClick={() => void exportFinal()}
                  >
                    <Icon name={busy ? 'reset' : 'spark'} size={15} className={busy ? 'spin' : undefined} />
                    {busy
                      ? '正在生成…'
                      : result?.preview && !stale
                        ? '打包并生成下载'
                        : stale || !result
                          ? '生成最终皮肤包'
                          : '重新生成'}
                  </button>
                  {result && !result.preview && !stale && (
                    <DownloadButtons files={result.files} name={name.trim()} compact disabled={busy} />
                  )}
                  {result && !stale && (
                    <button
                      type="button"
                      className="button-link"
                      disabled={packBusy || busy}
                      onClick={() => void addToPack()}
                    >
                      <Icon name={packBusy ? 'reset' : 'cube'} size={14} className={packBusy ? 'spin' : undefined} />
                      {packBusy ? '正在加入…' : '加入皮肤包'}
                    </button>
                  )}
                </div>
                {result && result.preview && !stale && (
                  <p className="field-help">下载按钮在打包完成后出现；当前预览不会冒充最终皮肤包。</p>
                )}
                {packMessage && (
                  <span className="pack-save-status">{packMessage} <a href="#pack">查看</a></span>
                )}
                {packError && (
                  <p className="error-message" role="alert"><Icon name="alert" size={15} />{packError}</p>
                )}
                {error && <p className="error-message" role="alert"><Icon name="alert" size={15} />{error}</p>}
              </div>

              <div className="export-report">
                {result ? (
                  <ConversionReport
                    result={result}
                    warnings={warnings}
                    stale={stale}
                    selectedMaterial={soloKey}
                    materialLabels={materialLabels}
                    onSelectMaterial={(materialKey) => selectMaterial(materialKey)}
                  />
                ) : (
                  <>
                    <WarningList warnings={warnings} />
                    <p className="field-help">转换后这里显示转换报告、材质像素覆盖和贴图利用率。</p>
                  </>
                )}
              </div>

              {result && (
                <details className="export-atlas">
                  <summary>图集诊断与区域明细</summary>
                  <AtlasInspector
                    src={result.textureUrl}
                    size={result.textureReport.size}
                    regions={atlasRegionsUi}
                    materials={atlasMaterials}
                    summary={result.textureReport}
                    selected={soloKey}
                    onSelect={selectMaterial}
                    onSelectCandidates={(ids) => setCandidates(candidateItems(ids))}
                    variant="panel"
                    {...(result.coverageUrl ? { coverageSrc: result.coverageUrl } : {})}
                  />
                </details>
              )}
            </aside>
          </div>
        )}
      </div>

      {(busy || loading || previewStatus === 'running' || previewStatus === 'queued' || error) && (
        <div className="workspace-statusbar" role="status">
          {error ? (
            <span className="error-text">{error}</span>
          ) : (
            <>
              <span>{progress?.label ?? (busy ? '正在转换…' : loading ? '正在读取文件…' : '正在更新纹理预览…')}</span>
              {progress?.detail && <small>{progress.detail}</small>}
              {(busy || previewStatus === 'running') && <span className="spinner" />}
            </>
          )}
        </div>
      )}

      {pending && (
        <Dialog
          title="选择包内模型"
          label="选择包内模型"
          className="model-candidate-dialog"
          closeLabel="取消选择"
          onClose={() => setPending(null)}
        >
          <p>这个包里有多套模型，选一个导入。</p>
          <ModelCandidateList
            candidates={pending.input.candidates}
            value={pending.main}
            onChange={(path) => setPending((current) => (current ? { ...current, main: path } : current))}
            disabledFormats={WEB_UNAVAILABLE_FORMATS}
            note={(candidate) => (candidate.format === 'pmd' ? '需桌面版' : null)}
          />
          <div className="pick-actions">
            <button type="button" onClick={() => setPending(null)}>取消</button>
            <button type="button" className="primary" onClick={loadPending}>加载所选模型</button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
