import { createHash, randomUUID } from 'node:crypto';
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  rmdir,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import sharp from 'sharp';
import { isPaddedTriangle } from './geometry-validator.ts';
import type {
  LibraryPack,
  PackHashes,
  PackStats,
  SkinOrigin,
} from './pack-types.ts';
import type { SkinPackFiles } from './skin-pack.ts';

export type Hashes = PackHashes;
export interface Tree {
  files: SkinPackFiles;
  directories: string[];
}

export function skinOrigin(pack: LibraryPack, index: number): SkinOrigin | null {
  if (pack.meta?.skinOrigins) return pack.meta.skinOrigins[index] ?? null;
  if (pack.skins !== 1 || !pack.meta || (!pack.meta.modelId && !pack.meta.template)) return null;
  return { packId: pack.id, skinIndex: index, modelId: pack.meta.modelId, template: pack.meta.template, source: pack.meta.source };
}

export type InstalledSkin = { texture: string; geometry?: string; localization_name?: string };

export function skinIdentity(skin: InstalledSkin, index: number) {
  const name = skin.localization_name ?? `fourdgen_${index}_${createHash('sha256').update(skin.texture + '|' + (skin.geometry ?? '')).digest('hex').slice(0, 12)}`;
  return { name, key: skin.texture + '::' + (skin.geometry ?? '') + '::' + name };
}

export function entriesAt(value: Tree) {
  return decode<{ skins: { texture: string }[] }>(value.files['skins.json']!).skins.map((entry, index) => ({ ...entry, index }));
}

export const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value, null, 2));
export const decode = <T>(bytes: Uint8Array): T => JSON.parse(new TextDecoder().decode(bytes)) as T;

export const validID = (value: string) => {
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(value)) throw new Error('ID must be lowercase letters, digits, _ or -, starting with a letter');
  return value;
};

export const safeName = (value: string) => {
  if (!value || value.includes('\\') || value.split('/').some((part) => !part || part === '.' || part === '..' || part.includes(':')) || isAbsolute(value)) throw new Error('Unsafe managed path: ' + value);
  return value;
};

export const inside = (parent: string, child: string) => {
  const path = relative(parent, child);
  return path !== '' && !path.startsWith('..') && !isAbsolute(path);
};

export const hashes = (files: SkinPackFiles): Hashes =>
  Object.fromEntries(
    Object.keys(files).sort().map((key) => [
      key,
      createHash('sha256').update(files[key]!).digest('hex'),
    ]),
  );

export const same = (a: Hashes, b: Hashes) =>
  JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

export async function exists(path: string) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export async function noLinks(path: string) {
  for (let current = resolve(path); ; current = dirname(current)) {
    if (await exists(current)) {
      // Bun on Windows returns a bare "E:" for the drive root; resolving that
      // would incorrectly mean the drive's current working directory.
      const actual = await realpath(current);
      const canonical = /^[A-Za-z]:$/.test(actual) ? actual + '\\' : actual;
      if ((await lstat(current)).isSymbolicLink() || resolve(canonical).toLowerCase() !== resolve(current).toLowerCase()) throw new Error('Linked paths are not supported: ' + current);
    }
    if (dirname(current) === current) break;
  }
}

export async function tree(path: string): Promise<Tree> {
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
export async function treeSignature(path: string): Promise<{ files: Record<string, string>; directories: string[] }> {
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

export function sameSignature(a: Record<string, string>, b: Record<string, string>) {
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
export function geometryEntry(bytes: Uint8Array, id: string): Uint8Array | null {
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
export function geometryEntries(bytes: Uint8Array): { id: string; value: Uint8Array }[] {
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

export function concatBytes(parts: Uint8Array[]) {
  const result = new Uint8Array(parts.reduce((size, part) => size + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.byteLength; }
  return result;
}

export async function writeTree(path: string, value: Tree) {
  await noLinks(path); await mkdir(path, { recursive: true });
  for (const dir of value.directories) await mkdir(join(path, safeName(dir)), { recursive: true });
  for (const [key, bytes] of Object.entries(value.files)) {
    const out = join(path, safeName(key)); await mkdir(dirname(out), { recursive: true }); await writeFile(out, bytes);
  }
}

function sameBytes(a: Uint8Array, b: Uint8Array) {
  return a === b || (a.byteLength === b.byteLength && Buffer.compare(a, b) === 0);
}

export async function replaceTree(path: string, value: Tree, old: Tree, expected: Hashes) {
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

export async function json<T>(path: string): Promise<T> { return decode<T>(await readFile(path)); }

export async function atomicJSON(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  const temp = path + '.' + randomUUID() + '.tmp';
  await writeFile(temp, encode(value)); await rename(temp, path);
}

/** Cheap, dependency-free summary of what a pack actually contains. */
export async function statsFor(files: SkinPackFiles): Promise<PackStats> {
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
        for (const poly of mesh.polys) triangles += poly.length === 3 || isPaddedTriangle(poly as never) ? 1 : 2;
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
