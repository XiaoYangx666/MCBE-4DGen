import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { fitPreviewCamera } from '../../web/shared/poly-mesh-preview';
import {
  createPreviewLighting,
  type PreviewLighting,
} from '../../web/shared/preview-lighting';
import { Icon } from './Icons';

const LIGHTING_KEY = '4dgen:preview-lighting';

/** Flat, texture-accurate rendering is the default; lighting is opt-in. */
function initialLighting() {
  try {
    return localStorage.getItem(LIGHTING_KEY) === 'on';
  } catch {
    return false;
  }
}

function rememberLighting(value: boolean) {
  try {
    localStorage.setItem(LIGHTING_KEY, value ? 'on' : 'off');
  } catch { /* storage can be unavailable in private mode */ }
}

interface ViewportProps {
  object: THREE.Object3D | null;
  className?: string;
  grid?: boolean;
  autoRotate?: boolean;
}

interface ViewState {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  current: THREE.Object3D | null;
  lighting: PreviewLighting;
  fit: () => void;
}

// Metalness is restored when lighting is switched back on. A WeakMap keeps the
// original value next to materials shared by several meshes.
const metalnessBackup = new WeakMap<THREE.Material, number>();

/** Flat mode strips metalness, since metals go black without a light probe. */
function applyMetalness(view: ViewState, lit: boolean) {
  const root = view.current;
  if (!root) return;
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      const standard = material as THREE.MeshStandardMaterial;
      if (typeof standard.metalness !== 'number') continue;
      if (!lit) {
        if (!metalnessBackup.has(material)) metalnessBackup.set(material, standard.metalness);
        // Metals have no diffuse response to ambient light and would go black.
        standard.metalness = 0;
      } else {
        const saved = metalnessBackup.get(material);
        if (saved !== undefined) {
          standard.metalness = saved;
          metalnessBackup.delete(material);
        }
      }
    }
  });
}

export function Viewport({ object, className, grid = false, autoRotate = false }: ViewportProps) {
  const host = useRef<HTMLDivElement>(null);
  const state = useRef<ViewState | null>(null);
  const [failed, setFailed] = useState(false);
  const [lit, setLit] = useState(initialLighting);
  const litRef = useRef(lit);
  litRef.current = lit;

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 10_000);
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance',
      });
    } catch {
      setFailed(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
    element.append(renderer.domElement);

    const lighting = createPreviewLighting(renderer, scene);

    const helper = grid ? new THREE.GridHelper(64, 16, 0x3c4660, 0x252b38) : null;
    if (helper) {
      (helper.material as THREE.Material).transparent = true;
      (helper.material as THREE.Material).opacity = 0.5;
      scene.add(helper);
    }

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.09;
    controls.autoRotate = autoRotate;
    controls.autoRotateSpeed = 1.2;
    controls.maxPolarAngle = Math.PI * 0.92;

    const fit = () => {
      const view = state.current;
      if (!view?.current) return;
      fitPreviewCamera(view.camera, view.controls, view.current, {
        view: 'angle',
        strategy: 'max-dimension',
        padding: 1.45,
      });
    };

    const view: ViewState = {
      renderer,
      scene,
      camera,
      controls,
      current: null,
      lighting,
      fit,
    };
    state.current = view;
    lighting.apply(litRef.current);
    applyMetalness(view, litRef.current);

    const resize = () => {
      const width = Math.max(1, element.clientWidth);
      const height = Math.max(1, element.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();

    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      if (!element.clientWidth || !element.clientHeight) return;
      controls.update();
      renderer.render(scene, camera);
    };
    tick();

    const contextLost = (event: Event) => {
      event.preventDefault();
      cancelAnimationFrame(frame);
      setFailed(true);
    };
    renderer.domElement.addEventListener('webglcontextlost', contextLost);

    return () => {
      cancelAnimationFrame(frame);
      renderer.domElement.removeEventListener('webglcontextlost', contextLost);
      observer.disconnect();
      controls.dispose();
      if (view.current) {
        applyMetalness(view, true);
        scene.remove(view.current);
      }
      renderer.dispose();
      renderer.domElement.remove();
      helper?.geometry.dispose();
      if (helper) (helper.material as THREE.Material).dispose();
      lighting.dispose();
      state.current = null;
    };
  }, [grid, autoRotate]);

  useEffect(() => {
    const view = state.current;
    if (!view) return;
    if (view.current && view.current !== object) {
      applyMetalness(view, true);
      view.scene.remove(view.current);
      view.current = null;
      view.lighting.apply(litRef.current);
    }
    view.current = object;
    if (object) {
      view.scene.add(object);
      view.lighting.apply(litRef.current, object);
      view.lighting.fit(object);
      applyMetalness(view, litRef.current);
      view.fit();
    }
  }, [object]);

  const toggleLighting = () => {
    const next = !lit;
    setLit(next);
    rememberLighting(next);
    const view = state.current;
    if (view) {
      view.lighting.apply(next, view.current);
      applyMetalness(view, next);
    }
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
          <button
            type="button"
            className="viewport-toggle"
            aria-pressed={lit}
            title={lit ? '关闭光照，按贴图原色显示' : '开启光照，查看立体明暗'}
            onClick={toggleLighting}
          >
            <Icon name="sun" size={12} /> 光照 {lit ? '开' : '关'}
          </button>
          <button type="button" className="viewport-reset" onClick={() => state.current?.fit()}>
            重置视角
          </button>
        </>
      )}
    </div>
  );
}
