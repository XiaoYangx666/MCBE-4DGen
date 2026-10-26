import { useEffect, useRef, useState } from 'react';
import type * as THREE from 'three';
import {
  createPreviewViewport,
  type PreviewViewport,
} from '../../web/shared/preview-viewport';
import { Icon } from './Icons';

// Lighting starts off on every page load. The toggle is remembered for the
// current session only, so it survives mode switches without becoming sticky.
let lightingPreference = false;

/** Flat, texture-accurate rendering is the default; lighting is opt-in. */
function initialLighting() {
  return lightingPreference;
}

function rememberLighting(value: boolean) {
  lightingPreference = value;
}

interface ViewportProps {
  object: THREE.Object3D | null;
  className?: string;
  grid?: boolean;
  autoRotate?: boolean;
  /** Source models are authored +Z; exported packs and image skins face -Z. */
  facing?: 'source' | 'output';
}

export function Viewport({
  object,
  className,
  grid = false,
  autoRotate = false,
  facing = 'output',
}: ViewportProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<PreviewViewport | null>(null);
  const [failed, setFailed] = useState(false);
  const [lit, setLit] = useState(initialLighting);
  const objectRef = useRef(object);
  const litRef = useRef(lit);
  objectRef.current = object;
  litRef.current = lit;

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    setFailed(false);
    let created: PreviewViewport;
    try {
      created = createPreviewViewport({
        host: element,
        alpha: true,
        grid: grid
          ? {
              size: 64,
              divisions: 16,
              color: 0x3c4660,
              centerColor: 0x252b38,
              opacity: 0.5,
            }
          : false,
        lit: litRef.current,
        renderMode: 'continuous',
        controls: {
          autoRotate,
          autoRotateSpeed: 1.2,
          maxPolarAngle: Math.PI * 0.92,
        },
        orientation: { direction: -1, label: '玩家正前方（−Z）' },
        // Source models are usually authored facing +Z; exported skins use the
        // Bedrock -Z front, so their default angle must also start there.
        framing: { angle: { directionZ: facing === 'source' ? 1 : -1 } },
        onContextLost: () => setFailed(true),
      });
    } catch {
      setFailed(true);
      return;
    }
    view.current = created;
    created.setObject(objectRef.current);
    return () => {
      view.current = null;
      created.dispose();
    };
  }, [grid, autoRotate, facing]);

  useEffect(() => {
    view.current?.setObject(object);
  }, [object]);

  const toggleLighting = () => {
    const next = !lit;
    setLit(next);
    rememberLighting(next);
    view.current?.setLit(next);
  };

  return (
    <div className={`viewport ${className ?? ''}`} ref={host}>
      {failed ? (
        <div className="viewport-fallback">
          <b>三维预览不可用</b>
          <span>当前浏览器没有启用 WebGL。转换和下载仍然可以继续。</span>
        </div>
      ) : (
        <>
          <div className="viewport-hint">拖拽旋转 · 滚轮缩放</div>
          <div className="viewport-orientation">正面检查：脸和胸前应朝向绿色箭头</div>
          <button
            type="button"
            className="viewport-toggle"
            aria-pressed={lit}
            title={lit ? '关闭光照，按贴图原色显示' : '开启光照，查看立体明暗'}
            onClick={toggleLighting}
          >
            <Icon name="sun" size={12} /> 光照 {lit ? '开' : '关'}
          </button>
          <div className="viewport-actions">
            <button
              type="button"
              className="viewport-reset viewport-front"
              title="切换到角色正面检查"
              onClick={() => view.current?.fit('front')}
            >
              正面检查
            </button>
            <button
              type="button"
              className="viewport-reset"
              onClick={() => view.current?.reset()}
            >
              重置视角
            </button>
          </div>
        </>
      )}
    </div>
  );
}
