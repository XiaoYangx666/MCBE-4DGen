import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { applyVrmMtoonMaterials } from '../webapp/engine/vrm-materials.ts';
import { srgbToLinear } from '../src/texture-pixels.ts';

/** Minimal GLTF stand-in: only the parser bits the adapter reads. */
function fakeGltf(materials: THREE.Material[], properties: unknown[]): GLTF {
  const associations = new Map<
    THREE.Object3D | THREE.Material | THREE.Texture,
    { materials?: number }
  >();
  materials.forEach((material, index) => associations.set(material, { materials: index }));
  return {
    parser: {
      json: { extensions: { VRM: { materialProperties: properties } }, textures: [] },
      associations,
      getDependency: async () => new THREE.Texture(),
    },
  } as unknown as GLTF;
}

const mtoon = (overrides: Record<string, unknown>) => ({
  shader: 'VRM/MToon',
  ...overrides,
});

describe('browser VRM MToon adapter', () => {
  it('applies blend mode, cutoff and culling from the shared mapping', async () => {
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const result = await applyVrmMtoonMaterials(fakeGltf([material], [mtoon({
      floatProperties: { _BlendMode: 1, _Cutoff: 0.3, _CullMode: 0 },
    })]));

    expect(result).toEqual({ applied: 1, unmatched: 0 });
    expect(material.alphaTest).toBeCloseTo(0.3, 6);
    expect(material.transparent).toBe(false);
    expect(material.side).toBe(THREE.DoubleSide);
  });

  it('uses MToon color only when the glTF base color is still white', async () => {
    const fallback = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const explicit = new THREE.MeshStandardMaterial({ color: 0xffffff });
    explicit.color.setRGB(0.01, 0.02, 0.04, THREE.LinearSRGBColorSpace);

    await applyVrmMtoonMaterials(fakeGltf([fallback, explicit], [
      mtoon({ vectorProperties: { _Color: [0.5, 0.5, 0.5, 1] } }),
      mtoon({ vectorProperties: { _Color: [0.5, 0.5, 0.5, 1] } }),
    ]));

    expect(fallback.color.r).toBeCloseTo(srgbToLinear(0.5), 6);
    expect(explicit.color.r).toBeCloseTo(0.01, 6);
  });

  it('reports materials the scene never references', async () => {
    const material = new THREE.MeshStandardMaterial();
    const result = await applyVrmMtoonMaterials(fakeGltf([material], [
      mtoon({}),
      mtoon({}),
    ]));
    expect(result).toEqual({ applied: 1, unmatched: 1 });
  });

  it('ignores files without VRM 0.x material properties', async () => {
    const material = new THREE.MeshStandardMaterial();
    const gltf = { parser: { json: {}, associations: new Map(), getDependency: async () => null } } as unknown as GLTF;
    expect(await applyVrmMtoonMaterials(gltf)).toEqual({ applied: 0, unmatched: 0 });
    expect(material.alphaTest).toBe(0);
  });
});
