import { readFileSync } from 'node:fs';
import { normalizeImportedPack } from "./import-skin-pack.ts";
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir, lstat, realpath, unlink, rmdir, rename, rm, stat } from 'node:fs/promises';
import { resolve, relative, isAbsolute, join, dirname } from 'node:path';
import { readSkinPack, validateSkinPackFiles, zipSkinPack } from './skin-pack.ts';
import type { SkinPackFiles } from './skin-pack.ts';
import { isPaddedTriangle } from './geometry-validator.ts';
import type { ActivePack, LibraryPack, PackHashes, PackMeta, PackStats, SkinOrigin } from './pack-types.ts';
import sharp from 'sharp';

export interface ManagerConfig {
  libraryOnly?: boolean;
  version: 1;
  skinPacksRoot: string;
  stateDir: string;
  slots: Record<string, { manifestFormat: 1 | 2 }>;
}
type Hashes = PackHashes;
type Active = ActivePack[];
interface Tree { files: SkinPackFiles; directories: string[] }
interface SlotEdits { name?: string; skins: Record<string, { name?: string; removed?: boolean }> }
interface Snapshot { edits?: SlotEdits; id: string; slot: string; target: string; created: string; hashes: Hashes; directories: string[]; active: Active }
interface TargetState {
  edits?: SlotEdits;
  presetSources?: string[];
  slot: string; target: string; original: string; active: Active; installed: Hashes;
  /** Cheap change detector for status(); writes still verify full hashes. */
  installedSignature?: Record<string, string>;
  headerUUID: string; moduleUUID: string; generation: number;
  pending?: { backup: string; planned: Hashes };
}
function skinOrigin(pack: LibraryPack, index: number): SkinOrigin | null {
  if (pack.meta?.skinOrigins) return pack.meta.skinOrigins[index] ?? null;
  if (pack.skins !== 1 || !pack.meta || (!pack.meta.modelId && !pack.meta.template)) return null;
  return { packId: pack.id, skinIndex: index, modelId: pack.meta.modelId, template: pack.meta.template, source: pack.meta.source };
}
type InstalledSkin = {texture:string; geometry?:string; localization_name?:string};
function skinIdentity(skin: InstalledSkin,index:number) {
  const name=skin.localization_name ?? `fourdgen_${index}_${createHash('sha256').update(skin.texture+'|'+(skin.geometry??'')).digest('hex').slice(0,12)}`;
  return {name,key:skin.texture+'::'+(skin.geometry??'')+'::'+name};
}
function entriesAt(value: Tree) {
  return decode<{ skins: { texture: string }[] }>(value.files['skins.json']!).skins.map((entry, index) => ({ ...entry, index }));
}
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
/** Names plus size/mtime: avoids reading multi-hundred-megabyte pack assets. */
async function treeSignature(path: string): Promise<{ files: Record<string, string>; directories: string[] }> {
  await noLinks(path);
  const result = { files: Object.create(null) as Record<string, string>, directories: [] as string[] };
  if (!(await exists(path))) throw new Error('Directory does not exist: ' + path);
  const visit = async (dir: string, prefix: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const key = safeName(prefix + entry.name), full = join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Links are not supported: ' + full);
      if (entry.isDirectory()) { result.directories.push(key); await visit(full, key + '/'); }
      else if (entry.isFile()) { const info = await stat(full); result.files[key] = `${info.size}:${info.mtimeMs}`; }
      else throw new Error('Unsupported filesystem entry: ' + full);
    }
  };
  await visit(path, ''); result.directories.sort(); return result;
}
function sameSignature(a: Record<string, string>, b: Record<string, string>) {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}
function skipJSONWhitespace(bytes: Uint8Array, from: number) {
  let index = from;
  while (bytes[index] === 0x20 || bytes[index] === 0x09 || bytes[index] === 0x0a || bytes[index] === 0x0d) index++;
  return index;
}
function scanJSONString(bytes: Uint8Array, from: number) {
  if (bytes[from] !== 0x22) throw new Error('Invalid geometry JSON: expected string');
  for (let index = from + 1; index < bytes.length; index++) {
    if (bytes[index] === 0x5c) index++;
    else if (bytes[index] === 0x22) return index + 1;
  }
  throw new Error('Invalid geometry JSON: unterminated string');
}
function scanJSONValue(bytes: Uint8Array, from: number) {
  const start = skipJSONWhitespace(bytes, from);
  if (bytes[start] === 0x22) return scanJSONString(bytes, start);
  if (bytes[start] !== 0x7b && bytes[start] !== 0x5b) {
    let index = start;
    while (index < bytes.length && bytes[index] !== 0x2c && bytes[index] !== 0x7d) index++;
    return index;
  }
  const stack: number[] = [bytes[start]!];
  let inString = false;
  for (let index = start + 1; index < bytes.length; index++) {
    const byte = bytes[index]!;
    if (inString) {
      if (byte === 0x5c) index++;
      else if (byte === 0x22) inString = false;
    } else if (byte === 0x22) inString = true;
    else if (byte === 0x7b || byte === 0x5b) stack.push(byte);
    else if (byte === 0x7d || byte === 0x5d) {
      const opener = stack.pop();
      if ((opener === 0x7b && byte !== 0x7d) || (opener === 0x5b && byte !== 0x5d))
        throw new Error('Invalid geometry JSON: mismatched delimiters');
      if (!stack.length) return index + 1;
    }
  }
  throw new Error('Invalid geometry JSON: unterminated value');
}
/** Extract one top-level geometry value without parsing the whole document. */
function geometryEntry(bytes: Uint8Array, id: string): Uint8Array | null {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const needle = Buffer.from(JSON.stringify(id));
  const at = buffer.indexOf(needle);
  if (at < 0) return null;
  const colon = skipJSONWhitespace(bytes, at + needle.length);
  if (bytes[colon] !== 0x3a) return null;
  const start = skipJSONWhitespace(bytes, colon + 1);
  return bytes.subarray(start, scanJSONValue(bytes, start));
}
/** Extract top-level geometry values without parsing their potentially huge meshes. */
function geometryEntries(bytes: Uint8Array): { id: string; value: Uint8Array }[] {
  const result: { id: string; value: Uint8Array }[] = [];
  let index = skipJSONWhitespace(bytes, 0);
  if (bytes[index++] !== 0x7b) throw new Error('Invalid geometry JSON: expected object');
  const decoder = new TextDecoder();
  while (true) {
    index = skipJSONWhitespace(bytes, index);
    if (bytes[index] === 0x7d) break;
    const keyStart = index;
    index = scanJSONString(bytes, index);
    const id = JSON.parse(decoder.decode(bytes.subarray(keyStart, index))) as string;
    index = skipJSONWhitespace(bytes, index);
    if (bytes[index++] !== 0x3a) throw new Error('Invalid geometry JSON: expected colon');
    const valueStart = skipJSONWhitespace(bytes, index);
    const valueEnd = scanJSONValue(bytes, valueStart);
    if (id.startsWith('geometry.')) result.push({ id, value: bytes.subarray(valueStart, valueEnd) });
    index = skipJSONWhitespace(bytes, valueEnd);
    if (bytes[index] === 0x2c) index++;
    else if (bytes[index] === 0x7d) break;
    else throw new Error('Invalid geometry JSON: expected comma or object end');
  }
  return result;
}
function concatBytes(parts: Uint8Array[]) {
  const result = new Uint8Array(parts.reduce((size, part) => size + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.byteLength; }
  return result;
}
async function writeTree(path: string, value: Tree) {
  await noLinks(path); await mkdir(path, { recursive: true });
  for (const dir of value.directories) await mkdir(join(path, safeName(dir)), { recursive: true });
  for (const [key, bytes] of Object.entries(value.files)) {
    const out = join(path, safeName(key)); await mkdir(dirname(out), { recursive: true }); await writeFile(out, bytes);
  }
}
function sameBytes(a: Uint8Array, b: Uint8Array) {
  return a === b || (a.byteLength === b.byteLength && Buffer.compare(a, b) === 0);
}
async function replaceTree(path: string, value: Tree, old: Tree, expected: Hashes) {
  // The caller has already verified this exact old tree. Only touch changed
  // files: skin textures and other unchanged assets need not be rewritten.
  await noLinks(path);
  const nextFiles = new Set(Object.keys(value.files));
  const oldFiles = new Set(Object.keys(old.files));
  for (const key of oldFiles) {
    if (!nextFiles.has(key)) await unlink(join(path, safeName(key)));
  }

  const nextDirectories = new Set(value.directories);
  for (const dir of [...old.directories].sort((a, b) => b.length - a.length)) {
    if (!nextDirectories.has(dir)) await rmdir(join(path, safeName(dir)));
  }
  for (const dir of value.directories) await mkdir(join(path, safeName(dir)), { recursive: true });

  const changed: string[] = [];
  for (const [key, bytes] of Object.entries(value.files)) {
    const before = old.files[key];
    if (before && sameBytes(before, bytes)) continue;
    const out = join(path, safeName(key));
    await mkdir(dirname(out), { recursive: true });
    const temp = out + '.' + randomUUID() + '.tmp';
    try {
      await writeFile(temp, bytes);
      await rename(temp, out);
    } catch (error) {
      await rm(temp, { force: true }).catch(() => {});
      throw error;
    }
    changed.push(key);
  }

  // Verify replacements without rereading and hashing every unchanged file.
  // Their hashes were checked immediately before mutation and they were never
  // opened for writing in this operation.
  for (const key of changed) {
    const actual = createHash('sha256').update(await readFile(join(path, safeName(key)))).digest('hex');
    if (actual !== expected[key]) throw new Error('Post-write SHA256 verification failed: ' + key);
  }
  for (const key of oldFiles) {
    if (!nextFiles.has(key) && await exists(join(path, safeName(key))))
      throw new Error('Post-write deletion verification failed: ' + key);
  }
}
async function json<T>(path: string): Promise<T> { return decode<T>(await readFile(path)); }
async function atomicJSON(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  const temp = path + '.' + randomUUID() + '.tmp';
  await writeFile(temp, encode(value)); await rename(temp, path);
}
/** Cheap, dependency-free summary of what a pack actually contains. */
async function statsFor(files: SkinPackFiles): Promise<PackStats> {
  let triangles = 0, vertices = 0, bones = 0;
  const bytes = Object.values(files).reduce((sum, value) => sum + value.byteLength, 0);
  if (files['geometry.json']) {
    const root = decode<Record<string, unknown>>(files['geometry.json']!);
    for (const [id, value] of Object.entries(root)) {
      if (!id.startsWith('geometry.')) continue;
      const geometry = value as { bones?: { poly_mesh?: { positions: unknown[]; polys: unknown[][] } }[] };
      for (const bone of geometry.bones ?? []) {
        const mesh = bone.poly_mesh;
        if (!mesh) continue;
        bones++;
        vertices += mesh.positions.length;
        for (const poly of mesh.polys) triangles += poly.length===3 || isPaddedTriangle(poly as never) ? 1 : 2;
      }
    }
  }
  let texture: PackStats['texture'] = null;
  try {
    const skins = decode<{ skins: { texture: string }[] }>(files['skins.json']!).skins;
    const name = skins[0]?.texture, image = name ? files[name] : undefined;
    if (image) {
      const metadata = await sharp(image).metadata();
      if (metadata.width && metadata.height) texture = { width: metadata.width, height: metadata.height };
    }
  } catch { /* stats are informative only */ }
  return { triangles, vertices, bones, texture, bytes };
}

export class PackManager {
  readonly config: ManagerConfig;
  constructor(config: ManagerConfig) {
    this.config = config;
    if (config.version !== 1 || !isAbsolute(config.skinPacksRoot) || !isAbsolute(config.stateDir) || !Object.keys(config.slots).length) throw new Error('Invalid manager config');
    for (const [slot, options] of Object.entries(config.slots)) {
      validID(slot); if (!options || ![1, 2].includes(options.manifestFormat)) throw new Error('Invalid slot manifestFormat');
    }
    if (!relative(config.skinPacksRoot, config.stateDir) || inside(config.skinPacksRoot, config.stateDir) || inside(config.stateDir, config.skinPacksRoot)) throw new Error('Manager state and skin_packs root must be separate');
  }
  private requireGame() { if(this.config.libraryOnly)throw new Error("Game directory is not configured"); }
  private target(slot: string) {
    if (!Object.hasOwn(this.config.slots, slot)) throw new Error('Slot is not configured: ' + slot);
    const target = resolve(this.config.skinPacksRoot, validID(slot));
    if (!inside(this.config.skinPacksRoot, target)) throw new Error('Target escapes root');
    return target;
  }
  private statePath(slot: string) {
    this.target(slot);
    let owner: {root:string} | null = null;
    try { owner = JSON.parse(readFileSync(join(this.config.stateDir,'owner.json'),'utf8')); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const namespace = owner && owner.root !== this.config.skinPacksRoot ? createHash('sha256').update(this.config.skinPacksRoot).digest('hex') : '';
    return join(this.config.stateDir, 'targets', namespace, slot + '.json');
  }
  private libraryPath(id: string) { return join(this.config.stateDir, 'library', validID(id) + '.json'); }
  private revisionPath(id: string, revision: string) {
    if (!/^[0-9a-f-]{36}$/.test(revision)) throw new Error('Invalid library revision');
    return join(this.config.stateDir, 'library', validID(id), revision);
  }
  private async state(slot: string) {
    const path = this.statePath(slot);
    if (!(await exists(path))) return null;
    const state = await json<TargetState>(path);
    if ((!this.config.libraryOnly && state.target !== this.target(slot)) || state.slot !== slot) throw new Error('Target state belongs to another directory');
    state.presetSources ??= state.generation === 0 ? state.active.map(p => p.id) : [];
    return state;
  }
  private async locked<T>(action: () => Promise<T>) {
    await noLinks(this.config.stateDir); await noLinks(this.config.skinPacksRoot);
    await mkdir(this.config.stateDir, { recursive: true });
    const owner = join(this.config.stateDir, 'owner.json');
    const lock = join(this.config.stateDir, 'operation.lock');
    try { await mkdir(lock); } catch { throw new Error('Another manager operation is running (or operation.lock remains after a crash); inspect before clearing the lock'); }
    try {
      if (this.config.libraryOnly) { /* Local collection operations do not bind a game directory. */ } else if (await exists(owner)) {
        // Other installs use a target namespace while sharing the local library.
      } else await atomicJSON(owner, { root: this.config.skinPacksRoot });
      return await action();
    } finally { await rmdir(lock); }
  }
  async importPack(id: string, source: string) {
    return this.locked(async () => {
      if (await exists(this.libraryPath(id))) throw new Error('Library ID already exists; import with a new ID to retain the previous version');
      await noLinks(source);
      const raw = await readSkinPack(source, { external: true });
      let canonical = false;
      try { await validateSkinPackFiles(raw); canonical = true; } catch { /* External packs need normalization. */ }
      if (canonical) return this.store(id, raw, []);
      const normalized = await normalizeImportedPack(raw);
      return this.store(id, normalized.files, [], { importWarnings: normalized.warnings });
    });
  }
  /** One-time UI migration: record the sources of the existing prebuilt game packs. */
  async initializePresetSources() {
    return this.locked(async () => {
      for (const slot of Object.keys(this.config.slots)) {
        if (!this.config.slots[slot] || !(await exists(this.statePath(slot)))) continue;
        const state = await json<TargetState>(this.statePath(slot));
        if (state.target !== this.target(slot)) throw new Error('Target state belongs to another directory');
        if (state.presetSources === undefined) await atomicJSON(this.statePath(slot), { ...state, presetSources: state.active.map(p => p.id) });
      }
    });
  }
  async createPack(name: string) {
    return this.locked(async () => {
      name = name.trim();
      if (!name || name.length > 120 || /[\r\n\x00]/.test(name)) throw new Error('名称需为 1–120 个字符');
      const id = 'pack-' + randomUUID();
      const pack: LibraryPack = { id, name, revision: randomUUID(), draft: true, skins: 0, hashes: {}, imported: new Date().toISOString(), warnings: [], stats: { triangles: 0, vertices: 0, bones: 0, texture: null, bytes: 0 } };
      await atomicJSON(this.libraryPath(id), pack);
      return pack;
    });
  }
  /** Copy chosen skins into a user pack, leaving source packs and game slots untouched. */
  async addSkins(targetId: string, sourceId: string, indices: number[], options: { originPackId?: string } = {}) {
    return this.locked(async () => {
      if (targetId === sourceId) throw new Error('不能添加同一个包');
      const target = await json<LibraryPack>(this.libraryPath(targetId));
      const source = await json<LibraryPack>(this.libraryPath(sourceId));
      if (target.removed || source.removed || !indices.length || indices.some(i => !Number.isInteger(i) || i < 0 || i >= source.skins)) throw new Error('请选择有效皮肤');
      const slot = Object.keys(this.config.slots)[0]!;
      const manifest = target.draft ? null : decode<{ header: { uuid: string }; modules: { uuid: string }[] }>((await readSkinPack(this.revisionPath(targetId, target.revision)))['manifest.json']!);
      const state = { slot, target: this.target(slot), original: '', active: [], installed: {}, headerUUID: manifest?.header.uuid ?? randomUUID(), moduleUUID: manifest?.modules[0]?.uuid ?? randomUUID(), generation: 0 } as TargetState;
      const refs = [...(target.draft ? [] : [{ id: target.id, revision: target.revision }]), { id: source.id, revision: source.revision }];
      const composed = await this.compose(slot, state, refs, { id: sourceId, indices });
      const header = decode<{ header: { name: string } }>(composed.files['manifest.json']!);
      header.header.name = target.name;
      composed.files['manifest.json'] = encode(header);
      const key = decode<{ localization_name: string }>(composed.files['skins.json']!).localization_name;
      for (const locale of ['en_US','zh_CN']) {
        const path = `texts/${locale}.lang`;
        const lines = new TextDecoder().decode(composed.files[path]).split('\n').filter(l => !l.startsWith('skinpack.' + key + '='));
        composed.files[path] = new TextEncoder().encode([`skinpack.${key}=${target.name}`, ...lines].join('\n'));
      }
      if (!target.draft) await atomicJSON(this.revisionPath(targetId, target.revision) + '.json', target);
      const selected = Array.from({length:source.skins}, (_,i) => i).filter(i => indices.includes(i));
      const appended = selected.map((index, offset) => {
        const origin = skinOrigin(source, index);
        if (!origin) return null;
        // When the source is a temporary staging pack, point the origin at the
        // destination pack and its new index instead of the deleted staging ID.
        return options.originPackId
          ? { ...origin, packId: options.originPackId, skinIndex: target.skins + offset }
          : origin;
      });
      const result = await this.store(targetId, composed.files, composed.directories, { ...target.meta, skinOrigins: [...Array.from({length:target.skins}, (_,i) => skinOrigin(target,i)), ...appended] });
      await atomicJSON(this.libraryPath(targetId), { ...result, imported: target.imported });
      return result;
    });
  }
  /** Read preset contents from the actual game directory, including its baseline skins. */
  async presetContents(slot: string) {
    const target = this.target(slot);
    const [skinsBytes, manifestBytes, enBytes, zhBytes] = await Promise.all([
      readFile(join(target, 'skins.json')).catch(() => null),
      readFile(join(target, 'manifest.json')).catch(() => null),
      readFile(join(target, 'texts', 'en_US.lang')).catch(() => null),
      readFile(join(target, 'texts', 'zh_CN.lang')).catch(() => null),
    ]);
    const skins = skinsBytes ? decode<{ skins?: { localization_name?: string; texture: string; geometry: string }[]; localization_name?: string; serialize_name?: string }>(skinsBytes) : { skins: [] };
    const labels = new Map<string,string>();
    for (const bytes of [enBytes, zhBytes]) if (bytes) for (const line of new TextDecoder().decode(bytes).split(/\r?\n/)) { const i = line.indexOf('='); if (i > 0) labels.set(line.slice(0,i),line.slice(i+1)); }
    const origins = new Map<string, SkinOrigin>();
    const state = await this.state(slot);
    for (const ref of state?.active ?? []) {
      const latest = await json<LibraryPack>(this.libraryPath(ref.id));
      const pack = latest.revision === ref.revision ? latest : await json<LibraryPack>(this.revisionPath(ref.id, ref.revision) + '.json');
      for (let index = 0; index < pack.skins; index++) {
        const origin = skinOrigin(pack, index);
        if (origin) origins.set(`${pack.id}_${index}.png`, origin);
      }
    }
    // Reuse the verified install hashes when sizes still match; only fall back
    // to reading and hashing every asset when the slot changed on disk.
    let revision: string;
    const measured = await treeSignature(target);
    if (state?.installedSignature && sameSignature(measured.files, state.installedSignature))
      revision = createHash('sha256').update(JSON.stringify(state.installed)).digest('hex');
    else revision = createHash('sha256').update(JSON.stringify(hashes((await tree(target)).files))).digest('hex');
    return { id: slot, name: manifestBytes ? decode<{header?:{name?:string}}>(manifestBytes).header?.name ?? slot : slot, revision, skins: (skins.skins ?? []).map((skin,index) => ({ index, name: labels.get(`skin.${skins.localization_name ?? skins.serialize_name}.${skin.localization_name}`) ?? skin.localization_name ?? `皮肤 ${index+1}`, geometry: skin.geometry, texture: skin.texture, origin: origins.get(skin.texture) ?? null })) };
  }
  async presetScene(slot: string, index: number) {
    const target = this.target(slot);
    const skinsBytes = await readFile(join(target, 'skins.json')).catch(() => null);
    const entries = skinsBytes ? decode<{ skins: { texture: string; geometry: string }[] }>(skinsBytes).skins : [];
    const skin = Number.isInteger(index) && index >= 0 ? entries[index] : undefined;
    if (!skin) throw new Error('皮肤不存在');
    const texture = await readFile(join(target, safeName(skin.texture))).catch(() => null);
    if (!texture) throw new Error('皮肤不存在');
    const geometryBytes = await readFile(join(target, 'geometry.json')).catch(() => null);
    let geometry: Record<string, unknown> | null = null;
    if (geometryBytes) {
      // Parse only the selected geometry instead of the whole 100+ MB document.
      const entry = geometryEntry(geometryBytes, skin.geometry);
      if (entry) geometry = { [skin.geometry]: JSON.parse(new TextDecoder().decode(entry)) };
    }
    return { name: slot, identifier: skin.geometry, geometry, texture, skins: entries.length };
  }
  /** Import validated skin pack files directly, without a staging directory. */
  async importFiles(id: string, files: SkinPackFiles, directories: string[] = [], meta?: PackMeta) {
    return this.locked(async () => {
      if (await exists(this.libraryPath(id))) throw new Error('Library ID already exists; import with a new ID to retain the previous version');
      const safeDirectories = [...new Set(directories.map(safeName))].sort();
      return this.store(id, files, safeDirectories, meta);
    });
  }
  private async store(id: string, files: SkinPackFiles, directories: string[] = [], meta?: PackMeta): Promise<LibraryPack> {
    const path = this.libraryPath(id);
    const validated = await validateSkinPackFiles(files);
    const warnings: string[] = [];
    for (const [name, bytes] of Object.entries(files)) if (name.endsWith('.png') && name !== 'pack_icon.png') {
      const image = await sharp(bytes).metadata();
      if (image.width! > 128 || image.height! > 128) warnings.push(`${name}: ${image.width}x${image.height} exceeds the 128px size verified in this client; reconvert to 128 before enabling`);
    }
    const revision = randomUUID();
    await writeTree(this.revisionPath(id, revision), { files, directories });
    const pack: LibraryPack = { id, revision, name: validated.name, skins: validated.skins, hashes: hashes(files), imported: new Date().toISOString(), warnings, stats: await statsFor(files), ...(meta ? { meta } : {}) };
    await atomicJSON(path, pack); return pack;
  }
  /** First texture of the pack, used as a thumbnail in the local workbench. */
  async icon(id: string) {
    const pack = await json<LibraryPack>(this.libraryPath(id));
    if (pack.draft) return null;
    const files = await readSkinPack(this.revisionPath(id, pack.revision));
    if (files['pack_icon.png']) return files['pack_icon.png'];
    const skins = decode<{ skins: { texture: string }[] }>(files['skins.json']!).skins;
    const texture = skins[0]?.texture;
    return texture && files[texture] ? files[texture] : null;
  }
  /** First skin of a library pack, for the local workbench 3D preview. */
  async scene(id: string, skinIndex = 0) {
    const pack = await json<LibraryPack>(this.libraryPath(id));
    const files = await readSkinPack(this.revisionPath(id, pack.revision));
    const skins = decode<{ skins: { texture: string; geometry: string }[] }>(files['skins.json']!).skins;
    const skin = Number.isInteger(skinIndex) && skinIndex >= 0 ? skins[skinIndex] : undefined;
    if (!skin) throw new Error('Skin pack contains no skins');
    const texture = files[skin.texture];
    if (!texture) throw new Error('Missing skin texture ' + skin.texture);
    const rawGeometry = files['geometry.json'] ? geometryEntry(files['geometry.json']!, skin.geometry) : null;
    const geometry = rawGeometry ? { [skin.geometry]: JSON.parse(new TextDecoder().decode(rawGeometry)) } : null;
    return { name: pack.name, identifier: skin.geometry, geometry, texture, skins: skins.length };
  }
  /** Enumerate every skin instead of implicitly showing only the first. */
  async contents(id: string) {
    const pack = await json<LibraryPack>(this.libraryPath(id));
    if (pack.draft) return { id, name: pack.name, revision: pack.revision, skins: [] };
    const files = await readSkinPack(this.revisionPath(id, pack.revision));
    if (!same(hashes(files), pack.hashes)) throw new Error('Library hash mismatch: ' + id);
    const data = decode<{ serialize_name: string; localization_name?: string; skins: { localization_name?: string; texture: string; geometry: string }[] }>(files['skins.json']!);
    const strings = new Map<string, string>();
    for (const path of ['texts/en_US.lang', 'texts/zh_CN.lang']) {
      for (const line of new TextDecoder().decode(files[path] ?? new Uint8Array()).split(/\r?\n/)) {
        const at = line.indexOf('='); if (at > 0) strings.set(line.slice(0, at), line.slice(at + 1));
      }
    }
    const key = data.localization_name ?? data.serialize_name;
    return { id, name: pack.name, revision: pack.revision, skins: data.skins.map((skin, index) => ({ index, name: strings.get(`skin.${key}.${skin.localization_name}`) ?? skin.localization_name ?? `皮肤 ${index + 1}`, geometry: skin.geometry, texture: skin.texture, origin: skinOrigin(pack, index) })) };
  }
  /** Write a new verified revision; installed revisions are unchanged until explicitly updated. */
  async renameNames(id: string, change: { name?: string; skinIndex?: number; skinName?: string }) {
    return this.locked(async () => {
      const pack = await json<LibraryPack>(this.libraryPath(id));
      if (pack.draft) {
        const name = change.name?.trim();
        if (!name || name.length > 120 || /[\r\n\x00]/.test(name)) throw new Error('名称无效');
        await atomicJSON(this.libraryPath(id), { ...pack, name });
        return { ...pack, name };
      }
      const files = await readSkinPack(this.revisionPath(id, pack.revision));
      if (!same(hashes(files), pack.hashes)) throw new Error('Library hash mismatch: ' + id);
      const label = (v: string) => { const n = v.trim(); if (!n || n.length > 120 || /[\r\n\x00]/.test(n)) throw new Error('名称需为 1–120 个字符，不能包含换行'); return n; };
      const data = decode<{ serialize_name: string; localization_name?: string; skins: { localization_name?: string }[] }>(files['skins.json']!);
      const key = data.localization_name ?? data.serialize_name;
      const updates = new Map<string, string>();
      if (change.name !== undefined) {
        const name = label(change.name);
        const manifest = decode<{ header: { name: string } }>(files['manifest.json']!);
        manifest.header.name = name;
        files['manifest.json'] = encode(manifest);
        updates.set('skinpack.' + key, name);
      }
      if (change.skinName !== undefined) {
        const i = change.skinIndex;
        if (i === undefined || !Number.isInteger(i) || i < 0 || !data.skins[i]) throw new Error('皮肤不存在');
        const skin = data.skins[i]!;
        skin.localization_name ??= 'skin' + i;
        updates.set(`skin.${key}.${skin.localization_name}`, label(change.skinName));
        files['skins.json'] = encode(data);
      }
      if (!updates.size) throw new Error('没有要修改的名称');
      const languages = Object.keys(files).filter(p => /^texts\/[^/]+\.lang$/.test(p));
      if (!languages.length) { languages.push('texts/en_US.lang', 'texts/zh_CN.lang'); files['texts/languages.json'] = encode(['en_US', 'zh_CN']); }
      for (const path of languages) {
        const lines = new TextDecoder().decode(files[path] ?? new Uint8Array()).split(/\r?\n/).filter(line => !updates.has(line.split('=')[0]!));
        for (const [key, value] of updates) lines.push(key + '=' + value);
        files[path] = new TextEncoder().encode(lines.filter(Boolean).join('\n') + '\n');
      }
      await atomicJSON(this.revisionPath(id, pack.revision) + ".json", pack);
      const next = await this.store(id, files, [], pack.meta);
      await atomicJSON(this.libraryPath(id), { ...next, imported: pack.imported });
      return { ...next, imported: pack.imported };
    });
  }
  async removeSkin(id: string, index: number) {
    return this.locked(async()=>{
      const pack = await json<LibraryPack>(this.libraryPath(id));
      if(pack.draft || !Number.isInteger(index) || index<0 || index>=pack.skins)throw Error('请选择有效皮肤');
      const files = await readSkinPack(this.revisionPath(id,pack.revision));
      if(!same(hashes(files),pack.hashes))throw Error('Library hash mismatch: '+id);
      const data = decode<{skins:{texture:string}[]}>(files['skins.json']!);
      const next = this.editTree({files,directories:[]},{skins:{[skinIdentity(data.skins[index]!,index).key]:{removed:true}}});
      const meta = {...pack.meta,skinOrigins:Array.from({length:pack.skins},(_,i)=>skinOrigin(pack,i)).filter((_,i)=>i!==index)};
      await atomicJSON(this.revisionPath(id,pack.revision)+'.json',pack);
      const result = pack.skins>1 ? await this.store(id,next.files,next.directories,meta) : {...pack,revision:randomUUID(),draft:true,skins:0,hashes:{},meta,stats:{triangles:0,vertices:0,bones:0,texture:null,bytes:0}};
      await atomicJSON(this.libraryPath(id),{...result,imported:pack.imported});
      return result;
    });
  }
  async updateEnabled(slot: string, id: string) {
    this.requireGame();
    return this.locked(async () => {
      const pack = await json<LibraryPack>(this.libraryPath(id));
      if (pack.removed || pack.draft || !pack.skins || pack.warnings?.length) throw new Error('皮肤包不可启用，请先添加皮肤并检查兼容提示');
      const state = await this.state(slot);
      if (!state?.active.some(p => p.id === id)) throw new Error('皮肤包未启用');
      const active: Active = state.active.flatMap((p) => {
        if (p.id !== id) return [p];
        if (!p.skins) return [{ id, revision: pack.revision }];
        const skins = p.skins.filter((index) => index < pack.skins);
        return skins.length ? [{ id, revision: pack.revision, skins }] : [];
      });
      return this.apply(slot, state, await this.compose(slot, state, active), active);
    });
  }
  private async assertInactive(id: string) {
    const inspect = async(folder:string):Promise<void>=>{
      await noLinks(folder);
      for(const entry of await readdir(folder,{withFileTypes:true}).catch(()=>[])) {
        if(entry.isSymbolicLink())throw Error('Links are not supported');
        const path=join(folder,entry.name);
        if(entry.isDirectory() && /^[a-f0-9]{64}$/.test(entry.name))await inspect(path);
        else if(entry.isFile() && entry.name.endsWith('.json')) {
          const state=await json<TargetState>(path);
          if(state.active?.some(p=>p.id===id))throw Error('Disable this pack from its slot before deleting it');
        }
      }
    };
    await inspect(join(this.config.stateDir,'targets'));
  }
  /** Permanently remove a library pack. Only allowed when no slot uses it. */
  async remove(id: string) {
    return this.locked(async () => {
      await this.assertInactive(id);
      const path = this.libraryPath(id), pack = await json<LibraryPack>(path);
      if (!inside(this.config.stateDir, path) || !inside(this.config.stateDir, this.revisionPath(id, pack.revision))) throw new Error('Library path escapes state directory');
      await rm(this.revisionPath(id, pack.revision), { recursive: true, force: true });
      await unlink(path);
      await rm(join(this.config.stateDir, 'library', id), { recursive: true, force: true });
      return { id };
    });
  }
  /**
   * Drop old write snapshots, but never the original baseline or the most
   * recent pre-change snapshots. A failed deploy can therefore be recovered
   * even after several later applies.
   */
  async pruneBackups(slot: string, options: { keepRecent?: number } = {}) {
    const target = this.target(slot), state = await this.state(slot);
    if (state?.pending) return { removed: 0 };
    const keepRecent = Math.max(1, Math.min(100, Math.floor(options.keepRecent ?? 10)));
    const keep = new Set(state ? [state.original] : []);
    const dir = join(this.config.stateDir, 'backups');
    if (!(await exists(dir))) return { removed: 0 };
    const candidates: { name: string; info: Snapshot }[] = [];
    for (const name of await readdir(dir)) {
      if (!/^[0-9a-f-]{36}$/.test(name) || keep.has(name)) continue;
      const path = join(dir, name);
      let info: Snapshot | null = null;
      try { info = await json<Snapshot>(join(path, 'snapshot.json')); } catch { continue; }
      if (info.slot !== slot || info.target !== target) continue;
      candidates.push({ name, info });
    }
    candidates.sort((a, b) => b.info.created.localeCompare(a.info.created));
    for (const item of candidates.slice(0, keepRecent)) keep.add(item.name);
    let removed = 0;
    for (const item of candidates) {
      if (keep.has(item.name)) continue;
      await rm(join(dir, item.name), { recursive: true, force: true });
      removed++;
    }
    return { removed };
  }
  async list() {
    const dir = join(this.config.stateDir, 'library');
    if (!(await exists(dir))) return [];
    return Promise.all((await readdir(dir)).filter((name) => /^[a-z][a-z0-9_-]*\.json$/.test(name)).map((name) => json<LibraryPack>(join(dir, name))));
  }
  /** Backfill stats for packs imported before stats existed. */
  async ensureStats() {
    const packs = await this.list();
    for (const pack of packs) {
      if (pack.stats || pack.draft) continue;
      try {
        pack.stats = await statsFor(await readSkinPack(this.revisionPath(pack.id, pack.revision)));
        await atomicJSON(this.libraryPath(pack.id), pack);
      } catch { /* leave unreadable entries for the CLI to report */ }
    }
    return packs;
  }

  async exportPack(id: string, output: string) {
    if (!/\.zip$/i.test(output)) throw new Error("Skin packs can only be exported as .zip");
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
      if (!(await exists(target))) return { slot, target, exists: false, managed: !!state, active: state?.active ?? [], presetSources: state?.presetSources ?? [], pending: state?.pending ?? null, changedOutsideManager: null, skins: null, originalBackup: state?.original ?? null };
      const measured = await treeSignature(target);
      let skins: number | null = null;
      let name: string = slot;
      try { name = decode<{header:{name:string}}>(await readFile(join(target, 'manifest.json'))).header.name; } catch {}
      try { skins = decode<{ skins: unknown[] }>(await readFile(join(target, 'skins.json'))).skins.length; } catch { /* report unreadable metadata */ }
      // Sizes match the last verified install: skip hashing large assets.
      // apply() still verifies full hashes before any write.
      let changedOutsideManager: boolean | null = null;
      if (state) {
        if (state.installedSignature && sameSignature(measured.files, state.installedSignature)) {
          changedOutsideManager = false;
        } else {
          const current = await tree(target);
          changedOutsideManager = !same(hashes(current.files), state.installed);
          if (!changedOutsideManager) {
            // Backfill the cheap signature for states written by older builds.
            state.installedSignature = measured.files;
            void atomicJSON(this.statePath(slot), state).catch(() => {});
          }
        }
      }
      return { slot, name, target, exists: true, managed: !!state, skins, active: state?.active ?? [], presetSources: state?.presetSources ?? [],
        changedOutsideManager,
        pending: state?.pending ?? null, originalBackup: state?.original ?? null };
    }));
  }
  private async snapshot(slot: string, value: Tree, active: Active, edits?: SlotEdits) {
    const id = randomUUID(), path = join(this.config.stateDir, 'backups', id);
    await writeTree(join(path, 'files'), value);
    const info: Snapshot = { id, slot, target: this.target(slot), created: new Date().toISOString(), hashes: hashes(value.files), directories: value.directories, active, ...(edits ? {edits} : {}) };
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
    const current = await tree(this.target(slot));
    return { presetSources: [], slot, target: this.target(slot), original: backup.id, active, installed: hashes(current.files), installedSignature: (await treeSignature(this.target(slot))).files,
      headerUUID: randomUUID(), moduleUUID: randomUUID(), generation: 0 };
  }
  /** Explicit migration of an already installed slot, with the user's original backup. No target writes. */
  async adopt(slot: string, originalDirectory: string, packID?: string) {
    this.requireGame();
    return this.locked(async () => {
      if (await this.state(slot)) throw new Error('Slot is already managed');
      let active: Active = [];
      if (packID) {
        const pack = await json<LibraryPack>(this.libraryPath(packID));
        if (pack.removed || pack.draft || !pack.skins) throw new Error('皮肤包为空或已归档，请先添加皮肤');
        const current = await readSkinPack(this.target(slot));
        if (!same(hashes(current), pack.hashes)) throw new Error('Adopt pack must exactly match the current target');
        active = [{ id: pack.id, revision: pack.revision }];
      }
      const state = await this.initialState(slot, await tree(originalDirectory), active);
      state.presetSources = active.map(p => p.id);
      await atomicJSON(this.statePath(slot), state); return state;
    });
  }
  private async compose(slot: string, state: TargetState, active: Active, selection?: { id: string; indices: number[] }): Promise<Tree> {
    if (!active.length) return this.editTree((await this.loadSnapshot(slot, state.original)).value, state.edits);
    const files: SkinPackFiles = Object.create(null) as SkinPackFiles;
    const geometryParts: Uint8Array[] = [new TextEncoder().encode('{"format_version":"1.8.0"')];
    let geometryCount = 0;
    const skins: Record<string, unknown>[] = [];
    const key = 'FourDGen_' + slot;
    const lang: string[] = [];
    const packNames: string[] = [];
    for (const packRef of active) {
      const currentPack = await json<LibraryPack>(this.libraryPath(packRef.id));
      const pack = currentPack.revision === packRef.revision ? currentPack : await json<LibraryPack>(this.revisionPath(packRef.id, packRef.revision) + '.json');
      if (pack.id !== packRef.id || pack.revision !== packRef.revision) throw new Error('Active library revision unavailable');
      packNames.push(pack.name);
      const content = await readSkinPack(this.revisionPath(pack.id, pack.revision));
      if (!same(hashes(content), pack.hashes)) throw new Error('Library hash mismatch: ' + pack.id);
      const sourceSkins = decode<{ skins: Record<string, unknown>[] }>(content['skins.json']!).skins;
      const sourceMeta = decode<{ localization_name?: string; serialize_name?: string }>(content['skins.json']!);
      const labels = new Map<string, string>();
      if (content['texts/en_US.lang']) for (const line of new TextDecoder().decode(content['texts/en_US.lang']).split(/\r?\n/)) {
        const split = line.indexOf('='); if (split > 0) labels.set(line.slice(0, split), line.slice(split + 1));
      }
      const remap = new Map<string, string>();
      const sourceGeometry = content['geometry.json'] ? geometryEntries(content['geometry.json']) : [];
      const wanted = packRef.skins
        ? new Set(packRef.skins)
        : selection?.id === pack.id
          ? new Set(selection.indices)
          : null;
      const selected = sourceSkins
        .map((entry, index) => ({ entry, index }))
        .filter(({ index }) => !wanted || wanted.has(index));
      const usedGeometry = new Set(selected.map(({ entry }) => String(entry.geometry)));
      for (const { id, value } of sourceGeometry) {
        if (!usedGeometry.has(id)) continue;
        const renamed = `geometry.fourdgen_${pack.id}_${remap.size}`; remap.set(id, renamed);
        geometryParts.push(new TextEncoder().encode(',' + JSON.stringify(renamed) + ':'));
        geometryParts.push(value);
        geometryCount++;
      }
      for (const { entry, index } of selected) {
        const texture = `${pack.id}_${index}.png`, name = `${pack.id}_${index}`;
        files[texture] = content[entry.texture as string]!;
        skins.push({ ...entry, localization_name: name, texture, geometry: remap.get(entry.geometry as string) ?? entry.geometry });
        const label = labels.get(`skin.${sourceMeta.localization_name ?? sourceMeta.serialize_name}.${String(entry.localization_name)}`) ?? `${pack.name} / ${String(entry.localization_name)}`;
        lang.push(`skin.${key}.${name}=${label.replace(/[\r\n]/g, ' ')}`);
      }
    }
    const displayName = packNames.length === 1 ? packNames[0]! : '4DGen · ' + packNames.join(' / ');
    lang.unshift(`skinpack.${key}=${displayName.replace(/[\r\n]/g, ' ')}`);
    files['manifest.json'] = encode({ format_version: this.config.slots[slot]!.manifestFormat,
      header: { name: displayName, uuid: state.headerUUID, version: [1, 0, state.generation + 1] },
      modules: [{ type: 'skin_pack', uuid: state.moduleUUID, version: [1, 0, state.generation + 1] }] });
    files['skins.json'] = encode({ serialize_name: key, localization_name: key, skins });
    if (geometryCount) {
      geometryParts.push(new TextEncoder().encode('}'));
      files['geometry.json'] = concatBytes(geometryParts);
    }
    files['texts/languages.json'] = encode(['en_US', 'zh_CN']);
    for (const locale of ['en_US', 'zh_CN']) files[`texts/${locale}.lang`] = new TextEncoder().encode(lang.join('\n') + '\n');
    // Every source revision was validated when stored, and its full content is
    // hash-checked above. Re-running the deep geometry validator here would
    // parse the entire merged geometry a second time on every enable/disable.
    // The generated skin/geometry references are remapped from those verified
    // source records, so no new untrusted geometry enters this tree.
    return this.editTree({ files, directories: ['texts'] }, state.edits);
  }
  /** Edits belong to a game install, never to its source library packs. */
  private editTree(value: Tree, edits?: SlotEdits): Tree {
    if (!edits) return value;
    const files = {...value.files};
    const data = decode<{serialize_name:string; localization_name?:string; skins: {texture:string; localization_name?:string}[]}>(files['skins.json']!);
    const key = data.localization_name ?? data.serialize_name;
    const updates = new Map<string,string>();
    const identities=new Map(data.skins.map((skin,index)=>[skin,skinIdentity(skin,index)]));
    const editFor=(skin:InstalledSkin)=>edits.skins[identities.get(skin)!.key] ?? edits.skins[skin.texture];
    const removed = data.skins.filter(skin=>editFor(skin)?.removed);
    data.skins = data.skins.filter(skin => !editFor(skin)?.removed);
    for(const skin of removed) if(!data.skins.some(s=>s.texture===skin.texture))delete files[skin.texture];
    if(removed.length && files['geometry.json']) {
      const geometry=decode<Record<string,unknown>>(files['geometry.json']);
      const used=new Set(data.skins.map(s=>(s as {geometry?:string}).geometry));
      for(const key of Object.keys(geometry))if(key.startsWith('geometry.')&&!used.has(key))delete geometry[key];
      if(Object.keys(geometry).some(key=>key.startsWith('geometry.')))files['geometry.json']=encode(geometry);else delete files['geometry.json'];
    }
    data.skins.forEach((skin,index) => {
      const name = editFor(skin)?.name;
      if (name !== undefined) { skin.localization_name ??= identities.get(skin)!.name; updates.set(`skin.${key}.${skin.localization_name}`,name); }
    });
    if (edits.name !== undefined) {
      const manifest = decode<{header:{name:string}}>(files['manifest.json']!);
      manifest.header.name = edits.name; files['manifest.json'] = encode(manifest);
      updates.set('skinpack.'+key,edits.name);
    }
    files['skins.json'] = encode(data);
    const paths = new Set(['texts/en_US.lang','texts/zh_CN.lang',...Object.keys(files).filter(p=>/^texts\/[^/]+\.lang$/.test(p))]);
    for (const path of paths) {
      const lines = new TextDecoder().decode(files[path] ?? new Uint8Array()).split(/\r?\n/).filter(line=>!updates.has(line.split('=')[0]!));
      files[path] = new TextEncoder().encode([...lines.filter(Boolean),...Array.from(updates,([key,value])=>key+'='+value)].join('\n')+'\n');
    }
    return {files,directories:[...new Set([...value.directories,'texts'])]};
  }
  async editInstalled(slot: string, change: {name?:string; skinIndex?:number; skinName?:string; remove?:boolean; revision?:string}) {
    this.requireGame();
    return this.locked(async()=>{
      const current = await tree(this.target(slot));
      const revision = createHash('sha256').update(JSON.stringify(hashes(current.files))).digest('hex');
      if (change.revision && change.revision !== revision) throw Error('皮肤包已变化，请刷新后重试');
      const state = await this.state(slot) ?? await this.initialState(slot,current);
      const edits: SlotEdits = structuredClone(state.edits ?? {skins:{}});
      const label = (value:string) => { if(typeof value!=='string' || !value.trim() || value.length>120 || /[\r\n\x00]/.test(value)) throw Error('名称需为 1–120 个字符'); return value.trim(); };
      if (change.name !== undefined) edits.name = label(change.name);
      if (change.skinName !== undefined || change.remove) {
        const entries = decode<{skins:{texture:string}[]}>(current.files['skins.json']!).skins;
        const index = change.skinIndex;
        if (!Number.isInteger(index) || index! < 0 || !entries[index!]) throw Error('请选择有效皮肤');
        const texture = skinIdentity(entries[index!]!,index!).key;
        edits.skins[texture] = {...edits.skins[texture],...(change.skinName!==undefined?{name:label(change.skinName)}:{}),...(change.remove?{removed:true}:{})};
      }
      if(change.name===undefined && change.skinName===undefined && !change.remove) throw Error('没有要修改的内容');
      let active = state.active;
      if (change.remove) {
        const installed = entriesAt(current).find((entry) => entry.index === change.skinIndex);
        const ref = installed && state.active.find((p) => installed.texture.startsWith(p.id + '_'));
        if (ref) {
          const latest = await json<LibraryPack>(this.libraryPath(ref.id));
          const pack = latest.revision === ref.revision ? latest : await json<LibraryPack>(this.revisionPath(ref.id, ref.revision) + '.json').catch(() => latest);
          const local = Number(installed!.texture.slice(ref.id.length + 1).replace(/\.png$/i, ''));
          const localIndex = Number.isInteger(local) ? local : change.skinIndex!;
          const all = Array.from({ length: pack.skins }, (_, i) => i);
          const remaining = (ref.skins ?? all).filter((i) => i !== localIndex);
          active = remaining.length
            ? state.active.map((p) => p.id === ref.id ? { id: ref.id, revision: p.revision, skins: remaining } : p)
            : state.active.filter((p) => p.id !== ref.id);
        }
      }
      const next = this.editTree(current,edits);
      const manifest=decode<{header:{version?:number[]};modules?:{version?:number[]}[]}>(next.files['manifest.json']!);
      const version=manifest.header.version ?? [1,0,0];
      const nextVersion=[version[0]??1,version[1]??0,(version[2]??0)+1];
      manifest.header.version=nextVersion;
      for(const module of manifest.modules??[])module.version=nextVersion;
      next.files['manifest.json']=encode(manifest);
      return this.apply(slot,state,next,active,edits);
    });
  }
  private async apply(slot: string, state: TargetState, next: Tree, active: Active, edits: SlotEdits | null | undefined = state.edits) {
    const current = await tree(this.target(slot)), currentHashes = hashes(current.files);
    if (state.pending) throw new Error('An interrupted operation requires recover before changing this slot');
    if (!same(currentHashes, state.installed)) throw new Error('Slot changed outside manager; refusing to overwrite external changes');
    const backup = await this.snapshot(slot, current, state.active, state.edits);
    const nextHashes = hashes(next.files);
    state.pending = { backup: backup.id, planned: nextHashes };
    await atomicJSON(this.statePath(slot), state);
    try {
      // Recheck after backup, immediately before mutation.
      if (!same(hashes((await tree(this.target(slot))).files), currentHashes)) throw new Error('Target changed while backing up');
      await replaceTree(this.target(slot), next, current, nextHashes);
      if (edits) state.edits = edits; else delete state.edits;
      state.active = active; state.installed = nextHashes; state.installedSignature = (await treeSignature(this.target(slot))).files; state.generation++; delete state.pending;
      await atomicJSON(this.statePath(slot), state);
    } catch (error) {
      // Keep pending + the verified backup for explicit recovery. Never clobber unknown changes.
      throw new Error(`Deployment did not complete. Backup ${backup.id} is retained; run packs recover ${slot}. ${String(error)}`);
    }
    return { slot, active, backup: backup.id, installed: state.installed };
  }
  async enable(slot: string, id: string) {
    this.requireGame();
    return this.locked(async () => {
      const pack = await json<LibraryPack>(this.libraryPath(id)); if (pack.removed || pack.draft || !pack.skins) throw new Error('皮肤包为空或已归档，请先添加皮肤');
      if (pack.warnings?.length) throw new Error('Pack needs client compatibility adjustment: ' + pack.warnings.join('; '));
      const state = await this.state(slot) ?? await this.initialState(slot, await tree(this.target(slot)));
      const existing = state.active.find((p) => p.id === id);
      if (existing) {
        const edits = structuredClone(state.edits ?? {skins:{}});
        let restored = false;
        // Reinstalling the whole pack restores skins that were removed one by one.
        for (const [texture,edit] of Object.entries(edits.skins)) if(texture.startsWith(id+'_')&&edit.removed) {delete edit.removed;restored=true;}
        if (!existing.skins && !restored) throw Error('该包的皮肤已全部在游戏中');
        const active = state.active.map((p) => p.id === id ? { id, revision: pack.revision } : p);
        return this.apply(slot,state,await this.compose(slot,{...state,edits},active),active,edits);
      }
      const active = [...state.active, { id, revision: pack.revision }];
      const edits = state.edits ? structuredClone(state.edits) : { skins: {} };
      let restored = false;
      // A pack may have been disabled after individual skins were removed.
      // Reinstalling the whole pack clears those stale removals.
      for (const [texture, edit] of Object.entries(edits.skins)) {
        if (texture.startsWith(id + '_') && edit.removed) {
          delete edit.removed;
          restored = true;
        }
      }
      return this.apply(slot, state, await this.compose(slot, restored ? { ...state, edits } : state, active), active, restored ? edits : state.edits);
    });
  }
  /** Install only the chosen skins from one pack, merging with skins already installed. */
  async enableSkins(slot: string, id: string, indices: number[]) {
    this.requireGame();
    return this.locked(async () => {
      const pack = await json<LibraryPack>(this.libraryPath(id));
      if (pack.removed || pack.draft || !pack.skins) throw new Error('皮肤包为空或已归档，请先添加皮肤');
      if (pack.warnings?.length) throw new Error('Pack needs client compatibility adjustment: ' + pack.warnings.join('; '));
      const wanted = [...new Set(indices)];
      if (!wanted.length || wanted.some((index) => !Number.isInteger(index) || index < 0 || index >= pack.skins)) throw new Error('请选择有效皮肤');
      const state = await this.state(slot) ?? await this.initialState(slot, await tree(this.target(slot)));
      const existing = state.active.find((p) => p.id === id);
      let active: Active;
      if (!existing) {
        active = [...state.active, { id, revision: pack.revision, skins: wanted.sort((a, b) => a - b) }];
      } else {
        if (!existing.skins) throw new Error('该包的皮肤已全部在游戏中');
        const merged = [...new Set([...existing.skins, ...wanted])].sort((a, b) => a - b);
        active = state.active.map((p) => p.id === id
          ? { id, revision: pack.revision, skins: merged }
          : p);
      }
      const edits = state.edits ? structuredClone(state.edits) : { skins: {} };
      let restored = false;
      for (const [key, edit] of Object.entries(edits.skins)) {
        const match = key.match(/^(.*)_(\d+)\.png(?:::|$)/);
        if (!match || match[1] !== id || !edit.removed || !wanted.includes(Number(match[2]))) continue;
        delete edit.removed;
        restored = true;
      }
      return this.apply(slot, state, await this.compose(slot, restored ? { ...state, edits } : state, active), active, restored ? edits : state.edits);
    });
  }
  async disable(slot: string, id: string) {
    this.requireGame();
    return this.locked(async () => {
      const state = await this.state(slot); if (!state || !state.active.some((p) => p.id === id)) throw new Error('Pack is not enabled in this slot');
      const active = state.active.filter((p) => p.id !== id);
      return this.apply(slot, state, await this.compose(slot, state, active), active);
    });
  }
  /** Remove one installed skin while keeping the rest of its pack in the game. */
  async disableSkin(slot: string, id: string, index: number) {
    this.requireGame();
    return this.locked(async () => {
      const state = await this.state(slot);
      const entry = state?.active.find((p) => p.id === id);
      if (!state || !entry) throw new Error('皮肤包未安装到游戏');
      const latest = await json<LibraryPack>(this.libraryPath(id));
      const pack = latest.revision === entry.revision ? latest : await json<LibraryPack>(this.revisionPath(id, entry.revision) + '.json');
      const installed = entry.skins ?? Array.from({ length: pack.skins }, (_, i) => i);
      if (!Number.isInteger(index) || !installed.includes(index)) throw new Error('这个皮肤没有安装到游戏');
      const remaining = installed.filter((i) => i !== index);
      const active = remaining.length
        ? state.active.map((p) => p.id === id ? { id, revision: p.revision, skins: remaining } : p)
        : state.active.filter((p) => p.id !== id);
      return this.apply(slot, state, await this.compose(slot, state, active), active);
    });
  }
  async restore(slot: string, backupID?: string) {
    this.requireGame();
    return this.locked(async () => {
      const state = await this.state(slot); if (!state) throw new Error('Slot is not managed');
      const backup = await this.loadSnapshot(slot, backupID ?? state.original);
      return this.apply(slot, state, backup.value, backup.info.active, backup.info.edits ?? null);
    });
  }
  async recover(slot: string) {
    this.requireGame();
    return this.locked(async () => {
      const state = await this.state(slot); if (!state?.pending) throw new Error('No interrupted operation');
      const backup = await this.loadSnapshot(slot, state.pending.backup);
      const currentTree = await tree(this.target(slot));
      const current = hashes(currentTree.files);
      for (const [key, hash] of Object.entries(current)) if (backup.info.hashes[key] !== hash && state.pending.planned[key] !== hash) throw new Error('Recovery found unknown external changes; refusing overwrite');
      await replaceTree(this.target(slot), backup.value, currentTree, backup.info.hashes);
      if (backup.info.edits) state.edits = backup.info.edits; else delete state.edits;
      state.active = backup.info.active; state.installed = backup.info.hashes; state.installedSignature = (await treeSignature(this.target(slot))).files; delete state.pending;
      await atomicJSON(this.statePath(slot), state); return { slot, recovered: backup.info.id };
    });
  }
  async archive(id: string) {
    return this.locked(async () => {
      await this.assertInactive(id);
      const path = this.libraryPath(id), pack = await json<LibraryPack>(path); pack.removed = true;
      await atomicJSON(path, pack); return pack;
    });
  }
}

