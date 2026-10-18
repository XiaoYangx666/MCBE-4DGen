import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, rm, unlink, readdir } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import sharp from 'sharp';
import { PackManager } from '../src/pack-manager.ts';
import { buildSkinPack, readSkinPack, validateSkinPackPath, zipSkinPack } from '../src/skin-pack.ts';
import type { BedrockGeometryFile } from '../src/bedrock-types.ts';

async function fixture() {
  await mkdir('.cache/manager-tests', { recursive: true });
  const dir = await mkdtemp(resolve('.cache/manager-tests/case-'));
  const root = join(dir, 'skin_packs'), state = join(dir, 'state');
  for (const slot of ['custom', 'persona', 'reference-a']) {
    await mkdir(join(root, slot, 'empty'), { recursive: true });
    await writeFile(join(root, slot, 'skins.json'), '{"skins":[],"serialize_name":"Original"}');
    await writeFile(join(root, slot, 'manifest.json'), '{"original":true}');
  }
  const manager = new PackManager({ version: 1, skinPacksRoot: root, stateDir: state,
    slots: { custom: { manifestFormat: 2 }, persona: { manifestFormat: 1 } } });
  const png = await sharp({ create: { width: 64, height: 64, channels: 4, background: '#ff8040' } }).png().toBuffer();
  const geometry: BedrockGeometryFile = { format_version: '1.8.0', 'geometry.skin0': {
    texturewidth: 64, textureheight: 64, bones: [{ name: 'body', poly_mesh: {
      normalized_uvs: true, positions: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], normals: [[0, 0, 1]],
      uvs: [[0, 0], [1, 0], [0, 1]], polys: [[[0, 0, 0], [1, 0, 1], [2, 0, 2], [2, 0, 2]]],
    } }],
  } };
  const files = buildSkinPack({ geometry, png, identifier: 'geometry.skin0', packName: 'Fixture' });
  const source = join(dir, 'source');
  for (const [name, bytes] of Object.entries(files)) { await mkdir(dirname(join(source, name)), { recursive: true }); await writeFile(join(source, name), bytes); }
  return { dir, root, state, manager, source, files };
}
const cleanup = async (dir: string) => { assert.ok(dir.startsWith(resolve('.cache/manager-tests') + '\\') || dir.startsWith(resolve('.cache/manager-tests') + '/')); await rm(dir, { recursive: true, force: true }); };

test('library merges colliding IDs, disables individual packs, and restores exact original files and empty directories', async () => {
  const f = await fixture();
  try {
    await f.manager.importPack('first', f.source);
    const archive = join(f.dir, 'pack.mcpack'); await writeFile(archive, await zipSkinPack(f.files));
    await f.manager.importPack('second', archive);
    const exported = join(f.dir, 'exported.mcpack');
    await f.manager.exportPack('first', exported);
    assert.equal((await validateSkinPackPath(exported)).skins, 1);
    await assert.rejects(f.manager.exportPack('first', exported), /EEXIST/);
    await f.manager.enable('custom', 'first');
    const firstUUID = JSON.parse(await readFile(join(f.root, 'custom/manifest.json'), 'utf8')).header.uuid;
    const second = await f.manager.enable('custom', 'second');
    const validated = await validateSkinPackPath(join(f.root, 'custom'));
    assert.equal(validated.skins, 2); assert.equal(new Set(validated.geometries).size, 2);
    assert.equal(JSON.parse(await readFile(join(f.root, 'custom/manifest.json'), 'utf8')).header.uuid, firstUUID);
    await assert.rejects(f.manager.archive('first'), /Disable/);
    await f.manager.disable('custom', 'first');
    assert.equal((await validateSkinPackPath(join(f.root, 'custom'))).skins, 1);
    await f.manager.disable('custom', 'second');
    assert.equal(await readFile(join(f.root, 'custom/manifest.json'), 'utf8'), '{"original":true}');
    assert.ok((await readdir(join(f.root, 'custom'))).includes('empty'));
    assert.equal(await readFile(join(f.root, 'reference-a/manifest.json'), 'utf8'), '{"original":true}');
    await f.manager.restore('custom', second.backup);
    assert.equal((await validateSkinPackPath(join(f.root, 'custom'))).skins, 1);
    assert.equal((await f.manager.status()).find((s) => s.slot === 'custom')!.changedOutsideManager, false);
  } finally { await cleanup(f.dir); }
});

test('standard skin imports without geometry.json and damaged backup is rejected', async () => {
  const f = await fixture();
  try {
    const standard = { ...f.files };
    delete standard['geometry.json'];
    const meta = JSON.parse(new TextDecoder().decode(standard['skins.json']!));
    meta.skins[0].geometry = 'geometry.humanoid.custom'; delete meta.skins[0].hide_armor;
    standard['skins.json'] = new TextEncoder().encode(JSON.stringify(meta));
    const archive = join(f.dir, 'standard.mcpack'); await writeFile(archive, await zipSkinPack(standard));
    await f.manager.importPack('standard', archive);
    const applied = await f.manager.enable('persona', 'standard');
    assert.equal((await validateSkinPackPath(join(f.root, 'persona'))).skins, 1);
    await writeFile(join(f.state, 'backups', applied.backup, 'files/manifest.json'), 'damaged backup');
    const before = await readFile(join(f.root, 'persona/manifest.json'));
    await assert.rejects(f.manager.restore('persona', applied.backup), /integrity mismatch/);
    assert.deepEqual(await readFile(join(f.root, 'persona/manifest.json')), before);
  } finally { await cleanup(f.dir); }
});

test('manager rejects external target edits and library tampering before overwriting files', async () => {
  const f = await fixture();
  try {
    const pack = await f.manager.importPack('first', f.source);
    await f.manager.enable('persona', 'first');
    assert.equal((await validateSkinPackPath(join(f.root, 'persona'))).skins, 1);
    await writeFile(join(f.root, 'persona/notes.txt'), 'user work');
    await assert.rejects(f.manager.disable('persona', 'first'), /outside manager/);
    await assert.rejects(f.manager.restore('persona'), /outside manager/);
    assert.equal(await readFile(join(f.root, 'persona/notes.txt'), 'utf8'), 'user work');
    await writeFile(join(f.state, 'library/first', pack.revision, 'skin0.png'), 'tampered');
    await assert.rejects(f.manager.enable('custom', 'first'), /hash mismatch/);
    assert.equal(await readFile(join(f.root, 'custom/manifest.json'), 'utf8'), '{"original":true}');
    await assert.rejects(f.manager.enable('../reference-a', 'first'), /not configured/);
  } finally { await cleanup(f.dir); }
});

test('adopt tracks an accepted install without modifying it and restores supplied pre-session backup', async () => {
  const f = await fixture();
  try {
    await f.manager.importPack('accepted', f.source);
    const baseline = join(f.dir, 'baseline'); await mkdir(baseline); await writeFile(join(baseline, 'skins.json'), '{"skins":[]}');
    const target = join(f.root, 'custom');
    await rm(target, { recursive: true }); await mkdir(target);
    for (const [name, bytes] of Object.entries(f.files)) { await mkdir(dirname(join(target, name)), { recursive: true }); await writeFile(join(target, name), bytes); }
    const before = await readFile(join(target, 'manifest.json'));
    await f.manager.adopt('custom', baseline, 'accepted');
    assert.deepEqual((await f.manager.status()).find(s => s.slot === 'custom')!.presetSources, ['accepted']);
    assert.deepEqual(await readFile(join(target, 'manifest.json')), before);
    await f.manager.importFiles('user-pack', f.files);
    await f.manager.enable('custom', 'user-pack');
    assert.deepEqual((await f.manager.status()).find(s => s.slot === 'custom')!.presetSources, ['accepted'], 'later user packs must remain visible as local packs');
    await f.manager.disable('custom', 'user-pack');
    await f.manager.disable('custom', 'accepted');
    assert.deepEqual(await readdir(target), ['skins.json']);
    assert.equal(await readFile(join(target, 'skins.json'), 'utf8'), '{"skins":[]}');
  } finally { await cleanup(f.dir); }
});

test('interrupted operation recovery verifies backup and rejects unknown external changes', async () => {
  const f = await fixture();
  try {
    await f.manager.importPack('first', f.source);
    const applied = await f.manager.enable('custom', 'first');
    const path = join(f.state, 'targets/custom.json'), state = JSON.parse(await readFile(path, 'utf8'));
    state.pending = { backup: applied.backup, planned: state.installed };
    await writeFile(path, JSON.stringify(state));
    await unlink(join(f.root, 'custom/skin0.png')).catch(async () => {
      const files = await readSkinPack(join(f.root, 'custom')); const name = Object.keys(files).find((n) => n.endsWith('.png'))!; await unlink(join(f.root, 'custom', name));
    });
    await writeFile(join(f.root, 'custom/external.txt'), 'preserve');
    await assert.rejects(f.manager.recover('custom'), /unknown external/);
    await unlink(join(f.root, 'custom/external.txt'));
    await f.manager.recover('custom');
    assert.equal(await readFile(join(f.root, 'custom/manifest.json'), 'utf8'), '{"original":true}');
    assert.equal((await f.manager.status()).find((s) => s.slot === 'custom')!.pending, null);
  } finally { await cleanup(f.dir); }
});

test('multi-skin contents, independent names and installed revision updates preserve existing game state', async () => {
  const f = await fixture();
  try {
    const files = { ...f.files };
    const skinData = JSON.parse(new TextDecoder().decode(files['skins.json']));
    skinData.skins.push({ ...skinData.skins[0], localization_name: 'skin1', texture: 'skin1.png' });
    files['skins.json'] = new TextEncoder().encode(JSON.stringify(skinData));
    files['skin1.png'] = new Uint8Array(await sharp({ create: { width: 64, height: 64, channels: 4, background: '#0080ff' } }).png().toBuffer());
    await f.manager.importFiles('multi', files);
    await f.manager.importFiles('other', f.files);
    await f.manager.enable('custom', 'multi');
    const before = await readFile(join(f.root, 'custom/skins.json'));
    const firstRevision = (await f.manager.list()).find(p => p.id === 'multi')!.revision;
    const renamed = await f.manager.renameNames('multi', { name: '中文皮肤包', skinIndex: 1, skinName: '蓝色皮肤' });
    assert.notEqual(renamed.revision, firstRevision);
    assert.deepEqual(await readFile(join(f.root, 'custom/skins.json')), before, 'renaming must not deploy implicitly');
    const contents = await f.manager.contents('multi');
    assert.equal(contents.skins.length, 2);
    assert.equal(contents.name, '中文皮肤包');
    assert.equal(contents.skins[1]!.name, '蓝色皮肤');
    assert.deepEqual(Buffer.from((await f.manager.scene('multi', 1)).texture), Buffer.from(files['skin1.png']!));
    await assert.rejects(f.manager.scene('multi', -1));
    await assert.rejects(f.manager.scene('multi', 2));
    await assert.rejects(f.manager.renameNames('multi', { skinIndex: 9, skinName: 'bad' }));
    await f.manager.enable('custom', 'other'); // compose must still find the installed older revision.
    await f.manager.updateEnabled('custom', 'multi');
    const lang = await readFile(join(f.root, 'custom/texts/en_US.lang'), 'utf8');
    assert.ok(lang.includes('蓝色皮肤'));
    assert.ok(lang.includes('中文皮肤包'));
    await f.manager.renameNames('multi', { name: '再次修改' });
    await f.manager.disable('custom', 'other'); // unrelated operation must retain the installed name.
    assert.equal(JSON.parse(await readFile(join(f.root, 'custom/manifest.json'), 'utf8')).header.name, '中文皮肤包');
    await f.manager.updateEnabled('custom', 'multi');
    assert.equal(JSON.parse(await readFile(join(f.root, 'custom/manifest.json'), 'utf8')).header.name, '再次修改');
    await f.manager.disable('custom', 'multi');
    await f.manager.remove('multi');
    assert.ok(!(await readdir(join(f.state, 'library'))).includes('multi'));
  } finally { await cleanup(f.dir); }
});

test('empty user packs accept selected skin copies while preset views reflect actual slot contents', async () => {
  const f = await fixture();
  try {
    const files = { ...f.files };
    const data = JSON.parse(new TextDecoder().decode(files['skins.json']));
    data.skins.push({ ...data.skins[0], localization_name: 'second' });
    files['skins.json'] = new TextEncoder().encode(JSON.stringify(data));
    await f.manager.importFiles('source-multi', files);
    const before = await readFile(join(f.root, 'custom/skins.json'));
    const draft = await f.manager.createPack('我的组合包');
    assert.equal((await f.manager.contents(draft.id)).skins.length, 0);
    await assert.rejects(f.manager.enable('custom', draft.id), /为空/);
    await f.manager.renameNames(draft.id, { name: '组合皮肤' });
    await f.manager.addSkins(draft.id, 'source-multi', [1]);
    const copied = await f.manager.contents(draft.id);
    assert.equal(copied.name, '组合皮肤');
    assert.equal(copied.skins.length, 1);
    assert.equal((await f.manager.contents('source-multi')).skins.length, 2);
    assert.deepEqual(await readFile(join(f.root, 'custom/skins.json')), before);
    await f.manager.addSkins(draft.id, 'source-multi', [0]);
    assert.equal((await f.manager.contents(draft.id)).skins.length, 2);
    await f.manager.enable('custom', draft.id);
    const preset = await f.manager.presetContents('custom');
    assert.equal(preset.skins.length, 2);
    assert.ok((await f.manager.presetScene('custom', 1)).texture.byteLength > 0);
    await assert.rejects(f.manager.presetContents('../outside'));
    await assert.rejects(f.manager.addSkins(draft.id, 'source-multi', [9]));
    await f.manager.disable('custom', draft.id);
    await f.manager.remove(draft.id);
    const empty = await f.manager.createPack('空包');
    await f.manager.remove(empty.id);
    assert.ok(!(await f.manager.list()).some(p => p.id === empty.id));
  } finally { await cleanup(f.dir); }
});
