import type { BedrockGeometryFile } from '../../src/bedrock-types.ts';

export type SkinSource = 'image' | 'model' | 'import';

export interface StoredSkin {
  id: string;
  name: string;
  source: SkinSource;
  createdAt: number;
  updatedAt: number;
  triangles: number;
  geometry: BedrockGeometryFile;
  png: Uint8Array;
}

/**
 * The browser version intentionally keeps exactly one pack. Its UUIDs are
 * persisted so repeated ZIP exports keep the same in-game identity.
 */
export interface SkinPack {
  version: 1;
  headerId: string;
  moduleId: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  skins: StoredSkin[];
}

export const DEFAULT_PACK_NAME = '我的 4D 皮肤包';
