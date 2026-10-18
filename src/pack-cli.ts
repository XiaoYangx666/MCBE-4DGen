import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { PackManager } from './pack-manager.ts';
import type { ManagerConfig } from './pack-manager.ts';

const help = `Skin pack library and reversible slot manager
Usage: bun run packs <command> [arguments] [--config skin-manager.local.json]
  init --root <skin_packs> [--state <directory>]  Write local config; no game writes
  import <id> <directory|mcpack>                Import immutable copy into library
  export <id> <output.mcpack>                   Export stored pack; refuse overwrite
  list                                        List library packs
  status                                      Inspect configured slots and external changes
  enable <slot> <id>                           Add library pack to slot (backs up first)
  disable <slot> <id>                          Remove pack; last removal restores baseline
  backups <slot>                              List verified-operation backup metadata
  restore <slot> [backup-id]                   Restore original baseline or a named backup
  recover <slot>                              Recover interrupted deployment using its backup
  archive <id>                                Mark inactive pack archived; keep files/backups
  adopt <slot> <original-directory> [pack-id]  Track existing install and original backup
Config paths resolve relative to the config file; enabled slots default to custom/persona.
Close Minecraft before enable/disable/restore/recover; restart and reselect the skin afterward.
`;
async function main() {
  const args = process.argv.slice(2);
  let configPath = resolve('skin-manager.local.json');
  const i = args.indexOf('--config');
  if (i !== -1) {
    if (!args[i + 1]) throw new Error('--config requires a path');
    configPath = resolve(args[i + 1]!); args.splice(i, 2);
  }
  const command = args.shift();
  if (!command || command === '--help' || command === 'help') { console.log(help); return; }
  if (command === 'init') {
    let root: string | undefined, state = '.skin-pack-manager';
    while (args.length) {
      const flag = args.shift(), value = args.shift();
      if (!value || !['--root', '--state'].includes(flag!)) throw new Error('init requires --root <path> and optional --state <path>');
      if (flag === '--root') root = value; else state = value;
    }
    if (!root) throw new Error('init requires --root <skin_packs path>');
    const config: ManagerConfig = { version: 1, skinPacksRoot: resolve(dirname(configPath), root),
      stateDir: resolve(dirname(configPath), state), slots: { custom: { manifestFormat: 2 }, persona: { manifestFormat: 1 } } };
    new PackManager(config); // Validate before writing.
    await writeFile(configPath, JSON.stringify(config, null, 2), { flag: 'wx' });
    console.log(JSON.stringify({ configPath, ...config }, null, 2)); return;
  }
  const raw = JSON.parse(await readFile(configPath, 'utf8')) as ManagerConfig;
  const manager = new PackManager({ ...raw, skinPacksRoot: resolve(dirname(configPath), raw.skinPacksRoot),
    stateDir: resolve(dirname(configPath), raw.stateDir) });
  const count = (min: number, max = min) => { if (args.length < min || args.length > max) throw new Error('Wrong arguments for ' + command + '\n' + help); };
  let result: unknown;
  switch (command) {
    case 'import': count(2); result = await manager.importPack(args[0]!, resolve(args[1]!)); break;
    case 'export': count(2); result = await manager.exportPack(args[0]!, resolve(args[1]!)); break;
    case 'list': count(0); result = await manager.list(); break;
    case 'status': count(0); result = await manager.status(); break;
    case 'enable': count(2); result = await manager.enable(args[0]!, args[1]!); break;
    case 'disable': count(2); result = await manager.disable(args[0]!, args[1]!); break;
    case 'backups': count(1); result = await manager.backups(args[0]!); break;
    case 'restore': count(1, 2); result = await manager.restore(args[0]!, args[1]); break;
    case 'recover': count(1); result = await manager.recover(args[0]!); break;
    case 'archive': count(1); result = await manager.archive(args[0]!); break;
    case 'adopt': count(2, 3); result = await manager.adopt(args[0]!, resolve(args[1]!), args[2]); break;
    default: throw new Error('Unknown command: ' + command + '\n' + help);
  }
  console.log(JSON.stringify(result, null, 2));
}
try { await main(); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
