import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

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
  fit: () => void;
}

export function Viewport({ object, className, grid = false, autoRotate = false }: ViewportProps) {
  const host = useRef<HTMLDivElement>(null);
  const state = useRef<ViewState | null>(null);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 10_000);
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
    element.append(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xdce8ff, 0x151a24, 2.4));
    const key = new THREE.DirectionalLight(0xffffff, 2.3);
    key.position.set(3, 6, 5);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x92aeff, 1.1);
    fill.position.set(-5, 2, -4);
    scene.add(fill);

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
      const box = new THREE.Box3().setFromObject(view.current);
      if (box.isEmpty()) return;
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const max = Math.max(size.x, size.y, size.z, 0.001);
      const distance = max / (2 * Math.tan((view.camera.fov * Math.PI) / 360)) * 1.45;
      view.camera.position.copy(center).add(new THREE.Vector3(0.62, 0.28, 1).normalize().multiplyScalar(distance));
      view.camera.near = Math.max(distance / 2000, 0.01);
      view.camera.far = Math.max(distance * 60, 100);
      view.camera.updateProjectionMatrix();
      view.controls.target.copy(center);
      view.controls.minDistance = Math.max(max * 0.03, 0.01);
      view.controls.maxDistance = Math.max(max * 30, 10);
      view.controls.update();
    };

    const view: ViewState = { renderer, scene, camera, controls, current: null, fit };
    state.current = view;

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

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      if (view.current) scene.remove(view.current);
      renderer.dispose();
      renderer.domElement.remove();
      helper?.geometry.dispose();
      if (helper) (helper.material as THREE.Material).dispose();
      state.current = null;
    };
  }, [grid, autoRotate]);

  useEffect(() => {
    const view = state.current;
    if (!view) return;
    if (view.current && view.current !== object) view.scene.remove(view.current);
    view.current = object;
    if (object) {
      view.scene.add(object);
      view.fit();
    }
  }, [object]);

  return (
    <div className={`viewport ${className ?? ''}`} ref={host}>
      <div className="viewport-hint">拖拽旋转 · 滚轮缩放</div>
      <button type="button" className="viewport-reset" onClick={() => state.current?.fit()}>
        重置视角
      </button>
    </div>
  );
}
