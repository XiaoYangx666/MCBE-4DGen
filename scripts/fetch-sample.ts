import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { selectSample } from './sample.ts';

const sample = selectSample(process.argv[2]);

function verify(bytes: Uint8Array): void {
  if (bytes.byteLength !== sample.bytes || createHash('sha256').update(bytes).digest('hex') !== sample.sha256) {
    throw new Error('Sample integrity mismatch; refusing to use unverified model bytes.');
  }
}

try {
  let cached: Uint8Array | undefined;
  try { cached = await readFile(sample.path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (cached) verify(cached);
  else {
    const response = await fetch(sample.url, { signal: AbortSignal.timeout(45_000) });
    if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    verify(bytes);
    await mkdir(dirname(sample.path), { recursive: true });
    await writeFile(sample.path, bytes);
  }
  console.log(`${sample.path} | ${sample.license} | ${sample.credit} | SHA256 verified`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
