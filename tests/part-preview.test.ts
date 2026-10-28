import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createPartPreview } from '../webapp/lib/part-visibility.ts';

function triangle() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
  );
  geometry.addGroup(0, 3, 0);
  return geometry;
}

function makeScene() {
  const scene = new THREE.Scene();
  const materialA = new THREE.MeshBasicMaterial({ name: 'A' });
  const materialB = new THREE.MeshBasicMaterial({ name: 'B' });
  const first = new THREE.Mesh(triangle(), [materialA, materialB]);
  first.geometry.addGroup(0, 3, 1);
  first.name = 'first';
  const second = new THREE.Mesh(triangle(), materialA);
  second.name = 'second';
  scene.add(first, second);
  return { scene, first, second };
}

describe('source preview part visibility', () => {
  it('hides dropped groups and restores the original geometry', () => {
    const { scene, first, second } = makeScene();
    const preview = createPartPreview(scene);
    expect(preview.partIds()).toEqual(['w0.0', 'w0.1', 'w1.0']);
    preview.apply(new Set(['w0.0', 'w1.0']), null);
    expect(first.visible).toBe(true);
    expect(first.geometry.groups).toHaveLength(1);
    expect(first.geometry.groups[0]!.materialIndex).toBe(0);
    expect(second.visible).toBe(true);
    preview.apply(new Set(['w1.0']), null);
    expect(first.visible).toBe(false);
    expect(second.visible).toBe(true);
    preview.restore();
    expect(first.visible).toBe(true);
    expect(first.geometry.groups).toHaveLength(2);
    expect(first.geometry.groups[1]!.materialIndex).toBe(1);
  });

  it('shows only the selected part without losing the restore state', () => {
    const { scene, first, second } = makeScene();
    const preview = createPartPreview(scene);
    preview.apply(null, 'w0.1');
    expect(first.visible).toBe(true);
    expect(first.geometry.groups).toHaveLength(1);
    expect(first.geometry.groups[0]!.materialIndex).toBe(1);
    expect(second.visible).toBe(false);
    preview.apply(null, null);
    expect(first.geometry.groups).toHaveLength(2);
    expect(second.visible).toBe(true);
  });
});

