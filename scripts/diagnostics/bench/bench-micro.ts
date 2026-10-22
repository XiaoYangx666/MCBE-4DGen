// Diagnostic only: isolate fs read, sharp (native), and JS/JIT cost per runtime.
// Usage: node scripts/diagnostics/bench/bench-micro.ts <image>
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';

const runtime = (process.versions as { bun?: string }).bun ? 'bun' : 'node';
const file = process.argv[2]!;

const t0 = performance.now();
const bytes = await readFile(file);
const t1 = performance.now();

const meta = await sharp(bytes).metadata();
const t2 = performance.now();

// Many small native round-trips, closest to a chart-by-chart composer.
let tiles = 0;
for (let i = 0; i < 40; i++) {
  const small = await sharp({ create: { width: 64, height: 64, channels: 4, background: { r: i * 6, g: 20, b: 30, alpha: 255 } } })
    .png().toBuffer();
  tiles += small.byteLength;
}
const t3 = performance.now();

const out = await sharp(bytes).resize(128, 128, { fit: 'fill' }).png().toBuffer();
const t4 = performance.now();

// JS/JIT: trig + float math over a big buffer.
const n = 2_000_000;
const src = new Float64Array(n);
for (let i = 0; i < n; i++) src[i] = Math.sin(i) * 1000;
const t5 = performance.now();
let acc = 0;
for (let i = 0; i < n; i++) acc += Math.hypot(src[i]!, src[i]! * 0.5);
const t6 = performance.now();

console.log(JSON.stringify({
  runtime,
  readMs: Math.round(t1 - t0),
  decodeMetaMs: Math.round(t2 - t1),
  smallSharpMs: Math.round(t3 - t2),
  resize128Ms: Math.round(t4 - t3),
  jitMs: Math.round(t6 - t5),
  trigSeedMs: Math.round(t5 - t4),
  meta: `${meta.width}x${meta.height}`,
  acc: Math.round(acc),
  tiles,
  outBytes: out.byteLength,
}));
