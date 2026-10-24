import { useEffect, useRef, useState } from 'react';
import type * as THREE from 'three';
import { DropZone } from './DropZone';
import { DownloadButtons, InstallHelp, WarningList } from './Common';
import { Icon } from './Icons';
import { Viewport } from './Viewport';
import { loadModelFiles, formatOf, MODEL_ACCEPT, type LoadedModel } from '../lib/import-model';
import { extractModel } from '../lib/extract';
import { convertBatches, nextFrame, type ConvertResult } from '../lib/convert';
import type { DoubleSidedPolicy } from '../lib/bedrock';
import { buildGeometryPreview } from '../lib/output-preview';
import { formatBytes, isCompactViewport } from '../lib/download';

const DEFAULT_NAME = '我的 4D 皮肤';

export function ModelStudio() {
  const [model, setModel] = useState<LoadedModel | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [name, setName] = useState(DEFAULT_NAME);
  const [height, setHeight] = useState(32);
  const [doubleSided, setDoubleSided] = useState<DoubleSidedPolicy>('source');
  const [result, setResult] = useState<ConvertResult | null>(null);
  const [resultKey, setResultKey] = useState('');
  const [preview, setPreview] = useState<THREE.Object3D | null>(null);
  const [viewMode, setViewMode] = useState<'source' | 'output'>('source');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const modelRef = useRef<LoadedModel | null>(null);
  const loadId = useRef(0);
  const customName = useRef(false);
  const resultRef = useRef<HTMLElement>(null);

  useEffect(() => () => {
    modelRef.current?.dispose();
    modelRef.current = null;
  }, []);

  useEffect(() => {
    if (!result) {
      setPreview(null);
      return;
    }
    const created = buildGeometryPreview(result.geometry, result.textureUrl);
    setPreview(created.object);
    if (isCompactViewport()) {
      const behavior = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
      requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior, block: 'start' }));
    }
    return () => created.dispose();
  }, [result]);

  const choose = async (incoming: File[]) => {
    if (!incoming.length) return;
    if (!incoming.some((file) => formatOf(file.name))) {
      setError('没有找到支持的模型文件。支持 GLB、glTF、VRM、FBX、OBJ、DAE、STL、PLY。');
      return;
    }
    const total = incoming.reduce((sum, file) => sum + file.size, 0);
    if (total > 512 * 1024 * 1024) {
      setError('文件总大小超过 512 MB，请精简贴图或先压缩模型。');
      return;
    }
    const token = ++loadId.current;
    setError(null);
    setLoading(true);
    setPhase('解析模型…');
    setResult(null);
    setViewMode('source');
    setWarnings([]);
    modelRef.current?.dispose();
    modelRef.current = null;
    setModel(null);
    try {
      await nextFrame();
      const loaded = await loadModelFiles(incoming);
      if (token !== loadId.current) {
        loaded.dispose();
        return;
      }
      modelRef.current = loaded;
      setModel(loaded);
      setFiles(incoming);
      setWarnings(loaded.warnings);
      if (!customName.current) setName(loaded.name.slice(0, 60) || DEFAULT_NAME);
    } catch (cause) {
      if (token === loadId.current)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (token === loadId.current) {
        setLoading(false);
        setPhase('');
      }
    }
  };

  const convert = async () => {
    if (!model || busy) return;
    setBusy(true);
    setError(null);
    setPhase('读取网格…');
    try {
      await nextFrame();
      const extracted = extractModel(model.scene);
      const merged = [...new Set([...model.warnings, ...extracted.warnings])];
      setWarnings(merged);
      const converted = await convertBatches(extracted.batches, {
        name: name.trim(),
        height,
        doubleSided,
        onPhase: setPhase,
      });
      setResult(converted);
      setResultKey(`${name.trim()}|${height}|${doubleSided}|${model.stats.triangles}`);
      setWarnings([...new Set([...merged, ...converted.report.warnings])]);
      setViewMode('output');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
      setPhase('');
    }
  };

  const key = `${name.trim()}|${height}|${doubleSided}|${model?.stats.triangles ?? 0}`;
  const stale = !!result && resultKey !== key;
  const viewObject = viewMode === 'output' && preview ? preview : model?.scene ?? null;
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);

  return (
    <div className="studio-layout">
      <section className="studio-settings">
        <div className="settings-body">
        <div className="template-icon"><Icon name="cube" size={30} /></div>
        <h2>3D 模型 · 4D 皮肤</h2>
        <p>导入模型后自动拼贴材质、生成 poly_mesh，并打包为基岩版皮肤。</p>

        <fieldset disabled={loading || busy}>
          <DropZone
            accept={MODEL_ACCEPT}
            multiple
            compact={!!model}
            title={model ? '重新选择模型' : '拖入模型，或点击选择'}
            hint={model ? `${model.name} · ${formatBytes(totalBytes)}` : 'GLB / glTF / VRM / FBX / OBJ / DAE / STL / PLY'}
            icon="cube"
            onFiles={(next) => void choose(next)}
            disabled={loading || busy}
          />
          {!model && (
            <p className="help model-formats">
              推荐 GLB / glTF / VRM 与带 MTL 的 OBJ；FBX / DAE / STL / PLY 为实验支持。PMX / PMD 请使用桌面版。
            </p>
          )}

          <label className="field-label">
            皮肤名称
            <input
              value={name}
              maxLength={128}
              onChange={(event) => {
                customName.current = true;
                setName(event.target.value);
              }}
              placeholder="输入皮肤名称"
            />
          </label>

          <label className="field-label">
            模型高度
            <input
              type="number"
              min={8}
              max={64}
              value={height}
              onChange={(event) => setHeight(Number(event.target.value) || 32)}
            />
          </label>
          <input
            className="height-range"
            type="range"
            min={8}
            max={64}
            step={1}
            value={height}
            aria-label="模型高度"
            onChange={(event) => setHeight(Number(event.target.value))}
          />

          <div className="choice-field">
            <span>背面渲染 <small>全部双面会使面数翻倍</small></span>
            <div className="choice-row">
              {([
                ['source', '跟随材质'],
                ['all', '全部双面'],
                ['front', '仅正面'],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={doubleSided === value ? 'active' : ''}
                  onClick={() => setDoubleSided(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </fieldset>
        </div>

        <div className="settings-footer">
          {error && <p className="error-message" role="alert"><Icon name="alert" size={15} />{error}</p>}
          <button type="button" className="primary" disabled={!model || busy || loading || !name.trim()} onClick={() => void convert()}>
            <Icon name={busy ? 'reset' : 'spark'} size={15} className={busy ? 'spin' : undefined} />
            {busy ? phase || '正在转换…' : result ? '重新转换' : '转换为 4D 皮肤'}
          </button>
          <p className="privacy-note"><Icon name="shield" size={14} /> 模型与贴图只在浏览器内处理，不会上传。</p>
        </div>
      </section>

      <section className="studio-result model-result" ref={resultRef}>
        <div className="result-header">
          <div>
            <h2>{result && viewMode === 'output' ? '输出预览' : model ? '源模型预览' : '模型预览'}</h2>
            <p>
              {result && viewMode === 'output'
                ? '实际导出的 poly_mesh 与 128 × 128 贴图。'
                : model
                  ? `${model.stats.triangles.toLocaleString('zh-CN')} 三角面 · ${model.stats.materials} 材质 · ${model.stats.textures} 贴图`
                  : '导入模型后会在这里显示三维预览。'}
            </p>
          </div>
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
        </div>

        <div className="model-stage">
          {viewObject ? (
            <Viewport object={viewObject} grid={viewMode === 'output'} />
          ) : (
            <div className="empty-state compact">
              {loading ? (
                <>
                  <span className="spinner" />
                  <h2>{phase || '正在解析模型…'}</h2>
                  <p>大模型需要几秒钟，请保持页面打开。</p>
                </>
              ) : (
                <>
                  <Icon name="cube" size={42} />
                  <h2>还没有导入模型</h2>
                  <p>支持 GLB / glTF / VRM，其他格式尽力而为。</p>
                </>
              )}
            </div>
          )}
          {busy && (
            <div className="busy-overlay">
              <span className="spinner" />
              <b>{phase || '正在转换…'}</b>
              <small>大模型可能需要几秒钟</small>
            </div>
          )}
        </div>

        <div className="result-body model-details">
          <WarningList warnings={warnings} />
          {result ? (
            <>
              <div className="report-stats">
                <div><span>输出三角面</span><b>{result.report.triangles.toLocaleString('zh-CN')}</b></div>
                <div><span>源三角面</span><b>{result.report.sourceTriangles.toLocaleString('zh-CN')}</b></div>
                <div><span>材质</span><b>{result.report.materials.length}</b></div>
                <div><span>贴图覆盖</span><b>{Math.round(result.textureCoverage * 100)}%</b></div>
              </div>
              <InstallHelp />
            </>
          ) : (
            <div className="inline-note">
              转换完成后会显示面数、贴图覆盖率与导出按钮。当前贴图固定 128 × 128，材质会自动拼进一张图集。
            </div>
          )}
        </div>
        {result && (
          <div className="result-footer">
            {stale && (
              <p className="stale-note" role="status"><Icon name="alert" size={14} /> 名称或转换设置已修改，请重新转换。</p>
            )}
            <DownloadButtons files={result.files} name={name.trim()} compact />
          </div>
        )}
      </section>
    </div>
  );
}
