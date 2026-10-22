#!/usr/bin/env node
/**
 * Skin-state experiments for Minecraft Bedrock (Windows).
 *
 * This is deliberately a standalone script first: it snapshots the files that
 * actually hold the selected skin and the character-creator profiles, then can
 * diff and restore them. The desktop UI can call the same functions later.
 *
 * Usage:
 *   node scripts/client/skin-state.ts inspect
 *   node scripts/client/skin-state.ts snapshot --label before-create
 *   node scripts/client/skin-state.ts list
 *   node scripts/client/skin-state.ts show <id>
 *   node scripts/client/skin-state.ts diff <a> <b>
 *   node scripts/client/skin-state.ts restore <id> [--profile] [--options] [--packs] [--all]
 *                                        [--slot personaProfile2]
 */
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '../..');
const configPath =
  process.env.SKIN_MANAGER_CONFIG ?? resolve(appRoot, 'skin-manager.local.json');
const snapshotRoot = resolve(
  process.env.SKIN_STATE_ROOT ?? resolve(appRoot, '.cache', 'skin-state'),
);

type Json = Record<string, any>;
type ManifestFile = { size: number; sha256: string; source: string };
type SnapshotManifest = {
  version: 1;
  id: string;
  label: string;
  created: string;
  gameRunning: boolean;
  configPath: string;
  userDir: string;
  skinPacksRoot: string;
  selectedSkin: string | null;
  selectedPack: Json | null;
  profiles: Json[];
  options: Record<string, string>;
  files: Record<string, ManifestFile>;
};

function log(message: string) {
  console.log(message);
}

function fail(message: string): never {
  console.error('错误: ' + message);
  process.exit(1);
}

function sha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function exists(path: string) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function inside(root: string, path: string) {
  const rel = relative(root, path);
  return rel !== '' && !rel.startsWith('..') && !rel.includes(':' + sep);
}

async function readJson<T = Json>(path: string): Promise<T> {
  return JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, '')) as T;
}

async function atomicWrite(path: string, bytes: Uint8Array) {
  await mkdir(dirname(path), { recursive: true });
  const temp = path + '.' + randomUUID() + '.tmp';
  await writeFile(temp, bytes);
  await rename(temp, path);
}

async function atomicJson(path: string, value: unknown) {
  await atomicWrite(path, new TextEncoder().encode(JSON.stringify(value, null, 2)));
}

function gameProcesses() {
  try {
    const out = execFileSync(
      'tasklist',
      ['/FI', 'IMAGENAME eq Minecraft.Windows.exe', '/NH'],
      { encoding: 'utf8', windowsHide: true },
    );
    return out.toLowerCase().includes('minecraft.windows.exe');
  } catch {
    return false;
  }
}

function assertGameClosed() {
  if (process.env.SKIN_STATE_ALLOW_RUNNING === '1') return;
  if (gameProcesses())
    fail('Minecraft 正在运行。请先完全退出游戏，再读写 ud*.dat / options.txt。');
}

function loadConfig() {
  if (!existsSync(configPath)) fail('找不到配置文件: ' + configPath);
  const raw = JSON.parse(
    readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''),
  ) as Json;
  if (raw.version !== 1 || typeof raw.skinPacksRoot !== 'string')
    fail('skin-manager 配置无效: ' + configPath);
  return {
    raw,
    skinPacksRoot: resolve(dirname(configPath), raw.skinPacksRoot),
    stateDir: resolve(dirname(configPath), raw.stateDir),
  };
}

function appDataRoot() {
  return (
    process.env.APPDATA ??
    join(process.env.USERPROFILE ?? '', 'AppData', 'Roaming')
  );
}

async function discoverUserDir() {
  const users = join(appDataRoot(), 'Minecraft Bedrock', 'Users');
  if (!existsSync(users)) fail('找不到 Minecraft Bedrock 用户目录: ' + users);
  const candidates: { dir: string; ud: string; mtime: number }[] = [];
  for (const user of await readdir(users, { withFileTypes: true })) {
    if (!user.isDirectory()) continue;
    const dir = join(users, user.name, 'games', 'com.mojang');
    if (!existsSync(dir)) continue;
    for (const file of await readdir(dir)) {
      if (!/^ud[0-9]+\.dat$/i.test(file)) continue;
      const full = join(dir, file);
      candidates.push({ dir, ud: full, mtime: (await stat(full)).mtimeMs });
    }
  }
  if (!candidates.length)
    fail('找不到 ud*.dat（角色创建器档案）。请先启动一次 Minecraft。');
  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates[0]!;
}

function parseOptions(text: string) {
  const bom = text.startsWith('\uFEFF');
  const body = bom ? text.slice(1) : text;
  const eol = body.includes('\r\n') ? '\r\n' : '\n';
  const lines = body.split(/\r?\n/);
  const values: Record<string, string> = {};
  for (const line of lines) {
    const index = line.indexOf(':');
    if (index > 0) values[line.slice(0, index)] = line.slice(index + 1);
  }
  return { bom, eol, lines, values };
}

function patchOptions(text: string, updates: Record<string, string>) {
  const { bom, eol, lines } = parseOptions(text);
  const seen = new Set<string>();
  const output = lines.map((line) => {
    const index = line.indexOf(':');
    if (index <= 0) return line;
    const key = line.slice(0, index);
    if (!Object.hasOwn(updates, key)) return line;
    seen.add(key);
    return key + ':' + updates[key];
  });
  for (const [key, value] of Object.entries(updates))
    if (!seen.has(key)) output.push(key + ':' + value);
  return (bom ? '\uFEFF' : '') + output.join(eol);
}

function parseSkinIndex(value: string | undefined) {
  if (!value) return null;
  const match =
    /^([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})_(.+)$/i.exec(value);
  return match ? { packUUID: match[1]!, skinID: match[2]! } : null;
}

function summarizeProfiles(doc: Json) {
  const sync = doc.Synchronized ?? {};
  const base = sync.personaProfile?.personaCollection?.universalApp?.[0] ?? {};
  const lastUsed = String(base.lastUsedPersonaSlot ?? '');
  const profiles: Json[] = [];
  for (const key of Object.keys(sync)) {
    if (!/^personaProfile\d+$/.test(key)) continue;
    const items = sync[key]?.personaCollection?.universalApp ?? [];
    const head = items[0] ?? {};
    const pieces = items.slice(1);
    const slotName = key.replace('personaProfile', 'persona');
    profiles.push({
      slot: key,
      kind: head.skin ? 'classic' : pieces.length ? 'persona' : 'empty',
      skin: !!head.skin,
      skinColor: head.skcol ?? null,
      arm: head.arm ?? null,
      pieces: pieces.length,
      lastUsed: lastUsed === 'persona_profile_' + slotName,
      itemIds: pieces.map((item: Json) => item.id).filter(Boolean),
    });
  }
  return { profiles, lastUsed, base };
}

async function findPack(packUUID: string, skinID: string) {
  const roots = [
    loadConfig().skinPacksRoot,
    join(appDataRoot(), 'Minecraft Bedrock', 'premium_cache', 'skin_packs'),
  ];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const folder = join(root, entry.name);
      const manifestPath = join(folder, 'manifest.json');
      if (!existsSync(manifestPath)) continue;
      let manifest: Json;
      try {
        manifest = await readJson(manifestPath);
      } catch {
        continue;
      }
      if (String(manifest.header?.uuid ?? '').toLowerCase() !== packUUID.toLowerCase())
        continue;
      let skin: Json | null = null;
      const skinsPath = join(folder, 'skins.json');
      if (existsSync(skinsPath)) {
        try {
          const data = await readJson<{ skins?: Json[] }>(skinsPath);
          skin =
            data.skins?.find(
              (item) =>
                item.localization_name === skinID ||
                item.name === skinID ||
                String(item.localization_name ?? '').includes(skinID),
            ) ?? null;
        } catch {
          /* Marketplace cache skins.json is often encrypted. */
        }
      }
      return {
        uuid: packUUID,
        name: manifest.header?.name ?? entry.name,
        folder,
        source: root.includes('premium_cache') ? 'premium_cache' : 'skin_packs',
        skin,
        skinID,
      };
    }
  }
  return null;
}

async function collectState() {
  const config = loadConfig();
  const user = await discoverUserDir();
  const optionsPath = join(user.dir, 'minecraftpe', 'options.txt');
  if (!existsSync(optionsPath)) fail('找不到 options.txt: ' + optionsPath);
  const optionsText = await readFile(optionsPath, 'utf8');
  const options = parseOptions(optionsText).values;
  const ud = await readJson(user.ud);
  const profileSummary = summarizeProfiles(ud);
  const selectedSkin = options.game_skintypefull ?? null;
  const index = parseSkinIndex(selectedSkin ?? undefined);
  const selectedPack = index
    ? await findPack(index.packUUID, index.skinID)
    : null;
  return {
    config,
    user,
    optionsPath,
    optionsText,
    options,
    ud,
    profileSummary,
    selectedSkin,
    selectedPack,
  };
}

async function addFile(
  files: Record<string, ManifestFile>,
  snapshotDir: string,
  source: string,
  key: string,
) {
  if (!existsSync(source)) return;
  const bytes = await readFile(source);
  const target = join(snapshotDir, 'files', key);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes);
  files[key] = { size: bytes.byteLength, sha256: sha256(bytes), source };
}

async function addTree(
  files: Record<string, ManifestFile>,
  snapshotDir: string,
  sourceRoot: string,
  keyRoot: string,
) {
  if (!existsSync(sourceRoot)) return;
  for (const entry of await readdir(sourceRoot, { withFileTypes: true })) {
    const source = join(sourceRoot, entry.name);
    const key = keyRoot + '/' + entry.name;
    if (entry.isDirectory()) await addTree(files, snapshotDir, source, key);
    else if (entry.isFile()) await addFile(files, snapshotDir, source, key);
  }
}

async function snapshot(label: string) {
  assertGameClosed();
  const state = await collectState();
  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .slice(0, 19);
  const id = stamp + '-' + (label || 'snapshot').replace(/[^A-Za-z0-9_-]+/g, '-');
  const dir = join(snapshotRoot, id);
  if (existsSync(dir)) fail('快照已存在: ' + dir);
  await mkdir(dir, { recursive: true });
  const files: Record<string, ManifestFile> = {};
  await addFile(files, dir, state.user.ud, 'ud/' + state.user.ud.split(sep).pop()!);
  await addFile(files, dir, state.optionsPath, 'minecraftpe/options.txt');
  for (const name of ['global_resource_packs.json', 'catalog_info.json']) {
    const source = join(state.user.dir, 'minecraftpe', name);
    if (existsSync(source)) await addFile(files, dir, source, 'minecraftpe/' + name);
  }
  for (const slot of ['persona', 'custom']) {
    const source = join(state.config.skinPacksRoot, slot);
    await addTree(files, dir, source, 'skin_packs/' + slot);
  }
  await addTree(
    files,
    dir,
    join(state.user.dir, 'custom_skins'),
    'custom_skins',
  );
  const premium = join(appDataRoot(), 'Minecraft Bedrock', 'premium_cache');
  for (const key of [
    'persona/.lru.json',
    'persona/personaCatalogItemCache.json',
    'skin_packs/.lru.json',
  ]) {
    const source = join(premium, key.replaceAll('/', sep));
    if (existsSync(source)) await addFile(files, dir, source, 'premium_cache/' + key);
  }
  const manifest: SnapshotManifest = {
    version: 1,
    id,
    label,
    created: new Date().toISOString(),
    gameRunning: false,
    configPath,
    userDir: state.user.dir,
    skinPacksRoot: state.config.skinPacksRoot,
    selectedSkin: state.selectedSkin,
    selectedPack: state.selectedPack,
    profiles: state.profileSummary.profiles,
    options: {
      game_skintypefull: state.options.game_skintypefull ?? '',
      game_recentskin1: state.options.game_recentskin1 ?? '',
      game_recentskin2: state.options.game_recentskin2 ?? '',
      game_recentskin3: state.options.game_recentskin3 ?? '',
    },
    files,
  };
  await atomicJson(join(dir, 'snapshot.json'), manifest);
  log('已创建快照: ' + id);
  log('目录: ' + dir);
  log('选中皮肤: ' + (manifest.selectedSkin ?? '(空)'));
  for (const profile of manifest.profiles)
    log(
      `  ${profile.slot}: ${profile.kind}` +
        (profile.skinColor ? `, 肤色 ${profile.skinColor}` : '') +
        `, 部件 ${profile.pieces}` +
        (profile.lastUsed ? ' [最后使用]' : ''),
    );
  return manifest;
}

async function listSnapshots() {
  if (!existsSync(snapshotRoot)) return [];
  const result: SnapshotManifest[] = [];
  for (const entry of await readdir(snapshotRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(snapshotRoot, entry.name, 'snapshot.json');
    if (!existsSync(path)) continue;
    result.push(await readJson<SnapshotManifest>(path));
  }
  result.sort((a, b) => b.created.localeCompare(a.created));
  return result;
}

async function loadSnapshot(id: string) {
  const path = join(snapshotRoot, id, 'snapshot.json');
  if (!existsSync(path)) fail('找不到快照: ' + id);
  return readJson<SnapshotManifest>(path);
}

function diffProfiles(a: Json[], b: Json[]) {
  const bySlot = (items: Json[]) =>
    Object.fromEntries(items.map((item) => [item.slot, item]));
  const left = bySlot(a);
  const right = bySlot(b);
  const lines: string[] = [];
  for (const slot of [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()) {
    const before = left[slot];
    const after = right[slot];
    if (!before || !after) {
      lines.push(`${slot}: ${before ? '删除' : '新增'}`);
      continue;
    }
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    lines.push(
      `${slot}: ${before.kind}/${before.pieces}件/${before.skinColor} -> ${after.kind}/${after.pieces}件/${after.skinColor}` +
        (before.lastUsed !== after.lastUsed
          ? `, 最后使用 ${before.lastUsed} -> ${after.lastUsed}`
          : ''),
    );
  }
  return lines;
}

async function diff(aId: string, bId: string) {
  const a = await loadSnapshot(aId);
  const b = await loadSnapshot(bId);
  log(`A: ${a.id} (${a.label})`);
  log(`B: ${b.id} (${b.label})`);
  log('');
  log('选中皮肤:');
  log(`  A: ${a.selectedSkin ?? '(空)'}`);
  log(`  B: ${b.selectedSkin ?? '(空)'}`);
  log('');
  log('角色创建器档案:');
  const profileLines = diffProfiles(a.profiles, b.profiles);
  if (!profileLines.length) log('  (无变化)');
  else for (const line of profileLines) log('  ' + line);
  log('');
  log('文件:');
  const keys = [...new Set([...Object.keys(a.files), ...Object.keys(b.files)])].sort();
  let changed = 0;
  for (const key of keys) {
    const before = a.files[key];
    const after = b.files[key];
    if (!before) {
      log(`  + ${key}`);
      changed++;
    } else if (!after) {
      log(`  - ${key}`);
      changed++;
    } else if (before.sha256 !== after.sha256) {
      log(`  ~ ${key} (${before.size} -> ${after.size})`);
      changed++;
    }
  }
  if (!changed) log('  (无变化)');
}

async function restoreFile(snapshotDir: string, manifest: SnapshotManifest, key: string) {
  const entry = manifest.files[key];
  if (!entry) return;
  const source = join(snapshotDir, 'files', key);
  const bytes = await readFile(source);
  if (sha256(bytes) !== entry.sha256)
    fail(`快照文件校验失败: ${key}`);
  await atomicWrite(entry.source, bytes);
  log('已恢复: ' + entry.source);
}

async function restore(id: string, options: { profile: boolean; options: boolean; packs: boolean; all: boolean; slot?: string }) {
  assertGameClosed();
  const manifest = await loadSnapshot(id);
  const dir = join(snapshotRoot, id);
  const current = await collectState();
  const before = await snapshot('before-restore-' + id);
  log('恢复前已自动快照: ' + before.id);
  log('');
  const udKey = Object.keys(manifest.files).find((key) => key.startsWith('ud/'));
  if (!udKey) fail('快照里没有 ud*.dat');
  if (options.slot) {
    if (!/^personaProfile[1-5]$/.test(options.slot))
      fail('--slot 只支持 personaProfile1..5');
    const saved = await readJson<Json>(join(dir, 'files', udKey));
    const target = current.ud;
    target.Synchronized ??= {};
    target.Synchronized[options.slot] = saved.Synchronized?.[options.slot];
    const base =
      target.Synchronized.personaProfile?.personaCollection?.universalApp?.[0];
    if (base)
      base.lastUsedPersonaSlot =
        'persona_profile_persona' + options.slot.replace('personaProfile', '');
    const text = JSON.stringify(target, null, 3);
    const bom = (await readFile(current.user.ud, 'utf8')).startsWith('\uFEFF');
    await atomicWrite(current.user.ud, new TextEncoder().encode((bom ? '\uFEFF' : '') + text));
    log('已恢复档案槽: ' + options.slot);
  } else if (options.profile || options.all) {
    await restoreFile(dir, manifest, udKey);
  }
  if (options.options || options.all) {
    const currentText = await readFile(current.optionsPath, 'utf8');
    const updates: Record<string, string> = {};
    for (const key of [
      'game_skintypefull',
      'game_recentskin1',
      'game_recentskin2',
      'game_recentskin3',
    ])
      if (Object.hasOwn(manifest.options, key))
        updates[key] = manifest.options[key]!;
    await atomicWrite(
      current.optionsPath,
      new TextEncoder().encode(patchOptions(currentText, updates)),
    );
    log('已恢复皮肤索引: ' + (manifest.options.game_skintypefull ?? '(空)'));
  }
  if (options.packs || options.all) {
    for (const slot of ['persona', 'custom']) {
      const keys = Object.keys(manifest.files).filter((key) =>
        key.startsWith('skin_packs/' + slot + '/'),
      );
      if (!keys.length) continue;
      const target = join(current.config.skinPacksRoot, slot);
      const stage = target + '.restore-' + randomUUID();
      await mkdir(stage, { recursive: true });
      for (const key of keys) {
        const bytes = await readFile(join(dir, 'files', key));
        const relativeKey = key.slice(('skin_packs/' + slot + '/').length);
        const out = join(stage, relativeKey);
        await mkdir(dirname(out), { recursive: true });
        await writeFile(out, bytes);
      }
      await rm(target, { recursive: true, force: true });
      await rename(stage, target);
      log('已恢复皮肤包: ' + target);
    }
  }
  log('');
  log('恢复完成。启动 Minecraft 后检查选中皮肤和角色创建器档案。');
}

function usage() {
  log(`用法:
  node scripts/client/skin-state.ts inspect
  node scripts/client/skin-state.ts snapshot --label before-create
  node scripts/client/skin-state.ts list
  node scripts/client/skin-state.ts show <id>
  node scripts/client/skin-state.ts diff <a> <b>
  node scripts/client/skin-state.ts restore <id> [--profile] [--options] [--packs] [--all]
                                       [--slot personaProfile2]`);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === 'help' || command === '--help') return usage();
  if (command === 'inspect') {
    if (gameProcesses()) log('注意: Minecraft 正在运行；inspect 只读，快照/恢复前必须先退出游戏。\n');
    const state = await collectState();
    log('用户目录: ' + state.user.dir);
    log('档案文件: ' + state.user.ud);
    log('选中皮肤: ' + (state.selectedSkin ?? '(空)'));
    if (state.selectedPack) {
      log(
        `皮肤包: ${state.selectedPack.name} (${state.selectedPack.source})`,
      );
      log('  目录: ' + state.selectedPack.folder);
      log('  皮肤 ID: ' + state.selectedPack.skinID);
      if (state.selectedPack.skin)
        log('  皮肤条目: ' + JSON.stringify(state.selectedPack.skin));
    }
    log('');
    log('角色创建器档案:');
    for (const profile of state.profileSummary.profiles)
      log(
        `  ${profile.slot}: ${profile.kind}` +
          (profile.skinColor ? `, 肤色 ${profile.skinColor}` : '') +
          `, 部件 ${profile.pieces}` +
          (profile.lastUsed ? ' [最后使用]' : ''),
      );
    log('');
    log('options.txt 皮肤键:');
    for (const key of [
      'game_skintypefull',
      'game_recentskin1',
      'game_recentskin2',
      'game_recentskin3',
    ])
      log(`  ${key}=${state.options[key] ?? ''}`);
    return;
  }
  if (command === 'snapshot') {
    const labelIndex = args.indexOf('--label');
    const label = labelIndex >= 0 ? args[labelIndex + 1] ?? 'snapshot' : 'snapshot';
    await snapshot(label);
    return;
  }
  if (command === 'list') {
    const items = await listSnapshots();
    if (!items.length) return log('(没有快照)');
    for (const item of items)
      log(
        `${item.id}  ${item.label}  ${item.selectedSkin ?? '(空)'}  ${item.profiles
          .map((p) => `${p.slot}:${p.kind}/${p.pieces}`)
          .join(' ')}`,
      );
    return;
  }
  if (command === 'show') {
    const item = await loadSnapshot(args[0] ?? '');
    log(JSON.stringify(item, null, 2));
    return;
  }
  if (command === 'diff') {
    if (args.length < 2) fail('需要两个快照 ID');
    await diff(args[0]!, args[1]!);
    return;
  }
  if (command === 'restore') {
    const id = args[0];
    if (!id) fail('需要快照 ID');
    const flags = new Set(args.slice(1));
    const slotIndex = args.indexOf('--slot');
    const slot = slotIndex >= 0 ? args[slotIndex + 1] : undefined;
    const all = flags.has('--all');
    await restore(id, {
      profile: flags.has('--profile') || (!all && !flags.has('--options') && !flags.has('--packs') && !slot),
      options: flags.has('--options'),
      packs: flags.has('--packs'),
      all,
      ...(slot ? { slot } : {}),
    });
    return;
  }
  usage();
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
