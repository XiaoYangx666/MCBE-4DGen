import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { DropZone } from './DropZone';
import { DownloadButtons } from './Common';
import { Icon } from '../../web/shared/Icons';
import {
  createImageSkin,
  previewImageCutout,
  type CutoutPreview,
  type ImageSkinResult,
} from '../engine/image-skin';
import { nextFrame } from '../engine/frame';
import { useSkinPack } from '../lib/pack-context';
import { formatBytes } from '../../web/shared/format';
import { SKIN_NAME_MAX_LENGTH } from '../../src/skin-pack-files.ts';
import { isCompactViewport } from '../lib/viewport';

const GeometryPreview = lazy(async () => {
  const module = await import('./SkinPreview');
  return { default: module.GeometryPreview };
});

const DEFAULT_NAME = '我的 4D 皮肤';

export function ImageStudio() {
  const [file, setFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [name, setName] = useState(DEFAULT_NAME);
  const [height, setHeight] = useState(32);
  const [cutout, setCutout] = useState(false);
  const [tolerance, setTolerance] = useState(30);
  const [cutoutPreview, setCutoutPreview] = useState<CutoutPreview | null>(null);
  const [cutoutBusy, setCutoutBusy] = useState(false);
  const [result, setResult] = useState<ImageSkinResult | null>(null);
  const [resultKey, setResultKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [packBusy, setPackBusy] = useState(false);
  const [packMessage, setPackMessage] = useState('');
  const [packError, setPackError] = useState('');
  const customName = useRef(false);
  const resultRef = useRef<HTMLElement>(null);
  const { addSkin } = useSkinPack();

  useEffect(() => {
    if (!file) {
      setSourceUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setSourceUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    if (!file || !cutout) {
      setCutoutPreview(null);
      setCutoutBusy(false);
      return;
    }
    let active = true;
    setCutoutBusy(true);
    const timer = window.setTimeout(() => {
      void previewImageCutout(file, { tolerance })
        .then((preview) => {
          if (active) setCutoutPreview(preview);
        })
        .catch(() => {
          if (active) setCutoutPreview(null);
        })
        .finally(() => {
          if (active) setCutoutBusy(false);
        });
    }, 160);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [file, cutout, tolerance]);

  useEffect(() => {
    setPackMessage('');
    setPackError('');
  }, [result]);

  useEffect(() => {
    if (!result || !isCompactViewport()) return;
    const behavior = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior, block: 'start' }));
  }, [result]);

  const key = `${name.trim()}|${height}|${cutout ? `cutout-${tolerance}` : 'original'}`;
  const stale = !!result && resultKey !== key;
  const previewSrc = cutout && cutoutPreview ? cutoutPreview.url : sourceUrl;
  const updateHeight = (value: number) => {
    if (!Number.isFinite(value) || value <= 0) {
      setHeight(32);
      return;
    }
    setHeight(Math.min(64, Math.max(8, Math.round(value))));
  };

  const addToPack = async () => {
    if (!result || packBusy) return;
    setPackBusy(true);
    setPackError('');
    try {
      const added = await addSkin({
        name: name.trim() || '图片皮肤',
        geometry: result.geometry,
        png: result.png,
        triangles: 4,
        source: 'image',
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

  const choose = (files: File[]) => {
    const next = files[0];
    if (!next) return;
    if (!next.type.startsWith('image/') && !/\.(png|jpe?g|webp|gif|bmp|svg|avif)$/i.test(next.name)) {
      setError('请选择 PNG、JPEG、WebP、GIF、BMP、SVG 或 AVIF 图片。');
      return;
    }
    if (next.size > 40 * 1024 * 1024) {
      setError('图片超过 40 MB，请先压缩后再试。');
      return;
    }
    setFile(next);
    setResult(null);
    setError(null);
    if (!customName.current) setName(next.name.replace(/\.[^.]+$/, '').slice(0, 60) || DEFAULT_NAME);
  };

  const generate = async () => {
    if (!file || busy) return;
    setBusy(true);
    setError(null);
    setPhase('读取图片…');
    try {
      await nextFrame();
      const created = await createImageSkin(file, {
        name: name.trim(),
        height,
        cutout: { enabled: cutout, tolerance },
      });
      setResult(created);
      setResultKey(key);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
      setPhase('');
    }
  };

  return (
    <div className="studio-layout">
      <section className="studio-settings">
        <div className="settings-body">
          <div className="template-icon"><Icon name="image" size={30} /></div>
          <h2>图片 · 平面皮肤</h2>

          <fieldset disabled={busy}>
            {file && sourceUrl ? (
              <div className="image-pick">
                <div className="image-preview-wrap">
                  <img
                    className="image-source-preview"
                    src={previewSrc ?? sourceUrl}
                    alt={cutout ? '去除背景后的图片' : '待转换的图片'}
                  />
                  {cutout && cutoutBusy && (
                    <span className="image-preview-status"><span className="spinner" /> 识别背景…</span>
                  )}
                </div>
                <div className="image-pick-meta">
                  <span title={file.name}>{file.name}</span>
                  <small>{formatBytes(file.size)}</small>
                  <button type="button" className="text-button" onClick={() => setFile(null)}>更换图片</button>
                </div>
                {cutout && cutoutPreview && (
                  <p className={`cutout-status${cutoutPreview.detected ? '' : ' is-muted'}`} role="status">
                    {cutoutPreview.detected
                      ? cutoutPreview.removedRatio > 0.98
                        ? '几乎整张图片都被识别为背景，请降低容差。'
                        : `已去除背景 ${Math.round(cutoutPreview.removedRatio * 100)}%`
                      : '没有识别到可去除的纯色背景，图片将保持原样。'}
                  </p>
                )}
              </div>
            ) : (
              <DropZone
                accept="image/*,.png,.jpg,.jpeg,.webp,.gif,.bmp,.svg,.avif"
                title="拖入图片，或点击选择"
                hint="PNG / JPEG / WebP / GIF / SVG · 最大 40 MB"
                icon="image"
                onFiles={choose}
              />
            )}

            <label className="cutout-toggle">
              <input
                type="checkbox"
                checked={cutout}
                onChange={(event) => setCutout(event.target.checked)}
              />
              <span>
                <b>自动去除纯色背景</b>
                <small>白底、绿幕或单色背景会变成透明</small>
              </span>
            </label>
            {cutout && (
              <div className="field-label cutout-tolerance">
                <span className="cutout-tolerance-head">
                  抠图容差
                  <output>{tolerance}%</output>
                </span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={tolerance}
                  onChange={(event) => setTolerance(Number(event.target.value))}
                />
                <span className="field-help">边缘残留背景时调高；主体被误删时调低。</span>
              </div>
            )}

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
              平面高度
              <input
                type="number"
                min={8}
                max={64}
                value={height}
                onChange={(event) => updateHeight(Number(event.target.value))}
              />
            </label>
            <input
              className="height-range"
              type="range"
              min={8}
              max={64}
              step={1}
              value={height}
              aria-label="平面高度"
              onChange={(event) => updateHeight(Number(event.target.value))}
            />
          </fieldset>
        </div>

        <div className="settings-footer">
          {error && <p className="error-message" role="alert"><Icon name="alert" size={15} />{error}</p>}
          <button type="button" className="primary" disabled={!file || busy || !name.trim()} onClick={() => void generate()}>
            <Icon name={busy ? 'reset' : 'spark'} size={15} className={busy ? 'spin' : undefined} />
            {busy ? phase || '正在生成…' : result ? '重新生成' : '生成图片皮肤'}
          </button>
        </div>
      </section>

      <section className="studio-result" ref={resultRef}>
        <div className="result-header">
          <div>
            <h2>{result ? name.trim() : '成品预览'}</h2>
            <p>
              {result
                ? `${result.width.toFixed(1)} × ${result.height} · 4 三角面 · 双面 · 源图 ${result.sourceWidth}×${result.sourceHeight}${
                    result.backgroundDetected
                      ? ` · 已去除背景 ${Math.round(result.backgroundRemoved * 100)}%`
                      : ''
                  }`
                : '生成后在这里显示 3D 预览。'}
            </p>
          </div>
          {result && <span className="badge">128 × 128</span>}
        </div>

        {result ? (
          <>
          <div className="result-body">
            <div className="skin-stage is-3d">
              <Suspense
                fallback={(
                  <div className="preview-loading">
                    <span className="spinner" /> 正在加载三维预览…
                  </div>
                )}
              >
                <GeometryPreview geometry={result.geometry} textureUrl={result.pngUrl} mirrorX={false} />
              </Suspense>
            </div>
          </div>
          <div className="result-footer">
            {stale && (
              <p className="stale-note" role="status"><Icon name="alert" size={14} /> 名称、高度或抠图设置已修改，请重新生成。</p>
            )}
            <div className="pack-add-row">
              <button type="button" className="button-link" disabled={packBusy || stale} onClick={() => void addToPack()}>
                <Icon name={packBusy ? 'reset' : 'cube'} size={14} className={packBusy ? 'spin' : undefined} />
                {packBusy ? '正在加入…' : '加入皮肤包'}
              </button>
              {packMessage && (
                <span className="pack-save-status">{packMessage} <a href="#pack">查看</a></span>
              )}
            </div>
            {packError && <p className="error-message" role="alert"><Icon name="alert" size={15} />{packError}</p>}
            <DownloadButtons files={result.files} name={name.trim()} disabled={stale} />
          </div>
          </>
        ) : (
          <div className="empty-state">
            <Icon name="image" size={42} />
            <h2>选择一张图片</h2>
            <p>立绘、表情包、透明 PNG 都可以；纯色背景也能一键抠掉。</p>
          </div>
        )}
      </section>
    </div>
  );
}
