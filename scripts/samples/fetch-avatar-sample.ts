import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import manifest from './avatar-samples.json' with { type: 'json' };

const name = process.argv[2];
if (name !== 'GeneLight' && name !== 'Shino') throw new Error('Usage: node scripts/samples/fetch-avatar-sample.ts GeneLight|Shino');
const sample = manifest[name];
for (const file of sample.files) {
  const path = join('.cache/anime', file.path);
  let bytes: Uint8Array;
  try { bytes = await readFile(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const response = await fetch(file.url, { signal: AbortSignal.timeout(45_000) });
    if (!response.ok) throw new Error('Sample download failed: HTTP ' + response.status);
    bytes = new Uint8Array(await response.arrayBuffer());
  }
  if (bytes.byteLength !== file.bytes || createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error('Sample integrity mismatch: ' + file.path);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}
console.log(JSON.stringify({ path: join('.cache/anime', sample.entry), license: sample.license, credit: sample.credit, source: sample.source, verifiedFiles: sample.files.length }, null, 2));
