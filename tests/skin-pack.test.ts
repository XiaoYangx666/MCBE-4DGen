import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { documentFixture, writeDocument } from './fixtures.ts';
import type { IntermediateModel } from '../src/model.ts';
import { optimizeModel } from '../src/optimizer.ts';
import { bindStatic } from '../src/bone-mapper.ts';
import { exportBedrockGeometry } from '../src/bedrock-exporter.ts';
import {
  buildSkinPack, readSkinPack, validateSkinPackFiles, validateSkinPackPath, zipSkinPack,
} from '../src/skin-pack.ts';

async function fixturePack() {
  const input: IntermediateModel = {
    document: await documentFixture(),
    source: { path: 'synthetic', format: 'gltf', units: 'meters', coordinates: 'right-handed-y-up', importer: 'gltf-transform' },
    warnings: [],
  };
  const optimized = await optimizeModel(input, {
    prepare: { height: 32, center: 'ground' },
    mesh: { preset: 'original' },
    texture: { maxTextureSize: 8, atlasSize: 32 },
  });
  const exported = await exportBedrockGeometry(bindStatic(optimized.model), { identifier: 'geometry.skin0' });
  return buildSkinPack({ geometry: exported.file, png: exported.png, identifier: 'geometry.skin0', packName: 'Test Pack' });
}
const parsed = (value: Uint8Array): any => JSON.parse(new TextDecoder().decode(value));
const encoded = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));

test('builds localized pack metadata and linked skin0.png', async () => {
  const files = await fixturePack();
  assert.deepEqual(Object.keys(files).sort(), ['geometry.json', 'manifest.json', 'skin0.png', 'skins.json', 'texts/en_US.lang', 'texts/languages.json', 'texts/zh_CN.lang']);
  const metadata = await validateSkinPackFiles(files);
  assert.equal(metadata.name, 'Test Pack');
  assert.equal(metadata.skins, 1);
  assert.deepEqual(metadata.geometries, ['geometry.skin0']);
  const manifest = parsed(files['manifest.json']!);
  assert.equal(manifest.format_version, 2);
  assert.equal(manifest.modules[0].type, 'skin_pack');
  assert.notEqual(manifest.header.uuid, manifest.modules[0].uuid);
  const skins = parsed(files['skins.json']!);
  assert.deepEqual(skins.skins[0], {
    localization_name: 'skin0', geometry: 'geometry.skin0',
    texture: 'skin0.png', hide_armor: true, type: 'free',
  });
});

test('CLI refuses an existing sibling archive before creating output, and no-mcpack leaves it intact', async () => {
  const dir = await mkdtemp(join(tmpdir(), '4d-collision-'));
  try {
    const input = await writeDocument(dir, 'glb'), output = join(dir, 'output');
    const original = 'existing archive';
    await writeFile(output + '.mcpack', original);
    const run = (extra: string[]) => spawnSync(process.execPath, [
      'src/cli.ts', 'convert', input, '--out', output, '--atlas', '32', ...extra,
    ], { encoding: 'utf8' });
    const rejected = run([]);
    assert.equal(rejected.status, 1);
    assert.equal(rejected.stdout, '');
    assert.match(rejected.stderr, /archive already exists/);
    await assert.rejects(readFile(join(output, 'geometry.json')), { code: 'ENOENT' });
    assert.equal(run(['--no-mcpack']).status, 0);
    assert.equal(await readFile(output + '.mcpack', 'utf8'), original);
    assert.equal((await validateSkinPackPath(output)).skins, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('pack reader rejects archive names that JSZip would otherwise silently normalize', async () => {
  const dir = await mkdtemp(join(tmpdir(), '4d-zip-names-'));
  try {
    const zip = new JSZip();
    zip.file('../manifest.json', '{}', { createFolders: false });
    const path = join(dir, 'unsafe.mcpack');
    await writeFile(path, await zip.generateAsync({ type: 'uint8array' }));
    await assert.rejects(readSkinPack(path), /unsafe filename/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('validates actual mcpack zip contents and rejects broken links', async () => {
  const files = await fixturePack();
  const zip = await zipSkinPack(files);
  const dir = await mkdtemp(join(tmpdir(), '4d-pack-test-'));
  try {
    const path = join(dir, 'example.mcpack');
    await Bun.write(path, zip);
    assert.equal((await validateSkinPackPath(path)).skins, 1);
    const read = await readSkinPack(path);
    assert.deepEqual(Object.keys(read).sort(), Object.keys(files).sort());
  } finally { await rm(dir, { recursive: true, force: true }); }

  const badSkin = parsed(files['skins.json']!);
  badSkin.skins[0].geometry = 'geometry.missing';
  await assert.rejects(validateSkinPackFiles({ ...files, 'skins.json': encoded(badSkin) }), /missing referenced geometry/);
  badSkin.skins[0].geometry = 'geometry.skin0';
  badSkin.skins[0].texture = '../escape.png';
  await assert.rejects(validateSkinPackFiles({ ...files, 'skins.json': encoded(badSkin) }), /invalid skin entry/);
  await assert.rejects(validateSkinPackFiles({ ...files, 'skin0.png': Uint8Array.of(1, 2, 3) }));
  const badManifest = parsed(files['manifest.json']!);
  badManifest.modules[0].uuid = badManifest.header.uuid;
  await assert.rejects(validateSkinPackFiles({ ...files, 'manifest.json': encoded(badManifest) }), /invalid skin_pack module/);
});

test('CLI converts a real imported GLB to unpacked files and installable archive layout', async () => {
  const dir = await mkdtemp(join(tmpdir(), '4d-convert-test-'));
  try {
    const input = await writeDocument(dir, 'glb');
    const output = join(dir, 'output');
    const run = spawnSync(process.execPath, [
      'run', 'src/cli.ts', 'convert', input, '--out', output, '--name', 'Test CLI', '--atlas', '32',
    ], { cwd: process.cwd(), encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const report = JSON.parse(run.stdout);
    assert.equal(report.name, 'Test CLI');
    assert.equal(report.triangles, 2);
    assert.equal((await validateSkinPackPath(output)).skins, 1);
    assert.equal((await validateSkinPackPath(output + '.mcpack')).skins, 1);
    const files = await readSkinPack(output);
    assert.ok((await readFile(join(output, 'geometry.json'))).length > 0);
    assert.ok(files['skin0.png']!.length > 0);
    const again = spawnSync(process.execPath, ['run', 'src/cli.ts', 'convert', input, '--out', output],
      { cwd: process.cwd(), encoding: 'utf8' });
    assert.notEqual(again.status, 0);
    assert.match(again.stderr, /not empty|already exists/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

