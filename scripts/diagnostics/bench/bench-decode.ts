// Diagnostic only: UTF-8 text decoding cost of an 82 MB binary buffer per runtime.
// Usage: node scripts/diagnostics/bench/bench-decode.ts <large-json-file>
import { readFile } from 'node:fs/promises';

const runtime = (process.versions as { bun?: string }).bun ? 'bun' : 'node';
const bytes = new Uint8Array(await readFile(process.argv[2]!));

const t0 = performance.now();
const text = new TextDecoder().decode(bytes);
const t1 = performance.now();

const t2 = performance.now();
let idx = text.indexOf('"meshes"');
const t3 = performance.now();

console.log(JSON.stringify({
  runtime,
  decodeMs: Math.round(t1 - t0),
  indexOfMs: Math.round(t3 - t2),
  textLength: text.length,
  foundAt: idx,
}));
