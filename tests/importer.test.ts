import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { NodeIO } from '@gltf-transform/core';
import { importModel } from '../src/importer.ts';
import { inspectModel } from '../src/inspect.ts';
import { documentFixture, writeDocument, writeObj } from './fixtures.ts';

async function temporary(work: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), '4d-import-'));
  try { await work(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

for (const type of ['glb', 'gltf'] as const) {
  test(`${type}: retains shared mesh, hierarchy, local transforms, normals, UV and texture alpha`, () => temporary(async (dir) => {
    const path = await writeDocument(dir, type);
    const model = await importModel(path);
    const report = await inspectModel(model);
    assert.equal(report.counts.meshes, 1);
    assert.equal(report.counts.vertices, 3);
    assert.equal(report.counts.triangles, 1);
    assert.equal(report.counts.meshInstances, 2);
    assert.equal(report.counts.instanceTriangles, 2);
    assert.deepEqual(report.bounds, { min: [10, 0, 0], max: [14, 3, 8], size: [4, 3, 8] });
    assert.deepEqual(model.document.getRoot().listNodes().find((n) => n.getName() === 'child')?.getTranslation(), [1, 0, 0]);
    assert.equal(report.textures[0]?.width, 8);
    assert.equal(report.textures[0]?.height, 4);
    assert.equal(report.textures[0]?.hasAlpha, true);
    assert.equal(report.materials[0]?.alphaMode, 'BLEND');
    assert.deepEqual(report.materials[0]?.baseColor, [1, 1, 1, 0.5]);
    const primitive = model.document.getRoot().listMeshes()[0]!.listPrimitives()[0]!;
    assert.deepEqual(Array.from(primitive.getAttribute('NORMAL')!.getArray()!), [0, 0, 1, 0, 0, 1, 0, 0, 1]);
    assert.deepEqual(Array.from(primitive.getAttribute('TEXCOORD_0')!.getArray()!), [0, 0, 1, 0, 0, 1]);
    // Inspection must not bake transforms or mutate the reusable Document.
    assert.deepEqual(model.document.getRoot().listNodes()[0]?.getScale(), [2, 3, 4]);
  }));
}

for (const backend of ['native', 'wasm'] as const) {
  test(`OBJ ${backend}: multiple objects, materials and external PNG are retained`, () => temporary(async (dir) => {
    const model = await importModel(await writeObj(dir), { backend });
    const report = await inspectModel(model);
    assert.equal(report.source.backend, backend);
    assert.equal(report.counts.triangles, 2);
    assert.equal(report.counts.vertices, 6);
    assert.equal(report.counts.meshes, 2);
    const green = report.materials.find((m) => m.name === 'green');
    const red = report.materials.find((m) => m.name === 'red');
    assert.equal(green?.baseColorTexture, 0);
    assert.deepEqual(red?.baseColor.slice(0, 3), [1, 0, 0]);
    assert.equal(report.textures[0]?.hasAlpha, true);
    assert.deepEqual(report.bounds?.size, [3, 1, 0]);
    assert.equal(report.source.units, 'unspecified');
  }));
}

test('GLB preserves joint hierarchy, inverse bind matrices and original skin weights', () => temporary(async (dir) => {
  const model = await importModel(await writeDocument(dir, 'glb', true));
  const report = await inspectModel(model);
  assert.equal(report.counts.skins, 1);
  assert.equal(report.counts.joints, 1);
  assert.equal(report.skins[0]?.joints[0]?.name, 'hips');
  assert.equal(report.skins[0]?.inverseBindMatrices, 1);
  const p = model.document.getRoot().listMeshes()[0]!.listPrimitives()[0]!;
  assert.deepEqual(Array.from(p.getAttribute('WEIGHTS_0')!.getArray()!), [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
  assert.ok(report.warnings.some((s) => s.includes('not evaluated skin deformation')));
}));

test('nested rotation and nonuniform scale contribute to world bounds', () => temporary(async (dir) => {
  const doc = await documentFixture();
  const parent = doc.getRoot().listNodes()[0]!;
  parent.removeChild(doc.getRoot().listNodes().find((n) => n.getName() === 'other')!);
  parent.setRotation([0, 0, Math.SQRT1_2, Math.SQRT1_2]);
  const path = join(dir, 'rotated.glb');
  await new NodeIO().write(path, doc);
  const report = await inspectModel(await importModel(path));
  assert.ok(report.bounds);
  report.bounds.min.forEach((v, i) => assert.ok(Math.abs(v - [7, 2, 0][i]!) < 1e-6));
  report.bounds.max.forEach((v, i) => assert.ok(Math.abs(v - [10, 4, 0][i]!) < 1e-6));
}));

test('OBJ quad is triangulated by Assimp; glTF nonindexed triangles are counted', () => temporary(async (dir) => {
  const path = join(dir, 'quad.obj');
  await writeFile(path, 'v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3 4\n');
  assert.equal((await inspectModel(await importModel(path))).counts.triangles, 2);
  const doc = await documentFixture();
  doc.getRoot().listMeshes()[0]!.listPrimitives()[0]!.setIndices(null);
  const glb = join(dir, 'nonindexed.glb');
  await new NodeIO().write(glb, doc);
  assert.equal((await inspectModel(await importModel(glb))).counts.triangles, 1);
}));

test('percent-encoded texture filenames resolve without losing image data', () => temporary(async (dir) => {
  const path = await writeDocument(dir, 'gltf');
  const json = JSON.parse(await readFile(path, 'utf8'));
  const image = await readFile(join(dir, json.images[0].uri));
  await writeFile(join(dir, 'image with space.png'), image);
  json.images[0].uri = 'image%20with%20space.png';
  await writeFile(path, JSON.stringify(json));
  assert.equal((await inspectModel(await importModel(path))).textures[0]?.width, 8);
}));

test('missing MTL, missing PNG, missing external buffer and corrupt texture fail explicitly', () => temporary(async (dir) => {
  const obj = await writeObj(dir);
  await rm(join(dir, 'material.mtl'));
  await assert.rejects(importModel(obj), /Missing OBJ resources|IMPORT_FAILED|material.mtl/i);
  await writeFile(join(dir, 'material.mtl'), 'newmtl green\nmap_Kd textures/color.png\nnewmtl red\nKd 1 0 0\n');
  await rm(join(dir, 'textures', 'color.png'));
  await assert.rejects(importModel(obj), /ENOENT|color.png/i);
  await writeFile(join(dir, 'textures', 'color.png'), 'not a png');
  await assert.rejects(inspectModel(await importModel(obj)), /unsupported image|corrupt|invalid|input/i);
  const path = await writeDocument(dir, 'gltf');
  const json = JSON.parse(await readFile(path, 'utf8'));
  await rm(join(dir, json.buffers[0].uri));
  await assert.rejects(importModel(path), /ENOENT/);
}));

test('external resources outside the model folder are rejected, including symlinks', () => temporary(async (dir) => {
  const path = await writeDocument(dir, 'gltf');
  const json = JSON.parse(await readFile(path, 'utf8'));
  json.images[0].uri = '../outside.png';
  await writeFile(path, JSON.stringify(json));
  await assert.rejects(importModel(path), /outside the model directory/);
  json.images[0].uri = 'linked.png';
  await symlink('/etc/hosts', join(dir, 'linked.png'));
  await writeFile(path, JSON.stringify(json));
  await assert.rejects(importModel(path), /outside the model directory/);
  json.images[0].uri = 'https://example.com/texture.png';
  await writeFile(path, JSON.stringify(json));
  await assert.rejects(importModel(path), /schemes are unsupported|network|HTTP/i);
}));

test('invalid indices, non-finite positions, non-triangle primitives and unknown required extensions fail', () => temporary(async (dir) => {
  const path = join(dir, 'bad.glb');
  for (const type of ['indices', 'positions', 'mode'] as const) {
    const doc = await documentFixture();
    const p = doc.getRoot().listMeshes()[0]!.listPrimitives()[0]!;
    if (type === 'indices') p.getIndices()!.setArray(new Uint16Array([0, 1, 99]));
    if (type === 'positions') p.getAttribute('POSITION')!.setArray(new Float32Array([NaN, 0, 0, 1, 0, 0, 0, 1, 0]));
    if (type === 'mode') p.setMode(1);
    await new NodeIO().write(path, doc);
    await assert.rejects(importModel(path), /Index outside|Non-finite|Only triangle/);
  }
  const gltf = join(dir, 'unknown.gltf');
  await writeFile(gltf, JSON.stringify({ asset: { version: '2.0' }, extensionsUsed: ['TEST_missing'], extensionsRequired: ['TEST_missing'] }));
  await assert.rejects(importModel(gltf), /extension/i);
}));

test('Node CLI outputs parseable JSON and returns failure without a success report', () => temporary(async (dir) => {
  const path = await writeDocument(dir, 'glb');
  const cli = resolve('src/cli.ts');
  // Node binary is explicit: Bun's process.execPath points to Bun.
  const node = process.env.CODEX_PRIMARY_RUNTIME_NODE ?? 'node';
  const result = spawnSync(node, [cli, 'inspect', path, '--json'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).counts.triangles, 1);
  for (const args of [['inspect', join(dir, 'missing.glb')], ['inspect', path, '--oops'], ['convert', path]]) {
    const failure = spawnSync(node, [cli, ...args], { encoding: 'utf8' });
    assert.equal(failure.status, 1);
    assert.equal(failure.stdout, '');
    assert.match(failure.stderr, /Error:/);
  }
}));
