import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createPreviewOrientation } from '../web/shared/preview-orientation.ts';

function mesh(size: [number, number, number] = [4, 8, 2]): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.BoxGeometry(size[0], size[1], size[2]),
    new THREE.MeshBasicMaterial(),
  );
}

function arrowDirection(arrow: THREE.ArrowHelper) {
  return new THREE.Vector3(0, 1, 0).applyQuaternion(arrow.quaternion);
}

describe('shared preview orientation', () => {
  it('fits the arrow beside the model and points along +Z', () => {
    const orientation = createPreviewOrientation({
      label: false,
      direction: 1,
      offset: 'side',
    });
    const object = mesh([4, 8, 2]);

    expect(orientation.fit(object)).toBe(true);
    const arrow = orientation.object.children[0] as THREE.ArrowHelper;
    expect(arrow.position.x).toBeCloseTo(2 + 4 * 0.12, 5);
    expect(arrow.position.y).toBeCloseTo(-4 + 8 * 0.01 + 0.1, 5);
    expect(arrow.position.z).toBeCloseTo(0, 5);
    expect(arrowDirection(arrow).z).toBeCloseTo(1, 5);
    expect(orientation.object.children).toHaveLength(1); // label disabled

    expect(orientation.fit(new THREE.Group())).toBe(false);
    orientation.dispose();
    expect(() => orientation.dispose()).not.toThrow();
  });

  it('centers and points along -Z for the desktop convention', () => {
    const orientation = createPreviewOrientation({
      label: false,
      direction: -1,
    });
    const object = mesh([2, 2, 2]);
    object.position.set(10, 5, -3);
    object.updateMatrixWorld(true);

    expect(orientation.fit(object)).toBe(true);
    const arrow = orientation.object.children[0] as THREE.ArrowHelper;
    expect(arrow.position.x).toBeCloseTo(10, 5);
    expect(arrow.position.y).toBeCloseTo(4 + 2 * 0.01 + 0.1, 5);
    expect(arrow.position.z).toBeCloseTo(-3, 5);
    expect(arrowDirection(arrow).z).toBeCloseTo(-1, 5);

    orientation.dispose();
  });
});
