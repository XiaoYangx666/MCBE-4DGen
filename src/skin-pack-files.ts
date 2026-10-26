import type { BedrockGeometryFile } from './bedrock-types.ts';
import { validateGeometry } from './geometry-validator.ts';

export type SkinPackFiles = Record<string, Uint8Array>;

const encoder = new TextEncoder();
const text = (value: unknown) => encoder.encode(JSON.stringify(value));

/** UUID v4 without Node APIs, so this module also runs in the browser. */
export function randomUuid(): string {
  const crypto = globalThis.crypto;
  if (crypto?.randomUUID) return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (crypto?.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const UUID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** True for a canonical UUID string, used to preserve pack identity. */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/** True when the bytes start with the PNG signature and can carry an IHDR. */
export function isPng(value: Uint8Array): boolean {
  return value.length >= 24 &&
    PNG_SIGNATURE.every((byte, index) => value[index] === byte);
}

/** PNG IHDR dimensions without decoding the image. */
export function pngDimensions(value: Uint8Array) {
  if (value.length < 24) return null;
  const view = new DataView(value.buffer, value.byteOffset, value.byteLength);
  if (view.getUint32(12) !== 0x49484452) return null; // "IHDR"
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

export interface SkinPackInput {
  geometry: BedrockGeometryFile;
  png: Uint8Array;
  /** Human-readable name in manifest.json. */
  packName?: string;
  /** Must equal an identifier already present in geometry.json. */
  identifier: string;
}

export interface SkinPackCollectionSkin {
  /** Display name shown in the in-game skin picker. */
  name: string;
  /** A geometry file containing exactly one geometry definition. */
  geometry: BedrockGeometryFile;
  png: Uint8Array;
}

export interface SkinPackCollectionInput {
  packName?: string;
  skins: readonly SkinPackCollectionSkin[];
  /** Keep pack identity stable when updating an existing pack. */
  headerId?: string;
  moduleId?: string;
}

export interface SkinPackCollectionResult {
  files: SkinPackFiles;
  headerId: string;
  moduleId: string;
  skins: {
    name: string;
    identifier: `geometry.${string}`;
    texture: string;
    localizationName: string;
  }[];
}

function singleGeometry(file: BedrockGeometryFile, skinName: string) {
  const keys = Object.keys(file).filter((key) => key.startsWith('geometry.')) as `geometry.${string}`[];
  if (keys.length !== 1) throw new Error(`Skin "${skinName}" must contain exactly one geometry`);
  return { identifier: keys[0]!, geometry: file[keys[0]!]! };
}

function assertPng(value: Uint8Array, skinName: string) {
  if (!(value instanceof Uint8Array) || !isPng(value)) {
    throw new Error(`Skin "${skinName}" is missing a valid PNG texture`);
  }
  return new Uint8Array(value);
}

/**
 * Multi-skin legacy pack. Every skin gets an independent geometry key and
 * texture, while all of them share one pack identity and skin picker.
 */
export function buildSkinPackCollection(input: SkinPackCollectionInput): SkinPackCollectionResult {
  const name = (input.packName ?? 'Custom Skin Pack').trim();
  if (!name || name.length > 128) throw new Error('Pack name must be 1-128 characters');
  if (!input.skins.length) throw new Error('A skin pack needs at least one skin');
  const headerId = isUuid(input.headerId) ? input.headerId : randomUuid();
  const moduleId = isUuid(input.moduleId) ? input.moduleId : randomUuid();
  const key = 'FourDGen_' + headerId.replaceAll('-', '');
  const packLabel = name.replace(/[\r\n=]/g, ' ');
  const geometryFile = { format_version: '1.8.0' } as BedrockGeometryFile;
  const skins: SkinPackCollectionResult['skins'] = [];
  const entries: Record<string, unknown>[] = [];
  const files: SkinPackFiles = {};
  const english: string[] = [`skinpack.${key}=${packLabel}`];
  const chinese: string[] = [`skinpack.${key}=${packLabel}`];

  input.skins.forEach((skin, index) => {
    const label = skin.name.trim();
    if (!label || label.length > 128) throw new Error('Skin name must be 1-128 characters');
    const source = singleGeometry(skin.geometry, label);
    const identifier = `geometry.skin${index}` as const;
    const localizationName = `skin${index}`;
    const texture = `skin${index}.png`;
    geometryFile[identifier] = source.geometry;
    validateGeometry(
      { format_version: '1.8.0', [identifier]: source.geometry } as BedrockGeometryFile,
      { expectedIdentifier: identifier },
    );
    const textureBytes = assertPng(skin.png, label);
    const size = pngDimensions(textureBytes);
    if (!size || size.width !== source.geometry.texturewidth || size.height !== source.geometry.textureheight) {
      throw new Error(
        `Skin "${label}" texture is ${size?.width ?? '?'}×${size?.height ?? '?'}, ` +
        `but geometry expects ${source.geometry.texturewidth}×${source.geometry.textureheight}`,
      );
    }
    files[texture] = textureBytes;
    const escape = label.replace(/[\r\n=]/g, ' ');
    english.push(`skin.${key}.${localizationName}=${escape}`);
    chinese.push(`skin.${key}.${localizationName}=${escape}`);
    entries.push({
      localization_name: localizationName,
      geometry: identifier,
      texture,
      hide_armor: true,
      type: 'free',
    });
    skins.push({ name: label, identifier, texture, localizationName });
  });

  files['manifest.json'] = text({
    format_version: 2,
    header: { name, uuid: headerId, version: [1, 0, 0] },
    modules: [{ type: 'skin_pack', uuid: moduleId, version: [1, 0, 0] }],
  });
  files['skins.json'] = text({ serialize_name: key, localization_name: key, skins: entries });
  files['geometry.json'] = text(geometryFile);
  files['texts/languages.json'] = text(['en_US', 'zh_CN']);
  files['texts/en_US.lang'] = encoder.encode(english.join('\n') + '\n');
  files['texts/zh_CN.lang'] = encoder.encode(chinese.join('\n') + '\n');
  return { files, headerId, moduleId, skins };
}

/** Legacy single-skin geometry, texture, unique pack identity and localized names. */
export function buildSkinPack(input: SkinPackInput): SkinPackFiles {
  if (input.identifier !== 'geometry.skin0') {
    throw new Error('Single-skin export requires identifier geometry.skin0');
  }
  const name = input.packName ?? 'Custom Skin Pack';
  return buildSkinPackCollection({
    packName: name,
    skins: [{ name, geometry: input.geometry, png: input.png }],
  }).files;
}
