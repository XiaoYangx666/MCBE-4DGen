import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rememberModel, removeModel, updateModel } from '../server/model-library.ts';

test('persisted selection settings reject invalid texture fields', async () => {
  const folder = await mkdtemp(join(tmpdir(), '4dgen-settings-'));
  const path = join(folder, 'model.glb');
  let id = '';
  try {
    await writeFile(path, 'source');
    id = (await rememberModel(path, 'settings')).id;
    const base = {
      binding: 'static',
      ratio: 0.5,
      maxError: 0.03,
      height: 32,
      excluded: ['m:Body#1'],
      materialWeights: { 'm:Body#1': 2 },
      profile: null,
      includedParts: ['p0.0'],
      textureMode: 'budget' as const,
      textureTarget: 'texel-retention' as const,
      atlasSharing: true,
      fingerprint: 'v1:12345678:1',
    };
    await updateModel(id, { settings: base });
    await assert.rejects(
      updateModel(id, { settings: { ...base, textureMode: 'magic' as never } }),
      /编辑配置无效/,
    );
    await assert.rejects(
      updateModel(id, { settings: { ...base, includedParts: [1 as never] } }),
      /编辑配置无效/,
    );
    await assert.rejects(
      updateModel(id, { settings: { ...base, atlasSharing: 'yes' as never } }),
      /编辑配置无效/,
    );
  } finally {
    if (id) await removeModel(id);
    await rm(folder, { recursive: true, force: true });
  }
});
