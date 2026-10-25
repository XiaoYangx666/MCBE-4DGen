/**
 * Shared three.js preview shell for the browser web app and the desktop pack
 * preview (and, where it is safe, the workbench viewer).
 *
 * The shell owns the renderer, scene, camera, OrbitControls, resize handling,
 * render loop, lighting rig, front marker, grid/background and object
 * lifecycle. It intentionally knows nothing about React, the API, IndexedDB or
 * app state: callers hand it a host element and an `Object3D`.
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createDemandRender } from "./demand-render";
import {
  PREVIEW_CAMERA,
  PREVIEW_FRAMING,
  fitPreviewBounds,
  type FitPreviewCameraOptions,
  type PreviewViewKind,
} from "./poly-mesh-preview";
import {
  createPreviewLighting,
  type PreviewLighting,
} from "./preview-lighting";
import {
  createPreviewOrientation,
  type PreviewOrientation,
  type PreviewOrientationOptions,
} from "./preview-orientation";
import { bindViewportAppearance } from "./viewport-appearance";

export interface PreviewGridOptions {
  size?: number;
  divisions?: number;
  color?: number;
  centerColor?: number;
  opacity?: number;
  /** Height offset, useful for keeping the grid just under the ground. */
  y?: number;
}

export interface PreviewControlsOptions {
  enablePan?: boolean;
  enableZoom?: boolean;
  enableDamping?: boolean;
  dampingFactor?: number;
  autoRotate?: boolean;
  autoRotateSpeed?: number;
  maxPolarAngle?: number;
  minPolarAngle?: number;
}

export interface PreviewViewportOptions {
  /** Element the canvas is appended to; its CSS box defines the render size. */
  host: HTMLElement;
  /** Render every animation frame (default) or only when invalidated. */
  renderMode?: "continuous" | "demand";
  /** Transparent canvas; defaults to false. */
  alpha?: boolean;
  antialias?: boolean;
  maxPixelRatio?: number;
  /** Scene background. Omit/null keeps it transparent. */
  background?: THREE.ColorRepresentation | null;
  /**
   * Follow the host theme (`--viewport` background, `--muted` grid) and update
   * on `appearancechange`. Overrides `background`.
   */
  theme?: boolean;
  /** Grid configuration; false/omitted hides the grid. */
  grid?: boolean | PreviewGridOptions;
  /** Camera overrides; defaults come from `PREVIEW_CAMERA`. */
  camera?: { fov?: number; near?: number; far?: number };
  controls?: PreviewControlsOptions;
  /** Front marker; false disables it. Defaults to the Bedrock -Z convention. */
  orientation?: false | PreviewOrientationOptions;
  /** Initial lit state. Defaults to true. */
  lit?: boolean;
  /**
   * Strip metalness while unlit so flat mode keeps the authored texture
   * colours. Defaults to true; harmless when the preview is always lit.
   */
  flatMetalness?: boolean;
  /** Per-view overrides for the shared framing preset. */
  framing?: Partial<Record<PreviewViewKind, FitPreviewCameraOptions>>;
  /**
   * Refit the camera when the host resizes. `until-user-moves` stops after the
   * first orbit/zoom interaction.
   */
  refitOnResize?: boolean | "until-user-moves";
  /** Called before every draw, e.g. to apply workbench material/pose state. */
  onBeforeRender?: () => void;
  /** Called when the WebGL context is lost; the caller usually recreates. */
  onContextLost?: () => void;
  /** Renderer factory, mainly for tests or hosts with a custom context. */
  createRenderer?: () => THREE.WebGLRenderer;
}

export interface PreviewViewport {
  readonly host: HTMLElement;
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  /** Wrapper for the attached model; callers may add extra content. */
  readonly content: THREE.Group;
  readonly grid: THREE.GridHelper | null;
  readonly lighting: PreviewLighting;
  readonly orientation: PreviewOrientation | null;
  /**
   * Attach an object. The previous object is removed but not disposed; the
   * caller keeps ownership. Frames the shared angle view unless `frame` is
   * false.
   */
  setObject(object: THREE.Object3D | null, options?: { frame?: boolean }): void;
  /** Toggle lit vs. flat rendering. */
  setLit(lit: boolean, options?: { invalidate?: boolean }): void;
  /** Frame the attached content with the shared angle/front preset. */
  fit(view?: PreviewViewKind): boolean;
  /** Frame an explicit world-space box. */
  frameBox(
    box: THREE.Box3,
    view?: PreviewViewKind,
    overrides?: FitPreviewCameraOptions,
  ): boolean;
  /** Alias for `fit("angle")`. */
  reset(): boolean;
  /** Request a demand-mode frame (no-op in continuous mode). */
  invalidate(): void;
  /** Draw one frame immediately. */
  render(): void;
  dispose(): void;
}

// Metalness is restored when lighting is switched back on. A WeakMap keeps the
// original value next to materials shared by several meshes.
const metalnessBackup = new WeakMap<THREE.Material, number>();

/** Flat mode strips metalness, since metals go black without a light probe. */
function applyMetalness(root: THREE.Object3D | null, lit: boolean) {
  if (!root) return;
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];
    for (const material of materials) {
      const standard = material as THREE.MeshStandardMaterial;
      if (typeof standard.metalness !== "number") continue;
      if (!lit) {
        if (!metalnessBackup.has(material)) {
          metalnessBackup.set(material, standard.metalness);
        }
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

export function createPreviewViewport(
  options: PreviewViewportOptions,
): PreviewViewport {
  const host = options.host;
  const hadClass = host.classList.contains("preview-viewport");
  host.classList.add("preview-viewport");

  const renderer =
    options.createRenderer?.() ??
    new THREE.WebGLRenderer({
      antialias: options.antialias ?? true,
      alpha: options.alpha ?? false,
      powerPreference: "high-performance",
    });
  renderer.setPixelRatio(
    Math.min(globalThis.devicePixelRatio || 1, options.maxPixelRatio ?? 2),
  );
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, options.alpha ? 0 : 1);
  host.append(renderer.domElement);

  const scene = new THREE.Scene();
  if (options.background !== undefined && options.background !== null) {
    scene.background = new THREE.Color(options.background);
  }

  const cameraOptions = options.camera ?? {};
  const camera = new THREE.PerspectiveCamera(
    cameraOptions.fov ?? PREVIEW_CAMERA.fov,
    1,
    cameraOptions.near ?? PREVIEW_CAMERA.near,
    cameraOptions.far ?? PREVIEW_CAMERA.far,
  );

  const controls = new OrbitControls(camera, renderer.domElement);
  const controlOptions = options.controls ?? {};
  controls.enableDamping = controlOptions.enableDamping ?? true;
  controls.dampingFactor = controlOptions.dampingFactor ?? 0.09;
  if (controlOptions.enablePan !== undefined) {
    controls.enablePan = controlOptions.enablePan;
  }
  if (controlOptions.enableZoom !== undefined) {
    controls.enableZoom = controlOptions.enableZoom;
  }
  if (controlOptions.autoRotate !== undefined) {
    controls.autoRotate = controlOptions.autoRotate;
  }
  controls.autoRotateSpeed = controlOptions.autoRotateSpeed ?? 1.2;
  controls.maxPolarAngle = controlOptions.maxPolarAngle ?? Math.PI * 0.92;
  if (controlOptions.minPolarAngle !== undefined) {
    controls.minPolarAngle = controlOptions.minPolarAngle;
  }

  let requestRender: () => void = () => {};
  const invalidate = () => requestRender();

  const lighting = createPreviewLighting(renderer, scene, {
    onChange: invalidate,
  });

  let grid: THREE.GridHelper | null = null;
  if (options.grid) {
    const config = options.grid === true ? {} : options.grid;
    grid = new THREE.GridHelper(
      config.size ?? 48,
      config.divisions ?? 24,
      config.color ?? 0x46515b,
      config.centerColor ?? 0x282f36,
    );
    grid.position.y = config.y ?? 0;
    if (config.opacity !== undefined) {
      for (const material of Array.isArray(grid.material)
        ? grid.material
        : [grid.material]) {
        material.transparent = true;
        material.opacity = config.opacity;
      }
    }
    scene.add(grid);
  }

  const orientation =
    options.orientation === false
      ? null
      : createPreviewOrientation(
          options.orientation ?? { direction: -1, label: "玩家正前方（−Z）" },
        );
  if (orientation) {
    orientation.object.visible = false;
    scene.add(orientation.object);
  }

  const content = new THREE.Group();
  content.name = "PreviewContent";
  scene.add(content);

  const stripMetalness = options.flatMetalness ?? true;
  let lit = options.lit ?? true;
  lighting.apply(lit);
  let current: THREE.Object3D | null = null;
  let disposed = false;
  let contextLost = false;
  let lastView: PreviewViewKind = "angle";
  let userMoved = false;
  let frame = 0;
  let demand: ReturnType<typeof createDemandRender> | null = null;

  const draw = () => {
    if (disposed || contextLost) return false;
    options.onBeforeRender?.();
    const moving = controls.update();
    renderer.render(scene, camera);
    return moving;
  };

  const tick = () => {
    if (disposed || contextLost) return;
    frame = requestAnimationFrame(tick);
    if (!host.clientWidth || !host.clientHeight) return;
    options.onBeforeRender?.();
    controls.update();
    renderer.render(scene, camera);
  };

  const frameBox = (
    box: THREE.Box3,
    view: PreviewViewKind = "angle",
    overrides: FitPreviewCameraOptions = {},
  ) => {
    if (disposed) return false;
    const preset = {
      ...PREVIEW_FRAMING[view],
      ...options.framing?.[view],
      ...overrides,
    };
    const aspect = (host.clientWidth || 1) / Math.max(1, host.clientHeight || 1);
    const framed = fitPreviewBounds(camera, controls, box, { ...preset, aspect });
    if (framed) {
      lastView = view;
      invalidate();
    }
    return framed;
  };

  const fit = (view: PreviewViewKind = "angle") => {
    if (disposed || !current) return false;
    content.updateMatrixWorld(true);
    return frameBox(new THREE.Box3().setFromObject(content), view);
  };

  const setObject = (
    object: THREE.Object3D | null,
    objectOptions: { frame?: boolean } = {},
  ) => {
    if (disposed || current === object) return;
    if (stripMetalness) applyMetalness(current, true);
    if (current) content.remove(current);
    current = object;
    if (object) {
      content.add(object);
      content.updateMatrixWorld(true);
      lighting.apply(lit, object);
      lighting.fit(content);
      orientation?.fit(content);
      if (orientation) orientation.object.visible = true;
      if (stripMetalness) applyMetalness(object, lit);
      if (objectOptions.frame ?? true) fit("angle");
    } else {
      lighting.apply(lit);
      if (orientation) orientation.object.visible = false;
    }
    invalidate();
  };

  const setLit = (next: boolean, litOptions: { invalidate?: boolean } = {}) => {
    if (disposed) return;
    lit = next;
    lighting.apply(next, current);
    if (stripMetalness) applyMetalness(current, next);
    if (litOptions.invalidate ?? true) invalidate();
  };

  const resize = () => {
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    const refit =
      options.refitOnResize === true ||
      (options.refitOnResize === "until-user-moves" && !userMoved);
    if (refit && current) fit(lastView);
    else invalidate();
  };

  const onStart = () => {
    userMoved = true;
  };
  controls.addEventListener("start", onStart);

  const observer =
    typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
  if (observer) observer.observe(host);
  else window.addEventListener("resize", resize);
  resize();

  let unbindTheme: (() => void) | null = null;
  if (options.theme) {
    unbindTheme = bindViewportAppearance(scene, grid, invalidate);
  }

  const contextLostHandler = (event: Event) => {
    event.preventDefault();
    contextLost = true;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    demand?.dispose();
    options.onContextLost?.();
  };
  renderer.domElement.addEventListener("webglcontextlost", contextLostHandler);

  const onDemandChange = () => demand?.request();
  if ((options.renderMode ?? "continuous") === "demand") {
    demand = createDemandRender(draw);
    requestRender = demand.request;
    controls.addEventListener("change", onDemandChange);
    demand.request();
  } else {
    tick();
  }

  const render = () => {
    if (disposed || contextLost) return;
    options.onBeforeRender?.();
    controls.update();
    renderer.render(scene, camera);
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    observer?.disconnect();
    if (!observer) window.removeEventListener("resize", resize);
    renderer.domElement.removeEventListener("webglcontextlost", contextLostHandler);
    controls.removeEventListener("start", onStart);
    controls.removeEventListener("change", onDemandChange);
    demand?.dispose();
    demand = null;
    controls.dispose();
    if (stripMetalness) applyMetalness(current, true);
    if (current) content.remove(current);
    current = null;
    content.removeFromParent();
    orientation?.dispose();
    lighting.dispose();
    if (grid) {
      grid.removeFromParent();
      grid.geometry.dispose();
      for (const material of Array.isArray(grid.material)
        ? grid.material
        : [grid.material]) {
        material.dispose();
      }
    }
    unbindTheme?.();
    renderer.dispose();
    renderer.domElement.remove();
    if (!hadClass) host.classList.remove("preview-viewport");
  };

  return {
    host,
    renderer,
    scene,
    camera,
    controls,
    content,
    grid,
    lighting,
    orientation,
    setObject,
    setLit,
    fit,
    frameBox,
    reset: () => fit("angle"),
    invalidate,
    render,
    dispose,
  };
}
