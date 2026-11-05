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
  /**
   * Identity of the content generation. The viewport refits only when this
   * changes, so switching between source and output keeps the camera pose.
   * Omit it to keep the old behaviour (frame every attached object).
   */
  fitKey?: unknown;
}

export function Viewport({
  object,
  className,
  grid = false,
  autoRotate = false,
  facing = 'output',
  showFrontCheck = true,
  onPick,
  fitKey,
}: ViewportProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<PreviewViewport | null>(null);
  const [failed, setFailed] = useState(false);
  const [lit, setLit] = useState(initialLighting);
  const objectRef = useRef(object);
  const litRef = useRef(lit);
  const onPickRef = useRef(onPick);
  const gridRef = useRef(grid);
  const facingRef = useRef(facing);
  const autoRotateRef = useRef(autoRotate);
  const fitKeyRef = useRef<unknown>(undefined);
  objectRef.current = object;
  litRef.current = lit;
  onPickRef.current = onPick;
  gridRef.current = grid;
  facingRef.current = facing;
  autoRotateRef.current = autoRotate;

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    setFailed(false);
    let created: PreviewViewport;
    try {
      created = createPreviewViewport({
        host: element,
        alpha: true,
        // The grid is always created and toggled by visibility, so switching
        // source/output does not dispose and rebuild the WebGL viewport.
        grid: {
          size: 64,
          divisions: 16,
          color: 0x3c4660,
          centerColor: 0x252b38,
          opacity: 0.5,
        },
        lit: litRef.current,
        // Mobile GPUs (and tight shadow bounds after hiding parts) can turn
        // the whole model black through self-shadow acne. The ground plane
        // still receives the cast shadow, which is what sells the depth.
        selfShadow: false,
        renderMode: 'continuous',
        controls: {
          autoRotate: autoRotateRef.current,
          autoRotateSpeed: 1.2,
          maxPolarAngle: Math.PI * 0.92,
          // Keep wheel and pinch zoom available; the scene still frames itself
          // to fit when a new object is attached.
          enableZoom: true,
        },
        orientation: { direction: -1, label: '玩家正前方（−Z）' },
        // Source models are usually authored facing +Z; exported skins use the
        // Bedrock -Z front, so their default angle must also start there.
        framing: { angle: { directionZ: facingRef.current === 'source' ? 1 : -1 } },
        onContextLost: () => setFailed(true),
      });
    } catch {
      setFailed(true);
      return;
    }
    if (created.grid) created.grid.visible = gridRef.current;
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
  }, []);

  useEffect(() => {
    if (view.current) view.current.controls.autoRotate = autoRotate;
  }, [autoRotate]);

  useEffect(() => {
    const current = view.current;
    if (!current) return;
    if (current.grid) current.grid.visible = grid;
    current.invalidate();
  }, [grid]);

  // Source models face +Z, exported skins face -Z. Rotating the orbit by half a
  // turn keeps the same side of the character in view when switching modes,
  // instead of silently showing the back of the exported mesh.
  const previousFacing = useRef(facing);
  useEffect(() => {
    const current = view.current;
    if (!current) {
      previousFacing.current = facing;
      return;
    }
    if (previousFacing.current === facing) return;
    previousFacing.current = facing;
    const offset = current.camera.position.clone().sub(current.controls.target);
    offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
    current.camera.position.copy(current.controls.target).add(offset);
    current.controls.update();
    current.invalidate();
  }, [facing]);

  useEffect(() => {
    const current = view.current;
    if (!current) return;
    // Only reframe when the content generation changes. Switching source/output
    // swaps the object but must keep the user's camera pose.
    const refit = fitKey === undefined || fitKeyRef.current !== fitKey;
    if (fitKey !== undefined) fitKeyRef.current = fitKey;
    // Source and exported meshes use very different units (metres vs blocks).
    // Remember the old bounds so the switch can keep the same apparent size.
    current.content.updateMatrixWorld(true);
    const previous = new THREE.Box3().setFromObject(current.content);
    const previousSphere = previous.getBoundingSphere(new THREE.Sphere());
    current.setObject(object, { frame: false });
    if (refit && object) {
      current.content.updateMatrixWorld(true);
      current.frameBox(new THREE.Box3().setFromObject(current.content), 'angle', {
        directionZ: facing === 'source' ? 1 : -1,
      });
    } else if (object && previousSphere.radius > 1e-6) {
      current.content.updateMatrixWorld(true);
      const next = new THREE.Box3()
        .setFromObject(current.content)
        .getBoundingSphere(new THREE.Sphere());
      if (next.radius > 1e-6) {
        const offset = current.camera.position.clone().sub(previousSphere.center);
        offset.multiplyScalar(next.radius / previousSphere.radius);
        current.controls.target.copy(next.center);
        current.camera.position.copy(next.center).add(offset);
        current.controls.update();
        current.invalidate();
      }
    }
  }, [object, fitKey, facing]);

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
          <div className="viewport-hint">拖拽旋转 · 滚轮/双指缩放</div>
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
