// Diagnostic only: cost of copying a large Buffer into a Uint8Array per runtime.
// Usage: node scripts/diagnostics/bench/bench-copy.ts <large-file>
import { readFile } from 'node:fs/promises';

const runtime = (process.versions as { bun?: string }).bun ? 'bun' : 'node';
const buf = await readFile(process.argv[2]!);

const t0 = performance.now();
const a = Uint8Array.from(buf);
const t1 = performance.now();

const t2 = performance.now();
const b = new Uint8Array(buf);
const t3 = performance.now();

const t4 = performance.now();
const c = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
const t5 = performance.now();

const t6 = performance.now();
let sum = 0;
for (let i = 0; i < buf.length; i += 4096) sum += buf[i]!;
const t7 = performance.now();

console.log(JSON.stringify({
  runtime,
  uint8FromMs: Math.round(t1 - t0),
  newUint8ArrayMs: Math.round(t3 - t2),
  viewMs: Math.round(t5 - t4),
  loopMs: Math.round(t7 - t6),
  lengths: [a.length, b.length, c.length],
  sum,
}));
