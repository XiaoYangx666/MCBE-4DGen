import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { waitForExit } from '../lib/process.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function argument(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

const buildDir = resolve(argument('--build', join(root, 'release/4DGen-win32-x64')));
const outDir = resolve(argument('--out', join(root, 'release')));
const script = join(root, 'installer/4DGen.iss');

if (!existsSync(buildDir)) {
  throw new Error(`Build directory not found: ${buildDir}\nRun "npm run desktop:package" first, or pass --build <dir>.`);
}

const candidates = [
  process.env.ISCC,
  'C:/Program Files (x86)/Inno Setup 6/ISCC.exe',
  'C:/Program Files/Inno Setup 6/ISCC.exe',
  join(root, '.cache/inno/ISCC.exe'),
].filter((value): value is string => Boolean(value));
const iscc = candidates.find((value) => existsSync(value)) ?? 'ISCC.exe';

const child = spawn(
  iscc,
  [`/DBuildDir=${buildDir}`, `/DOutputDir=${outDir}`, script],
  { stdio: 'inherit' },
);
try {
  if (await waitForExit(child) !== 0) throw new Error('Inno Setup compilation failed.');
} catch (error) {
  if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
    throw new Error('ISCC.exe not found. Install Inno Setup 6, add it to PATH, or set the ISCC environment variable.');
  }
  throw error;
}
console.log(`Installer written to ${outDir} (4DGen-*-setup.exe)`);
