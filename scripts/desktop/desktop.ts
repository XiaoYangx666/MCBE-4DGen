import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { waitForExit } from '../lib/process.ts';

const electron = await import('electron');
const executable = electron.default as unknown as string;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const env: Record<string, string | undefined> = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
// Chromium creates its single-instance lock before main.cjs runs, so an
// alternate profile must also be passed as an early command-line switch.
const userData = process.env.FOURDGEN_DESKTOP_USER_DATA;
const args: string[] = [];
if (process.env.FOURDGEN_DESKTOP_NO_SANDBOX === '1')
  args.push('--no-sandbox');
if (userData) args.push(`--user-data-dir=${resolve(userData)}`);
args.push(root);
const child = spawn(executable, args, { env, stdio: 'inherit' });
process.on('SIGINT', () => child.kill());
process.on('SIGTERM', () => child.kill());
process.exitCode = (await waitForExit(child)) ?? 1;
