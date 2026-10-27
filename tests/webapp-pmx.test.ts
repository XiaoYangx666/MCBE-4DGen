import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { png } from './fixtures.ts';
import { pmxFixture } from './pmx-fixture.ts';
import { applyPmxMaterials, convertPmxModel, isPmdModel, isPmxModel } from '../webapp/engine/pmx.ts';

describe('webapp PMX conversion', () => {
  it('converts PMX to GLB and resolves sidecar textures by basename', async () => {
    const texture = new File([new Uint8Array(await png())], '脸.png', { type: 'image/png' });
    const result = await convertPmxModel([new File([new Uint8Array(pmxFixture())], '角色.pmx'), texture]);

    expect(result.file.name).toBe('角色.glb');
    expect(result.file.type).toBe('model/gltf-binary');
    const glb = new Uint8Array(await result.file.arrayBuffer());
    expect(new TextDecoder().decode(glb.subarray(0, 4))).toBe('glTF');
    expect(result.warnings.some((warning) => warning.includes('静态'))).toBe(true);
    expect(result.materials.length).toBe(2);
  }, 60_000);

  it('restores PMX names, diffuse alpha and the double-sided flag in order', () => {
    const face = new THREE.MeshBasicMaterial({ name: 'Mat_Face' });
    const hair = new THREE.MeshBasicMaterial({ name: 'Mat_Hair' });
    const scene = new THREE.Scene();
    scene.add(new THREE.Mesh(new THREE.BufferGeometry(), [face, hair]));

    expect(applyPmxMaterials(scene, [
      { name: '颜', alpha: 1, doubleSided: true },
      { name: '髮', alpha: 0.6, doubleSided: false },
    ])).toBe(2);
    expect(face.name).toBe('颜');
    expect(face.side).toBe(THREE.DoubleSide);
    expect(face.opacity).toBe(1);
    expect(hair.name).toBe('髮');
    expect(hair.opacity).toBe(0.6);
    expect(hair.transparent).toBe(true);
    expect(hair.side).toBe(THREE.FrontSide);
    expect(applyPmxMaterials(scene, [{ name: '只有一个', alpha: 1, doubleSided: false }])).toBe(0);
  });

  it('warns about missing textures and rejects PMD', async () => {
    const result = await convertPmxModel([new File([new Uint8Array(pmxFixture())], '角色.pmx')]);
    expect(result.warnings.join()).toMatch(/没有在导入的文件里找到/);

    await expect(convertPmxModel([new File([new Uint8Array([1])], 'a.pmd')]))
      .rejects.toThrow(/PMD/);

    expect(isPmxModel(new File([], 'a.PMX'))).toBe(true);
    expect(isPmdModel(new File([], 'a.pmd'))).toBe(true);
  }, 60_000);

  it('loads the largest PMX when an archive contains several', async () => {
    const prop = new File([new Uint8Array(pmxFixture(0, 1, 2, 0))], 'prop.pmx');
    const character = new File([new Uint8Array(pmxFixture(0, 1, 2, 4))], 'character.pmx');
    const result = await convertPmxModel([prop, character]);
    expect(result.file.name).toBe('character.glb');
    expect(result.warnings[0]).toMatch(/2 个 PMX/);
  }, 60_000);
});
