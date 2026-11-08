import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import {
  createPreviewViewport,
  type PreviewViewport,
} from '../../web/shared/preview-viewport';
import { mapPreviewPose } from '../lib/preview-pose';
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
  const autoRotateRef = useRef(autoRotate);
  const fitKeyRef = useRef<unknown>(undefined);
  objectRef.current = object;
  litRef.current = lit;
  onPickRef.current = onPick;
  gridRef.current = grid;
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
        // Every preview resets to the player's front (-Z), regardless of how
        // the source model was authored.
        framing: { angle: { directionZ: -1 } },
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

  // Switching source/output swaps the object but must keep the user's camera
  // pose. Source and exported meshes use different units, so the switch keeps
  // the same apparent size and angle instead of reframing.
  useEffect(() => {
    const current = view.current;
    if (!current) return;
    // Only reframe when the content generation changes.
    const refit = fitKey === undefined || fitKeyRef.current !== fitKey;
    if (fitKey !== undefined) fitKeyRef.current = fitKey;
    current.content.updateMatrixWorld(true);
    const previousSphere = new THREE.Box3()
      .setFromObject(current.content)
      .getBoundingSphere(new THREE.Sphere());
    current.setObject(object, { frame: false });
    if (refit && object) {
      current.content.updateMatrixWorld(true);
      current.frameBox(new THREE.Box3().setFromObject(current.content), 'angle', {
        directionZ: -1,
        resetZoom: true,
      });
      return;
    }
    if (!object || previousSphere.radius <= 1e-6) return;
    current.content.updateMatrixWorld(true);
    const nextSphere = new THREE.Box3()
      .setFromObject(current.content)
      .getBoundingSphere(new THREE.Sphere());
    if (nextSphere.radius <= 1e-6) return;
    // Map camera and target through the same scale/recenter transform. Mapping
    // both (instead of only the camera) keeps a panned target and makes a
    // source -> output -> source round trip exact.
    const mapped = mapPreviewPose(
      {
        position: current.camera.position.clone(),
        target: current.controls.target.clone(),
      },
      previousSphere,
      nextSphere,
    );
    current.camera.position.copy(mapped.position);
    current.controls.target.copy(mapped.target);
    current.controls.update();
    current.invalidate();
  }, [object, fitKey]);

  const toggleLighting = () => {
    const next = !lit;
    setLit(next);
    rememberLighting(next);
    view.current?.setLit(next);
  };

  /** Reset to the player's front, no matter which model is shown. */
  const resetView = () => {
    const current = view.current;
    if (!current) return;
    current.content.updateMatrixWorld(true);
    current.frameBox(new THREE.Box3().setFromObject(current.content), 'angle', {
      directionZ: -1,
      resetZoom: true,
    });
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
              onClick={resetView}
            >
              重置视角
            </button>
          </div>
        </>
      )}
    </div>
  );
}
