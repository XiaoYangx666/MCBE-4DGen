import { test } from 'vitest';
import assert from 'node:assert/strict';
import { Document } from '@gltf-transform/core';
import sharp from 'sharp';
import { exportHumanoid } from '../src/humanoid.ts';
import type { IntermediateModel } from '../src/model.ts';

async function fixture(): Promise<IntermediateModel> {
  const doc = new Document(), buffer = doc.createBuffer(), scene = doc.createScene();
  doc.getRoot().setDefaultScene(scene);
  const texture = doc.createTexture().setMimeType('image/png').setImage(await sharp({
    create: { width: 4, height: 4, channels: 4, background: '#ff8040' },
  }).png().toBuffer());
  const material = doc.createMaterial().setBaseColorTexture(texture).setMetallicFactor(0).setRoughnessFactor(1);
  const definitions: [string, [number, number, number]][] = [
    ['hips', [0, 1.4, 0]], ['head', [0, 2.7, 0]],
    ['leftUpperArm', [-0.3, 2.3, 0]], ['rightUpperArm', [0.3, 2.3, 0]],
    ['leftUpperLeg', [-0.1, 1.3, 0]], ['rightUpperLeg', [0.1, 1.3, 0]],
    ['leftHand', [-1, 2.3, 0]], ['rightHand', [1, 2.3, 0]],
  ];
  const joints = definitions.map(([role, point]) => {
    const joint = doc.createNode(role).setTranslation(point).setExtras({ _vrmHumanBone: role });
    scene.addChild(joint); return joint;
  });
  const skin = doc.createSkin(); for (const joint of joints) skin.addJoint(joint);
  const mesh = doc.createMesh();
  for (let i = 0; i < 6; i++) {
    const arm = i === 2 || i === 3, sign = i === 2 ? -1 : 1;
    const positions = arm ? [0, 0, 0, sign * 0.5, 0, 0, sign * 0.5, 0.1, 0] :
      [0, 0, 0, 0.1, 0, 0, 0, i > 3 ? -1.3 : 0.1, 0];
    const a = (type: 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4', values: number[]) =>
      doc.createAccessor().setType(type).setArray(Float32Array.from(values)).setBuffer(buffer);
    const p = doc.createPrimitive().setMaterial(material)
      .setAttribute('POSITION', a('VEC3', positions))
      .setAttribute('NORMAL', a('VEC3', [0, 0, 1, 0, 0, 1, 0, 0, 1]))
      .setAttribute('TEXCOORD_0', a('VEC2', [0, 0, 1, 0, 0, 1]))
      .setAttribute('WEIGHTS_0', a('VEC4', [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]))
      .setAttribute('JOINTS_0', doc.createAccessor().setType('VEC4').setArray(
        Uint16Array.from([i, 0, 0, 0, i, 0, 0, 0, i, 0, 0, 0])).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(Uint16Array.from([0, 1, 2])).setBuffer(buffer));
    mesh.addPrimitive(p);
  }
  scene.addChild(doc.createNode().setMesh(mesh).setSkin(skin));
  return { document: doc, source: { path: 'fixture', format: 'vrm', importer: 'gltf-transform',
    units: 'meters', coordinates: 'right-handed-y-up' }, warnings: [] };
}

test('VRM weights produce six independent player parts and lower both arms around source pivots', async () => {
  const model = await fixture();
  const result = await exportHumanoid(model, { height: 32, textureSize: 8 });
  assert.deepEqual(result.binding.parts, { body: 1, head: 1, leftArm: 1, rightArm: 1, leftLeg: 1, rightLeg: 1 });
  const geometry = result.file['geometry.skin0']!;
  for (const part of ['leftArm', 'rightArm']) {
    const bone = geometry.bones.find((b) => b.name === part)!;
    assert.ok(Math.min(...bone.poly_mesh!.positions.map((p) => p[1])) < bone.pivot![1] - 4);
    assert.ok(Math.max(...bone.poly_mesh!.positions.map((p) => p[1])) <= bone.pivot![1] + 0.001);
  }
  assert.equal(geometry.bones.filter((b) => b.poly_mesh).length, 6);
  assert.equal(model.document.getRoot().listSkins().length, 1);
  assert.equal(model.document.getRoot().listMeshes()[0]!.listPrimitives().length, 6);
});

test('humanoid conversion rejects missing explicit source roles instead of guessing anatomy', async () => {
  const model = await fixture();
  model.document.getRoot().listNodes().find((n) => n.getName() === 'leftHand')!.setExtras({});
  await assert.rejects(exportHumanoid(model, { height: 32, textureSize: 8 }), /leftHand/);
});

test('explicit source bone map binds a non-VRM rig and aligns its forward orientation', async () => {
  const model = await fixture();
  const boneMap: Record<string, string> = {};
  for (const node of model.document.getRoot().listNodes()) {
    const role = node.getExtras()._vrmHumanBone;
    if (typeof role === 'string') { boneMap[role] = node.getName(); node.setExtras({}); }
  }
  const result = await exportHumanoid(model, { height: 32, textureSize: 8, profile: { boneMap, rotationYDegrees: 180 } });
  assert.equal(result.binding.parts.leftArm, 1); assert.equal(result.binding.parts.leftLeg, 1);
  assert.ok(result.binding.pivots.leftArm[0] > 0);
  assert.ok(result.file['geometry.skin0']!.bones.find((b) => b.name === 'head')!.poly_mesh!.normals[0]![2] < -0.99);
  await assert.rejects(exportHumanoid(model, { height: 32, textureSize: 8, profile: { boneMap: { ...boneMap, head: 'missing' } } }), /exactly one source node/);
});

test('avatar shoulder profile moves both arm pivots outward and preserves torso and face', async () => {
  const model = await fixture();
  const plain = await exportHumanoid(model, { height: 32, textureSize: 8 });
  const tuned = await exportHumanoid(model, { height: 32, textureSize: 8,
    profile: { shoulderOutset: 1.2, armSpreadDegrees: 12 } });
  for (const name of ['leftArm', 'rightArm']) {
    const a = plain.file['geometry.skin0']!.bones.find((b) => b.name === name)!;
    const b = tuned.file['geometry.skin0']!.bones.find((b) => b.name === name)!;
    assert.ok(Math.abs(Math.abs(b.pivot![0]) - Math.abs(a.pivot![0]) - 1.2) < 1e-6);
    assert.ok(Math.max(...b.poly_mesh!.positions.map((p) => Math.abs(p[0]))) > Math.max(...a.poly_mesh!.positions.map((p) => Math.abs(p[0]))) + 1.2);
  }
  for (const name of ['head', 'body', 'leftLeg', 'rightLeg']) assert.deepEqual(
    tuned.file['geometry.skin0']!.bones.find((b) => b.name === name),
    plain.file['geometry.skin0']!.bones.find((b) => b.name === name));
  await assert.rejects(exportHumanoid(model, { height: 32, textureSize: 8, profile: { armSpreadDegrees: NaN } }), /armSpread/);
});

test('source garment rules retain a connected mixed-weight sleeve and prevent skirt ownership by a leg', async () => {
  const model = await fixture(), doc = model.document;
  const mesh = doc.getRoot().listMeshes()[0]!, buffer = doc.getRoot().listBuffers()[0]!;
  const base = mesh.listPrimitives();
  const skirt = base[4]!.clone().setMaterial(base[4]!.getMaterial()!.clone().setName('Skirt'));
  mesh.addPrimitive(skirt);
  const sleeve = base[2]!.clone().setMaterial(base[2]!.getMaterial()!.clone().setName('Shirt'));
  const a = (type: 'VEC2' | 'VEC3' | 'VEC4', values: number[]) =>
    doc.createAccessor().setType(type).setArray(Float32Array.from(values)).setBuffer(buffer);
  sleeve.setAttribute('POSITION', a('VEC3', [0, 0, 0, -0.1, 0, 0, -0.2, 0.1, 0, -0.3, 0, 0]))
    .setAttribute('NORMAL', a('VEC3', [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]))
    .setAttribute('TEXCOORD_0', a('VEC2', [0, 0, 1, 0, 0, 1, 1, 1]))
    .setAttribute('JOINTS_0', doc.createAccessor().setType('VEC4').setArray(Uint16Array.from(
      [0, 2, 0, 0, 0, 2, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0])).setBuffer(buffer))
    .setAttribute('WEIGHTS_0', a('VEC4', [0.9, 0.1, 0, 0, 0.9, 0.1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(Uint16Array.from([0, 1, 2, 1, 3, 2])).setBuffer(buffer));
  mesh.addPrimitive(sleeve);
  const result = await exportHumanoid(model, { height: 32, textureSize: 8, profile: { materialRules: [
    { material: 'Skirt', mode: 'body' }, { material: 'Shirt', mode: 'arm-components', minArmWeight: 0.35 },
  ] } });
  assert.deepEqual(result.binding.classification.find((r) => r.material === 'Skirt')!.triangles, { body: 1 });
  assert.deepEqual(result.binding.classification.find((r) => r.material === 'Shirt')!.triangles, { leftArm: 2 });
  assert.equal(result.binding.classification.find((r) => r.material === 'Shirt')!.components, 1);
  assert.equal(result.binding.parts.leftLeg, 1);
  assert.equal(result.binding.parts.body, 2);
  await assert.rejects(exportHumanoid(model, { height: 32, textureSize: 8, profile: {
    materialRules: [{ material: 'MissingGarment', mode: 'body' }],
  } }), /material not found/);
});

test('texture-only humanoid rebuild reuses prepared geometry without pose or reduction', async () => {
  let prepared: import('../src/humanoid.ts').PreparedHumanoid | undefined;
  const input = await fixture();
  const full = await exportHumanoid(input, {height:32,textureSize:64,reduction:{ratio:1,maxError:0.03},onPrepared:value => {prepared=value;}});
  assert.ok(prepared);
  const sourceUV = prepared.model.document.getRoot().listMeshes()[0]!.listPrimitives()[0]!.getAttribute('TEXCOORD_0')!.getArray()!.slice();
  const phases:string[]=[];
  const next = await exportHumanoid(input, {height:32,textureSize:64,materialWeights:{'':2},prepared,onStage:phase => phases.push(phase)});
  assert.deepEqual(phases,['atlas','export','done']);
  assert.deepEqual(next.binding.pivots,full.binding.pivots);
  assert.deepEqual(next.binding.parts,full.binding.parts);
  assert.deepEqual(next.binding.reduction,full.binding.reduction);
  for (const bone of full.file['geometry.skin0']!.bones) {
    const reused=next.file['geometry.skin0']!.bones.find(b => b.name===bone.name)!;
    assert.deepEqual(reused.pivot,bone.pivot);
    assert.deepEqual(reused.poly_mesh?.positions,bone.poly_mesh?.positions);
    assert.deepEqual(reused.poly_mesh?.normals,bone.poly_mesh?.normals);
  }
  assert.deepEqual(prepared.model.document.getRoot().listMeshes()[0]!.listPrimitives()[0]!.getAttribute('TEXCOORD_0')!.getArray(),sourceUV);
});
