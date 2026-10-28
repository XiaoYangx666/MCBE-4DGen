import { test } from 'vitest';
import assert from 'node:assert/strict';
import { Document, type Material } from '@gltf-transform/core';
import { prepareStaticModel } from '../src/prepare-model.ts';
import {
  PART_EXTRA,
  assignParts,
  filterParts,
  partDemands,
  partsByMaterial,
} from '../src/parts.ts';
import type { IntermediateModel } from '../src/model.ts';

const model = (document: Document): IntermediateModel => ({
  document,
  source: {
    path: 'generated',
    format: 'gltf',
    units: 'meters',
    coordinates: 'right-handed-y-up',
    importer: 'gltf-transform',
  },
  warnings: [],
});

/** Triangle with a UV offset so two primitives sample different regions. */
function primitive(
  doc: Document,
  material: Material,
  buffer: ReturnType<Document['createBuffer']>,
  offset: number,
) {
  return doc
    .createPrimitive()
    .setMaterial(material)
    .setAttribute(
      'POSITION',
      doc
        .createAccessor()
        .setType('VEC3')
        .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
        .setBuffer(buffer),
    )
    .setAttribute(
      'NORMAL',
      doc
        .createAccessor()
        .setType('VEC3')
        .setArray(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]))
        .setBuffer(buffer),
    )
    .setAttribute(
      'TEXCOORD_0',
      doc
        .createAccessor()
        .setType('VEC2')
        .setArray(new Float32Array([offset, 0, offset + 0.2, 0, offset, 0.2]))
        .setBuffer(buffer),
    )
    .setIndices(
      doc
        .createAccessor()
        .setType('SCALAR')
        .setArray(new Uint16Array([0, 1, 2]))
        .setBuffer(buffer),
    );
}

function document() {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const shared = doc.createMaterial('Shared');
  const other = doc.createMaterial('Other');
  const meshA = doc
    .createMesh('A')
    .addPrimitive(primitive(doc, shared, buffer, 0))
    .addPrimitive(primitive(doc, shared, buffer, 0.4));
  const meshB = doc.createMesh('B').addPrimitive(primitive(doc, other, buffer, 0.8));
  const nodeA = doc.createNode('body').setMesh(meshA);
  const nodeB = doc.createNode('prop').setMesh(meshB);
  const nodeC = doc.createNode('propCopy').setMesh(meshB);
  const scene = doc.createScene('main').addChild(nodeA).addChild(nodeB).addChild(nodeC);
  doc.getRoot().setDefaultScene(scene);
  return doc;
}

test('assignParts distinguishes primitives that share one material', () => {
  const doc = document();
  const parts = assignParts(doc);
  const ids = parts.map((part) => part.id);
  assert.deepEqual(ids, ['p0.0', 'p0.1', 'n1', 'n2']);
  assert.equal(parts[0]!.materialKey, parts[1]!.materialKey);
  assert.equal(parts[0]!.materialName, 'Shared');
  assert.equal(parts[2]!.instancePart, true);
  assert.equal(parts[2]!.materialName, 'Other');

  const byMaterial = partsByMaterial(doc);
  assert.equal([...byMaterial.values()].find((list) => list.length === 2)!.length, 2);

  // Idempotent: reading again returns the same ids.
  assert.deepEqual(assignParts(doc).map((part) => part.id), ids);
});

test('deleting one part keeps the other part that shares the material', () => {
  const doc = document();
  const report = filterParts(doc, new Set(['p0.1', 'n1', 'n2']));
  assert.deepEqual(report.removed.map((part) => part.id), ['p0.0']);
  const root = doc.getRoot();
  const meshes = root.listMeshes();
  const meshA = meshes.find((mesh) => mesh.getName() === 'A')!;
  assert.equal(meshA.listPrimitives().length, 1);
  // The shared material object is untouched and still referenced.
  const shared = root.listMaterials().find((material) => material.getName() === 'Shared')!;
  assert.equal(meshA.listPrimitives()[0]!.getMaterial(), shared);
  assert.equal(shared.listParents().includes(meshA.listPrimitives()[0]!), true);
  // UVs of the surviving part are unchanged.
  const uv = meshA.listPrimitives()[0]!.getAttribute('TEXCOORD_0')!;
  const value: number[] = [];
  uv.getElement(0, value);
  assert.ok(Math.abs((value[0] ?? 0) - 0.4) < 1e-6);
});

test('deleting an instanced node keeps the other instance of the same mesh', () => {
  const doc = document();
  const report = filterParts(doc, new Set(['p0.0', 'p0.1', 'n2']));
  assert.deepEqual(report.removed.map((part) => part.id), ['n1']);
  const nodes = doc.getRoot().listNodes().filter((node) => node.getMesh());
  assert.equal(nodes.length, 2);
  assert.ok(nodes.some((node) => node.getName() === 'propCopy'));
  assert.ok(!nodes.some((node) => node.getName() === 'prop'));
});

test('part ids survive prepareModel', async () => {
  const source = document();
  const before = assignParts(source).map((part) => part.id);
  const prepared = await prepareStaticModel(model(source));
  const after = assignParts(prepared.model.document);
  assert.deepEqual(after.map((part) => part.id).sort(), before.sort());
  // Instanced parts keep their node-level ids instead of collapsing by name.
  assert.ok(after.some((part) => part.id === 'n1'));
  assert.ok(after.some((part) => part.id === 'n2'));
});

test('partDemands accounts world and UV area per part', () => {
  const doc = document();
  const demands = partDemands(doc);
  assert.equal(demands.length, 4);
  for (const demand of demands) {
    assert.equal(demand.triangles, 1);
    assert.ok(demand.worldArea > 0);
    assert.ok(demand.uvArea > 0);
  }
  const removed = new Set(['p0.0']);
  const kept = new Set(['p0.1', 'n1', 'n2']);
  const keptArea = demands
    .filter((demand) => kept.has(demand.part.id))
    .reduce((sum, demand) => sum + demand.uvArea, 0);
  const totalArea = demands.reduce((sum, demand) => sum + demand.uvArea, 0);
  assert.ok(keptArea < totalArea);
  assert.ok(demands.some((demand) => demand.part.id === 'p0.0' && demand.uvArea > 0));
});
