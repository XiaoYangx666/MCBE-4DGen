import { randomUUID } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import JSZip from 'jszip';
import sharp from 'sharp';
import type { BedrockGeometryFile } from './bedrock-types.ts';
import { parseGeometryJSON, validateGeometry } from './geometry-validator.ts';

export type SkinPackFiles = Record<string, Uint8Array>;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const fileName = /^[A-Za-z0-9_-]+\.png$/;
const rootFile = /^(?:manifest|skins|geometry)\.json$|^[A-Za-z0-9_-]+\.png$/;
const text = (value: unknown) => encoder.encode(JSON.stringify(value));
function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error('Invalid skin pack: ' + message);
}
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const parse = (bytes: Uint8Array, name: string): unknown => {
  try { return JSON.parse(decoder.decode(bytes)) as unknown; }
  catch { throw new Error('Invalid skin pack: malformed ' + name); }
};
function required(files: Readonly<SkinPackFiles>, name: string): Uint8Array {
  const content = Object.hasOwn(files, name) ? files[name] : undefined;
  if (!(content instanceof Uint8Array)) throw new Error('Invalid skin pack: missing ' + name);
  return content;
}

export interface SkinPackInput {
  geometry: BedrockGeometryFile;
  png: Uint8Array;
  /** Human-readable name in manifest.json. */
  packName?: string;
  /** Must equal an identifier already present in geometry.json. */
  identifier: string;
}

/** The same minimal layout as the provided 5D reference pack: three JSON files and PNG textures. */
export function buildSkinPack(input: SkinPackInput): SkinPackFiles {
  const name = input.packName ?? 'Custom Skin Pack';
  if (!name.trim() || name.length > 128) throw new Error('Pack name must be 1–128 characters');
  if (input.identifier !== 'geometry.skin0') {
    throw new Error('Single-skin export requires identifier geometry.skin0');
  }
  validateGeometry(input.geometry, { expectedIdentifier: input.identifier });
  const headerId = randomUUID(), moduleId = randomUUID();
  return {
    'manifest.json': text({
      format_version: 2,
      header: { name, uuid: headerId, version: [1, 0, 0] },
      modules: [{ type: 'skin_pack', uuid: moduleId, version: [1, 0, 0] }],
    }),
    'skins.json': text({ skins: [{
      localization_name: 'skin0', geometry: input.identifier,
      texture: 'skin0.png', hide_armor: true, type: 'free',
    }] }),
    'geometry.json': text(input.geometry),
    'skin0.png': Uint8Array.from(input.png),
  };
}

export interface PackValidation {
  name: string;
  skins: number;
  geometries: string[];
  files: string[];
}

/** Independent cross-file validator: parses the actual JSON and PNG data, never calls the exporter. */
export async function validateSkinPackFiles(files: Readonly<SkinPackFiles>): Promise<PackValidation> {
  for (const name of Object.keys(files)) {
    assert(rootFile.test(name), 'unexpected or unsafe filename ' + name);
  }
  const manifest = parse(required(files, 'manifest.json'), 'manifest.json');
  const skins = parse(required(files, 'skins.json'), 'skins.json');
  const geometry = decoder.decode(required(files, 'geometry.json'));
  assert(record(manifest) && manifest.format_version === 2, 'manifest format_version must be 2');
  const header = manifest.header;
  assert(record(header) && typeof header.name === 'string' && header.name.trim().length > 0 &&
    typeof header.uuid === 'string' && uuid.test(header.uuid), 'invalid manifest header');
  const version = (value: unknown) => Array.isArray(value) && value.length === 3 &&
    value.every((n) => Number.isSafeInteger(n) && n >= 0);
  assert(version(header.version), 'invalid header version');
  assert(Array.isArray(manifest.modules) && manifest.modules.length === 1, 'expected one skin_pack module');
  const module = manifest.modules[0];
  assert(record(module) && module.type === 'skin_pack' && typeof module.uuid === 'string' &&
    uuid.test(module.uuid) && module.uuid !== header.uuid && version(module.version), 'invalid skin_pack module');
  assert(record(skins) && Array.isArray(skins.skins) && skins.skins.length > 0, 'skins.json has no skins');
  const names = new Set<string>(), geometries = new Set<string>(), textures = new Set<string>();
  for (const entry of skins.skins) {
    assert(record(entry) && typeof entry.localization_name === 'string' &&
      /^[A-Za-z0-9_-]+$/.test(entry.localization_name) &&
      typeof entry.geometry === 'string' && entry.geometry.startsWith('geometry.') &&
      typeof entry.texture === 'string' && fileName.test(entry.texture) &&
      entry.type === 'free' && typeof entry.hide_armor === 'boolean', 'invalid skin entry');
    assert(!names.has(entry.localization_name), 'duplicate localization_name');
    names.add(entry.localization_name);
    geometries.add(entry.geometry);
    textures.add(entry.texture);
    required(files, entry.texture);
  }
  const parsed = parseGeometryJSON(geometry, { atlasUVs: true });
  const available = new Set(parsed.geometries.map((g) => g.identifier));
  for (const id of geometries) assert(available.has(id), 'missing referenced geometry ' + id);
  for (const texture of textures) {
    const image = await sharp(required(files, texture)).metadata();
    assert(image.format === 'png' && !!image.width && !!image.height, 'invalid PNG ' + texture);
    for (const entry of skins.skins) {
      if (entry.texture !== texture) continue;
      const identifier = entry.geometry as string;
      const item = parsed.file[identifier as `geometry.${string}`];
      assert(item?.texturewidth === image.width && item.textureheight === image.height,
        'geometry dimensions do not match ' + texture);
    }
  }
  for (const file of Object.keys(files)) {
    if (file.endsWith('.png')) assert(textures.has(file), 'orphan PNG ' + file);
  }
  return {
    name: header.name, skins: skins.skins.length,
    geometries: [...geometries], files: Object.keys(files).sort(),
  };
}

export async function zipSkinPack(files: Readonly<SkinPackFiles>): Promise<Uint8Array> {
  await validateSkinPackFiles(files);
  const zip = new JSZip();
  for (const [name, bytes] of Object.entries(files)) zip.file(name, bytes);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

/** Read only root-level JSON/PNG files, so ZIP names cannot escape the target directory. */
export async function readSkinPack(path: string): Promise<SkinPackFiles> {
  const result: SkinPackFiles = {};
  const add = (name: string, bytes: Uint8Array) => {
    assert(rootFile.test(name), 'unexpected or unsafe filename ' + name);
    assert(!Object.hasOwn(result, name), 'duplicate file ' + name);
    result[name] = bytes;
  };
  if ((await stat(path)).isDirectory()) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      assert(entry.isFile(), 'subdirectories and non-files are not supported');
      add(entry.name, await readFile(join(path, entry.name)));
    }
  } else {
    const zip = await JSZip.loadAsync(await readFile(path), { checkCRC32: true, createFolders: false });
    for (const entry of Object.values(zip.files)) {
      assert(!entry.dir, 'unexpected directory in archive');
      add(entry.name, await entry.async('uint8array'));
    }
  }
  return result;
}

export async function validateSkinPackPath(path: string): Promise<PackValidation> {
  return validateSkinPackFiles(await readSkinPack(path));
}
