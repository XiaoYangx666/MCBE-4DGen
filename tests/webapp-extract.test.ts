import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { extractModel } from '../webapp/lib/extract.ts';

function sceneWithTriangle() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0,
    1, 0, 0,
    0, 0, 1,
  ], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
  const material = new THREE.MeshBasicMaterial({ color: 0xffffff, name: '布料' });
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(geometry, material));
  return scene;
}

function hasVertex(positions: Float32Array, x: number, y: number, z: number) {
  for (let i = 0; i < positions.length; i += 3) {
    if (Math.abs(positions[i]! - x) < 1e-6 &&
        Math.abs(positions[i + 1]! - y) < 1e-6 &&
        Math.abs(positions[i + 2]! - z) < 1e-6) return true;
  }
  return false;
}

describe('webapp model extraction', () => {
  it('keeps material names, UVs and triangle counts', () => {
    const extracted = extractModel(sceneWithTriangle());
    expect(extracted.batches).toHaveLength(1);
    expect(extracted.batches[0]!.name).toBe('布料');
    expect(extracted.batches[0]!.triangles).toBe(1);
    expect(extracted.batches[0]!.uvs).toBeInstanceOf(Float32Array);
    expect(extracted.stats.triangles).toBe(1);
  });

  it('applies Y rotation to positions before export', () => {
    const extracted = extractModel(sceneWithTriangle(), { rotationYDegrees: 90 });
    const positions = extracted.batches[0]!.positions;
    expect(hasVertex(positions, 1, 0, 0)).toBe(true);
    expect(hasVertex(positions, 0, 0, 1)).toBe(false);
  });

  it('bakes a posed skeleton only when requested', () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
    ], 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute([
      0, 0, 1,
      0, 0, 1,
      0, 0, 1,
    ], 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute([
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ], 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute([
      1, 0, 0, 0,
      1, 0, 0, 0,
      1, 0, 0, 0,
    ], 4));
    const bone = new THREE.Bone();
    const skeleton = new THREE.Skeleton([bone]);
    const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial({ name: '蒙皮' }));
    const scene = new THREE.Scene();
    scene.add(mesh, bone);
    scene.updateMatrixWorld(true);
    mesh.bind(skeleton);

    bone.rotation.z = Math.PI / 2;
    scene.updateMatrixWorld(true);
    skeleton.update();

    const bind = extractModel(scene);
    expect(hasVertex(bind.batches[0]!.positions, 1, 0, 0)).toBe(true);

    const posed = extractModel(scene, { bakeSkinning: true });
    expect(hasVertex(posed.batches[0]!.positions, 0, 1, 0)).toBe(true);
    expect(hasVertex(posed.batches[0]!.positions, 1, 0, 0)).toBe(false);
  });
});
