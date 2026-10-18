import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir, lstat, realpath, unlink, rmdir, rename } from 'node:fs/promises';
import { resolve, relative, isAbsolute, join, dirname } from 'node:path';
import { readSkinPack, validateSkinPackFiles, zipSkinPack } from './skin-pack.ts';
import type { SkinPackFiles } from './skin-pack.ts';
import sharp from 'sharp';

export interface ManagerConfig {
  version: 1;
  skinPacksRoot: string;
  stateDir: string;
  slots: Record<string, { manifestFormat: 1 | 2 }>;
}
type Hashes = Record<string, string>;
type Active = { id: string; revision: string }[];
interface Tree { files: SkinPackFiles; directories: string[] }
interface Snapshot { id: string; slot: string; target: string; created: string; hashes: Hashes; directories: string[]; active: Active }
interface TargetState {
  slot: string; target: string; original: string; active: Active; installed: Hashes;
  headerUUID: string; moduleUUID: string; generation: number;
  pending?: { backup: string; planned: Hashes };
}
interface LibraryPack { id: string; revision: string; name: string; skins: number; hashes: Hashes; imported: string; warnings: string[]; removed?: boolean }
const encode = (v: unknown) => new TextEncoder().encode(JSON.stringify(v, null, 2));
const decode = <T>(bytes: Uint8Array): T => JSON.parse(new TextDecoder().decode(bytes)) as T;
const validID = (value: string) => { if (!/^[a-z][a-z0-9_-]{0,63}$/.test(value)) throw new Error('ID must be lowercase letters, digits, _ or -, starting with a letter'); return value; };
const safeName = (value: string) => {
  if (!value || value.includes('\\') || value.split('/').some((p) => !p || p === '.' || p === '..' || p.includes(':')) || isAbsolute(value)) throw new Error('Unsafe managed path: ' + value);
  return value;
};
const inside = (parent: string, child: string) => { const r = relative(parent, child); return r !== '' && !r.startsWith('..') && !isAbsolute(r); };
const hashes = (files: SkinPackFiles): Hashes => Object.fromEntries(Object.keys(files).sort().map((key) => [key, createHash('sha256').update(files[key]!).digest('hex')]));
const same = (a: Hashes, b: Hashes) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
async function exists(path: string) { try { await lstat(path); return true; } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false; throw e; } }
async function noLinks(path: string) {
  for (let p = resolve(path);; p = dirname(p)) {
    if (await exists(p)) {
      // Bun on Windows returns a bare "E:" for the drive root; resolving that
      // would incorrectly mean the drive's current working directory.
      const actual = await realpath(p);
      const canonical = /^[A-Za-z]:$/.test(actual) ? actual + '\\' : actual;
      if ((await lstat(p)).isSymbolicLink() || resolve(canonical).toLowerCase() !== resolve(p).toLowerCase()) throw new Error('Linked paths are not supported: ' + p);
    }
    if (dirname(p) === p) break;
  }
}
async function tree(path: string): Promise<Tree> {
  await noLinks(path);
  const result: Tree = { files: Object.create(null) as SkinPackFiles, directories: [] };
  if (!(await exists(path))) throw new Error('Directory does not exist: ' + path);
  const visit = async (dir: string, prefix: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const key = safeName(prefix + entry.name), full = join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Links are not supported: ' + full);
      if (entry.isDirectory()) { result.directories.push(key); await visit(full, key + '/'); }
      else if (entry.isFile()) result.files[key] = await readFile(full);
      else throw new Error('Unsupported filesystem entry: ' + full);
    }
  };
  await visit(path, ''); result.directories.sort(); return result;
}
async function writeTree(path: string, value: Tree) {
  await noLinks(path); await mkdir(path, { recursive: true });
  for (const dir of value.directories) await mkdir(join(path, safeName(dir)), { recursive: true });
  for (const [key, bytes] of Object.entries(value.files)) {
    const out = join(path, safeName(key)); await mkdir(dirname(out), { recursive: true }); await writeFile(out, bytes);
  }
}
async function replaceTree(path: string, value: Tree) {
  // Enumerate only the verified slot. Never delete/move the skin_packs root or siblings.
  const old = await tree(path);
  for (const key of Object.keys(old.files)) await unlink(join(path, safeName(key)));
  for (const dir of old.directories.sort((a, b) => b.length - a.length)) await rmdir(join(path, safeName(dir)));
  await writeTree(path, value);
  if (!same(hashes((await tree(path)).files), hashes(value.files))) throw new Error('Post-write SHA256 verification failed');
}
async function json<T>(path: string): Promise<T> { return decode<T>(await readFile(path)); }
async function atomicJSON(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  const temp = path + '.' + randomUUID() + '.tmp';
  await writeFile(temp, encode(value)); await rename(temp, path);
}

export class PackManager {
  constructor(readonly config: ManagerConfig) {
    if (config.version !== 1 || !isAbsolute(config.skinPacksRoot) || !isAbsolute(config.stateDir) || !Object.keys(config.slots).length) throw new Error('Invalid manager config');
    for (const [slot, options] of Object.entries(config.slots)) {
      validID(slot); if (!options || ![1, 2].includes(options.manifestFormat)) throw new Error('Invalid slot manifestFormat');
    }
    if (!relative(config.skinPacksRoot, config.stateDir) || inside(config.skinPacksRoot, config.stateDir) || inside(config.stateDir, config.skinPacksRoot)) throw new Error('Manager state and skin_packs root must be separate');
  }
  private target(slot: string) {
    if (!Object.hasOwn(this.config.slots, slot)) throw new Error('Slot is not configured: ' + slot);
    const target = resolve(this.config.skinPacksRoot, validID(slot));
    if (!inside(this.config.skinPacksRoot, target)) throw new Error('Target escapes root');
    return target;
  }
  private statePath(slot: string) { this.target(slot); return join(this.config.stateDir, 'targets', slot + '.json'); }
  private libraryPath(id: string) { return join(this.config.stateDir, 'library', validID(id) + '.json'); }
  private revisionPath(id: string, revision: string) {
    if (!/^[0-9a-f-]{36}$/.test(revision)) throw new Error('Invalid library revision');
    return join(this.config.stateDir, 'library', validID(id), revision);
  }
  private async state(slot: string) {
    const path = this.statePath(slot);
    if (!(await exists(path))) return null;
    const state = await json<TargetState>(path);
    if (state.target !== this.target(slot) || state.slot !== slot) throw new Error('Target state belongs to another directory');
    return state;
  }
  private async locked<T>(action: () => Promise<T>) {
    await noLinks(this.config.stateDir); await noLinks(this.config.skinPacksRoot);
    await mkdir(this.config.stateDir, { recursive: true });
    const owner = join(this.config.stateDir, 'owner.json');
    const lock = join(this.config.stateDir, 'operation.lock');
    try { await mkdir(lock); } catch { throw new Error('Another manager operation is running (or operation.lock remains after a crash); inspect before clearing the lock'); }
    try {
      if (await exists(owner)) {
        if ((await json<{ root: string }>(owner)).root !== this.config.skinPacksRoot) throw new Error('State directory belongs to a different root');
      } else await atomicJSON(owner, { root: this.config.skinPacksRoot });
      return await action();
    } finally { await rmdir(lock); }
  }
  async importPack(id: string, source: string) {
    return this.locked(async () => {
      const path = this.libraryPath(id);
      if (await exists(path)) throw new Error('Library ID already exists; import with a new ID to retain the previous version');
      await noLinks(source);
      const files = await readSkinPack(source), validated = await validateSkinPackFiles(files);
      const warnings: string[] = [];
      for (const [name, bytes] of Object.entries(files)) if (name.endsWith('.png') && name !== 'pack_icon.png') {
        const image = await sharp(bytes).metadata();
        if (image.width! > 128 || image.height! > 128) warnings.push(`${name}: ${image.width}x${image.height} exceeds the 128px size verified in this client; reconvert to 128 before enabling`);
      }
      const revision = randomUUID();
      await writeTree(this.revisionPath(id, revision), { files, directories: [] });
      const pack: LibraryPack = { id, revision, name: validated.name, skins: validated.skins, hashes: hashes(files), imported: new Date().toISOString(), warnings };
      await atomicJSON(path, pack); return pack;
    });
  }
  async list() {
    const dir = join(this.config.stateDir, 'library');
    if (!(await exists(dir))) return [];
    return Promise.all((await readdir(dir)).filter((name) => /^[a-z][a-z0-9_-]*\.json$/.test(name)).map((name) => json<LibraryPack>(join(dir, name))));
  }
  async exportPack(id: string, output: string) {
    return this.locked(async () => {
      const pack = await json<LibraryPack>(this.libraryPath(id));
      const files = await readSkinPack(this.revisionPath(id, pack.revision));
      if (!same(hashes(files), pack.hashes)) throw new Error('Library hash mismatch: ' + id);
      await noLinks(output);
      await writeFile(output, await zipSkinPack(files), { flag: 'wx' });
      return { id, output, skins: pack.skins };
    });
  }
  async status() {
    return Promise.all(Object.keys(this.config.slots).map(async (slot) => {
      const target = this.target(slot), state = await this.state(slot);
      if (!(await exists(target))) return { slot, target, exists: false, managed: false };
      const current = await tree(target);
      let skins: number | null = null;
      try { skins = decode<{ skins: unknown[] }>(current.files['skins.json']!).skins.length; } catch { /* report unreadable metadata */ }
      return { slot, target, exists: true, managed: !!state, skins, active: state?.active ?? [],
        changedOutsideManager: state ? !same(hashes(current.files), state.installed) : null,
        pending: state?.pending ?? null, originalBackup: state?.original ?? null };
    }));
  }
  private async snapshot(slot: string, value: Tree, active: Active) {
    const id = randomUUID(), path = join(this.config.stateDir, 'backups', id);
    await writeTree(join(path, 'files'), value);
    const info: Snapshot = { id, slot, target: this.target(slot), created: new Date().toISOString(), hashes: hashes(value.files), directories: value.directories, active };
    if (!same(hashes((await tree(join(path, 'files'))).files), info.hashes)) throw new Error('Backup hash verification failed');
    await atomicJSON(join(path, 'snapshot.json'), info); return info;
  }
  private async loadSnapshot(slot: string, id: string) {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid backup ID');
    const path = join(this.config.stateDir, 'backups', id), info = await json<Snapshot>(join(path, 'snapshot.json'));
    if (info.id !== id || info.target !== this.target(slot) || info.slot !== slot) throw new Error('Backup target mismatch');
    const value = await tree(join(path, 'files'));
    if (!same(hashes(value.files), info.hashes)) throw new Error('Backup integrity mismatch');
    return { info, value };
  }
  async backups(slot: string) {
    this.target(slot);
    const dir = join(this.config.stateDir, 'backups'); if (!(await exists(dir))) return [];
    const result: Snapshot[] = [];
    for (const name of await readdir(dir)) if (/^[0-9a-f-]{36}$/.test(name)) {
      const info = await json<Snapshot>(join(dir, name, 'snapshot.json'));
      if (info.slot === slot && info.target === this.target(slot)) result.push(info);
    }
    return result.sort((a, b) => a.created.localeCompare(b.created));
  }
  private async initialState(slot: string, original: Tree, active: Active = []): Promise<TargetState> {
    const backup = await this.snapshot(slot, original, []);
    return { slot, target: this.target(slot), original: backup.id, active, installed: hashes((await tree(this.target(slot))).files),
      headerUUID: randomUUID(), moduleUUID: randomUUID(), generation: 0 };
  }
  /** Explicit migration of an already installed slot, with the user's original backup. No target writes. */
  async adopt(slot: string, originalDirectory: string, packID?: string) {
    return this.locked(async () => {
      if (await this.state(slot)) throw new Error('Slot is already managed');
      let active: Active = [];
      if (packID) {
        const pack = await json<LibraryPack>(this.libraryPath(packID));
        if (pack.removed) throw new Error('Pack is archived');
        const current = await readSkinPack(this.target(slot));
        if (!same(hashes(current), pack.hashes)) throw new Error('Adopt pack must exactly match the current target');
        active = [{ id: pack.id, revision: pack.revision }];
      }
      const state = await this.initialState(slot, await tree(originalDirectory), active);
      await atomicJSON(this.statePath(slot), state); return state;
    });
  }
  private async compose(slot: string, state: TargetState, active: Active): Promise<Tree> {
    if (!active.length) return (await this.loadSnapshot(slot, state.original)).value;
    const files: SkinPackFiles = Object.create(null) as SkinPackFiles;
    const geometry: Record<string, unknown> = { format_version: '1.8.0' }, skins: Record<string, unknown>[] = [];
    const key = 'FourDGen_' + slot;
    const lang = [`skinpack.${key}=4DGen ${slot}`];
    for (const packRef of active) {
      const pack = await json<LibraryPack>(this.libraryPath(packRef.id));
      if (pack.revision !== packRef.revision) throw new Error('Active library revision unavailable');
      const content = await readSkinPack(this.revisionPath(pack.id, pack.revision));
      if (!same(hashes(content), pack.hashes)) throw new Error('Library hash mismatch: ' + pack.id);
      const sourceSkins = decode<{ skins: Record<string, unknown>[] }>(content['skins.json']!).skins;
      const sourceMeta = decode<{ localization_name?: string; serialize_name?: string }>(content['skins.json']!);
      const labels = new Map<string, string>();
      if (content['texts/en_US.lang']) for (const line of new TextDecoder().decode(content['texts/en_US.lang']).split(/\r?\n/)) {
        const split = line.indexOf('='); if (split > 0) labels.set(line.slice(0, split), line.slice(split + 1));
      }
      const sourceGeometry = content['geometry.json'] ? decode<Record<string, unknown>>(content['geometry.json']) : {};
      const remap = new Map<string, string>();
      for (const [id, value] of Object.entries(sourceGeometry)) if (id.startsWith('geometry.')) {
        const renamed = `geometry.fourdgen_${pack.id}_${remap.size}`; remap.set(id, renamed); geometry[renamed] = value;
      }
      for (const [index, entry] of sourceSkins.entries()) {
        const texture = `${pack.id}_${index}.png`, name = `${pack.id}_${index}`;
        files[texture] = content[entry.texture as string]!;
        skins.push({ ...entry, localization_name: name, texture, geometry: remap.get(entry.geometry as string) ?? entry.geometry });
        const label = labels.get(`skin.${sourceMeta.localization_name ?? sourceMeta.serialize_name}.${String(entry.localization_name)}`) ?? `${pack.name} / ${String(entry.localization_name)}`;
        lang.push(`skin.${key}.${name}=${label.replace(/[\r\n]/g, ' ')}`);
      }
    }
    files['manifest.json'] = encode({ format_version: this.config.slots[slot]!.manifestFormat,
      header: { name: `4DGen ${slot}`, uuid: state.headerUUID, version: [1, 0, state.generation + 1] },
      modules: [{ type: 'skin_pack', uuid: state.moduleUUID, version: [1, 0, state.generation + 1] }] });
    files['skins.json'] = encode({ serialize_name: key, localization_name: key, skins });
    if (Object.keys(geometry).length > 1) files['geometry.json'] = encode(geometry);
    files['texts/languages.json'] = encode(['en_US', 'zh_CN']);
    for (const locale of ['en_US', 'zh_CN']) files[`texts/${locale}.lang`] = new TextEncoder().encode(lang.join('\n') + '\n');
    await validateSkinPackFiles(files);
    return { files, directories: ['texts'] };
  }
  private async apply(slot: string, state: TargetState, next: Tree, active: Active) {
    const current = await tree(this.target(slot)), currentHashes = hashes(current.files);
    if (state.pending) throw new Error('An interrupted operation requires recover before changing this slot');
    if (!same(currentHashes, state.installed)) throw new Error('Slot changed outside manager; refusing to overwrite external changes');
    const backup = await this.snapshot(slot, current, state.active);
    state.pending = { backup: backup.id, planned: hashes(next.files) };
    await atomicJSON(this.statePath(slot), state);
    try {
      // Recheck after backup, immediately before mutation.
      if (!same(hashes((await tree(this.target(slot))).files), currentHashes)) throw new Error('Target changed while backing up');
      await replaceTree(this.target(slot), next);
      state.active = active; state.installed = hashes(next.files); state.generation++; delete state.pending;
      await atomicJSON(this.statePath(slot), state);
    } catch (error) {
      // Keep pending + the verified backup for explicit recovery. Never clobber unknown changes.
      throw new Error(`Deployment did not complete. Backup ${backup.id} is retained; run packs recover ${slot}. ${String(error)}`);
    }
    return { slot, active, backup: backup.id, installed: state.installed };
  }
  async enable(slot: string, id: string) {
    return this.locked(async () => {
      const pack = await json<LibraryPack>(this.libraryPath(id)); if (pack.removed) throw new Error('Pack is archived');
      if (pack.warnings?.length) throw new Error('Pack needs client compatibility adjustment: ' + pack.warnings.join('; '));
      const state = await this.state(slot) ?? await this.initialState(slot, await tree(this.target(slot)));
      if (state.active.some((p) => p.id === id)) throw new Error('Pack already enabled in this slot');
      const active = [...state.active, { id, revision: pack.revision }];
      return this.apply(slot, state, await this.compose(slot, state, active), active);
    });
  }
  async disable(slot: string, id: string) {
    return this.locked(async () => {
      const state = await this.state(slot); if (!state || !state.active.some((p) => p.id === id)) throw new Error('Pack is not enabled in this slot');
      const active = state.active.filter((p) => p.id !== id);
      return this.apply(slot, state, await this.compose(slot, state, active), active);
    });
  }
  async restore(slot: string, backupID?: string) {
    return this.locked(async () => {
      const state = await this.state(slot); if (!state) throw new Error('Slot is not managed');
      const backup = await this.loadSnapshot(slot, backupID ?? state.original);
      return this.apply(slot, state, backup.value, backup.info.active);
    });
  }
  async recover(slot: string) {
    return this.locked(async () => {
      const state = await this.state(slot); if (!state?.pending) throw new Error('No interrupted operation');
      const backup = await this.loadSnapshot(slot, state.pending.backup);
      const current = hashes((await tree(this.target(slot))).files);
      for (const [key, hash] of Object.entries(current)) if (backup.info.hashes[key] !== hash && state.pending.planned[key] !== hash) throw new Error('Recovery found unknown external changes; refusing overwrite');
      await replaceTree(this.target(slot), backup.value);
      state.active = backup.info.active; state.installed = backup.info.hashes; delete state.pending;
      await atomicJSON(this.statePath(slot), state); return { slot, recovered: backup.info.id };
    });
  }
  async archive(id: string) {
    return this.locked(async () => {
      for (const slot of Object.keys(this.config.slots)) if ((await this.state(slot))?.active.some((p) => p.id === id)) throw new Error('Disable this pack before archiving');
      const path = this.libraryPath(id), pack = await json<LibraryPack>(path); pack.removed = true;
      await atomicJSON(path, pack); return pack;
    });
  }
}
