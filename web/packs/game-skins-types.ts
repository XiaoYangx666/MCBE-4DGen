import type { GameSkinBackup } from "../../src/game-skins";

export type {
  CompactGameSkin,
  CompactGameSkinBase,
  CompactGameSkinPiece,
  CompactGameSkinProfile,
  GameSkinBackup,
  GameSkinBackupKind,
  GameSkinBackupReason,
} from "../../src/game-skins";

export type GameSkinBackupsResponse = {
  backups: GameSkinBackup[];
};
