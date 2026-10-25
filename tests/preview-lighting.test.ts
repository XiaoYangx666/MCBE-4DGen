import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createPreviewLighting } from '../web/shared/preview-lighting.ts';

/**
 * A stand-in for WebGLRenderer: the rig only touches shadowMap and the
 * tone-mapping fields, so PMREM/WebGL never has to start in Node.
 */
function stubRenderer() {
  return {
    shadowMap: { enabled: false, type: THREE.BasicShadowMap },
    toneMapping: THREE.NoToneMapping,
    toneMappingExposure: 1,
  } as unknown as THREE.WebGLRenderer;
}

function mesh(size: [number, number, number] = [4, 8, 2]): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.BoxGeometry(size[0], size[1], size[2]),
    new THREE.MeshStandardMaterial(),
  );
}

describe('shared preview lighting', () => {
  it('adds the hemisphere/key/fill/rim/ambient set and toggles visibility', () => {
    const scene = new THREE.Scene();
    const rig = createPreviewLighting(null, scene, { environment: false });

    expect(rig.lights.hemi.intensity).toBe(2.2);
    expect(rig.lights.key.intensity).toBe(2.2);
    expect(rig.lights.fill.intensity).toBe(0.3);
    expect(rig.lights.rim.intensity).toBe(0.7);
    expect(rig.lights.ambient.intensity).toBeCloseTo(Math.PI, 5);
    expect(rig.lights.hemi.parent).toBe(scene);
    expect(rig.lights.key.parent).toBe(scene);
    expect(rig.lights.fill.parent).toBe(scene);
    expect(rig.lights.rim.parent).toBe(scene);
    expect(rig.lights.ambient.parent).toBe(scene);
    expect(scene.environmentIntensity).toBe(0.15);
    expect(rig.lights.key.castShadow).toBe(true);
    expect(rig.lights.key.shadow.mapSize.x).toBe(1024);
    expect(rig.lights.key.shadow.mapSize.y).toBe(1024);
    expect((rig.shadowPlane.material as THREE.ShadowMaterial).opacity).toBe(0.22);
    expect(rig.shadowPlane.receiveShadow).toBe(true);
    expect(rig.shadowPlane.visible).toBe(false);

    rig.apply(true);
    expect(rig.lights.hemi.visible).toBe(true);
    expect(rig.lights.key.visible).toBe(true);
    expect(rig.lights.fill.visible).toBe(true);
    expect(rig.lights.rim.visible).toBe(true);
    expect(rig.lights.ambient.visible).toBe(false);
    expect(rig.shadowPlane.visible).toBe(false);

    rig.apply(false);
    expect(rig.lights.hemi.visible).toBe(false);
    expect(rig.lights.key.visible).toBe(false);
    expect(rig.lights.fill.visible).toBe(false);
    expect(rig.lights.rim.visible).toBe(false);
    expect(rig.lights.ambient.visible).toBe(true);

    rig.dispose();
  });

  it('shows the shadow plane only when lit with an object attached', () => {
    const scene = new THREE.Scene();
    const rig = createPreviewLighting(null, scene, { environment: false });
    const object = mesh();

    rig.apply(true, object);
    expect(rig.shadowPlane.visible).toBe(true);
    rig.apply(false, object);
    expect(rig.shadowPlane.visible).toBe(false);
    rig.apply(true);
    expect(rig.shadowPlane.visible).toBe(false);

    rig.dispose();
  });

  it('reports environment changes and refreshes attached materials', () => {
    const scene = new THREE.Scene();
    const envMap = new THREE.Texture();
    const rig = createPreviewLighting(null, scene, { envMap });
    const object = mesh();
    const material = object.material as THREE.MeshStandardMaterial;

    expect(rig.apply(true, object)).toBe(true);
    expect(scene.environment).toBe(envMap);
    const version = material.version;

    expect(rig.apply(true, object)).toBe(false);
    expect(material.version).toBe(version);

    expect(rig.apply(false, object)).toBe(true);
    expect(scene.environment).toBeNull();
    expect(material.version).toBeGreaterThan(version);

    expect(rig.apply(false, object)).toBe(false);
    rig.dispose();
  });

  it('skips PMREM when environment generation is off', () => {
    const scene = new THREE.Scene();
    const rig = createPreviewLighting(null, scene, { environment: false });
    expect(rig.envMap).toBeNull();
    expect(rig.apply(true)).toBe(false);
    expect(scene.environment).toBeNull();
    rig.dispose();
  });

  it('wires soft shadows and NoToneMapping on the renderer', () => {
    const renderer = stubRenderer();
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 2;
    const scene = new THREE.Scene();
    const rig = createPreviewLighting(renderer, scene, { environment: false });

    expect(renderer.shadowMap.enabled).toBe(true);
    expect(renderer.shadowMap.type).toBe(THREE.PCFShadowMap);

    const object = mesh();
    const material = object.material as THREE.MeshStandardMaterial;
    const version = material.version;
    expect(rig.apply(true, object)).toBe(false); // environment is off
    expect(renderer.toneMapping).toBe(THREE.NoToneMapping);
    expect(renderer.toneMappingExposure).toBe(1);
    expect(material.version).toBeGreaterThan(version);

    rig.dispose();
  });

  it('places lights, shadow camera and shadow plane from the bounding box', () => {
    const scene = new THREE.Scene();
    const rig = createPreviewLighting(null, scene, { environment: false });
    const object = mesh([4, 8, 2]);

    expect(rig.fit(object)).toBe(true);
    // radius = max(size) * 0.8 = 6.4
    const radius = 6.4;
    expect(rig.lights.key.target.position.toArray()).toEqual([0, 0, 0]);
    expect(rig.lights.fill.target.position.toArray()).toEqual([0, 0, 0]);
    expect(rig.lights.rim.target.position.toArray()).toEqual([0, 0, 0]);
    for (const light of [rig.lights.key, rig.lights.fill, rig.lights.rim]) {
      expect(light.position.distanceTo(new THREE.Vector3(0, 0, 0))).toBeCloseTo(
        radius * 4,
        5,
      );
    }
    const shadowCamera = rig.lights.key.shadow.camera;
    expect(shadowCamera.left).toBe(-radius);
    expect(shadowCamera.right).toBe(radius);
    expect(shadowCamera.top).toBe(radius);
    expect(shadowCamera.bottom).toBe(-radius);
    expect(shadowCamera.near).toBe(0.1);
    expect(shadowCamera.far).toBeCloseTo(radius * 12, 5);

    expect(rig.shadowPlane.position.x).toBe(0);
    expect(rig.shadowPlane.position.y).toBeCloseTo(-4 + 0.002, 5);
    expect(rig.shadowPlane.position.z).toBe(0);
    expect(rig.shadowPlane.scale.x).toBeCloseTo(Math.max(4, 2, radius) * 2.6, 5);

    expect(object.castShadow).toBe(true);
    expect(object.receiveShadow).toBe(true);

    rig.dispose();
  });

  it('follows an off-centre object and ignores empty objects', () => {
    const scene = new THREE.Scene();
    const rig = createPreviewLighting(null, scene, { environment: false });
    const object = mesh([2, 2, 2]);
    object.position.set(10, 5, -3);
    object.updateMatrixWorld(true);

    expect(rig.fit(object)).toBe(true);
    expect(rig.lights.key.target.position.toArray()).toEqual([10, 5, -3]);
    expect(rig.shadowPlane.position.x).toBe(10);
    expect(rig.shadowPlane.position.y).toBeCloseTo(4 + 0.002, 5);
    expect(rig.shadowPlane.position.z).toBe(-3);

    expect(rig.fit(new THREE.Group())).toBe(false);
    rig.dispose();
  });

  it('disposes without throwing and leaves injected environment maps alone', () => {
    const scene = new THREE.Scene();
    const envMap = new THREE.Texture();
    let envDisposed = false;
    envMap.addEventListener('dispose', () => {
      envDisposed = true;
    });
    const rig = createPreviewLighting(null, scene, { envMap });
    const geometry = rig.shadowPlane.geometry;
    let geometryDisposed = false;
    geometry.addEventListener('dispose', () => {
      geometryDisposed = true;
    });

    rig.apply(true);
    rig.dispose();
    expect(envDisposed).toBe(false);
    expect(geometryDisposed).toBe(true);
    expect(scene.environment).toBeNull();
    expect(rig.lights.key.parent).toBeNull();
    expect(rig.shadowPlane.parent).toBeNull();
    expect(() => rig.dispose()).not.toThrow();
  });

  it('notifies demand-render callers when something changed', () => {
    const scene = new THREE.Scene();
    let changes = 0;
    const rig = createPreviewLighting(null, scene, {
      environment: false,
      onChange: () => changes++,
    });

    rig.apply(false);
    const afterFirst = changes;
    expect(afterFirst).toBeGreaterThan(0);
    rig.apply(false);
    expect(changes).toBe(afterFirst);
    rig.apply(true);
    expect(changes).toBeGreaterThan(afterFirst);
    rig.fit(mesh());
    expect(changes).toBeGreaterThan(afterFirst + 1);
    rig.dispose();
  });
});
