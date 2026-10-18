import { test, expect } from 'bun:test';
import { mkdtemp, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { importLocal, rememberModel, updateModel, removeModel, listModels } from '../server/model-library.ts';

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
    expect(await Bun.file(path).text()).toBe('source');
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
    expect(await Bun.file(join(first[0]!, '..', 'texture.png')).text()).toBe('texture');
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
