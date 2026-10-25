import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { fitPreviewCamera } from '../../web/shared/poly-mesh-preview';
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
  lights: {
    hemi: THREE.HemisphereLight;
    key: THREE.DirectionalLight;
    fill: THREE.DirectionalLight;
    rim: THREE.DirectionalLight;
    ambient: THREE.AmbientLight;
  };
  envMap: THREE.Texture;
  shadowPlane: THREE.Mesh;
  fit: () => void;
  fitShadow: () => void;
}

// Metalness is restored when lighting is switched back on. A WeakMap keeps the
// original value next to materials shared by several meshes.
const metalnessBackup = new WeakMap<THREE.Material, number>();

function applyLighting(view: ViewState, lit: boolean) {
  const { hemi, key, fill, rim, ambient } = view.lights;
  hemi.visible = lit;
  key.visible = lit;
  fill.visible = lit;
  rim.visible = lit;
  // AmbientLight at PI cancels the 1/PI Lambert factor, so the texture keeps
  // its authored colours instead of turning grey.
  ambient.visible = !lit;
  view.shadowPlane.visible = lit && !!view.current;

  const nextToneMapping = THREE.NoToneMapping;
  const environmentChanged = (view.scene.environment !== null) !== lit;
  const toneMappingChanged = view.renderer.toneMapping !== nextToneMapping;
  view.scene.environment = lit ? view.envMap : null;
  view.renderer.toneMapping = nextToneMapping;
  view.renderer.toneMappingExposure = 1;

  const root = view.current;
  if (!root) return;
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      const standard = material as THREE.MeshStandardMaterial;
      if (typeof standard.metalness === 'number') {
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
      if (environmentChanged || toneMappingChanged) material.needsUpdate = true;
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
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    element.append(renderer.domElement);

    // A studio environment gives PBR materials soft indirect light and
    // reflections; plain directional lights alone look plastic.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    const envMap = pmrem.fromScene(room, 0.04).texture;
    room.dispose();
    pmrem.dispose();
    scene.environmentIntensity = 0.15;

    const hemi = new THREE.HemisphereLight(0xffffff, 0x8a8f9a, 2.2);
    scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.bias = -0.0005;
    key.shadow.normalBias = 0.02;
    const fill = new THREE.DirectionalLight(0xc7d8ff, 0.3);
    const rim = new THREE.DirectionalLight(0xffffff, 0.7);
    for (const light of [key, fill, rim]) {
      scene.add(light);
      scene.add(light.target);
    }
    const ambient = new THREE.AmbientLight(0xffffff, Math.PI);
    ambient.visible = false;
    scene.add(ambient);

    const shadowPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.22 }),
    );
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.receiveShadow = true;
    shadowPlane.visible = false;
    scene.add(shadowPlane);

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

    const fitShadow = () => {
      const view = state.current;
      if (!view?.current) return;
      const box = new THREE.Box3().setFromObject(view.current);
      if (box.isEmpty()) return;
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const radius = Math.max(size.x, size.y, size.z, 0.5) * 0.8;
      const { key, fill, rim } = view.lights;
      key.target.position.copy(center);
      fill.target.position.copy(center);
      rim.target.position.copy(center);
      key.position.copy(center)
        .add(new THREE.Vector3(0.5, 1, 0.7).normalize().multiplyScalar(radius * 4));
      fill.position.copy(center)
        .add(new THREE.Vector3(-1, 0.4, 0.8).normalize().multiplyScalar(radius * 4));
      rim.position.copy(center)
        .add(new THREE.Vector3(0.2, 0.6, -1).normalize().multiplyScalar(radius * 4));
      for (const light of [key, fill, rim]) {
        light.target.updateMatrixWorld();
        light.updateMatrixWorld();
      }
      const shadowCamera = key.shadow.camera;
      shadowCamera.left = -radius;
      shadowCamera.right = radius;
      shadowCamera.top = radius;
      shadowCamera.bottom = -radius;
      shadowCamera.near = 0.1;
      shadowCamera.far = radius * 12;
      shadowCamera.updateProjectionMatrix();
      view.shadowPlane.position.set(center.x, box.min.y + 0.002, center.z);
      view.shadowPlane.scale.setScalar(Math.max(size.x, size.z, radius) * 2.6);
    };

    const view: ViewState = {
      renderer,
      scene,
      camera,
      controls,
      current: null,
      lights: { hemi, key, fill, rim, ambient },
      envMap,
      shadowPlane,
      fit,
      fitShadow,
    };
    state.current = view;
    applyLighting(view, litRef.current);

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
        applyLighting(view, true);
        scene.remove(view.current);
      }
      renderer.dispose();
      renderer.domElement.remove();
      helper?.geometry.dispose();
      if (helper) (helper.material as THREE.Material).dispose();
      envMap.dispose();
      key.shadow.map?.dispose();
      shadowPlane.geometry.dispose();
      (shadowPlane.material as THREE.Material).dispose();
      state.current = null;
    };
  }, [grid, autoRotate]);

  useEffect(() => {
    const view = state.current;
    if (!view) return;
    if (view.current && view.current !== object) {
      applyLighting(view, true);
      view.scene.remove(view.current);
      view.shadowPlane.visible = false;
    }
    view.current = object;
    if (object) {
      object.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      });
      view.scene.add(object);
      applyLighting(view, litRef.current);
      view.fit();
      view.fitShadow();
    }
  }, [object]);

  const toggleLighting = () => {
    const next = !lit;
    setLit(next);
    rememberLighting(next);
    const view = state.current;
    if (view) applyLighting(view, next);
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
