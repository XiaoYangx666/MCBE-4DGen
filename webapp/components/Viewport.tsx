import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import {
  createPreviewViewport,
  type PreviewViewport,
} from '../../web/shared/preview-viewport';
import { Icon } from '../../web/shared/Icons';

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
  /** The compact workbench drops the front check to keep controls minimal. */
  showFrontCheck?: boolean;
  /** Called with every material under the pointer on a click (not a drag). */
  onPick?: (materials: THREE.Material[]) => void;
}

export function Viewport({
  object,
  className,
  grid = false,
  autoRotate = false,
  facing = 'output',
  showFrontCheck = true,
  onPick,
}: ViewportProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<PreviewViewport | null>(null);
  const [failed, setFailed] = useState(false);
  const [lit, setLit] = useState(initialLighting);
  const objectRef = useRef(object);
  const litRef = useRef(lit);
  const onPickRef = useRef(onPick);
  objectRef.current = object;
  litRef.current = lit;
  onPickRef.current = onPick;

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
          // The scene is framed to fit; pinch/scroll zoom is disabled on mobile
          // and desktop alike so the model stays at a readable scale.
          enableZoom: false,
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

    const canvas = created.renderer.domElement;
    const ray = new THREE.Raycaster();
    let down: [number, number] | null = null;
    const pointerDown = (event: PointerEvent) => {
      down = [event.clientX, event.clientY];
    };
    const pointerUp = (event: PointerEvent) => {
      const pick = onPickRef.current;
      if (!pick || !down) return;
      const moved = Math.hypot(event.clientX - down[0], event.clientY - down[1]);
      down = null;
      if (moved > 4) return;
      const rect = canvas.getBoundingClientRect();
      ray.setFromCamera(
        new THREE.Vector2(
          ((event.clientX - rect.left) / rect.width) * 2 - 1,
          (-(event.clientY - rect.top) / rect.height) * 2 + 1,
        ),
        created.camera,
      );
      const hits = ray
        .intersectObject(created.content, true)
        .filter((hit) => hit.object.visible && (hit.object as THREE.Mesh).isMesh);
      if (!hits.length) return;
      const first = hits[0]!;
      const tolerance = Math.max(0.001, first.distance * 0.02);
      const materials: THREE.Material[] = [];
      for (const hit of hits) {
        if (hit.distance > first.distance + tolerance) break;
        const mesh = hit.object as THREE.Mesh;
        const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const index = hit.face?.materialIndex;
        const material =
          index !== undefined && list[index] ? list[index] : list[0];
        if (material && !materials.includes(material)) materials.push(material);
      }
      if (materials.length) pick(materials);
    };
    canvas.addEventListener('pointerdown', pointerDown);
    canvas.addEventListener('pointerup', pointerUp);

    return () => {
      canvas.removeEventListener('pointerdown', pointerDown);
      canvas.removeEventListener('pointerup', pointerUp);
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
          <div className="viewport-hint">拖拽旋转</div>
          <div className="viewport-orientation">正面检查：脸和胸前应朝向绿色箭头</div>
          <button
            type="button"
            className="viewport-toggle"
            aria-pressed={lit}
            title={lit ? '关闭光照，按贴图原色显示' : '开启光照，查看立体明暗'}
            onClick={toggleLighting}
          >
            <Icon name="sun" size={14} />
          </button>
          <div className="viewport-actions">
            {showFrontCheck && (
              <button
                type="button"
                className="viewport-reset"
                title="切换到角色正面检查"
                onClick={() => view.current?.fit('front')}
              >
                正面检查
              </button>
            )}
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
