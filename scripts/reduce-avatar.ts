import { readFile, writeFile, mkdir, lstat } from 'node:fs/promises';
import { resolve, dirname, basename, extname } from 'node:path';
import { importModel } from '../src/importer.ts';
import { exportHumanoid } from '../src/humanoid.ts';
import type { HumanoidProfile } from '../src/humanoid.ts';
import { buildSkinPack, validateSkinPackPath, zipSkinPack } from '../src/skin-pack.ts';

async function main() {
  const [source, profilePath, destination, ratio = '0.2', maxError = '0.03'] = process.argv.slice(2);
  if (!source || !profilePath || !destination) throw new Error('Usage: bun run scripts/reduce-avatar.ts <model> <profile.json> <new-output> [ratio] [max-error] [pack-name]');
  const out = resolve(destination);
  for (const path of [out, out + '.mcpack', out + '-reduction.json']) {
    try { await lstat(path); throw new Error('Refusing existing output: ' + path); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  }
  const profile = JSON.parse(await readFile(profilePath, 'utf8')) as HumanoidProfile;
  const result = await exportHumanoid(await importModel(source, { backend: 'wasm' }), { height: 32, textureSize: 256, profile,
    reduction: { ratio: Number(ratio), maxError: Number(maxError) } });
  const files = buildSkinPack({ geometry: result.file, png: result.png, identifier: 'geometry.skin0', packName: process.argv[7] ?? basename(source, extname(source)) + '（轻量）' });
  const archive = await zipSkinPack(files);
  for (const [name, bytes] of Object.entries(files)) { const path = resolve(out, name); await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes, { flag: 'wx' }); }
  await writeFile(out + '.mcpack', archive, { flag: 'wx' });
  await writeFile(out + '-reduction.json', JSON.stringify({ ...result.report, binding: result.binding }, null, 2), { flag: 'wx' });
  await validateSkinPackPath(out);
  console.log(JSON.stringify({ output: out, triangles: result.report.triangles, geometryBytes: files['geometry.json']!.byteLength, reduction: result.binding.reduction }, null, 2));
}
try { await main(); } catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exitCode = 1; }
