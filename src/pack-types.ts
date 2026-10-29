/** Shared skin-pack domain types used by the manager, server and web UI. */
import type { HumanoidProfile } from './humanoid.ts';

export type PackHashes = Record<string, string>;

export interface PackStats {
  triangles: number;
  vertices: number;
  bones: number;
  texture: { width: number; height: number } | null;
  bytes: number;
}

/** Project metadata kept beside the pack; not part of the installable pack files. */
export interface SkinOrigin {
  packId: string;
  skinIndex: number;
  modelId?: string | undefined;
  template?: "image" | undefined;
  source?: string | undefined;
}

export interface PackMeta {
  skinOrigins?: (SkinOrigin | null)[];
  template?: "image";
  sourceMime?: string;
  importWarnings?: string[];
  versionName?: string;
  modelId?: string;
  materialWeights?: Record<string, number>;
  source?: string;
  binding?: string;
  ratio?: number;
  maxError?: number;
  height?: number;
  excluded?: string[];
  profile?: HumanoidProfile | null;
  note?: string;
  /** True for atlas-only preview jobs; never installed as a pack. */
  preview?: boolean;
}

/** One immutable library revision plus the UI-facing summary. */
export interface LibraryPack {
  draft?: boolean;
  id: string;
  revision: string;
  name: string;
  skins: number;
  hashes: PackHashes;
  imported: string;
  warnings: string[];
  removed?: boolean;
  meta?: PackMeta;
  stats?: PackStats;
}

/** A pack enabled in a game slot; `skins` limits it to chosen source indices. */
export type ActivePack = {
  id: string;
  revision: string;
  skins?: number[];
};
