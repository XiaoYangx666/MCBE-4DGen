/**
 * Shared studio lighting for three.js previews.
 *
 * The web app, the desktop pack preview and the workbench viewer all want the
 * same look: a PMREM room environment for soft PBR reflections, a hemisphere /
 * key / fill / rim setup for shape, and one soft shadow plane under the model.
 * This module owns those lights and their placement. Render loops,
 * OrbitControls, React shells and material tricks stay with the callers.
 *
 * Only depends on three, so it is safe in the browser and in Node tests.
 */
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

/** Environment intensity shared by every preview. */
const ENVIRONMENT_INTENSITY = 0.15;

export interface PreviewLights {
  hemi: THREE.HemisphereLight;
  key: THREE.DirectionalLight;
  fill: THREE.DirectionalLight;
  rim: THREE.DirectionalLight;
  /** Only visible in the flat (`apply(false)`) mode; cancels the Lambert 1/PI. */
  ambient: THREE.AmbientLight;
}

export interface PreviewLightingOptions {
  /**
   * Use this environment map instead of generating the PMREM room map. The
   * caller keeps ownership; `dispose()` will not release it. Handy in tests
   * and when a host already has a studio map.
   */
  envMap?: THREE.Texture;
  /**
   * Set false to skip PMREM generation entirely (Node tests, renderers without
   * WebGL). Lights and shadows still work, just without reflections.
   */
  environment?: boolean;
  /** Called after `apply()` / `fit()` changed what the scene should show. */
  onChange?: () => void;
}

export interface PreviewLighting {
  lights: PreviewLights;
  shadowPlane: THREE.Mesh;
  /** Environment map in use, or null when environment generation is off. */
  envMap: THREE.Texture | null;
  /**
   * Toggle lit vs. flat mode and attach `object` for material refreshes.
   * Returns whether the scene environment changed (callers may use this to
   * refresh materials of objects the rig does not own).
   */
  apply(lit: boolean, object?: THREE.Object3D | null): boolean;
  /** Place lights, shadow camera and shadow plane around `object`'s bounds. */
  fit(object: THREE.Object3D): boolean;
  dispose(): void;
}

/**
 * Build the rig for `scene`. `renderer` may be null when PMREM is not needed;
 * when present it also gets soft shadow map settings.
 */
export function createPreviewLighting(
  renderer: THREE.WebGLRenderer | null,
  scene: THREE.Scene,
  options: PreviewLightingOptions = {},
): PreviewLighting {
  const useEnvironment = options.environment ?? true;

  if (renderer) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
  }

  let envMap: THREE.Texture | null = options.envMap ?? null;
  let ownsEnvMap = false;
  if (!envMap && useEnvironment && renderer) {
    // A studio environment gives PBR materials soft indirect light and
    // reflections; plain directional lights alone look plastic.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    envMap = pmrem.fromScene(room, 0.04).texture;
    ownsEnvMap = true;
    room.dispose();
    pmrem.dispose();
  }
  scene.environmentIntensity = ENVIRONMENT_INTENSITY;

  const hemi = new THREE.HemisphereLight(0xffffff, 0x8a8f9a, 2.2);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.bias = -0.0005;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 2;

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

  let lit = true;
  let disposed = false;
  const notify = () => options.onChange?.();

  const apply = (next: boolean, object?: THREE.Object3D | null): boolean => {
    if (disposed) return false;
    hemi.visible = next;
    key.visible = next;
    fill.visible = next;
    rim.visible = next;
    // AmbientLight at PI cancels the 1/PI Lambert factor, so the texture keeps
    // its authored colours instead of turning grey.
    ambient.visible = !next;
    shadowPlane.visible = next && !!object;

    const targetEnvironment = next ? envMap : null;
    const environmentChanged = scene.environment !== targetEnvironment;
    const toneMappingChanged = renderer
      ? renderer.toneMapping !== THREE.NoToneMapping
      : false;
    scene.environment = targetEnvironment;
    if (renderer) {
      renderer.toneMapping = THREE.NoToneMapping;
      renderer.toneMappingExposure = 1;
    }

    if (object) {
      const refresh = environmentChanged || toneMappingChanged;
      object.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh || !refresh) return;
        const materials = Array.isArray(mesh.material)
          ? mesh.material
          : [mesh.material];
        for (const material of materials) material.needsUpdate = true;
      });
    }

    const litChanged = lit !== next;
    lit = next;
    if (litChanged || environmentChanged || toneMappingChanged) notify();
    return environmentChanged;
  };

  const fit = (object: THREE.Object3D): boolean => {
    if (disposed) return false;
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return false;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z, 0.5) * 0.8;

    key.target.position.copy(center);
    fill.target.position.copy(center);
    rim.target.position.copy(center);
    key.position
      .copy(center)
      .add(new THREE.Vector3(0.5, 1, 0.7).normalize().multiplyScalar(radius * 4));
    fill.position
      .copy(center)
      .add(
        new THREE.Vector3(-1, 0.4, 0.8).normalize().multiplyScalar(radius * 4),
      );
    rim.position
      .copy(center)
      .add(
        new THREE.Vector3(0.2, 0.6, -1).normalize().multiplyScalar(radius * 4),
      );
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

    shadowPlane.position.set(center.x, box.min.y + 0.002, center.z);
    shadowPlane.scale.setScalar(Math.max(size.x, size.z, radius) * 2.6);

    object.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });

    notify();
    return true;
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const light of [hemi, key, fill, rim, ambient]) {
      light.removeFromParent();
    }
    for (const light of [key, fill, rim]) light.target.removeFromParent();
    key.shadow.dispose();
    shadowPlane.removeFromParent();
    shadowPlane.geometry.dispose();
    (shadowPlane.material as THREE.Material).dispose();
    if (scene.environment === envMap) scene.environment = null;
    if (ownsEnvMap) envMap?.dispose();
  };

  return {
    lights: { hemi, key, fill, rim, ambient },
    shadowPlane,
    envMap,
    apply,
    fit,
    dispose,
  };
}
