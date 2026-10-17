import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Document } from '@gltf-transform/core';
import { optimizeMesh } from '../src/mesh-optimizer.ts';
import { documentFixture } from './fixtures.ts';
import type { IntermediateModel } from '../src/model.ts';

const model = (document: Document): IntermediateModel => ({ document,
  source: { path: 'generated', format: 'gltf', units: 'meters', coordinates: 'right-handed-y-up', importer: 'gltf-transform' }, warnings: [] });

function grid(curved = false): IntermediateModel {
  const doc = new Document(), buffer = doc.createBuffer();
  const pos: number[] = [], uv: number[] = [], indices: number[] = [];
  const n = 24;
  for (let y = 0; y <= n; y++) for (let x = 0; x <= n; x++) {
    pos.push(x / n, y / n, curved ? 0.3 * Math.sin(x / n * Math.PI) * Math.sin(y / n * Math.PI) : 0);
    uv.push(x / n, y / n);
  }
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const a = y * (n + 1) + x, b = a + 1, c = a + n + 1, d = c + 1;
    indices.push(a, b, c, b, d, c);
  }
  const primitive = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(Float32Array.from(pos)).setBuffer(buffer))
    .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(Float32Array.from(uv)).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(Uint32Array.from(indices)).setBuffer(buffer));
  const mesh = doc.createMesh().addPrimitive(primitive);
  doc.getRoot().setDefaultScene(doc.createScene().addChild(doc.createNode().setMesh(mesh)));
  return model(doc);
}

test('real simplification reduces triangle count, respects UV, leaves source intact', async () => {
  const input = grid();
  const originalPositions = Array.from(input.document.getRoot().listMeshes()[0]!.listPrimitives()[0]!.getAttribute('POSITION')!.getArray()!);
  const { model: output, report } = await optimizeMesh(input, { ratio: 0.5, maxError: 0.01 });
  assert.equal(report.before, 1152);
  assert.ok(report.after <= 576);
  assert.ok(report.after > 0);
  assert.ok(report.primitives.every((p) => p.achievedError <= 0.01 + 1e-6));
  const p = output.document.getRoot().listMeshes()[0]!.listPrimitives()[0]!;
  const pos = p.getAttribute('POSITION')!, uv = p.getAttribute('TEXCOORD_0')!;
  for (let i = 0; i < pos.getCount(); i++) {
    const v: number[] = [], t: number[] = []; pos.getElement(i, v); uv.getElement(i, t);
    assert.deepEqual(t, v.slice(0, 2));
  }
  assert.deepEqual(Array.from(input.document.getRoot().listMeshes()[0]!.listPrimitives()[0]!.getAttribute('POSITION')!.getArray()!), originalPositions);
  assert.equal(report.generatedNormals, 1);
});

test('strict error budget retains curved detail and reports unmet target', async () => {
  const result = await optimizeMesh(grid(true), { triangles: 2, maxError: 0 });
  assert.ok(result.report.after > 2);
  assert.ok(result.report.warnings.some((w) => w.includes('retained')));
  assert.ok(result.report.primitives.every((p) => p.achievedError <= 1e-6));
});

test('Original preset keeps all valid faces; cleanup removes degenerate and unused data', async () => {
  const input = model(await documentFixture());
  const p = input.document.getRoot().listMeshes()[0]!.listPrimitives()[0]!;
  p.getIndices()!.setArray(new Uint16Array([0, 1, 2, 0, 0, 1]));
  const result = await optimizeMesh(input, { preset: 'original' });
  assert.equal(result.report.before, 2);
  assert.equal(result.report.after, 1);
  assert.equal(result.report.removedDegenerates, 1);
  assert.equal((await optimizeMesh(grid(), { preset: 'original' })).report.after, 1152);
});

test('material and skin boundaries do not weld together; small components remain', async () => {
  const doc = await documentFixture(true);
  const p = doc.getRoot().listMeshes()[0]!.listPrimitives()[0]!;
  const q = p.clone().setMaterial(doc.createMaterial('different'));
  doc.getRoot().listMeshes()[0]!.addPrimitive(q);
  const output = await optimizeMesh(model(doc), { triangles: 1, maxError: 1 });
  assert.equal(output.report.after, 2);
  const [a, b] = output.model.document.getRoot().listMeshes()[0]!.listPrimitives();
  assert.notEqual(a!.getMaterial(), b!.getMaterial());
  assert.notEqual(a!.getAttribute('POSITION'), b!.getAttribute('POSITION'));
  assert.deepEqual(Array.from(a!.getAttribute('WEIGHTS_0')!.getArray()!), [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
  assert.ok(output.report.warnings.length);
});

test('adjacent rigid skin regions retain their shared boundary during real simplification', async () => {
  const input = grid(), doc = input.document, root = doc.getRoot();
  const p = root.listMeshes()[0]!.listPrimitives()[0]!, position = p.getAttribute('POSITION')!;
  const joint0 = doc.createNode('left'), joint1 = doc.createNode('right');
  root.getDefaultScene()!.addChild(joint0).addChild(joint1);
  const skin = doc.createSkin().addJoint(joint0).addJoint(joint1);
  root.listNodes()[0]!.setSkin(skin);
  const joints = new Uint16Array(position.getCount() * 4), weights = new Float32Array(position.getCount() * 4);
  const protectedVertices = new Set<string>();
  for (let i = 0; i < position.getCount(); i++) {
    const v: number[] = []; position.getElement(i, v);
    joints[i * 4] = v[0]! > 0.5 ? 1 : 0; weights[i * 4] = 1;
    if (Math.abs(v[0]! - 0.5) < 1e-6 || Math.abs(v[0]! - 13 / 24) < 1e-6) protectedVertices.add(v.join(','));
  }
  p.setAttribute('JOINTS_0', doc.createAccessor().setType('VEC4').setArray(joints).setBuffer(root.listBuffers()[0]!));
  p.setAttribute('WEIGHTS_0', doc.createAccessor().setType('VEC4').setArray(weights).setBuffer(root.listBuffers()[0]!));
  const result = await optimizeMesh(input, { ratio: 0.5, maxError: 0.01 });
  assert.ok(result.report.after < result.report.before);
  const out = result.model.document.getRoot().listMeshes()[0]!.listPrimitives()[0]!.getAttribute('POSITION')!;
  const actual = new Set<string>();
  for (let i = 0; i < out.getCount(); i++) { const v: number[] = []; out.getElement(i, v); actual.add(v.join(',')); }
  for (const v of protectedVertices) assert.ok(actual.has(v), `Missing skin-boundary vertex ${v}`);
});

test('invalid options and all-degenerate geometry fail', async () => {
  for (const options of [{ ratio: 0 }, { triangles: 1.5 }, { maxError: NaN }, { ratio: 0.5, preset: 'high' as const }]) {
    await assert.rejects(optimizeMesh(grid(), options));
  }
  const input = model(await documentFixture());
  input.document.getRoot().listMeshes()[0]!.listPrimitives()[0]!.getIndices()!.setArray(new Uint16Array([0, 0, 0]));
  await assert.rejects(optimizeMesh(input), /All triangles are degenerate/);
});
