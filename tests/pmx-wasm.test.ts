import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pmxFixture } from './pmx-fixture.ts';
import { png } from './fixtures.ts';
import { importModel } from '../src/importer.ts';

test('PMX WASM handles four-component auxiliary UVs while retaining renderable UV0 and source skin', async () => {
  await mkdir('.cache/pmx-tests', { recursive: true });
  const dir = await mkdtemp(resolve('.cache/pmx-tests/case-'));
  try {
    await mkdir(join(dir, '贴图'));
    await writeFile(join(dir, '贴图/脸.png'), await png()); await writeFile(join(dir, '贴图/衣服.png'), await png());
    for (const extraUV of [0, 1, 4]) {
      const path = join(dir, `model-${extraUV}.pmx`); await writeFile(path, pmxFixture(0, 1, 2, extraUV));
      const result = await importModel(path, { backend: 'wasm' });
      assert.equal(result.source.backend, 'wasm'); assert.equal(result.document.getRoot().listSkins().length, 1);
      for (const mesh of result.document.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
        assert.equal(p.getAttribute('TEXCOORD_0')!.getType(), 'VEC2');
        for (const s of p.listSemantics().filter((s) => s.startsWith('TEXCOORD_'))) assert.equal(p.getAttribute(s)!.getType(), 'VEC2');
      }
      if (extraUV) assert.ok(result.warnings.some((w) => w.includes('auxiliary UV')));
    }
  } finally {
    assert.ok(dir.startsWith(resolve('.cache/pmx-tests'))); await rm(dir, { recursive: true, force: true });
  }
}, 30000);
