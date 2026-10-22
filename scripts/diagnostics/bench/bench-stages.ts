// Diagnostic only: times import / mesh reduce / texture atlas per runtime.
// Usage: node scripts/diagnostics/bench/bench-stages.ts <model> [ratio]
import { importModel } from '../../../src/importer.ts';
import { optimizeMesh } from '../../../src/mesh-optimizer.ts';
import { optimizeTextures } from '../../../src/texture-optimizer.ts';

const path = process.argv[2]!;
const ratio = Number(process.argv[3] ?? '0.2');
const t0 = performance.now();
const model = await importModel(path);
const t1 = performance.now();
const mesh = await optimizeMesh(model, { ratio, maxError: 0.001 });
const t2 = performance.now();
const texture = await optimizeTextures(mesh.model, { maxTextureSize: 256, compactSize: 128, padding: 1 });
const t3 = performance.now();
console.log(JSON.stringify({
  runtime: (process.versions as { bun?: string }).bun ? 'bun' : 'node',
  importMs: Math.round(t1 - t0),
  meshMs: Math.round(t2 - t1),
  textureMs: Math.round(t3 - t2),
  triangles: mesh.report.after,
  textureBytes: texture.png.byteLength,
}));
