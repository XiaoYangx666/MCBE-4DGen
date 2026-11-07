import { test, expect } from 'vitest';
import {
  mkdir,
  mkdtemp,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanCache } from '../server/cache-clean.ts';

async function prepare(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), '4dgen-cache-'));
  for (const folder of [
    'web-models',
    'web-preview',
    'source-icons',
    'pack-imports/nested',
  ])
    await mkdir(join(root, folder), { recursive: true });
  await writeFile(join(root, 'web-models', 'keep.glb'), '1234');
  await writeFile(join(root, 'web-models', 'keep.json'), '{}');
  await writeFile(join(root, 'web-models', 'drop.glb'), '123456');
  await writeFile(join(root, 'web-models', 'drop.json'), '{}');
  await writeFile(join(root, 'web-preview', 'keep.glb'), '12');
  await writeFile(join(root, 'web-preview', 'drop.glb'), '123');
  await writeFile(join(root, 'source-icons', 'a.png'), 'x');
  await writeFile(join(root, 'pack-imports', 'nested', 'tmp.png'), 'xx');
  return root;
}

test('unused cache cleanup keeps referenced models and previews', async () => {
  const root = await prepare();
  try {
    const result = await cleanCache(root, new Set(['keep']), 'unused');
    expect(result).toEqual({ mode: 'unused', files: 5, bytes: 14 });
    expect((await readdir(join(root, 'web-models'))).sort()).toEqual([
      'keep.glb',
      'keep.json',
    ]);
    expect(await readdir(join(root, 'web-preview'))).toEqual(['keep.glb']);
    expect(await readdir(join(root, 'source-icons'))).toEqual([]);
    expect(await readdir(join(root, 'pack-imports'))).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('full cache cleanup also removes referenced rebuildable files', async () => {
  const root = await prepare();
  try {
    const result = await cleanCache(root, new Set(['keep']), 'all');
    expect(result).toEqual({ mode: 'all', files: 8, bytes: 22 });
    for (const folder of [
      'web-models',
      'web-preview',
      'source-icons',
      'pack-imports',
    ])
      expect(await readdir(join(root, folder))).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
