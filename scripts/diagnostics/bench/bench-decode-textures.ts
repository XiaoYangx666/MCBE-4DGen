// Diagnostic only: decode every source PNG of one avatar to raw RGBA per runtime.
// Usage: node scripts/diagnostics/bench/bench-decode-textures.ts <texture-directory>
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

const runtime = (process.versions as { bun?: string }).bun ? 'bun' : 'node';
const dir = process.argv[2]!;
const files = (await readdir(dir)).filter((name) => /\.(png|jpg)$/i.test(name)).sort();
const per: Array<{ name: string; decodeMs: number; bytes: number }> = [];
for (const name of files) {
  const bytes = await readFile(join(dir, name));
  const t0 = performance.now();
  const raw = await sharp(new Uint8Array(bytes)).toColourspace('srgb').ensureAlpha().raw().toBuffer();
  const t1 = performance.now();
  per.push({ name, decodeMs: Math.round(t1 - t0), bytes: raw.byteLength });
}
console.log(JSON.stringify({
  runtime,
  totalMs: per.reduce((sum, one) => sum + one.decodeMs, 0),
  totalBytes: per.reduce((sum, one) => sum + one.bytes, 0),
  per,
}, null, 1));
