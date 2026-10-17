import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { importModel } from '../src/importer.ts';
import { inspectModel } from '../src/inspect.ts';
import { selectSample } from './sample.ts';

const sample = selectSample(process.argv[2]);
const bytes = await readFile(sample.path);
assert.equal(createHash('sha256').update(bytes).digest('hex'), sample.sha256);
const report = await inspectModel(await importModel(sample.path));
for (const key of ['vertices', 'triangles', 'meshes', 'textures'] as const) assert.equal(report.counts[key], sample.expected[key]);
assert.ok(report.textures.every((t) => t.width > 0 && t.height > 0));
assert.ok(report.bounds && report.bounds.size.every((v) => v > 0));
assert.ok(report.warnings.some((s) => s.includes('normal map')));
console.log(JSON.stringify({ sample: sample.name, sha256: sample.sha256, counts: report.counts,
  bounds: report.bounds, textures: report.textures, warnings: report.warnings }, null, 2));
