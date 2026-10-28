import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { extractModel } from '../webapp/engine/extract.ts';
import { preparePreviewMaterials } from '../webapp/engine/preview-materials.ts';

function sceneWithMaterial(material: THREE.Material) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0,
    1, 0, 0,
    0, 0, 1,
  ], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(geometry, material));
  return scene;
}

describe('webapp preview materials', () => {
  it('turns opaque-alpha blends into cutouts and disables depth writes for translucent ones', () => {
    const highlight = new THREE.MeshBasicMaterial({ name: 'EYE hi', transparent: true, opacity: 1 });
    const cloth = new THREE.MeshBasicMaterial({ name: 'cloth', transparent: true, opacity: 0.5 });
    const scene = sceneWithMaterial(highlight);
    const mesh = scene.children[0] as THREE.Mesh;
    mesh.material = [highlight, cloth];
    preparePreviewMaterials(scene);

    expect(highlight.transparent).toBe(false);
    expect(highlight.alphaTest).toBeGreaterThanOrEqual(0.5);
    expect(highlight.depthWrite).toBe(true);
    expect(cloth.transparent).toBe(true);
    expect(cloth.depthWrite).toBe(false);
  });

  it('keeps the source alpha mode for conversion after the preview policy runs', () => {
    const material = new THREE.MeshBasicMaterial({ name: 'EYE hi', transparent: true, opacity: 1 });
    const scene = sceneWithMaterial(material);

    const before = extractModel(scene).batches[0]!;
    preparePreviewMaterials(scene);
    const after = extractModel(scene).batches[0]!;

    expect(before.alphaMode).toBe('BLEND');
    expect(after.alphaMode).toBe('BLEND');
    expect(after.alphaCutoff).toBe(0.5);
  });
});
