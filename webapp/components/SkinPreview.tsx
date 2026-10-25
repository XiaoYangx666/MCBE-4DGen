import { useEffect, useRef, useState } from 'react';
import type * as THREE from 'three';
import { buildGeometryPreview } from '../lib/output-preview';
import type { StoredSkin } from '../lib/pack-types';
import { Icon } from './Icons';
import { Viewport } from './Viewport';

interface GeometryPreviewProps {
  geometry: StoredSkin['geometry'];
  textureUrl: string;
  grid?: boolean;
}

/** Rebuild the exported poly_mesh in three.js; shared by the pack and image studios. */
export function GeometryPreview({ geometry, textureUrl, grid = false }: GeometryPreviewProps) {
  const [object, setObject] = useState<THREE.Object3D | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let created: ReturnType<typeof buildGeometryPreview> | null = null;
    try {
      created = buildGeometryPreview(geometry, textureUrl);
      setObject(created.object);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
    return () => {
      created?.dispose();
      setObject(null);
    };
  }, [geometry, textureUrl]);

  if (error) {
    return (
      <div className="viewport-fallback">
        <b>无法预览这个皮肤</b>
        <span>{error}</span>
      </div>
    );
  }
  if (!object) {
    return (
      <div className="preview-loading">
        <span className="spinner" /> 正在准备三维预览…
      </div>
    );
  }
  return <Viewport object={object} grid={grid} />;
}

const SOURCE_LABEL: Record<StoredSkin['source'], string> = {
  image: '图片皮肤',
  model: '模型皮肤',
  import: '导入皮肤',
};

interface SkinPreviewDialogProps {
  skin: StoredSkin;
  onClose: () => void;
}

export function SkinPreviewDialog({ skin, onClose }: SkinPreviewDialogProps) {
  const [textureUrl, setTextureUrl] = useState('');
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const copy = skin.png.slice();
    const buffer = copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength) as ArrayBuffer;
    const next = URL.createObjectURL(new Blob([buffer], { type: 'image/png' }));
    setTextureUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [skin.png]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    closeButton.current?.focus({ preventScroll: true });
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="preview-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="skin-preview-title"
      >
        <header className="preview-header">
          <div>
            <h2 id="skin-preview-title">{skin.name}</h2>
            <p>
              {SOURCE_LABEL[skin.source]} · {skin.triangles.toLocaleString('zh-CN')} 三角面 ·
              实际导出的 poly_mesh
            </p>
          </div>
          <button
            ref={closeButton}
            type="button"
            className="icon-button"
            aria-label="关闭预览"
            onClick={onClose}
          >
            <Icon name="close" size={16} />
          </button>
        </header>
        <div className="preview-stage">
          {textureUrl && <GeometryPreview geometry={skin.geometry} textureUrl={textureUrl} grid />}
        </div>
        <footer className="preview-footer">
          实际导出的 poly_mesh · 点击背景或按 Esc 关闭
        </footer>
      </div>
    </div>
  );
}
