import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { NodeIO } from '@gltf-transform/core';
import { importModel } from '../src/importer.ts';
import { inspectModel } from '../src/inspect.ts';
import { prepareStaticModel } from '../src/prepare-model.ts';
import { validateSkinPackPath } from '../src/skin-pack.ts';
import { documentFixture, png } from './fixtures.ts';
import { pmxFixture } from './pmx-fixture.ts';
import { readPMXMaterials } from '../src/pmx-metadata.ts';
import { prepareVRM } from '../src/avatar-import.ts';

async function temporary(fn: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), '4d-avatar-'));
  try { await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}
const run = (args: string[]) => spawnSync(process.execPath, ['src/cli.ts', ...args], { encoding: 'utf8' });

test('PMX 2.0/2.1 UTF16/UTF8, 1/2/4 byte indices, Chinese sidecars, double-sided flags and rest skin survive native/WASM', () => temporary(async (dir) => {
  await mkdir(join(dir, '贴图'));
  for (const name of ['脸', '衣服']) await writeFile(join(dir, '贴图', name + '.png'), await png());
  for (const version of [2, 2.1] as const) for (const encoding of [0, 1] as const) for (const size of [1, 2, 4] as const) {
    const path = join(dir, '中文模型.pmx'); await writeFile(path, pmxFixture(encoding, size, version));
    for (const backend of ['native', 'wasm'] as const) {
      const model = await importModel(path, { backend });
      const report = await inspectModel(model);
      assert.equal(report.counts.triangles, 2);
      assert.equal(report.counts.materials, 2);
      assert.equal(report.counts.textures, 2);
      assert.equal(report.counts.joints, 2);
      assert.equal(report.materials[0]!.doubleSided, true);
      assert.equal(report.materials[1]!.doubleSided, false);
      assert.equal(report.materials[1]!.baseColor[3], 0.5);
      assert.equal(report.materials[0]!.alphaMode, 'BLEND');
      assert.equal(report.materials[0]!.name, '脸');
      assert.ok(model.document.getRoot().listNodes().some((n) => n.getName() === '上半身'));
      const prepared = await prepareStaticModel(model);
      const bounds = (await inspectModel(prepared.model)).bounds!;
      assert.deepEqual(bounds.min, [0, 0, 0]);
      assert.deepEqual(bounds.max, [3, 1, 0]); // bind pose must not shift the second triangle up
    }
  }
  const path = join(dir, '中文模型.pmx'), out = join(dir, 'pack');
  const converted = run(['convert', path, '--out', out, '--atlas', '64']);
  assert.equal(converted.status, 0, converted.stderr);
  assert.equal(JSON.parse(converted.stdout).triangles, 3); // only first material is two-sided
  assert.equal((await validateSkinPackPath(out + '.zip')).skins, 1);
  await rm(join(dir, '贴图', '脸.png'));
  await assert.rejects(importModel(path), /ENOENT|Missing PMX resources/);
}));

test('PMX metadata rejects malformed headers/counts before native import', async () => {
  const good = pmxFixture();
  assert.equal(readPMXMaterials(good).materials.length, 2);
  for (const length of [0, 12, 80, 200, 400]) assert.throws(() => readPMXMaterials(good.subarray(0, length)));
  const bad = Buffer.from(good); bad[0] = 0;
  assert.throws(() => readPMXMaterials(bad), /signature/);
  const globals = Buffer.from(good); globals[8] = 7;
  assert.throws(() => readPMXMaterials(globals), /globals/);
});

async function writeVRM(dir: string, version: '0' | '1', requiredUnknown = false) {
  const io = new NodeIO(), document = await documentFixture(true);
  const original = Buffer.from(await io.writeBinary(document));
  const json = await io.binaryToJSON(original);
  json.json.extensions ??= {};
  json.json.extensionsUsed ??= [];
  const ext = version === '0' ? 'VRM' : 'VRMC_vrm';
  json.json.extensionsUsed.push(ext);
  json.json.extensions[ext] = version === '0' ? {
    specVersion: '0.0', meta: { title: '测试角色', author: 'Test Author', licenseName: 'CC0' },
    materialProperties: [{ shader: 'VRM/MToon', vectorProperties: { _Color: [1, 0.5, 1, 0.5], _MainTex: [0, 0, 1, 1] },
      textureProperties: { _MainTex: 0 }, floatProperties: { _CullMode: 0, _BlendMode: 2 } }],
  } : { specVersion: '1.0', meta: { name: '测试角色', authors: ['Test Author'], licenseUrl: 'https://example.test/license' } };
  json.json.extensionsRequired = [ext];
  if (version === '1') {
    json.json.extensionsUsed.push('VRMC_materials_mtoon');
    json.json.extensionsRequired.push('VRMC_materials_mtoon');
    json.json.materials![0]!.extensions = { VRMC_materials_mtoon: { specVersion: '1.0' } };
  }
  if (requiredUnknown) json.json.extensionsRequired.push('TEST_unknown_required');
  const encoded = Buffer.from(JSON.stringify(json.json));
  const padded = Buffer.alloc(Math.ceil(encoded.length / 4) * 4, 32); encoded.copy(padded);
  const binChunk = original.subarray(20 + original.readUInt32LE(12));
  const header = Buffer.alloc(20); header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + padded.length + binChunk.length, 8); header.writeUInt32LE(padded.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  const path = join(dir, 'avatar.vrm'); await writeFile(path, Buffer.concat([header, padded, binChunk]));
  return path;
}

for (const version of ['0', '1'] as const) test(`VRM ${version}: initial skin, metadata, material fallback, full output and unknown required extension handling`, () => temporary(async (dir) => {
  const path = await writeVRM(dir, version);
  const model = await importModel(path), report = await inspectModel(model);
  assert.equal(model.source.importer, 'gltf-transform');
  assert.equal(model.source.avatar!.name, '测试角色');
  assert.deepEqual(model.source.avatar!.authors, ['Test Author']);
  assert.equal(report.counts.skins, 1);
  if (version === '0') {
    assert.equal(report.materials[0]!.doubleSided, true);
    assert.equal(report.materials[0]!.baseColor[1], 0.5);
    assert.equal(report.materials[0]!.alphaMode, 'BLEND');
  }
  const out = join(dir, 'pack');
  const result = run(['convert', path, '--out', out, '--atlas', '64']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal((await validateSkinPackPath(out + '.zip')).skins, 1);
  await writeVRM(dir, version, true);
  await assert.rejects(importModel(path), /extension/i);
}));

test('VRM explicit MToon limitations reject unsupported front culling/UV transforms and retain unknown required extensions', () => {
  const make = () => ({ json: { asset: { version: '2.0' }, materials: [{}], extensions: { VRM: { specVersion: '0.0', materialProperties: [{ shader: 'VRM/MToon', floatProperties: { _CullMode: 1 } }] } } }, resources: {} });
  assert.throws(() => prepareVRM(make() as any, () => {}), /front-face culling/);
  const data = make(); (data.json.extensions.VRM.materialProperties[0] as any).floatProperties = {};
  (data.json.extensions.VRM.materialProperties[0] as any).vectorProperties = { _MainTex: [0.2, 0, 1, 1] };
  assert.throws(() => prepareVRM(data as any, () => {}), /texture transforms/);
});

test('rigged FBX imports joint weights through native/WASM and converts to a static pack', () => temporary(async (dir) => {
  const { createAssimp } = await import('libassimp');
  const doc = await documentFixture(true);
  for (const node of doc.getRoot().listNodes()) {
    if (node.getName() === 'other') node.dispose();
    else { node.setTranslation([0, 0, 0]); node.setScale([1, 1, 1]); }
  }
  const assimp = await createAssimp({ backend: 'native' });
  try {
    const files = (await assimp.convert({ name: 'rig.glb', bytes: await new NodeIO().writeBinary(doc) }, { to: 'fbx' })).files;
    for (const file of files) await writeFile(join(dir, file.name), file.bytes);
    const path = join(dir, files.find((f) => f.name.endsWith('.fbx'))!.name);
    for (const backend of ['native', 'wasm'] as const) {
      const model = await importModel(path, { backend });
      assert.equal(model.document.getRoot().listSkins().length, 1);
      const prepared = await prepareStaticModel(model);
      assert.deepEqual((await inspectModel(prepared.model)).bounds!.min, [0, 0, 0]);
      assert.deepEqual((await inspectModel(prepared.model)).bounds!.max, [1, 1, 0]);
    }
    const result = run(['convert', path, '--out', join(dir, 'pack'), '--atlas', '32']);
    assert.equal(result.status, 0, result.stderr);
    assert.equal((await validateSkinPackPath(join(dir, 'pack.zip'))).skins, 1);
  } finally { assimp.dispose(); }
}));

test('Unity containers and old PMD give actionable format errors', async () => {
  for (const suffix of ['unitypackage', 'prefab', 'asset', 'bundle']) await assert.rejects(importModel('avatar.' + suffix), /Export FBX or VRM/);
  await assert.rejects(importModel('avatar.pmd'), /Export as PMX/);
});
