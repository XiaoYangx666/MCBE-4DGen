import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  applyMaterialVisibility,
  collectMaterialVisibility,
  restoreMaterialVisibility,
} from '../webapp/lib/material-visibility.ts';

function sceneWithMaterials() {
  const face = new THREE.MeshBasicMaterial({ name: '颜' });
  const hair = new THREE.MeshBasicMaterial({ name: '髮' });
  const hidden = new THREE.MeshBasicMaterial({ name: '隐藏', visible: false });
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.BufferGeometry(), [face, hair, hidden]));
  return { scene, face, hair, hidden };
}

describe('webapp material preview visibility', () => {
  it('hides unchecked materials and keeps source-hidden ones hidden', () => {
    const { scene, face, hair, hidden } = sceneWithMaterials();
    const originals = collectMaterialVisibility(scene);

    applyMaterialVisibility(scene, null, new Set([face.uuid, hair.uuid, hidden.uuid]), originals);
    expect(face.visible).toBe(true);
    expect(hair.visible).toBe(true);
    expect(hidden.visible).toBe(false);

    applyMaterialVisibility(scene, null, new Set([face.uuid]), originals);
    expect(face.visible).toBe(true);
    expect(hair.visible).toBe(false);
    expect(hidden.visible).toBe(false);
  });

  it('soloes a material and ignores solo when it is unchecked', () => {
    const { scene, face, hair } = sceneWithMaterials();
    const originals = collectMaterialVisibility(scene);

    applyMaterialVisibility(scene, hair.uuid, new Set([face.uuid, hair.uuid]), originals);
    expect(face.visible).toBe(false);
    expect(hair.visible).toBe(true);

    applyMaterialVisibility(scene, hair.uuid, new Set([face.uuid]), originals);
    expect(face.visible).toBe(true);
    expect(hair.visible).toBe(false);
  });

  it('restores the original visibility before export', () => {
    const { scene, face, hair, hidden } = sceneWithMaterials();
    const originals = collectMaterialVisibility(scene);
    applyMaterialVisibility(scene, null, new Set([face.uuid]), originals);

    restoreMaterialVisibility(scene, originals);
    expect(face.visible).toBe(true);
    expect(hair.visible).toBe(true);
    expect(hidden.visible).toBe(false);
  });
});
