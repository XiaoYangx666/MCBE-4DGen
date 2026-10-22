import {
  createGameSkinBackup,
  type GameSkinBackupReason,
} from '../../../src/game-skins.ts';
import { storage } from '../../../src/workspace-storage.ts';
import type { Studio } from '../../studio.ts';

/**
 * Snapshot the character-creator profiles whenever the custom slot changes.
 * This is deliberately best-effort: a failed backup must never undo or block
 * the game operation that already succeeded.
 */
export async function backupGameSkins(
  studio: Studio,
  reason: GameSkinBackupReason,
): Promise<void> {
  if (!studio.gameConfigured) return;
  try {
    const manager = studio.requireManager();
    await createGameSkinBackup({
      skinPacksRoot: manager.config.skinPacksRoot,
      dataDir: storage.skins,
      kind: 'auto',
      reason,
    });
  } catch (error) {
    console.warn(
      '游戏皮肤自动备份失败：',
      error instanceof Error ? error.message : String(error),
    );
  }
}
