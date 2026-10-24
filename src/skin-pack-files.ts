import type { BedrockGeometryFile } from './bedrock-types.ts';
import { validateGeometry } from './geometry-validator.ts';

export type SkinPackFiles = Record<string, Uint8Array>;

const encoder = new TextEncoder();
const text = (value: unknown) => encoder.encode(JSON.stringify(value));

/** UUID v4 without Node APIs, so this module also runs in the browser. */
function uuid(): string {
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

export interface SkinPackInput {
  geometry: BedrockGeometryFile;
  png: Uint8Array;
  /** Human-readable name in manifest.json. */
  packName?: string;
  /** Must equal an identifier already present in geometry.json. */
  identifier: string;
}

/** Legacy geometry, texture, unique pack identity and localized display names. */
export function buildSkinPack(input: SkinPackInput): SkinPackFiles {
  const name = input.packName ?? 'Custom Skin Pack';
  if (!name.trim() || name.length > 128) throw new Error('Pack name must be 1-128 characters');
  if (input.identifier !== 'geometry.skin0') {
    throw new Error('Single-skin export requires identifier geometry.skin0');
  }
  validateGeometry(input.geometry, { expectedIdentifier: input.identifier });
  const headerId = uuid(), moduleId = uuid();
  const key = 'FourDGen_' + headerId.replaceAll('-', '');
  const label = name.replace(/[\r\n=]/g, ' ');
  return {
    'manifest.json': text({
      format_version: 2,
      header: { name, uuid: headerId, version: [1, 0, 0] },
      modules: [{ type: 'skin_pack', uuid: moduleId, version: [1, 0, 0] }],
    }),
    'skins.json': text({ serialize_name: key, localization_name: key, skins: [{
      localization_name: 'skin0', geometry: input.identifier,
      texture: 'skin0.png', hide_armor: true, type: 'free',
    }] }),
    'geometry.json': text(input.geometry),
    'skin0.png': new Uint8Array(input.png),
    'texts/languages.json': text(['en_US', 'zh_CN']),
    'texts/en_US.lang': encoder.encode(`skinpack.${key}=${label}\nskin.${key}.skin0=${label}\n`),
    'texts/zh_CN.lang': encoder.encode(`skinpack.${key}=${label}\nskin.${key}.skin0=${label}\n`),
  };
}
