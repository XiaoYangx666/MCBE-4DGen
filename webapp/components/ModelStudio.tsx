import { useEffect, useMemo, useRef, useState } from 'react';
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
import {
  applyMaterialVisibility,
  collectMaterialVisibility,
  restoreMaterialVisibility,
} from '../lib/material-visibility';
import { extractModel, type ExtractedModel } from '../engine/extract';
import type { DoubleSidedPolicy } from '../engine/bedrock';
import { nextFrame } from '../engine/frame';
import { preparePreviewMaterials } from '../engine/preview-materials';
import type { TaskProgress } from '../engine/progress';
import {
  backMultiplier,
  loadModelJob,
  materialLabels as buildMaterialLabels,
  modelResultKey,
  ModelJobCancelled,
  prepareConvertedBatches,
  prepareModelInput,
  renderConvertedBatches,
  type PreparedModelInput,
} from '../engine/model-job';
import {
  defaultModelCandidate,
  type ModelFormat,
} from '../../src/model-candidates.ts';
import { Dialog } from '../../web/shared/Dialog';
import { ConversionReport } from './ConversionReport';
import { AtlasInspector } from '../../web/shared/AtlasInspector';
import { ModelCandidateList } from '../../web/shared/ModelCandidateList';
import { buildGeometryPreview } from '../lib/output-preview';
import { useSkinPack } from '../lib/pack-context';
import type { TextureSource } from '../engine/types';
import { RatioField } from '../../web/shared/RatioField';
import { MaterialDonut } from './MaterialDonut';
import { formatBytes } from '../../web/shared/format';
import { PoseControls } from '../../web/shared/PoseControls';
import {
  MaterialTuner,
  StudioParts,
  TextureStudio,
  type StudioMaterial,
  type StudioPart,
} from '../../web/shared/TextureStudio';
import { createPartPreview } from '../lib/part-visibility';
import { extractedParts } from '../engine/parts';
import { partDisplayNames, partGroupNames } from '../../web/shared/part-labels';
import { useCompactViewport } from '../lib/use-compact-viewport';

const DEFAULT_NAME = '我的 4D 皮肤';
/** Formats the browser build cannot open; the picker lists them as unavailable. */
const WEB_UNAVAILABLE_FORMATS: readonly ModelFormat[] = ['pmd'];
const ALLOCATION_OPTIONS = [
  {
    value: 'balanced',
    label: '均衡（推荐）',
    note: '一半按世界表面积、一半按源贴图细节；大块不糊，脸和头发也不会被挤掉。',
  },
  {
    value: 'density',
    label: '按世界表面积',
    note: '衣服、身体等面积大的材质优先；小件可能被压到最小。',
  },
  {
    value: 'retention',
    label: '按源贴图细节',
    note: '按材质实际采样的源图像素分配；衣服等大块可能明显变糊。',
  },
] as const;
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

export function ModelStudio({
  onOpenMenu,
  showMenu = true,
}: { onOpenMenu?: () => void; showMenu?: boolean } = {}) {
  const [model, setModel] = useState<LoadedModel | null>(null);
  const [sourceBytes, setSourceBytes] = useState(0);
  const [name, setName] = useState(DEFAULT_NAME);
  const [height, setHeight] = useState(32);
  const [heightText, setHeightText] = useState('32');
  const [ratio, setRatio] = useState(0.2);
  /** Per-part retention overrides keyed by stable part id; absent = global ratio. */
  const [partRatios, setPartRatios] = useState<Record<string, number>>({});
  const [maxError, setMaxError] = useState(0.03);
  const [doubleSided, setDoubleSided] = useState<DoubleSidedPolicy>('source');
  const [rotationY, setRotationY] = useState(0);
  const [armSpread, setArmSpread] = useState(0);
  const [armAvailable, setArmAvailable] = useState(false);
  const [binding, setBinding] = useState<BindingMode>('static');
  const [rigAvailable, setRigAvailable] = useState(false);
  const [source, setSource] = useState<ExtractedModel | null>(null);
  const [included, setIncluded] = useState<Set<string>>(new Set());
  const [mobileTab, setMobileTab] = useState<'basic' | 'edit' | 'texture' | 'export'>('basic');
  /** Wide-screen inspector tabs; the preview and material rail stay visible. */
  const [desktopTab, setDesktopTab] = useState<'settings' | 'texture' | 'export'>('settings');
  /** CSS fullscreen for the 3D stage: keeps the floating buttons visible. */
  const [stageFullscreen, setStageFullscreen] = useState(false);
  /** Full-page drop target; the compact sheet has no dedicated drop zone. */
  const [dragging, setDragging] = useState(false);
  /** Phones keep the sheet; wide screens use the three-column workbench. */
  const compact = useCompactViewport();
  const [previewRoot, setPreviewRoot] = useState<THREE.Group | null>(null);
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [textureTarget, setTextureTarget] = useState<'density' | 'retention' | 'balanced'>('balanced');
  const [allocationOpen, setAllocationOpen] = useState(false);
  const [includedParts, setIncludedParts] = useState<Set<string>>(new Set());
  const [selectedPart, setSelectedPart] = useState<string | null>(null);
  const [showKeptParts, setShowKeptParts] = useState(true);
  /** Parts are rarely adjusted; keep the long list collapsed by default. */
  const [partsOpen, setPartsOpen] = useState(false);
  const [materialsOpen, setMaterialsOpen] = useState(true);
  /** Pixel difference versus the previous conversion of the same model. */
  const [materialDeltas, setMaterialDeltas] = useState<Map<string, number>>(new Map());
  const [soloKey, setSoloKey] = useState<string | null>(null);
  /** Material whose density tuner is open from the texture tab. */
  const [tunerKey, setTunerKey] = useState<string | null>(null);
  const sourcePose = useRef('0|0');
  const armRig = useRef<ArmRig | null>(null);
  const humanoidRig = useRef<HumanoidRig | null>(null);
  const previewRootRef = useRef<THREE.Group | null>(null);
  const partPreview = useRef<ReturnType<typeof createPartPreview> | null>(null);
  const convertRun = useRef(0);
  /**
   * Filtered/reduced batches keyed by geometry-affecting settings only. Texture
   * density changes reuse this instead of re-running the reducer.
   */
  const preparedCache = useRef<{
    extracted: ExtractedModel;
    key: string;
    prepared: Awaited<ReturnType<typeof prepareConvertedBatches>>;
  } | null>(null);
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
  const folderInput = useRef<HTMLInputElement>(null);

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

  const setPartRatio = (id: string, value: number | null) => {
    setPartRatios((current) => {
      const next = { ...current };
      if (value === null) delete next[id];
      else next[id] = value;
      return next;
    });
  };
  const resetPartRatios = () => setPartRatios({});

  const resetLoadState = () => {
    setResult(null);
    setViewMode('source');
    setWarnings([]);
    setSource(null);
    setSourceBytes(0);
    setIncluded(new Set());
    setPartRatios({});
    setRotationY(0);
    setArmSpread(0);
    setArmAvailable(false);
    setRigAvailable(false);
    setBinding('static');
    setWeights({});
    setIncludedParts(new Set());
    setSelectedPart(null);
    setShowKeptParts(true);
    setMaterialDeltas(new Map());
    partPreview.current?.restore();
    partPreview.current = null;
    setSoloKey(null);
    originalVisibility.current = new Map();
    armRig.current = null;
    humanoidRig.current = null;
    preparedCache.current = null;
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
      partRatios,
      included,
      includedParts,
      weights,
      textureMode: 'budget',
      textureTarget,
      atlasSharing: true,
      modelTriangles: model?.stats.triangles ?? 0,
    }),
  ].join('|'), [binding, name, height, rotationY, armSpread, doubleSided, ratio, maxError, partRatios, included, includedParts, weights, textureTarget, model?.stats.triangles]);

  const convert = async () => {
    if (!model || busy) return;
    // Key already matches the current settings: re-running would reproduce the
    // same bytes, so keep the existing result (and its preview/downloads).
    if (result && resultKey === key) {
      setViewMode('output');
      return;
    }
    const run = ++convertRun.current;
    const before = result;
    setBusy(true);
    setError(null);
    setProgress({ label: '提取网格…' });
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
      const merged = [...new Set([...model.warnings, ...extracted.warnings])];
      if (armSpread !== 0) merged.push(`已按 ${armSpread}° 调整手臂，并烘焙到静态网格。`);
      setWarnings(merged);

      const geometryKey = [
        [...included].sort().join(','),
        [...includedParts].sort().join(','),
        ratio,
        maxError,
        Object.entries(partRatios)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([id, value]) => `${id}:${value.toFixed(2)}`)
          .join(','),
      ].join('|');
      const cached = preparedCache.current;
      const reuse = cached?.extracted === extracted && cached.key === geometryKey;
      const prepared = reuse
        ? cached.prepared
        : await prepareConvertedBatches(extracted, {
            included,
            includedParts,
            ratio,
            maxError,
            ...(Object.keys(partRatios).length ? { partRatios } : {}),
            onProgress: setProgress,
          });
      if (!reuse) preparedCache.current = { extracted, key: geometryKey, prepared };
      else setProgress({ label: '复用减面结果…', detail: '仅重做贴图与 UV' });

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
        textureMode: 'budget',
        textureTarget,
        atlasSharing: true,
        preserveTexture: model?.format === 'ysm',
        rig: binding === 'humanoid' ? extracted.rig : null,
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
      setResult({
        ...converted.result,
        elapsedMs: performance.now() - startedAt,
        excludedMaterials: converted.excludedMaterials,
        excludedMaterialKeys: converted.excludedMaterialKeys,
      });
      setResultKey(key);
      setWarnings([...new Set([...merged, ...converted.warnings])]);
      setViewMode('output');
    } catch (cause) {
      if (run === convertRun.current)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (run === convertRun.current) {
        setBusy(false);
        setProgress(null);
      }
    }
  };

  const stale = !!result && resultKey !== key;

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
  const triangleBudget = useMemo(() => {
    if (!source)
      return {
        source: model?.stats.triangles ?? 0,
        target: Math.max(1, Math.round((model?.stats.triangles ?? 0) * ratio)),
      };
    let sourceFaces = 0;
    let targetFaces = 0;
    for (const batch of source.batches) {
      if (!included.has(batch.key)) continue;
      const multiplier = backMultiplier(batch, doubleSided);
      if (batch.sourceParts && batch.sourcePartTable) {
        const counts = new Map<number, number>();
        for (const index of batch.sourceParts)
          counts.set(index, (counts.get(index) ?? 0) + 1);
        for (const [index, count] of counts) {
          const part = batch.sourcePartTable[index];
          if (!part || !includedParts.has(part.id)) continue;
          const faces = count * multiplier;
          sourceFaces += faces;
          targetFaces += faces * (partRatios[part.id] ?? ratio);
        }
      } else {
        const faces = batch.triangles * multiplier;
        sourceFaces += faces;
        targetFaces += faces * ratio;
      }
    }
    return { source: Math.round(sourceFaces), target: Math.max(1, Math.round(targetFaces)) };
  }, [source, included, includedParts, doubleSided, partRatios, ratio, model?.stats.triangles]);
  const sourceTriangles = triangleBudget.source;
  const targetFaces = triangleBudget.target;
  const actualFaces = result && !stale ? result.report.triangles : null;
  const selectedMaterial = source?.batches.find((batch) => batch.key === soloKey)?.name ?? null;
  const materialLabels = useMemo(
    () => source ? buildMaterialLabels(source.batches) : new Map<string, string>(),
    [source],
  );
  const studioParts = useMemo<StudioPart[]>(() => {
    if (!source) return [];
    const parts = extractedParts(source);
    const partInputs = parts.map((part) => ({
      name: part.name,
      mesh: part.mesh,
      material: part.materialName,
    }));
    const names = partDisplayNames(partInputs);
    const groups = partGroupNames(partInputs);
    const byMaterial = new Map<string, string[]>();
    parts.forEach((part, index) => {
      const list = byMaterial.get(part.materialKey) ?? [];
      list.push(names[index]!);
      byMaterial.set(part.materialKey, list);
    });
    return parts.map((part, index) => {
      const label = materialLabels.get(part.materialKey) ?? part.materialName;
      const name = names[index]!;
      return {
        id: part.id,
        name,
        group: groups[index]!,
        meta: `${part.triangles.toLocaleString('zh-CN')} 面${
          name === label ? '' : ` · ${label}`
        }`,
        materials: [label],
        materialKey: part.materialKey,
        thumbnail: materialThumbs.get(part.materialKey) ?? null,
        sharedWith: (byMaterial.get(part.materialKey) ?? []).filter((entry) => entry !== name),
      };
    });
  }, [source, materialLabels, materialThumbs]);
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
  const selectedStudioMaterial = useMemo(
    () => studioMaterials.find((material) => material.id === soloKey) ?? null,
    [studioMaterials, soloKey],
  );
  const tunerMaterial = useMemo(
    () => studioMaterials.find((material) => material.id === tunerKey) ?? null,
    [studioMaterials, tunerKey],
  );
  const setMaterialWeight = (id: string, value: number) => {
    setWeights((previous) => ({ ...previous, [id]: value }));
  };
  const resetMaterialWeight = (id: string) => {
    setWeights((previous) => {
      const next = { ...previous };
      delete next[id];
      return next;
    });
  };
  const resetAllMaterialWeights = () => setWeights({});
  const atlasRegions = result?.textureReport.regions ?? [];
  const atlasMaterials = useMemo(() => {
    if (!result) return [];
    const weightsByKey = new Map(
      (source?.batches ?? []).map((batch) => [batch.key, weights[batch.key] ?? 1]),
    );
    return (result.textureReport.materials ?? []).map((material) => ({
      id: material.key,
      name: materialLabels.get(material.key) ?? material.name,
      allocated: atlasRegions
        .filter((region) => region.materialKeys?.includes(material.key))
        .reduce((sum, region) => sum + region.contentPixels, 0),
      used: material.pixels,
      uv: material.uvPixels ?? null,
      weight: weightsByKey.get(material.key),
      flat: atlasRegions
        .filter((region) => region.materialKeys?.includes(material.key))
        .every((region) => region.flat),
      shared: material.sharedPixels ?? null,
      floorCharts: material.floorCharts,
      rectPixels: material.rectPixels,
      wastePixels: material.wastePixels,
      mode: result.textureReport.mode,
    }));
  }, [result, source, weights, atlasRegions, materialLabels]);

  const inspectorRegions = useMemo(
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

  const texturePanel = (
    <>
      <div className="texture-tab-head">
        <span>
          {result && result.textureUrl
            ? `输出贴图 ${result.textureReport.size} × ${result.textureReport.size} PNG`
            : '纹理分配'}
        </span>
        <div className="texture-tab-actions">
          <button
            type="button"
            className="texture-adjust-button"
            disabled={busy || loading}
            title="选择纹理分配方式"
            onClick={() => setAllocationOpen(true)}
          >
            <Icon name="settings" size={13} />
            分配方式
          </button>
          {result && result.textureUrl && (
            <button
              type="button"
              className="texture-adjust-button"
              disabled={!selectedStudioMaterial || busy || loading}
              title={
                selectedStudioMaterial
                  ? `调整 ${selectedStudioMaterial.name} 的相对纹理预算`
                  : '点击图集或占比图选择材质'
              }
              onClick={() => {
                if (selectedStudioMaterial) setTunerKey(selectedStudioMaterial.id);
              }}
            >
              <Icon name="settings" size={13} />
              调整清晰度
            </button>
          )}
        </div>
      </div>
      {result && result.textureUrl ? (
        <div className="texture-overview">
          <AtlasInspector
            src={result.textureUrl}
            size={result.textureReport.size}
            regions={inspectorRegions}
            materials={atlasMaterials}
            selected={soloKey}
            onSelect={(id) => setSoloKey(soloKey === id ? null : id)}
            showList={false}
            showAdvanced={false}
            zoomable={false}
            {...(result.coverageUrl ? { coverageSrc: result.coverageUrl } : {})}
          />
          <MaterialDonut
            materials={result.textureReport.materials.map((material) => ({
              key: material.key,
              name: materialLabels.get(material.key) ?? material.name,
              pixels: material.rectPixels ?? material.uvPixels ?? material.pixels,
            }))}
            total={result.textureReport.size * result.textureReport.size}
            selected={soloKey}
            onSelect={(id) => setSoloKey(soloKey === id ? null : id)}
            coverage={result.textureReport.allocatedUtilization ?? result.textureReport.contentUtilization}
            uvCoverage={result.textureReport.uvUtilization ?? result.textureCoverage}
          />
        </div>
      ) : (
        <p className="field-help">转换后在这里查看可点击的贴图和材质占比。</p>
      )}
    </>
  );

  const exportPanel = result ? (
    <>
      <div className="mobile-result-actions">
        <button
          type="button"
          className="button-link"
          disabled={packBusy || stale}
          onClick={() => void addToPack()}
        >
          <Icon name={packBusy ? 'reset' : 'cube'} size={14} className={packBusy ? 'spin' : undefined} />
          {packBusy ? '正在加入…' : '加入皮肤包'}
        </button>
        <DownloadButtons files={result.files} name={name.trim()} compact disabled={stale} />
      </div>
      {packMessage && (
        <span className="pack-save-status">{packMessage} <a href="#pack">查看</a></span>
      )}
      {packError && (
        <p className="error-message" role="alert"><Icon name="alert" size={15} />{packError}</p>
      )}
      {compact ? (
        <>
          <dl className="result-stats">
            <div>
              <dt>输出三角面</dt>
              <dd>{result.report.triangles.toLocaleString('zh-CN')}</dd>
            </div>
            <div>
              <dt>转换用时</dt>
              <dd>{result.elapsedMs !== undefined ? `${(result.elapsedMs / 1000).toFixed(1)} 秒` : '—'}</dd>
            </div>
            <div>
              <dt>源三角面</dt>
              <dd>{result.report.sourceTriangles.toLocaleString('zh-CN')}</dd>
            </div>
            <div>
              <dt>材质</dt>
              <dd>{result.report.materials.length}</dd>
            </div>
            <div>
              <dt>绑定</dt>
              <dd>{result.binding === 'humanoid' ? '六部位人形' : '静态整体'}</dd>
            </div>
            <div>
              <dt>分配方式</dt>
              <dd>
                {result.textureReport.target === 'retention'
                  ? '纹理预算 · 保留'
                  : result.textureReport.target === 'balanced'
                    ? '纹理预算 · 均衡'
                    : '纹理预算 · 密度'}
              </dd>
            </div>
            <div>
              <dt>有效 UV 覆盖</dt>
              <dd>{Math.round((result.textureReport.uvUtilization ?? result.textureCoverage) * 100)}%</dd>
            </div>
            {!!result.excludedMaterials?.length && (
              <div>
                <dt>已移除材质</dt>
                <dd>{result.excludedMaterials.length}</dd>
              </div>
            )}
          </dl>
          <WarningList warnings={warnings} />
        </>
      ) : (
        <ConversionReport
          result={result}
          warnings={warnings}
          stale={stale}
          selectedMaterial={selectedMaterial}
          materialLabels={materialLabels}
          onSelectMaterial={(materialKey) => {
            const batch = source?.batches.find((item) => item.key === materialKey);
            if (batch) setSoloKey(soloKey === batch.key ? null : batch.key);
          }}
        />
      )}
    </>
  ) : (
    <>
      <WarningList warnings={warnings} />
      <p className="field-help">转换后在这里加入或下载皮肤包。</p>
    </>
  );

  const partsPanel = (
    <div className="settings-section" data-section="parts">
      <div className="field-group">
        <button
          type="button"
          className="field-group-title group-toggle"
          aria-expanded={partsOpen}
          onClick={() => setPartsOpen((open) => !open)}
        >
          <span>模型部件</span>
          <small>{includedParts.size}/{studioParts.length} 保留</small>
        </button>
        {partsOpen &&
          (source ? (
            <StudioParts
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
              partRatios={partRatios}
              onPartRatio={setPartRatio}
              onResetPartRatios={resetPartRatios}
              defaultRatio={ratio}
            />
          ) : (
            <p className="field-help">导入模型后可以在这里选择要保留的部件。</p>
          ))}
      </div>
    </div>
  );

  return (
    <div
      className={`studio-layout model-layout ${compact ? 'compact' : `desktop-tab-${desktopTab}`} ${stageFullscreen ? 'stage-hidden' : ''}`}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        if (!loading && !busy) setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        if (loading || busy) return;
        const next = [...event.dataTransfer.files];
        if (next.length) void choose(next);
      }}
    >
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
      <input
        ref={folderInput}
        className="mobile-model-input"
        type="file"
        multiple
        disabled={loading || busy}
        {...{ webkitdirectory: '' }}
        onChange={(event) => {
          const next = event.target.files ? [...event.target.files] : [];
          event.target.value = '';
          if (next.length) void choose(next);
        }}
      />
      {dragging && (
        <div className="model-drop-overlay" aria-hidden="true">
          <Icon name="upload" size={30} />
          <b>松开以导入模型</b>
          <span>GLB / VRM / PMX / 含贴图的 ZIP / YSM 文件夹</span>
        </div>
      )}
      {!compact && (
        <header className="model-desktop-header">
          <div className="model-desktop-project">
            <span className="eyebrow">4DGen / 模型编辑</span>
            <h2>{model?.name ?? '模型工作台'}</h2>
            <small>
              {model
                ? `${model.stats.triangles.toLocaleString('zh-CN')} 三角面 · ${model.stats.materials} 材质 · ${formatBytes(totalBytes)}`
                : '导入模型后开始编辑；切换预览不会丢失当前配置'}
            </small>
          </div>
          <nav className="model-desktop-tabs" aria-label="模型工作区">
            {([
              ['settings', '设置'],
              ['texture', '纹理'],
              ['export', '导出'],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={desktopTab === key ? 'active' : ''}
                onClick={() => setDesktopTab(key)}
              >
                {label}
              </button>
            ))}
          </nav>
        </header>
      )}
      <div className="studio-sheet">
        {compact && (
          <div className="mobile-settings-tabs" role="tablist" aria-label="模型设置">
            {([
              ['basic', '基础'],
              ['edit', '部件/材质'],
              ['texture', '纹理'],
              ['export', '导出'],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={mobileTab === key}
                className={mobileTab === key ? 'active' : ''}
                onClick={() => setMobileTab(key)}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        <div className="sheet-body" data-tab={mobileTab}>
          <aside className="studio-inspector">
            <div className="panel-heading">
              <div className="template-icon"><Icon name="cube" size={26} /></div>
              <h2>
                {desktopTab === 'settings' ? '转换设置' : desktopTab === 'texture' ? '纹理' : '导出'}
              </h2>
            </div>
            <div className="panel-scroll">
        {(compact || desktopTab === 'settings') && (
          <>
        <fieldset disabled={loading || busy}>
          <div className="settings-section" data-section="basic">
            <div className="settings-section-title">基础配置</div>

          <div className="field-group">
            <div className="field-group-title">名称与绑定</div>
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
          </div>

          <div className="field-group">
            <div className="field-group-title">尺寸与姿态</div>
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
            {!heightValid && <p className="field-help error-text">模型高度需为 1–128</p>}

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

          <div className="field-group">
            <div className="field-group-title">网格简化</div>
            <RatioField
              ratio={ratio}
              onChange={setRatio}
              sourceTriangles={sourceTriangles}
              targetFaces={targetFaces}
              actualFaces={actualFaces}
              disabled={loading || busy}
              showBudget={!!model}
            />
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
          </div>

          <div className="field-group">
            <div className="field-group-title">渲染</div>
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

          </div>
        </fieldset>
        {compact && partsPanel}
          </>
        )}
        {!compact && desktopTab === 'texture' && (
          <div className="settings-section texture-section">{texturePanel}</div>
        )}
        {!compact && desktopTab === 'export' && (
          <div className="settings-section result-section">{exportPanel}</div>
        )}
      {compact && (
        <>
          <div className="settings-section texture-section" data-section="texture">{texturePanel}</div>
          <div className="settings-section result-section" data-section="export">{exportPanel}</div>
        </>
      )}
            </div>
          </aside>

          <aside className={`studio-materials${partsOpen ? '' : ' collapsed-parts'}`}>
            <div className="panel-heading">模型 / 材质</div>
            <div className="panel-scroll">
              {!compact && (
                <>
                  <DropZone
                    accept={MODEL_ACCEPT}
                    multiple
                    compact={!!model}
                    title={model ? '重新选择模型' : '拖入模型或 ZIP，或点击选择'}
                    hint={model ? `${model.name} · ${formatBytes(totalBytes)}` : 'GLB / glTF / VRM / PMX / FBX / OBJ / DAE / STL / PLY、含贴图的 ZIP 或 YSM 模型文件夹'}
                    icon="cube"
                    onFiles={(next) => void choose(next)}
                    disabled={loading || busy}
                  />
                  <button
                    type="button"
                    className="button-link"
                    disabled={loading || busy}
                    onClick={() => folderInput.current?.click()}
                  >
                    选择 YSM 模型文件夹
                  </button>
                </>
              )}

          {!compact && partsPanel}

          <div className="settings-section" data-section="material">
            <div className="field-group">
              <button
                type="button"
                className="field-group-title group-toggle"
                aria-expanded={materialsOpen}
                onClick={() => setMaterialsOpen((open) => !open)}
              >
                <span>材质与清晰度</span>
                <small>{studioMaterials.length} 项</small>
              </button>
              {materialsOpen &&
                (source ? (
                  <TextureStudio
                    materials={studioMaterials}
                    selectedMaterial={soloKey}
                    onSelectMaterial={(id) => setSoloKey(id)}
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
                    onWeight={setMaterialWeight}
                    onResetWeight={resetMaterialWeight}
                    onResetAllWeights={resetAllMaterialWeights}
                    disabled={loading || busy}
                    note="纹理预算 · 相对清晰度 0.1–20×"
                  />
                ) : (
                  <p className="field-help">导入模型后可以在这里调整材质清晰度。</p>
                ))}
            </div>
          </div>
            </div>
          </aside>
        </div>

        <div className="settings-footer">
          {compact && stale && (
            <p className="stale-note" role="status"><Icon name="alert" size={14} /> 参数已修改，请重新转换。</p>
          )}
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
          <button type="button" className="primary" disabled={!model || busy || loading || !name.trim() || !heightValid || !included.size || !includedParts.size} onClick={() => void convert()}>
            <Icon name={busy ? 'reset' : 'spark'} size={15} className={busy ? 'spin' : undefined} />
            {busy ? '正在转换…' : result ? '重新转换' : '转换为 4D 皮肤'}
          </button>
        </div>
      </div>

      <section className="studio-result model-result">
        {!compact && (
          <div className="result-header">
            <div>
              <h2>{result && viewMode === 'output' ? '输出预览' : model ? '源模型预览' : '模型预览'}</h2>
              <p>
                {result && viewMode === 'output'
                  ? '实际导出的 poly_mesh 与 128 × 128 贴图。'
                  : model
                    ? `${model.stats.triangles.toLocaleString('zh-CN')} 三角面 · ${model.stats.materials} 材质 · ${model.stats.textures} 贴图`
                    : '导入模型后在这里预览。'}
              </p>
            </div>
            <div className="result-header-actions">
              <div className="tabs">
                {model && (
                  <button type="button" className={viewMode === 'source' ? 'active' : ''} onClick={() => setViewMode('source')}>
                    源模型
                  </button>
                )}
                {result && (
                  <button type="button" className={viewMode === 'output' ? 'active' : ''} onClick={() => setViewMode('output')}>
                    4D 输出
                  </button>
                )}
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label={stageFullscreen ? '退出全屏' : '全屏预览'}
                title={stageFullscreen ? '退出全屏' : '全屏预览'}
                onClick={() => setStageFullscreen((value) => !value)}
              >
                <Icon name={stageFullscreen ? 'shrink' : 'expand'} size={16} />
              </button>
            </div>
          </div>
        )}

        <div className={`model-stage${stageFullscreen ? ' fullscreen' : ''}`}>
          {!compact && stageFullscreen && (
            <button
              type="button"
              className="stage-fullscreen-exit"
              onClick={() => setStageFullscreen(false)}
            >
              <Icon name="shrink" size={16} /> 退出全屏
            </button>
          )}
          {compact && (
            <div className="stage-side-buttons">
              {showMenu && (
                <button
                  type="button"
                  className="stage-menu-button"
                  aria-label="打开菜单"
                  onClick={onOpenMenu}
                >
                  <Icon name="menu" size={18} />
                </button>
              )}
              {model && (
                <button
                  type="button"
                  className="stage-icon-button"
                  aria-label="更换模型"
                  title="更换模型"
                  disabled={loading || busy}
                  onClick={() => modelInput.current?.click()}
                >
                  <Icon name="upload" size={16} />
                </button>
              )}
            </div>
          )}
          {compact && (
            <div className="stage-topbar">
              <div className="stage-topbar-right">
                <button
                  type="button"
                  className="stage-icon-button"
                  aria-label={stageFullscreen ? '显示设置面板' : '全屏预览'}
                  aria-pressed={stageFullscreen}
                  title={stageFullscreen ? '显示设置面板' : '全屏预览'}
                  onClick={() => setStageFullscreen((value) => !value)}
                >
                  <Icon name={stageFullscreen ? 'shrink' : 'expand'} size={16} />
                </button>
              </div>
            </div>
          )}
          {compact && (model || result) && (
            <div className="stage-viewswitch" role="tablist" aria-label="预览切换">
              {model && (
                <button type="button" className={viewMode === 'source' ? 'active' : ''} onClick={() => setViewMode('source')}>
                  源
                </button>
              )}
              {result && (
                <button type="button" className={viewMode === 'output' ? 'active' : ''} onClick={() => setViewMode('output')}>
                  4D
                </button>
              )}
            </div>
          )}
          {viewObject ? (
            <Viewport
              object={viewObject}
              grid={viewMode === 'output'}
              showFrontCheck={false}
              fitKey={model}
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
                  <p>{compact ? '选择模型文件，或从侧边栏「获取模型」进入站点目录。' : '拖入模型或 ZIP，或从「获取模型」页进入站点目录。'}</p>
                  {compact && (
                    <div className="empty-actions">
                      <button type="button" className="button-link" onClick={() => modelInput.current?.click()}>
                        选择模型文件
                      </button>
                      <button type="button" className="button-link" onClick={() => folderInput.current?.click()}>
                        YSM 模型文件夹
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
          {(busy || loading) && viewObject && (
            <div className="busy-overlay">
              <span className="spinner" />
              <b>{progress?.label || (busy ? '正在转换…' : '正在读取文件…')}</b>
              <small>
                {progress?.detail ? `${progress.detail}，` : ''}
                大模型需要十几秒，请保持页面打开。
              </small>
            </div>
          )}
        </div>

      </section>

      {!compact && (
        <div className="model-desktop-status" role="status">
          {error ? (
            <span className="error-text">{error}</span>
          ) : busy || loading ? (
            <>
              <span className="spinner" />
              {progress?.label ?? (busy ? '正在转换…' : '正在读取文件…')}
              {progress?.detail ? ` · ${progress.detail}` : ''}
            </>
          ) : stale ? (
            <span className="workspace-stale">参数已修改，请重新转换</span>
          ) : (
            <span>{model ? '就绪' : '等待导入模型'}</span>
          )}
          <span className="grow" />
          {result && (
            <span>
              输出 {result.report.triangles.toLocaleString('zh-CN')} 三角面 ·{' '}
              {result.textureReport.size} × {result.textureReport.size} 贴图
            </span>
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

      {allocationOpen && (
        <Dialog
          title="纹理分配方式"
          label="纹理分配方式"
          className="allocation-dialog"
          closeLabel="关闭纹理分配方式"
          onClose={() => setAllocationOpen(false)}
        >
          <div className="allocation-options">
            {ALLOCATION_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`allocation-option${
                  textureTarget === option.value ? ' active' : ''
                }`}
                aria-pressed={textureTarget === option.value}
                onClick={() => {
                  setTextureTarget(option.value);
                  setAllocationOpen(false);
                }}
              >
                <b>{option.label}</b>
                <span>{option.note}</span>
              </button>
            ))}
          </div>
          <p className="allocation-note">
            切换后会标记需要重新转换，点「转换」生成新图集。
          </p>
        </Dialog>
      )}

      {tunerMaterial && (
        <MaterialTuner
          material={tunerMaterial}
          disabled={loading || busy}
          onWeight={setMaterialWeight}
          onResetWeight={resetMaterialWeight}
          onResetAllWeights={resetAllMaterialWeights}
          onClose={() => setTunerKey(null)}
        />
      )}
    </div>
  );
}
