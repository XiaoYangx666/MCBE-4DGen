import { resolveManagerConfig } from "../src/workspace-storage.ts";
import { readFile, writeFile, mkdir, lstat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { validateSkinPackPath } from '../src/skin-pack.ts';
import { previewOutput } from '../src/preview.ts';
import { PackManager } from '../src/pack-manager.ts';
import type { ManagerConfig } from '../src/pack-manager.ts';
import { waitForExit } from './process.ts';

interface Workflow {
  version: 1; model: string; output: string; name: string;
  binding?: 'static' | 'humanoid'; profile?: string; height?: number;
  managerConfig?: string; libraryId?: string; slot?: string;
}
async function main() {
  const args = process.argv.slice(2), configArgument = args.shift();
  if (!configArgument || args.some((s) => s !== '--deploy') || args.length > 1) throw new Error('Usage: node scripts/workflow.ts <workflow.json> [--deploy]');
  const configPath = resolve(configArgument), base = dirname(configPath);
  const config = JSON.parse(await readFile(configPath, 'utf8')) as Workflow;
  if (config.version !== 1 || !config.model || !config.output || !config.name ||
      (config.binding && !['static', 'humanoid'].includes(config.binding))) throw new Error('Invalid workflow config');
  const model = resolve(base, config.model), output = resolve(base, config.output);
  const profile = config.profile ? resolve(base, config.profile) : undefined;
  let manager: PackManager | undefined;
  if (config.managerConfig) {
    if (!config.libraryId) throw new Error('managerConfig requires libraryId');
    const path = resolve(base, config.managerConfig), value = JSON.parse(await readFile(path, 'utf8')) as ManagerConfig;
    manager = new PackManager(await resolveManagerConfig(value,path));
    if ((await manager.list()).some((p) => p.id === config.libraryId)) throw new Error('Library ID already exists; choose a new version ID');
  }
  if (args.includes('--deploy') && (!manager || !config.slot)) throw new Error('--deploy requires managerConfig, libraryId and slot');
  const previewPath = output + '-preview.png', reportPath = output + '-workflow.json';
  for (const path of [output, output + '.zip', previewPath, reportPath]) {
    try { await lstat(path); throw new Error('Workflow refuses existing output: ' + path); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  await mkdir(dirname(output), { recursive: true });
  const command = [process.execPath, resolve(dirname(fileURLToPath(import.meta.url)), '../src/cli.ts'), 'convert', model,
    '--out', output, '--name', config.name, '--binding', config.binding ?? 'static'];
  if (profile) command.push('--humanoid-profile', profile);
  if (config.height !== undefined) command.push('--height', String(config.height));
  console.error('Converting and binding model...');
  const child = spawn(command[0]!, command.slice(1), { stdio: ['ignore', 'pipe', 'inherit'] });
  let stdout = '';
  child.stdout!.setEncoding('utf8');
  child.stdout!.on('data', (chunk: string) => { stdout += chunk; });
  const code = await waitForExit(child);
  if (code !== 0) throw new Error('Conversion failed; no pack enabled');
  const conversion: unknown = JSON.parse(stdout);
  const validation = await validateSkinPackPath(output);
  console.error('Rendering written geometry...');
  const preview = await previewOutput(output, { size: 256, unlit: true });
  await writeFile(previewPath, preview.png, { flag: 'wx' });
  const digest = async (path: string) => createHash('sha256').update(await readFile(path)).digest('hex');
  const imported = manager ? await manager.importPack(config.libraryId!, output) : null;
  const report: Record<string, unknown> = { version: 1, created: new Date().toISOString(), configPath,
    source: { path: model, sha256: await digest(model) },
    profile: profile ? { path: profile, sha256: await digest(profile), values: JSON.parse(await readFile(profile, 'utf8')) } : null,
    conversion, validation, previewPath, imported, deployment: null,
    acceptance: 'Offline checks only; wearing and motion must be verified in Minecraft by the user.' };
  // Persist conversion/provenance even if enabling fails; the successful report is updated afterward.
  await writeFile(reportPath, JSON.stringify(report, null, 2), { flag: 'wx' });
  if (args.includes('--deploy')) {
    console.error('Backing up and enabling pack...');
    report.deployment = await manager!.enable(config.slot!, config.libraryId!);
    await writeFile(reportPath, JSON.stringify(report, null, 2));
  }
  console.log(JSON.stringify({ output, previewPath, reportPath, libraryId: imported?.id ?? null, deployed: !!report.deployment }, null, 2));
}
try { await main(); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }

