import { useEffect, useRef, useState } from 'react';
import { DropZone } from './DropZone';
import { DownloadButtons, InstallHelp } from './Common';
import { Icon } from './Icons';
import { createImageSkin, type ImageSkinResult } from '../lib/image-skin';
import { nextFrame } from '../lib/convert';
import { formatBytes, isCompactViewport } from '../lib/download';

const DEFAULT_NAME = '我的 4D 皮肤';

export function ImageStudio() {
  const [file, setFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [name, setName] = useState(DEFAULT_NAME);
  const [height, setHeight] = useState(32);
  const [result, setResult] = useState<ImageSkinResult | null>(null);
  const [resultKey, setResultKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const customName = useRef(false);
  const resultRef = useRef<HTMLElement>(null);

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
    if (!result || !isCompactViewport()) return;
    const behavior = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior, block: 'start' }));
  }, [result]);

  const key = `${name.trim()}|${height}`;
  const stale = !!result && resultKey !== key;

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
      const created = await createImageSkin(file, { name: name.trim(), height });
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
          <p>完整图片贴到竖直平面，两面可见。保留比例和透明背景，跟随身体移动。</p>

          <fieldset disabled={busy}>
            {file && sourceUrl ? (
              <div className="image-pick">
                <img className="image-source-preview" src={sourceUrl} alt="待转换的图片" />
                <div className="image-pick-meta">
                  <span title={file.name}>{file.name}</span>
                  <small>{formatBytes(file.size)}</small>
                  <button type="button" className="text-button" onClick={() => setFile(null)}>更换图片</button>
                </div>
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
              平面高度
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
              aria-label="平面高度"
              onChange={(event) => setHeight(Number(event.target.value))}
            />
            <p className="help">默认 32，约为玩家身高。宽度按图片比例计算，输出贴图固定 128 × 128。</p>
          </fieldset>
        </div>

        <div className="settings-footer">
          {error && <p className="error-message" role="alert"><Icon name="alert" size={15} />{error}</p>}
          <button type="button" className="primary" disabled={!file || busy || !name.trim()} onClick={() => void generate()}>
            <Icon name={busy ? 'reset' : 'spark'} size={15} className={busy ? 'spin' : undefined} />
            {busy ? phase || '正在生成…' : result ? '重新生成' : '生成图片皮肤'}
          </button>
          <p className="privacy-note"><Icon name="shield" size={14} /> 图片只在浏览器内处理，不会上传。</p>
        </div>
      </section>

      <section className="studio-result" ref={resultRef}>
        <div className="result-header">
          <div>
            <h2>{result ? name.trim() : '成品预览'}</h2>
            <p>
              {result
                ? `${result.width.toFixed(1)} × ${result.height} · 4 三角面 · 双面 · 源图 ${result.sourceWidth}×${result.sourceHeight}`
                : '导入图片并生成后，在这里检查平面比例与透明区域。'}
            </p>
          </div>
          {result && <span className="badge">128 × 128</span>}
        </div>

        {result ? (
          <>
          <div className="result-body">
            <div className="skin-stage">
              <img src={result.pngUrl} alt="生成的皮肤贴图" />
            </div>
            <InstallHelp />
          </div>
          <div className="result-footer">
            {stale && (
              <p className="stale-note" role="status"><Icon name="alert" size={14} /> 名称或高度已修改，请重新生成。</p>
            )}
            <DownloadButtons files={result.files} name={name.trim()} />
          </div>
          </>
        ) : (
          <div className="empty-state">
            <Icon name="image" size={42} />
            <h2>一张图片，一张平面皮肤</h2>
            <p>适合立绘、表情包、标志与透明 PNG。生成后可直接下载 .mcpack。</p>
          </div>
        )}
      </section>
    </div>
  );
}
