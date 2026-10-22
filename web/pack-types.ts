import type { BedrockGeometryFile } from "../src/bedrock-types";
import type { PersonaRecipe } from "../src/persona-recipe";
import type {
  ActivePack,
  LibraryPack,
  SkinOrigin,
} from "../src/pack-types";

export type {
  LibraryPack,
  PackMeta,
  PackStats,
  SkinOrigin,
} from "../src/pack-types";

export type SlotStatus = {
  slot: string;
  name?: string;
  target: string;
  exists: boolean;
  managed: boolean;
  skins: number | null;
  active: ActivePack[];
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
  origin?: SkinOrigin | null;
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
