import assert from 'node:assert/strict';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { importModel } from '../../src/importer.ts';
import { optimizeMesh } from '../../src/mesh-optimizer.ts';
import { inspectModel } from '../../src/inspect.ts';
import { selectSample } from './sample.ts';

const sample = selectSample(process.argv[2] ?? 'ToyCar');
const result = await optimizeMesh(await importModel(sample.path), { ratio: Number(process.argv[3] ?? 0.5), maxError: Number(process.argv[4] ?? 0.001) });
const path = `.cache/samples/${sample.name}-optimized.glb`;
await new NodeIO().registerExtensions(ALL_EXTENSIONS).write(path, result.model.document);
const reread = await inspectModel(await importModel(path));
assert.equal(reread.counts.triangles, result.report.after);
console.log(JSON.stringify({ sample: sample.name, output: path, ...result.report }, null, 2));
