import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { detectHumanoidRig } from '../webapp/engine/humanoid.ts';
import { extractModel } from '../webapp/engine/extract.ts';
import { buildBedrockGeometry } from '../webapp/engine/bedrock.ts';

function humanoidScene() {
  const scene = new THREE.Scene();
  const roots = new THREE.Group();
  scene.add(roots);
  const bones: Record<string, THREE.Bone> = {};
  const add = (name: string, parent: THREE.Object3D, x: number, y: number, z = 0) => {
    const bone = new THREE.Bone();
    bone.name = name;
    bone.position.set(x, y, z);
    (parent === roots ? roots : parent).add(bone);
    bones[name] = bone;
    return bone;
  };
  const hips = add('hips', roots, 0, 1.5, 0);
  add('head', hips, 0, 1.2);
  const leftArm = add('leftUpperArm', hips, -0.4, 0.8);
  add('leftHand', leftArm, -0.7, 0);
  const rightArm = add('rightUpperArm', hips, 0.4, 0.8);
  add('rightHand', rightArm, 0.7, 0);
  add('leftUpperLeg', hips, -0.2, -0.1);
  add('rightUpperLeg', hips, 0.2, -0.1);

  const names = [
    'hips',
    'head',
    'leftUpperArm',
    'rightUpperArm',
    'leftUpperLeg',
    'rightUpperLeg',
  ];
  // Six independent triangles, each fully weighted to one player bone.
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const skinIndex: number[] = [];
  const skinWeight: number[] = [];
  names.forEach((name, index) => {
    const x = index * 0.2;
    positions.push(x, 0, 0, x + 0.1, 0, 0, x, 0.1, 0);
    normals.push(0, 0, 1, 0, 0, 1, 0, 0, 1);
    uvs.push(0, 0, 1, 0, 0, 1);
    for (let corner = 0; corner < 3; corner++) {
      skinIndex.push(index, 0, 0, 0);
      skinWeight.push(1, 0, 0, 0);
    }
    expect(bones[name]).toBeDefined();
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
  const material = new THREE.MeshBasicMaterial({ name: 'body' });
  const mesh = new THREE.SkinnedMesh(geometry, material);
  scene.add(mesh);
  const skeleton = new THREE.Skeleton(names.map((name) => bones[name]!));
  mesh.bind(skeleton);
  scene.updateMatrixWorld(true);
  return { scene, names };
}

describe('webapp six-part humanoid binding', () => {
  it('detects a complete VRM/MMD-style rig', () => {
    const { scene } = humanoidScene();
    const rig = detectHumanoidRig(scene);
    expect(rig).not.toBeNull();
    expect(rig!.partNodes.leftArm.name).toBe('leftUpperArm');
    expect(rig!.partNodes.head.name).toBe('head');
  });

  it('classifies every triangle and emits six player parts', () => {
    const { scene } = humanoidScene();
    const rig = detectHumanoidRig(scene)!;
    const extracted = extractModel(scene, { rig, bakeSkinning: true });
    expect(extracted.rig).not.toBeNull();
    expect(Array.from(extracted.batches[0]!.parts ?? [])).toEqual([0, 1, 2, 3, 4, 5]);

    const { file, report } = buildBedrockGeometry(extracted.batches, {
      height: 32,
      doubleSided: 'front',
      rig: extracted.rig!,
    });
    const geometry = file['geometry.skin0'];
    const skinned = geometry.bones.filter((bone) => bone.poly_mesh);
    expect(skinned).toHaveLength(6);
    expect(skinned.every((bone) => bone.poly_mesh!.polys.length === 1)).toBe(true);
    expect(report.parts).toMatchObject({ body: 1, head: 1, leftArm: 1, rightArm: 1, leftLeg: 1, rightLeg: 1 });

    const leftArm = geometry.bones.find((bone) => bone.name === 'leftArm')!;
    const rightArm = geometry.bones.find((bone) => bone.name === 'rightArm')!;
    // Bedrock mirrors X, so the source's left arm is the larger local X.
    expect(leftArm.pivot![0]).toBeGreaterThan(rightArm.pivot![0]);
  });
});
