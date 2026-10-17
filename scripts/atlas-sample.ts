import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { importModel } from '../src/importer.ts';
import { optimizeModel } from '../src/optimizer.ts';
import { inspectModel } from '../src/inspect.ts';
import { selectSample } from './sample.ts';

const sample = selectSample(process.argv[2] ?? 'ToyCar');
const result = await optimizeModel(await importModel(sample.path), {
  mesh: { ratio: 0.5, maxError: 0.001 },
  texture: { maxTextureSize: Number(process.argv[3] ?? 256), atlasSize: Number(process.argv[4] ?? 2048), filter: 'lanczos3' },
});
const output = `.cache/samples/${sample.name}-atlas.glb`;
await new NodeIO().registerExtensions(ALL_EXTENSIONS).write(output, result.model.document);
await writeFile(`.cache/samples/${sample.name}-atlas.png`, result.atlas);
const reread = await inspectModel(await importModel(output));
assert.equal(reread.counts.triangles, result.report.mesh.after);
assert.equal(reread.counts.textures, 1);
assert.ok(reread.materials.every((m) => m.baseColorTexture === 0));
console.log(JSON.stringify({ sample: sample.name, output, ...result.report }, null, 2));
