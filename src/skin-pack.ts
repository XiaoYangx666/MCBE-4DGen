import { safeExternalAsset } from "./import-skin-pack.ts";
import { validateImportedGeometry } from "./pack-geometry.ts";
import { readFile, readdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import JSZip from 'jszip';
import sharp from 'sharp';
import type { BedrockGeometryFile } from './bedrock-types.ts';
import { parseGeometryJSON } from './geometry-validator.ts';

import { buildSkinPack, isUuid } from './skin-pack-files.ts';
import type { SkinPackFiles, SkinPackInput } from './skin-pack-files.ts';
import { zipSkinPackBytes } from './skin-pack-zip.ts';
export { buildSkinPack };
export type { SkinPackFiles, SkinPackInput };
const decoder = new TextDecoder('utf-8', { fatal: true });
const fileName = /^[A-Za-z0-9_-]+\.png$/;
const rootFile = /^(?:manifest|skins|geometry)\.json$|^[A-Za-z0-9_-]+\.png$|^texts\/(?:[a-z]{2}_[A-Z]{2}\.lang|languages\.json)$/;
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

export interface PackValidation {
  name: string;
  skins: number;
  geometries: string[];
  files: string[];
}

/**
 * Independent cross-file validator: parses the actual JSON and PNG data, never
 * calls the exporter. `light` skips the deep geometry parse; use it only for
 * content copied from an already-validated pack, such as a game-slot export.
 */
export async function validateSkinPackFiles(
  files: Readonly<SkinPackFiles>,
  options: { light?: boolean } = {},
): Promise<PackValidation> {
  for (const name of Object.keys(files)) {
    assert(rootFile.test(name), 'unexpected or unsafe filename ' + name);
  }
  const manifest = parse(required(files, 'manifest.json'), 'manifest.json');
  const skins = parse(required(files, 'skins.json'), 'skins.json');
  assert(record(manifest) && [1, 2].includes(manifest.format_version as number), 'manifest format_version must be 1 or 2');
  const header = manifest.header;
  assert(record(header) && typeof header.name === 'string' && header.name.trim().length > 0 &&
    isUuid(header.uuid), 'invalid manifest header');
  const version = (value: unknown) => Array.isArray(value) && value.length === 3 &&
    value.every((n) => Number.isSafeInteger(n) && n >= 0);
  assert(version(header.version), 'invalid header version');
  assert(Array.isArray(manifest.modules) && manifest.modules.length === 1, 'expected one skin_pack module');
  const module = manifest.modules[0];
  assert(record(module) && module.type === 'skin_pack' &&
    isUuid(module.uuid) && module.uuid !== header.uuid && version(module.version), 'invalid skin_pack module');
  assert(record(skins) && Array.isArray(skins.skins) && skins.skins.length > 0, 'skins.json has no skins');
  const names = new Set<string>(), geometries = new Set<string>(), textures = new Set<string>();
  for (const entry of skins.skins) {
    assert(record(entry) && typeof entry.localization_name === 'string' &&
      /^[A-Za-z0-9_-]+$/.test(entry.localization_name) &&
      typeof entry.geometry === 'string' && entry.geometry.startsWith('geometry.') &&
      typeof entry.texture === 'string' && fileName.test(entry.texture) &&
      ['free', 'paid'].includes(entry.type as string) && (entry.hide_armor === undefined || typeof entry.hide_armor === 'boolean'), 'invalid skin entry');
    assert(!names.has(entry.localization_name), 'duplicate localization_name');
    names.add(entry.localization_name);
    geometries.add(entry.geometry);
    textures.add(entry.texture);
    required(files, entry.texture);
  }
  const builtin = new Set(['geometry.humanoid.custom', 'geometry.humanoid.customSlim']);
  let parsed: {
    file: BedrockGeometryFile;
    geometries: { identifier: string }[];
  } | null = null;
  let external = false;
  if (!options.light) {
    const geometryBytes = files['geometry.json'];
    const rawGeometry = geometryBytes ? JSON.parse(decoder.decode(geometryBytes)) : null;
    external = !!rawGeometry && (rawGeometry.format_version !== '1.8.0' || Object.values(rawGeometry).some((g:any)=>g?.bones?.some((b:any)=>b.cubes?.length)));
    parsed = rawGeometry ? external ? validateImportedGeometry(rawGeometry) : parseGeometryJSON(JSON.stringify(rawGeometry), { atlasUVs: true }) : null;
    const available = new Set<string>([...builtin, ...(parsed?.geometries.map((g) => g.identifier) ?? [])]);
    for (const id of geometries) assert(available.has(id), 'missing referenced geometry ' + id);
  }
  for (const texture of textures) {
    const image = await sharp(required(files, texture)).metadata();
    assert(image.format === 'png' && !!image.width && !!image.height, 'invalid PNG ' + texture);
    for (const entry of skins.skins) {
      if (entry.texture !== texture) continue;
      const identifier = entry.geometry as string;
      if (builtin.has(identifier)) {
        assert(image.width! >= 64 && (image.width! & (image.width! - 1)) === 0 && [image.width, image.width! / 2].includes(image.height!), 'unsupported standard skin dimensions');
        continue;
      }
      // Light validation trusts custom geometry copied from a validated pack.
      if (options.light) continue;
      const item = parsed?.file[identifier as `geometry.${string}`];
      assert(external || (item?.texturewidth === image.width && item.textureheight === image.height),
        'geometry dimensions do not match ' + texture);
    }
  }
  for (const file of Object.keys(files)) {
    if (file.endsWith('.png')) assert(textures.has(file) || file === 'pack_icon.png', 'orphan PNG ' + file);
  }
  return {
    name: header.name, skins: skins.skins.length,
    geometries: [...geometries], files: Object.keys(files).sort(),
  };
}

export async function zipSkinPack(
  files: Readonly<SkinPackFiles>,
  options: { fast?: boolean; light?: boolean } = {},
): Promise<Uint8Array> {
  await validateSkinPackFiles(files, options.light ? { light: true } : {});
  return zipSkinPackBytes(files, options.fast ? { fast: true } : {});
}

/** Read supported root assets and texts/ only; reject unsafe or unexpected ZIP paths. */
export async function readSkinPack(path: string, options: { external?: boolean } = {}): Promise<SkinPackFiles> {
  const result: SkinPackFiles = {};
  const add = (name: string, bytes: Uint8Array) => {
    assert(options.external ? safeExternalAsset(name) : rootFile.test(name), 'unexpected or unsafe filename ' + name);
    assert(!Object.hasOwn(result, name), 'duplicate file ' + name);
    result[name] = bytes;
  };
  assert(!(await lstat(path)).isSymbolicLink(), 'symbolic links are not supported');
  if ((await lstat(path)).isDirectory()) {
    const entries = await readdir(path, { withFileTypes: true });
    const files = entries.filter((entry) => entry.isFile());
    const directories = entries.filter((entry) => entry.isDirectory());
    // Accept a single wrapper folder, e.g. an extracted 4DGen-xxxxxxxx pack.
    if (!files.length && directories.length === 1 && directories[0]!.name !== 'texts') {
      return readSkinPack(join(path, directories[0]!.name), options);
    }
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name === 'texts') {
        for (const nested of await readdir(join(path, 'texts'), { withFileTypes: true })) {
          assert(nested.isFile(), 'non-file in texts');
          add('texts/' + nested.name, await readFile(join(path, 'texts', nested.name)));
        }
      } else {
        assert(entry.isFile(), 'unexpected directory or link');
        add(entry.name, await readFile(join(path, entry.name)));
      }
    }
  } else {
    const zip = await JSZip.loadAsync(await readFile(path), { checkCRC32: true, createFolders: false });
    const entries = Object.values(zip.files);
    const fileEntries = entries.filter((entry) => !entry.dir);
    const roots = new Set(fileEntries.map((entry) => {
      const index = entry.name.indexOf('/');
      return index < 0 ? '' : entry.name.slice(0, index);
    }));
    const wrapper = roots.size === 1 && !roots.has('') ? [...roots][0]! : '';
    const prefix = wrapper ? wrapper + '/' : '';
    for (const entry of entries) {
      let name = entry.name;
      if (prefix) {
        if (name === prefix) {
          assert(entry.dir, 'unexpected file path in archive');
          continue;
        }
        assert(name.startsWith(prefix), 'unexpected or unsafe filename ' + name);
        name = name.slice(prefix.length);
      }
      if (entry.dir) { assert(name === 'texts/', 'unexpected directory in archive'); continue; }
      assert(!entry.unsafeOriginalName || entry.unsafeOriginalName === entry.name,
        'unexpected or unsafe filename ' + entry.unsafeOriginalName);
      add(name, await entry.async('uint8array'));
    }
  }
  return result;
}

export async function validateSkinPackPath(path: string): Promise<PackValidation> {
  return validateSkinPackFiles(await readSkinPack(path));
}

