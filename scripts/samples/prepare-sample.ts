import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { importModel } from '../../src/importer.ts';
import { optimizeModel } from '../../src/optimizer.ts';
import { inspectModel } from '../../src/inspect.ts';
import { selectSample } from './sample.ts';

const sample = selectSample(process.argv[2] ?? 'ToyCar');
const height = Number(process.argv[3] ?? 32);
const result = await optimizeModel(await importModel(sample.path), {
  prepare: { height, center: 'ground' }, mesh: { ratio: 0.5, maxError: 0.001 },
  texture: { maxTextureSize: 256, atlasSize: 2048 },
});
const output = `.cache/samples/${sample.name}-prepared.glb`;
await new NodeIO().registerExtensions(ALL_EXTENSIONS).write(output, result.model.document);
await writeFile(`.cache/samples/${sample.name}-prepared-atlas.png`, result.atlas);
const reread = await inspectModel(await importModel(output));
assert.equal(reread.counts.triangles, result.report.mesh.after);
assert.equal(reread.counts.textures, 1);
assert.equal(reread.counts.skins, 0);
assert.ok(reread.bounds);
assert.ok(Math.abs(reread.bounds.size[1]! - height) < height * 1e-6);
assert.ok(Math.abs(reread.bounds.min[1]) < 1e-4);
const report = { sample: sample.name, output, preparation: result.report.preparation,
  mesh: result.report.mesh, atlas: result.report.texture.atlas, bounds: reread.bounds };
await writeFile(`.cache/samples/${sample.name}-prepared-report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
