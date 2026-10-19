import type { BedrockGeometryFile } from "../src/bedrock-types";
import type { PersonaRecipe } from "../src/persona-recipe";

export type PackMeta = {
  template?: "image";
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
  profile?: unknown;
};

export type PackStats = {
  triangles: number;
  vertices: number;
  bones: number;
  texture: { width: number; height: number } | null;
  bytes: number;
};

export type LibraryPack = {
  id: string;
  revision: string;
  name: string;
  skins: number;
  imported: string;
  warnings: string[];
  removed?: boolean;
  draft?: boolean;
  meta?: PackMeta;
  stats?: PackStats;
};

export type SlotStatus = {
  slot: string;
  name?: string;
  target: string;
  exists: boolean;
  managed: boolean;
  skins: number | null;
  active: { id: string; revision: string }[];
  presetSources?: string[];
  changedOutsideManager: boolean | null;
  pending: unknown;
  originalBackup: string | null;
};

export type Packs = {
  configured: boolean;
  gameConfigured?: boolean;
  gameError?: string;
  configPath?: string;
  error?: string;
  root?: string;
  stateDir?: string;
  slots?: Record<string, { manifestFormat: number }>;
  status?: SlotStatus[];
  library?: LibraryPack[];
  persona?: PersonaRecipe;
  personaError?: string;
};

export type Scene = {
  name: string;
  identifier: string;
  geometry: BedrockGeometryFile | null;
  skins: number;
  texture: string;
};

export type SkinItem = {
  origin?: {
    packId: string;
    skinIndex: number;
    modelId?: string;
    template?: "image";
    source?: string;
  } | null;
  index: number;
  name: string;
  geometry: string;
  texture: string;
};

export type Contents = {
  id: string;
  name: string;
  revision: string;
  skins: SkinItem[];
};
