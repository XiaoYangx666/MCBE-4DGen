import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { getBounds } from '@gltf-transform/core';
import type { Node } from '@gltf-transform/core';
import { fitStaticModel, prepareStaticModel } from '../src/prepare-model.ts';
import { optimizeModel } from '../src/optimizer.ts';
import { documentFixture } from './fixtures.ts';
import type { IntermediateModel } from '../src/model.ts';

async function fixture(skin = false): Promise<IntermediateModel> {
  return { document: await documentFixture(skin), source: { path: 'fixture', format: 'gltf', units: 'meters', coordinates: 'right-handed-y-up', importer: 'gltf-transform' }, warnings: [] };
}
function close(actual: number[], expected: number[], epsilon = 1e-5) {
  assert.equal(actual.length, expected.length);
  actual.forEach((v, i) => assert.ok(Math.abs(v - expected[i]!) <= epsilon, `${actual} != ${expected}`));
}
function first(node: Node, semantic = 'POSITION') {
  const values: number[] = []; node.getMesh()!.listPrimitives()[0]!.getAttribute(semantic)!.getElement(0, values); return values;
}

test('nested world transforms and shared mesh instances bake independently without mutating input', async () => {
  const input = await fixture(), result = await prepareStaticModel(input);
  const root = result.model.document.getRoot();
  assert.equal(root.listMeshes().length, 2);
  assert.equal(result.report.triangles, 2);
  assert.equal(result.report.instances, 2);
  close(result.report.after.min, [10, 0, 0]); close(result.report.after.max, [14, 3, 8]);
  for (const node of root.listNodes()) { close(node.getTranslation(), [0, 0, 0]); close(node.getScale(), [1, 1, 1]); }
  const [a, b] = root.listMeshes();
  assert.notEqual(a!.listPrimitives()[0]!.getAttribute('POSITION'), b!.listPrimitives()[0]!.getAttribute('POSITION'));
  assert.equal(input.document.getRoot().listMeshes().length, 1);
  close(input.document.getRoot().listNodes().find((n) => n.getName() === 'child')!.getTranslation(), [1, 0, 0]);
  assert.deepEqual(result.model.preparation, { snapshot: 'initial-pose', worldTransformsBaked: true, scene: 0 });
});

test('rotation, nonuniform scale, final height, ground centering and translation use the documented order', async () => {
  const result = await prepareStaticModel(await fixture(), { scale: [2, 1, 0.5], rotation: [0, 90, 0], height: 32, center: 'ground', translation: [1, 2, 3] });
  const b = result.report.after;
  assert.ok(Math.abs(b.max[1] - b.min[1] - 32) < 1e-5);
  close([(b.min[0] + b.max[0]) / 2, b.min[1], (b.min[2] + b.max[2]) / 2], [1, 2, 3]);
  close([b.max[0] - b.min[0], b.max[2] - b.min[2]], [4 * 32 / 3, 8 * 32 / 3]);
  const centered = await prepareStaticModel(await fixture(), { center: 'bounds' });
  close(centered.report.after.min.map((v, i) => v + centered.report.after.max[i]!), [0, 0, 0]);
});

test('nonuniform normals use inverse transpose, and reflections preserve triangle orientation', async () => {
  const input = await fixture(), root = input.document.getRoot();
  root.listMeshes()[0]!.listPrimitives()[0]!.getAttribute('NORMAL')!
    .setArray(new Float32Array(Array(3).fill([1 / Math.sqrt(3), 1 / Math.sqrt(3), 1 / Math.sqrt(3)]).flat()));
  const output = await prepareStaticModel(input);
  const n = [0.5, 1 / 3, 0.25], length = Math.hypot(...n);
  close(first(output.model.document.getRoot().listNodes()[0]!, 'NORMAL'), n.map((v) => v / length));
  const reflected = await prepareStaticModel(await fixture(), { scale: [-1, 1, 1] });
  const p = reflected.model.document.getRoot().listMeshes()[0]!.listPrimitives()[0]!;
  const i = p.getIndices()!.getArray()!, a: number[] = [], b: number[] = [], c: number[] = [];
  p.getAttribute('POSITION')!.getElement(i[0]!, a); p.getAttribute('POSITION')!.getElement(i[1]!, b); p.getAttribute('POSITION')!.getElement(i[2]!, c);
  assert.ok((b[0]! - a[0]!) * (c[1]! - a[1]!) - (b[1]! - a[1]!) * (c[0]! - a[0]!) > 0);
});

test('initial skin pose uses jointWorld * inverseBind without applying mesh transform twice', async () => {
  const input = await fixture(true), root = input.document.getRoot();
  root.listNodes().find((n) => n.getName() === 'hips')!.setTranslation([2, 3, 4]);
  const inverse = root.listSkins()[0]!.getInverseBindMatrices()!;
  const matrix: number[] = []; inverse.getElement(0, matrix); matrix[12] = -1; inverse.setElement(0, matrix);
  const result = await prepareStaticModel(input), out = result.model.document.getRoot();
  close(first(out.listNodes().find((n) => n.getName() === 'child')!), [1, 3, 4]);
  close(first(out.listNodes().find((n) => n.getName() === 'other')!), [10, 0, 8]);
  assert.equal(out.listSkins().length, 0);
  assert.ok(out.listMeshes().every((m) => m.listPrimitives().every((p) => !p.getAttribute('WEIGHTS_0') && !p.getAttribute('JOINTS_0'))));
  assert.equal(root.listSkins().length, 1);
  assert.ok(result.report.warnings.some((w) => w.includes('Initial skin pose frozen')));
});

test('normalized weights and multiple influence sets are evaluated before being frozen', async () => {
  const input = await fixture(true), root = input.document.getRoot(), buffer = root.listBuffers()[0]!;
  const otherJoint = input.document.createNode('second').setTranslation([2, 0, 0]);
  root.getDefaultScene()!.addChild(otherJoint);
  const skin = root.listSkins()[0]!; skin.addJoint(otherJoint).setInverseBindMatrices(null);
  const p = root.listMeshes()[0]!.listPrimitives()[0]!;
  p.getAttribute('JOINTS_0')!.setArray(new Uint16Array([0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0]));
  p.getAttribute('WEIGHTS_0')!.setArray(new Uint8Array([128, 127, 0, 0, 128, 127, 0, 0, 128, 127, 0, 0])).setNormalized(true);
  let result = await prepareStaticModel(input);
  close(first(result.model.document.getRoot().listNodes().find((n) => n.getName() === 'child')!), [2 * 127 / 255, 0, 0]);
  p.getAttribute('JOINTS_0')!.setArray(new Uint16Array(12));
  p.getAttribute('WEIGHTS_0')!.setArray(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0])).setNormalized(false);
  p.setAttribute('JOINTS_1', input.document.createAccessor().setType('VEC4').setArray(new Uint16Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0])).setBuffer(buffer));
  p.setAttribute('WEIGHTS_1', p.getAttribute('WEIGHTS_0')!.clone());
  result = await prepareStaticModel(input);
  close(first(result.model.document.getRoot().listNodes().find((n) => n.getName() === 'child')!), [1, 0, 0]);
  assert.ok(result.report.warnings.some((w) => w.includes('normalized')));
});

test('shared morph target uses per-node override or mesh defaults before world baking', async () => {
  const input = await fixture(), doc = input.document, root = doc.getRoot(), mesh = root.listMeshes()[0]!, p = mesh.listPrimitives()[0]!;
  const delta = doc.createAccessor().setType('VEC3').setArray(new Float32Array([2, 0, 0, 2, 0, 0, 2, 0, 0])).setBuffer(root.listBuffers()[0]!);
  p.addTarget(doc.createPrimitiveTarget().setAttribute('POSITION', delta)); mesh.setWeights([1]);
  root.listNodes().find((n) => n.getName() === 'child')!.setWeights([0.5]);
  const result = await prepareStaticModel(input), out = result.model.document.getRoot();
  close(first(out.listNodes().find((n) => n.getName() === 'child')!), [14, 0, 0]);
  close(first(out.listNodes().find((n) => n.getName() === 'other')!), [14, 0, 8]);
  assert.equal(out.listMeshes()[0]!.listPrimitives()[0]!.listTargets().length, 0);
  assert.deepEqual(Array.from(delta.getArray()!), [2, 0, 0, 2, 0, 0, 2, 0, 0]);
});

test('scene selection is explicit and animation initial pose is distinguished from sampled animation', async () => {
  const input = await fixture(), doc = input.document, root = doc.getRoot();
  doc.createAnimation('not evaluated');
  const scene = doc.createScene('second').addChild(doc.createNode('standalone').setMesh(root.listMeshes()[0]!).setTranslation([50, 0, 0]));
  const result = await prepareStaticModel(input, { scene: root.listScenes().indexOf(scene) });
  close(result.report.after.min, [50, 0, 0]); close(result.report.after.max, [51, 1, 0]);
  assert.equal(result.model.document.getRoot().listAnimations().length, 0);
  assert.ok(result.report.warnings.some((w) => w.includes('not evaluated')));
  assert.ok(result.report.warnings.some((w) => w.includes('Only scene')));
});

test('invalid transforms, zero-height scaling, singular nodes and invalid skin weights fail', async () => {
  for (const options of [{ scale: 0 }, { height: -1 }, { rotation: [NaN, 0, 0] as [number, number, number] }, { scene: 99 }]) {
    await assert.rejects(prepareStaticModel(await fixture(), options));
  }
  const flat = await fixture();
  flat.document.getRoot().listMeshes()[0]!.listPrimitives()[0]!.getAttribute('POSITION')!.setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]));
  await assert.rejects(prepareStaticModel(flat, { height: 32 }), /zero-height/);
  const singular = await fixture(); singular.document.getRoot().listNodes()[0]!.setScale([0, 1, 1]);
  await assert.rejects(prepareStaticModel(singular), /singular/);
  const skin = await fixture(true);
  skin.document.getRoot().listMeshes()[0]!.listPrimitives()[0]!.getAttribute('WEIGHTS_0')!.setArray(new Float32Array(12));
  await assert.rejects(prepareStaticModel(skin), /no valid skin influence/);
  const reflected = await fixture(true);
  reflected.document.getRoot().listNodes().find((n) => n.getName() === 'hips')!.setScale([-1, 1, 1]);
  await assert.rejects(prepareStaticModel(reflected), /Reflected or singular blended skin/);
});

test('final fitting occurs after reduction and refuses unfrozen or nonidentity models', async () => {
  await assert.rejects(fitStaticModel(await fixture(), { height: 32 }), /prepared rigid/);
  const result = await optimizeModel(await fixture(), {
    prepare: { height: 32, center: 'ground', translation: [1, 2, 3] },
    mesh: { ratio: 0.5 }, texture: { maxTextureSize: 8, atlasSize: 32 },
  });
  assert.ok(result.model.preparation?.worldTransformsBaked);
  const bounds = getBounds(result.model.document.getRoot().getDefaultScene()!);
  close([bounds.max[1] - bounds.min[1], bounds.min[1]], [32, 2]);
  const invalid = (await prepareStaticModel(await fixture())).model;
  invalid.document.getRoot().listNodes()[0]!.setTranslation([1, 0, 0]);
  await assert.rejects(fitStaticModel(invalid), /identity node/);
});
