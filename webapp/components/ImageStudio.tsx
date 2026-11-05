import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ImageSourcePicker } from './ImageSourcePicker';
import { DownloadButtons } from './Common';
import { Icon } from '../../web/shared/Icons';
import { createImageSkin, type ImageSkinResult } from '../engine/image-skin';
import { nextFrame } from '../engine/frame';
import { useSkinPack } from '../lib/pack-context';
import { SKIN_NAME_MAX_LENGTH } from '../../src/skin-pack-files.ts';
import { isCompactViewport } from '../lib/viewport';
import { useCutoutPreview } from '../lib/use-cutout-preview';
import {
  IMAGE_SKIN_HEIGHT_DEFAULT,
  IMAGE_SKIN_HEIGHT_MAX,
  IMAGE_SKIN_HEIGHT_MIN,
  clampImageSkinHeight,
} from '../lib/image-skin-options';

const GeometryPreview = lazy(async () => {
  const module = await import('./SkinPreview');
  return { default: module.GeometryPreview };
});

const DEFAULT_NAME = '我的 4D 皮肤';

export function ImageStudio() {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState(DEFAULT_NAME);
  const [height, setHeight] = useState(IMAGE_SKIN_HEIGHT_DEFAULT);
  const [cutout, setCutout] = useState(false);
  const [tolerance, setTolerance] = useState(30);
  const { preview: cutoutPreview, busy: cutoutBusy } = useCutoutPreview(file, cutout, tolerance);
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
  const updateHeight = (value: number) => setHeight(clampImageSkinHeight(value));

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
            <ImageSourcePicker
              file={file}
              cutout={cutout}
              tolerance={tolerance}
              cutoutPreview={cutoutPreview}
              cutoutBusy={cutoutBusy}
              onFiles={choose}
              onClear={() => setFile(null)}
              onCutoutChange={setCutout}
              onToleranceChange={setTolerance}
            />

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
                min={IMAGE_SKIN_HEIGHT_MIN}
                max={IMAGE_SKIN_HEIGHT_MAX}
                value={height}
                onChange={(event) => updateHeight(Number(event.target.value))}
              />
            </label>
            <input
              className="height-range"
              type="range"
              min={IMAGE_SKIN_HEIGHT_MIN}
              max={IMAGE_SKIN_HEIGHT_MAX}
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
