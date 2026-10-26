import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  PREVIEW_CAMERA,
  PREVIEW_FRAMING,
  fitPreviewBounds,
  fitPreviewCamera,
} from '../web/shared/poly-mesh-preview.ts';

function camera() {
  return new THREE.PerspectiveCamera(PREVIEW_CAMERA.fov, 1, 0.01, 10_000);
}

function controls() {
  return {
    target: new THREE.Vector3(),
    minDistance: 0,
    maxDistance: Infinity,
    update: () => true,
  };
}

function box(size: [number, number, number] = [4, 8, 2], center: [number, number, number] = [0, 0, 0]) {
  const [x = 0, y = 0, z = 0] = center;
  const [width = 4, height = 8, depth = 2] = size;
  return new THREE.Box3(
    new THREE.Vector3(x - width / 2, y - height / 2, z - depth / 2),
    new THREE.Vector3(x + width / 2, y + height / 2, z + depth / 2),
  );
}

describe('shared preview camera presets', () => {
  it('uses the desktop pack camera and framing as the reference', () => {
    expect(PREVIEW_CAMERA.fov).toBe(32);
    for (const view of ['angle', 'front'] as const) {
      expect(PREVIEW_FRAMING[view].strategy).toBe('extent');
      expect(PREVIEW_FRAMING[view].padding).toBe(1.16);
    }
  });

  it('frames both views from the model front (-Z) side', () => {
    const target = box();
    const angleCamera = camera();
    const angleControls = controls();
    expect(
      fitPreviewBounds(angleCamera, angleControls, target, {
        ...PREVIEW_FRAMING.angle,
        aspect: 1,
      }),
    ).toBe(true);

    const frontCamera = camera();
    const frontControls = controls();
    expect(
      fitPreviewBounds(frontCamera, frontControls, target, {
        ...PREVIEW_FRAMING.front,
        aspect: 1,
      }),
    ).toBe(true);

    // Both cameras sit in front of the model and look back along +Z.
    expect(angleCamera.position.z).toBeLessThan(0);
    expect(frontCamera.position.z).toBeLessThan(0);
    expect(frontCamera.position.x).toBeCloseTo(0, 5);
    expect(angleCamera.position.x).toBeGreaterThan(0);
    // Straight-on is closer to the model than the 3/4 angle.
    expect(frontCamera.position.z).toBeLessThan(angleCamera.position.z);
    expect(angleControls.target.toArray()).toEqual([0, 0, 0]);
    expect(frontControls.target.toArray()).toEqual([0, 0, 0]);
  });

  it('can frame from +Z for source models', () => {
    const view = camera();
    const orbit = controls();
    expect(
      fitPreviewBounds(view, orbit, box(), {
        ...PREVIEW_FRAMING.angle,
        aspect: 1,
        directionZ: 1,
      }),
    ).toBe(true);
    expect(view.position.z).toBeGreaterThan(0);
  });

  it('frames off-centre bounds and ignores empty boxes', () => {
    const target = box([2, 2, 2], [10, 5, -3]);
    const view = camera();
    const orbit = controls();
    expect(
      fitPreviewBounds(view, orbit, target, {
        ...PREVIEW_FRAMING.angle,
        aspect: 1,
      }),
    ).toBe(true);
    expect(orbit.target.toArray()).toEqual([10, 5, -3]);

    expect(fitPreviewBounds(view, orbit, new THREE.Box3())).toBe(false);
  });

  it('resets zoom only when asked', () => {
    const target = box();
    const view = camera();
    view.zoom = 2.5;
    const orbit = controls();
    fitPreviewBounds(view, orbit, target, {
      ...PREVIEW_FRAMING.angle,
      aspect: 1,
    });
    expect(view.zoom).toBe(2.5);

    fitPreviewBounds(view, orbit, target, {
      ...PREVIEW_FRAMING.front,
      aspect: 1,
      resetZoom: true,
    });
    expect(view.zoom).toBe(1);
  });

  it('still supports the legacy max-dimension strategy', () => {
    const object = new THREE.Mesh(
      new THREE.BoxGeometry(4, 8, 2),
      new THREE.MeshBasicMaterial(),
    );
    const view = camera();
    const orbit = controls();
    expect(
      fitPreviewCamera(view, orbit, object, {
        strategy: 'max-dimension',
        padding: 1.45,
      }),
    ).toBe(true);
    // The legacy angle camera sits on the +Z side.
    expect(view.position.z).toBeGreaterThan(0);
    expect(orbit.minDistance).toBeGreaterThan(0);
  });
});
