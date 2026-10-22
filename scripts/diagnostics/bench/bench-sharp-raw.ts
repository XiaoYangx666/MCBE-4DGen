// Diagnostic only: repeated sharp pipelines built from a large raw RGBA buffer.
// Usage: node scripts/diagnostics/bench/bench-sharp-raw.ts
import sharp from 'sharp';

const runtime = (process.versions as { bun?: string }).bun ? 'bun' : 'node';
const side = 4096;
const raw = Buffer.alloc(side * side * 4, 128);
// Warm up so JIT/native init is not part of the measurement.
await sharp(raw, { raw: { width: side, height: side, channels: 4 } }).resize(32, 32, { fit: 'fill' }).raw().toBuffer();

const iterations = 20;
const t0 = performance.now();
let bytes = 0;
for (let i = 0; i < iterations; i++) {
  bytes += (await sharp(raw, { raw: { width: side, height: side, channels: 4 } })
    .extract({ left: i * 8, top: i * 4, width: 512, height: 256 })
    .resize(64, 64, { fit: 'fill' })
    .raw()
    .toBuffer()).byteLength;
}
const t1 = performance.now();
console.log(JSON.stringify({ runtime, perPipelineMs: Math.round((t1 - t0) / iterations), totalMs: Math.round(t1 - t0), bytes }));
