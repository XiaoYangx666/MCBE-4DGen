import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, rm, unlink, readdir, stat } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import sharp from 'sharp';
import { PackManager } from '../src/pack-manager.ts';
import { buildSkinPack, readSkinPack, validateSkinPackPath, zipSkinPack } from '../src/skin-pack.ts';
import type { BedrockGeometryFile } from '../src/bedrock-types.ts';

async function fixture() {
  await mkdir('.cache/manager-tests', { recursive: true });
  const dir = await mkdtemp(resolve('.cache/manager-tests/case-'));
  const root = join(dir, 'skin_packs'), state = join(dir, 'state');
  for (const slot of ['custom', 'persona', 'custom2']) {
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
    const exported = join(f.dir, 'exported.zip');
    await assert.rejects(f.manager.exportPack('first', join(f.dir, 'exported.mcpack')), /only be exported as .zip/);
    await f.manager.exportPack('first', exported);
    assert.equal((await validateSkinPackPath(exported)).skins, 1);
    await assert.rejects(f.manager.exportPack('first', exported), /EEXIST/);
    await f.manager.enable('custom', 'first');
    const firstUUID = JSON.parse(await readFile(join(f.root, 'custom/manifest.json'), 'utf8')).header.uuid;
    const firstTexture = join(f.root, 'custom/first_0.png');
    const firstTextureMtime = (await stat(firstTexture)).mtimeMs;
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = await f.manager.enable('custom', 'second');
    assert.equal((await stat(firstTexture)).mtimeMs, firstTextureMtime, 'unchanged textures should not be rewritten');
    const validated = await validateSkinPackPath(join(f.root, 'custom'));
    assert.equal(validated.skins, 2); assert.equal(new Set(validated.geometries).size, 2);
    assert.equal(JSON.parse(await readFile(join(f.root, 'custom/manifest.json'), 'utf8')).header.uuid, firstUUID);
    await assert.rejects(f.manager.archive('first'), /Disable/);
    await f.manager.disable('custom', 'first');
    assert.equal((await validateSkinPackPath(join(f.root, 'custom'))).skins, 1);
    await f.manager.disable('custom', 'second');
    assert.equal(await readFile(join(f.root, 'custom/manifest.json'), 'utf8'), '{"original":true}');
    assert.ok((await readdir(join(f.root, 'custom'))).includes('empty'));
    assert.equal(await readFile(join(f.root, 'custom2/manifest.json'), 'utf8'), '{"original":true}');
    await f.manager.restore('custom', second.backup);
    assert.equal((await validateSkinPackPath(join(f.root, 'custom'))).skins, 1);
    assert.equal((await f.manager.status()).find((s) => s.slot === 'custom')!.changedOutsideManager, false);
  } finally { await cleanup(f.dir); }
});

test('exports selected skins from the installed game slot with a fresh identity', async () => {
  const f = await fixture();
  try {
    await f.manager.importPack('first', f.source);
    await f.manager.importPack('second', f.source);
    const target = await f.manager.createPack('Multi');
    await f.manager.addSkins(target.id, 'first', [0]);
    await f.manager.addSkins(target.id, 'second', [0]);
    await f.manager.renameNames(target.id, { skinIndex: 0, skinName: 'First Skin' });
    await f.manager.renameNames(target.id, { skinIndex: 1, skinName: 'Second Skin' });
    await f.manager.enable('custom', target.id);
    const installedUUID = JSON.parse(
      await readFile(join(f.root, 'custom/manifest.json'), 'utf8'),
    ).header.uuid;
    const before = await readSkinPack(join(f.root, 'custom'));

    const all = await f.manager.exportInstalled('custom');
    assert.equal(all.skins, 2);
    const exported = await f.manager.exportInstalled('custom', [1], { name: 'Only Second' });
    assert.equal(exported.skins, 1);
    const zip = join(f.dir, 'game-export.zip');
    await writeFile(zip, exported.bytes);
    const validation = await validateSkinPackPath(zip);
    assert.equal(validation.skins, 1);
    assert.equal(validation.geometries.length, 1);
    const files = await readSkinPack(zip);
    const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json']!));
    assert.equal(manifest.header.name, 'Only Second');
    assert.notEqual(manifest.header.uuid, installedUUID);
    const skins = JSON.parse(new TextDecoder().decode(files['skins.json']!)).skins;
    assert.equal(skins.length, 1);
    assert.equal(skins[0].texture, `${target.id}_1.png`);
    assert.match(new TextDecoder().decode(files['texts/zh_CN.lang']!), /Second Skin/);
    assert.doesNotMatch(new TextDecoder().decode(files['texts/zh_CN.lang']!), /First Skin/);

    await f.manager.importPack('from-game', zip);
    assert.deepEqual(
      (await f.manager.contents('from-game')).skins.map((skin) => skin.name),
      ['Second Skin'],
    );
    assert.deepEqual(await readSkinPack(join(f.root, 'custom')), before);
    await assert.rejects(f.manager.exportInstalled('custom', [9]), /有效皮肤/);
  } finally { await cleanup(f.dir); }
});

test('installs and removes individual skins from a multi-skin pack', async () => {
  const f = await fixture();
  try {
    await f.manager.importPack('multi-a', f.source);
    await f.manager.importPack('multi-b', f.source);
    const target = await f.manager.createPack('Multi');
    await f.manager.addSkins(target.id, 'multi-a', [0]);
    await f.manager.addSkins(target.id, 'multi-b', [0]);
    assert.equal((await f.manager.contents(target.id)).skins.length, 2);
    const readSkins = async () => JSON.parse(await readFile(join(f.root, 'custom/skins.json'), 'utf8')).skins;

    await f.manager.enableSkins('custom', target.id, [0]);
    let skins = await readSkins();
    assert.equal(skins.length, 1);
    assert.equal(skins[0].texture, `${target.id}_0.png`);
    let state = (await f.manager.status()).find((s) => s.slot === 'custom')!;
    assert.deepEqual(state.active[0]!.skins, [0]);

    await f.manager.enableSkins('custom', target.id, [1]);
    assert.equal((await readSkins()).length, 2);
    state = (await f.manager.status()).find((s) => s.slot === 'custom')!;
    assert.deepEqual(state.active[0]!.skins, [0, 1]);

    await f.manager.disableSkin('custom', target.id, 0);
    skins = await readSkins();
    assert.equal(skins.length, 1);
    assert.equal(skins[0].texture, `${target.id}_1.png`);
    state = (await f.manager.status()).find((s) => s.slot === 'custom')!;
    assert.deepEqual(state.active[0]!.skins, [1]);

    await f.manager.disableSkin('custom', target.id, 1);
    assert.equal(await readFile(join(f.root, 'custom/manifest.json'), 'utf8'), '{"original":true}');
  } finally { await cleanup(f.dir); }
});

test('addSkins can point origins at the destination when the source is temporary', async () => {
  const f = await fixture();
  try {
    await f.manager.importFiles('staging', f.files, [], { modelId: 'model-1' });
    const target = await f.manager.createPack('Target');
    await f.manager.addSkins(target.id, 'staging', [0], { originPackId: target.id });
    const contents = await f.manager.contents(target.id);
    assert.equal(contents.skins[0]?.origin?.packId, target.id);
    assert.equal(contents.skins[0]?.origin?.skinIndex, 0);
    assert.equal(contents.skins[0]?.origin?.modelId, 'model-1');
    await f.manager.remove('staging');
    assert.equal((await f.manager.contents(target.id)).skins.length, 1);
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
    await assert.rejects(f.manager.enable('../custom2', 'first'), /not configured/);
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

test('status uses a cheap signature and still reports external edits', async () => {
  const f = await fixture();
  try {
    await f.manager.importPack('first', f.source);
    await f.manager.enable('custom', 'first');
    const slot = async () => (await f.manager.status()).find((s) => s.slot === 'custom')!;
    assert.equal((await slot()).changedOutsideManager, false);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await writeFile(join(f.root, 'custom/notes.txt'), 'external work');
    assert.equal((await slot()).changedOutsideManager, true);
    await unlink(join(f.root, 'custom/notes.txt'));
    assert.equal((await slot()).changedOutsideManager, false);
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


test('offline collection is usable before game configuration and keeps existing installed state protected',async()=>{
  const f=await fixture();
  try {
    const offline=new PackManager({...f.manager.config,libraryOnly:true,skinPacksRoot:join(f.dir,'not-configured')});
    await offline.importFiles('offline-skin',f.files,['texts']);
    await assert.rejects(()=>offline.enable('custom','offline-skin'),/not configured/);
    await f.manager.enable('custom','offline-skin');
    assert.equal((await f.manager.status())[0]!.active![0]!.id,'offline-skin');
    // Losing the config must not allow deletion of a still-installed pack.
    await assert.rejects(()=>offline.remove('offline-skin'),/Disable/);
    const collection=await offline.createPack('offline collection');
    await offline.addSkins(collection.id,'offline-skin',[0]);
    assert.equal((await offline.contents(collection.id)).skins.length,1);
  }finally{await cleanup(f.dir);}
});


test('collection skins retain independent model origins through copying and renaming', async () => {
  const f = await fixture();
  try {
    await f.manager.importFiles('model-a', f.files, [], {modelId:'source-a'});
    await f.manager.importFiles('model-b', f.files, [], {modelId:'source-b'});
    const collection = await f.manager.createPack('合集');
    await f.manager.addSkins(collection.id, 'model-a', [0]);
    await f.manager.addSkins(collection.id, 'model-b', [0]);
    let contents = await f.manager.contents(collection.id);
    assert.deepEqual(contents.skins.map(s => s.origin?.modelId), ['source-a', 'source-b']);
    await f.manager.renameNames(collection.id, {skinIndex:1, skinName:'第二个角色'});
    contents = await f.manager.contents(collection.id);
    assert.equal(contents.skins[1]?.name, '第二个角色');
    assert.deepEqual(contents.skins.map(s => s.origin?.modelId), ['source-a', 'source-b']);
    await f.manager.enable('custom', collection.id);
    assert.deepEqual((await f.manager.presetContents('custom')).skins.map(s => s.origin?.modelId), ['source-a','source-b']);
    const copy = await f.manager.createPack('副本');
    await f.manager.addSkins(copy.id, collection.id, [1]);
    assert.equal((await f.manager.contents(copy.id)).skins[0]?.origin?.modelId, 'source-b');
    await f.manager.importFiles('unknown', f.files);
    assert.equal((await f.manager.contents('unknown')).skins[0]?.origin, null);
  } finally { await cleanup(f.dir); }
});


test('game-side skin removal and names survive recomposition without changing local packs', async()=>{
  const f=await fixture();
  try {
    await f.manager.importFiles('first',f.files,[],{modelId:'a'});
    await f.manager.importFiles('second',f.files,[],{modelId:'b'});
    await f.manager.enable('custom','first');await f.manager.enable('custom','second');
    const original=await f.manager.contents('first');
    const before=await f.manager.presetContents('custom');
    await f.manager.editInstalled('custom',{name:'我的角色',revision:before.revision});
    await assert.rejects(f.manager.editInstalled('custom',{skinIndex:0,remove:true,revision:before.revision}),/刷新/);
    await f.manager.editInstalled('custom',{skinIndex:0,skinName:'专属名字'});
    await f.manager.editInstalled('custom',{skinIndex:1,remove:true});
    let game=await f.manager.presetContents('custom');
    assert.equal(game.name,'我的角色');assert.equal(game.skins.length,1);assert.equal(game.skins[0]?.name,'专属名字');
    assert.deepEqual(await f.manager.contents('first'),original);
    await f.manager.renameNames('first',{name:'本地新名字'});
    await f.manager.updateEnabled('custom','first');
    game=await f.manager.presetContents('custom');
    assert.equal(game.name,'我的角色');assert.equal(game.skins.length,1);assert.equal(game.skins[0]?.name,'专属名字');
    await f.manager.enable('custom','second'); // Re-add removed skins in the current game pack.
    assert.equal((await f.manager.presetContents('custom')).skins.length,2);
    const operation=await f.manager.editInstalled('custom',{skinIndex:1,remove:true});
    await f.manager.restore('custom',operation.backup);
    assert.equal((await f.manager.presetContents('custom')).skins.length,2);
    await f.manager.editInstalled('custom',{skinIndex:1,remove:true});
    await f.manager.editInstalled('custom',{skinIndex:0,remove:true});
    assert.equal((await f.manager.presetContents('custom')).skins.length,0);
    await f.manager.enable('custom','first');
    assert.equal((await f.manager.presetContents('custom')).skins.length,1);
    await f.manager.restore('custom');
    assert.equal(await readFile(join(f.root,'custom/manifest.json'),'utf8'),'{"original":true}');
  }finally{await cleanup(f.dir);}
});

test('different game installs share library but retain separate slot state and backups',async()=>{
 const f=await fixture();
 try{
  await f.manager.importFiles('first',f.files);await f.manager.enable('custom','first');
  const root=join(f.dir,'other-game');await mkdir(join(root,'custom'),{recursive:true});
  for(const [name,bytes] of Object.entries(f.files)){await mkdir(dirname(join(root,'custom',name)),{recursive:true});await writeFile(join(root,'custom',name),bytes);}
  const other=new PackManager({...f.manager.config,skinPacksRoot:root,slots:{custom:{manifestFormat:2}}});
  assert.equal((await other.status())[0]?.managed,false);
  await other.editInstalled('custom',{name:'另一个游戏'});
  assert.equal((await other.presetContents('custom')).name,'另一个游戏');
  assert.notEqual((await f.manager.presetContents('custom')).name,'另一个游戏');
  assert.equal((await other.list()).length,1);
  await other.restore('custom');
  assert.equal((await other.presetContents('custom')).name,(await f.manager.contents('first')).name);
 }finally{await cleanup(f.dir);}
});


test('game edits identify individual skins even when they share a PNG',async()=>{
 const f=await fixture();try{
  const files={...f.files};const data=JSON.parse(new TextDecoder().decode(files['skins.json']));
  data.skins.push({...data.skins[0],localization_name:'variant'});files['skins.json']=new TextEncoder().encode(JSON.stringify(data));
  await f.manager.importFiles('variants',files);await f.manager.enable('custom','variants');
  // Simulate an existing external game pack that references the same PNG twice.
  const unmanaged=join(f.root,'custom2');
  for(const [name,bytes] of Object.entries(files)){await mkdir(dirname(join(unmanaged,name)),{recursive:true});await writeFile(join(unmanaged,name),bytes);}
  const manager=new PackManager({...f.manager.config,slots:{custom2:{manifestFormat:2}}});
  await manager.editInstalled('custom2',{skinIndex:1,skinName:'另一个皮肤'});
  assert.notEqual((await manager.presetContents('custom2')).skins[0]?.name,'另一个皮肤');
  await manager.editInstalled('custom2',{skinIndex:1,remove:true});
  const contents=await manager.presetContents('custom2');assert.equal(contents.skins.length,1);
  assert.ok((await readFile(join(unmanaged,contents.skins[0]!.texture))).length);
 }finally{await cleanup(f.dir);}
});
