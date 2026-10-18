import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { Document } from '@gltf-transform/core';
import type { IntermediateModel } from '../src/model.ts';
import { reduceRigidModel } from '../src/rigid-mesh-reducer.ts';

test('rigid reducer removes invisible shell and reduces each material/bone group without source-weight locks', async () => {
  const doc = new Document(), buffer = doc.createBuffer(), scene = doc.createScene(), mesh = doc.createMesh();
  doc.getRoot().setDefaultScene(scene); scene.addChild(doc.createNode().setMesh(mesh));
  for (const [part, offset] of [['body', 0], ['head', 12]] as const) {
    const pos: number[] = [], normal: number[] = [], uv: number[] = [], indices: number[] = [];
    for (let y = 0; y <= 20; y++) for (let x = 0; x <= 20; x++) { pos.push(x / 2 + offset, y / 2, 0); normal.push(0, 0, 1); uv.push(x / 20, y / 20); }
    for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) { const i = y * 21 + x; indices.push(i, i + 1, i + 21, i + 1, i + 22, i + 21); }
    const a = (type: 'VEC3' | 'VEC2' | 'SCALAR', values: number[]) => doc.createAccessor().setType(type).setArray(Float32Array.from(values)).setBuffer(buffer);
    const p = doc.createPrimitive().setExtras({ _playerPart: part }).setMaterial(doc.createMaterial(part))
      .setAttribute('POSITION', a('VEC3', pos)).setAttribute('NORMAL', a('VEC3', normal)).setAttribute('TEXCOORD_0', a('VEC2', uv))
      .setAttribute('_SOURCE_SKIN_REGION', a('SCALAR', Array.from({ length: pos.length / 3 }, (_, i) => i)))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(Uint32Array.from(indices)).setBuffer(buffer));
    mesh.addPrimitive(p);
  }
  mesh.addPrimitive(mesh.listPrimitives()[0]!.clone().setMaterial(doc.createMaterial('invisible-outline').setAlphaMode('BLEND').setBaseColorFactor([0, 0, 0, 0])));
  const model: IntermediateModel = { document: doc, source: { path: 'fixture', format: 'gltf', importer: 'gltf-transform', units: 'meters', coordinates: 'right-handed-y-up' },
    warnings: [], preparation: { snapshot: 'initial-pose', worldTransformsBaked: true, scene: 0 } };
  const reduced = await reduceRigidModel(model, { ratio: 0.15, maxError: 0.03 });
  assert.equal(reduced.report.invisibleTriangles, 800);
  assert.ok(reduced.report.after < 500);
  const parts = reduced.model.document.getRoot().listMeshes().flatMap((m) => m.listPrimitives());
  assert.deepEqual(parts.map((p) => p.getExtras()._playerPart), ['body', 'head']);
  assert.ok(parts.every((p) => !p.getAttribute('_SOURCE_SKIN_REGION')));
  assert.equal(mesh.listPrimitives().length, 3);
  assert.ok(mesh.listPrimitives()[0]!.getAttribute('_SOURCE_SKIN_REGION'));
});
