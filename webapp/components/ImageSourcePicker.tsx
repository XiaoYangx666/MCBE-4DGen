import { useEffect, useState } from 'react';
import type { CutoutPreview } from '../engine/image-skin';
import { formatBytes } from '../../web/shared/format';
import { DropZone } from './DropZone';

interface ImageSourcePickerProps {
  file: File | null;
  cutout: boolean;
  tolerance: number;
  cutoutPreview: CutoutPreview | null;
  cutoutBusy: boolean;
  onFiles: (files: File[]) => void;
  onClear: () => void;
  onCutoutChange: (enabled: boolean) => void;
  onToleranceChange: (tolerance: number) => void;
}

/**
 * Image drop/preview plus the cutout controls. The object URL lives here so the
 * studio only owns the selected file and the generated result.
 */
export function ImageSourcePicker({
  file,
  cutout,
  tolerance,
  cutoutPreview,
  cutoutBusy,
  onFiles,
  onClear,
  onCutoutChange,
  onToleranceChange,
}: ImageSourcePickerProps) {
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setSourceUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setSourceUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const previewUrl = cutout && cutoutPreview ? cutoutPreview.url : sourceUrl;

  return (
    <>
      {file && sourceUrl ? (
        <div className="image-pick">
          <div className="image-preview-wrap">
            <img
              className="image-source-preview"
              src={previewUrl ?? sourceUrl}
              alt={cutout ? '去除背景后的图片' : '待转换的图片'}
            />
            {cutout && cutoutBusy && (
              <span className="image-preview-status"><span className="spinner" /> 识别背景…</span>
            )}
          </div>
          <div className="image-pick-meta">
            <span title={file.name}>{file.name}</span>
            <small>{formatBytes(file.size)}</small>
            <button type="button" className="text-button" onClick={onClear}>更换图片</button>
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
          onFiles={onFiles}
        />
      )}

      <label className="cutout-toggle">
        <input
          type="checkbox"
          checked={cutout}
          onChange={(event) => onCutoutChange(event.target.checked)}
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
            onChange={(event) => onToleranceChange(Number(event.target.value))}
          />
          <span className="field-help">边缘残留背景时调高；主体被误删时调低。</span>
        </div>
      )}
    </>
  );
}
