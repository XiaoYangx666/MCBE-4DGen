// Diagnostic only: split importModel into its steps to find the runtime gap.
// Usage: node scripts/diagnostics/bench/bench-import.ts <model.glb>
import { realpath } from 'node:fs/promises';
import { dirname } from 'node:path';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { ModelIO, ModelResources } from '../../../src/resources.ts';
import { validateModel } from '../../../src/validate-model.ts';

const runtime = (process.versions as { bun?: string }).bun ? 'bun' : 'node';
const input = process.argv[2]!;
const t0 = performance.now();
const path = await realpath(input);
const t1 = performance.now();
await MeshoptDecoder.ready;
const t2 = performance.now();
const resources = new ModelResources(dirname(path));
const io = new ModelIO(resources).registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
  .setStrictResources(true).setLogger({ debug() {}, info() {}, warn() {}, error() {} });
const json = await io.readAsJSON(path);
const t3 = performance.now();
const document = await io.readJSON(json);
const t4 = performance.now();
// Materialize every accessor: readJSON is lazy, so force full decode.
let values = 0;
for (const accessor of document.getRoot().listAccessors()) { accessor.getArray(); values += accessor.getCount(); }
const t5 = performance.now();
const model = { document, source: { path, format: 'glb', units: 'meters', coordinates: 'right-handed-y-up', importer: 'gltf-transform' }, warnings: [] } as unknown as Parameters<typeof validateModel>[0];
validateModel(model);
const t6 = performance.now();

console.log(JSON.stringify({
  runtime,
  realpathMs: Math.round(t1 - t0),
  meshoptReadyMs: Math.round(t2 - t1),
  readAsJsonMs: Math.round(t3 - t2),
  readJsonMs: Math.round(t4 - t3),
  decodeAccessorsMs: Math.round(t5 - t4),
  validateMs: Math.round(t6 - t5),
  accessorValues: values,
}));
