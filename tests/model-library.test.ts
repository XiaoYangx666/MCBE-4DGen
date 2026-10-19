import { test, expect } from 'vitest';
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { rememberModel, updateModel, removeModel, listModels } from '../server/model-library.ts';
import { importLocal, ownModel } from '../server/source-archive.ts';

test('library preserves names and editing state across reopen; removing a record keeps source files', async () => {
  const folder = await mkdtemp(join(tmpdir(), '4dgen-entry-'));
  let id = '';
  try {
    const path = join(folder, 'source.pmx');
    await writeFile(path, 'source');
    const entry = await rememberModel(path, 'source'); id = entry.id;
    const settings = { binding: 'humanoid', ratio: 0.4, maxError: 0.03, height: 32, excluded: ['hidden'], materialWeights: { face: 4 }, profile: { armSpreadDegrees: 17 } };
    await updateModel(id, { name: '新名字', settings, packIds: ['legacy-version'] });
    const reopened = await rememberModel(path, 'source');
    expect(reopened.name).toBe('新名字');
    expect(reopened.settings).toEqual(settings);
    expect(reopened.packIds).toEqual(['legacy-version']);
    expect((await listModels()).some(m => m.id === id)).toBe(true);
    await expect(updateModel(id, { name: ' ' })).rejects.toThrow('名称');
    await removeModel(id); id = '';
    expect(await readFile(path, 'utf8')).toBe('source');
  } finally {
    if (id) await removeModel(id);
    await rm(folder, { recursive: true, force: true });
  }
});

test('server imports local ZIP once, keeps sidecars and returns every model candidate', async () => {
  const folder = await mkdtemp(join(tmpdir(), '4dgen-local-'));
  try {
    const zip = new JSZip();
    const unique = crypto.randomUUID();
    zip.file('角色/model.pmx', unique);
    zip.file('角色/weapon.pmx', 'weapon');
    zip.file('角色/texture.png', 'texture');
    const path = join(folder, 'models.zip');
    await writeFile(path, await zip.generateAsync({ type: 'uint8array' }));
    const first = await importLocal(path);
    expect(first.length).toBe(2);
    const before = await stat(first[0]!);
    expect(await importLocal(path)).toEqual(first);
    expect((await stat(first[0]!)).mtimeMs).toBe(before.mtimeMs);
    expect(await readFile(join(first[0]!, '..', 'texture.png'), 'utf8')).toBe('texture');
  } finally { await rm(folder, { recursive: true, force: true }); }
});
test('local import rejects ZIP paths escaping the package', async () => {
  const folder = await mkdtemp(join(tmpdir(), '4dgen-local-'));
  try {
    const zip = new JSZip();
    zip.file('../escape.pmx', 'bad');
    const path = join(folder, 'bad.zip');
    await writeFile(path, await zip.generateAsync({ type: 'uint8array' }));
    await expect(importLocal(path)).rejects.toThrow('路径无效');
  } finally { await rm(folder, { recursive: true, force: true }); }
});


test('missing sources can be relinked without losing identity, settings or versions', async () => {
  const folder = await mkdtemp(join(tmpdir(), '4dgen-relink-'));
  let id = '';
  try {
    const original = join(folder, 'original.glb'), moved = join(folder, 'moved.glb');
    await writeFile(original, 'model');
    const entry = await rememberModel(original, 'My model'); id = entry.id;
    const settings = { binding: 'static', ratio: 0.5, maxError: 0.03, height: 32, excluded: [], materialWeights: {}, profile: {} };
    await updateModel(id, { settings, packIds: ['saved-skin'] });
    await rm(original);
    expect((await listModels()).find(m => m.id === id)?.sourceAvailable).toBe(false);
    await writeFile(moved, 'model');
    await updateModel(id, {path: moved});
    const reopened = await rememberModel(moved, 'moved', {}, id);
    expect(reopened.id).toBe(id);
    expect(reopened.path).toBe(moved);
    expect(reopened.name).toBe('My model');
    expect(reopened.settings).toEqual(settings);
    expect(reopened.packIds).toEqual(['saved-skin']);
    expect((await listModels()).find(m => m.id === id)?.sourceAvailable).toBe(true);
    await expect(updateModel(id, {path: folder})).rejects.toThrow();
    await expect(updateModel(id, {path: 'relative.glb'})).rejects.toThrow();
  } finally {
    if (id) await removeModel(id);
    await rm(folder, {recursive: true, force: true});
  }
});

test('managed source copies model and nested sidecars independently of original files',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'4d-owned-'));
  let copied='';
  try {
    const {mkdir}=await import('node:fs/promises');
    await mkdir(join(folder,'textures'));await writeFile(join(folder,'textures/a.png'),'texture');
    const source=join(folder,'model.obj');await writeFile(source,'model');
    copied=await ownModel(source);
    expect(copied).not.toBe(source);
    await rm(folder,{recursive:true,force:true});
    expect(await readFile(copied, 'utf8')).toBe('model');
    expect(await readFile(join(copied,'../textures/a.png'), 'utf8')).toBe('texture');
  }finally{
    await rm(folder,{recursive:true,force:true});
    if(copied)await rm(join(copied,'..'),{recursive:true,force:true});
  }
});


test('deleting an archived model removes its own files while retaining original downloads',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'4d-model-delete-'));let id='';
 try{
  const original=join(folder,'delete.obj');await writeFile(original,'v 0 0 0');
  const owned=await ownModel(original);const entry=await rememberModel(owned,'Delete me');id=entry.id;
  await removeModel(id,true);id='';
  expect((await stat(original)).isFile()).toBe(true);
  await expect(stat(owned)).rejects.toThrow();
 }finally{if(id)await removeModel(id);await rm(folder,{recursive:true,force:true});}
});
