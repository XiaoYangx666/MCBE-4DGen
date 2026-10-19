import { createHash, randomUUID } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  buildPersonaRecipe,
  type PersonaProfileRecipe,
  type PersonaRecipe,
} from './persona-recipe.ts';

export type GameSkinBackupKind = 'auto' | 'manual';

export type GameSkinBackupReason =
  | 'custom:enable'
  | 'custom:disable'
  | 'custom:restore'
  | 'custom:apply-update'
  | 'custom:edit'
  | 'manual';

export interface CompactGameSkinBase {
  arm?: string;
  csArm?: string;
  skinColor?: string;
  skin: boolean;
}

export interface CompactGameSkinPiece {
  id: string;
  colors?: string[];
}

export interface CompactGameSkinProfile {
  slot: string;
  kind: PersonaProfileRecipe['kind'];
  lastUsed: boolean;
  base: CompactGameSkinBase;
  pieces: CompactGameSkinPiece[];
}

/** Small, image-free snapshot of the five character-creator profiles. */
export interface CompactGameSkin {
  version: 1;
  lastUsedPersonaSlot: string | null;
  profiles: CompactGameSkinProfile[];
}

export interface GameSkinBackup extends CompactGameSkin {
  id: string;
  created: string;
  kind: GameSkinBackupKind;
  reason: GameSkinBackupReason;
  label?: string;
  /** Only present on the response of a skipped duplicate backup. */
  deduplicated?: boolean;
}

export interface GameSkinBackupOptions {
  skinPacksRoot: string;
  /** The workspace skins directory, normally `storage.skins`. */
  dataDir: string;
  kind: GameSkinBackupKind;
  reason: GameSkinBackupReason;
  label?: string;
  /** Overrides for tests or a non-default install. */
  appDataRoot?: string;
  userDir?: string;
  now?: Date;
}

const AUTO_BACKUP_LIMIT = 30;
const MANUAL_BACKUP_LIMIT = 100;

export function gameSkinBackupRoot(dataDir: string): string {
  return resolve(dataDir, 'game-skins', 'backups');
}

function compactBase(base: PersonaProfileRecipe['base']): CompactGameSkinBase {
  return {
    ...(base.arm ? { arm: base.arm } : {}),
    ...(base.csArm ? { csArm: base.csArm } : {}),
    ...(base.skinColor ? { skinColor: base.skinColor } : {}),
    skin: base.skin === true,
  };
}

/**
 * Keep only the data needed to recreate a character-creator recipe. Names,
 * thumbnails, matched casts and the raw appearance document are intentionally
 * dropped so a backup stays around one kilobyte.
 */
export function compactPersonaRecipe(recipe: PersonaRecipe): CompactGameSkin {
  return {
    version: 1,
    lastUsedPersonaSlot: recipe.source.lastUsedPersonaSlot,
    profiles: recipe.profiles.map((profile) => ({
      slot: profile.slot,
      kind: profile.kind,
      lastUsed: profile.lastUsed,
      base: compactBase(profile.base),
      pieces: profile.pieces.map((piece) => ({
        id: piece.id,
        ...(piece.colors?.length
          ? { colors: piece.colors.map(String) }
          : {}),
      })),
    })),
  };
}

function fingerprint(value: CompactGameSkin): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        lastUsedPersonaSlot: value.lastUsedPersonaSlot,
        profiles: value.profiles,
      }),
    )
    .digest('hex');
}

function backupPath(dataDir: string, id: string): string {
  if (!/^[a-z0-9-]+$/i.test(id)) throw Error('无效的备份 ID');
  return join(gameSkinBackupRoot(dataDir), id + '.json');
}

function isBackup(value: unknown): value is GameSkinBackup {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<GameSkinBackup>;
  return (
    typeof item.id === 'string' &&
    typeof item.created === 'string' &&
    (item.kind === 'auto' || item.kind === 'manual') &&
    typeof item.reason === 'string' &&
    Array.isArray(item.profiles)
  );
}

/** Newest first. Unreadable entries are ignored rather than breaking the UI. */
export async function listGameSkinBackups(
  dataDir: string,
): Promise<GameSkinBackup[]> {
  const root = gameSkinBackupRoot(dataDir);
  let entries: Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const backups: GameSkinBackup[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/^[a-z0-9-]+\.json$/i.test(entry.name)) continue;
    try {
      const value = JSON.parse(
        await readFile(join(root, entry.name), 'utf8'),
      ) as unknown;
      if (isBackup(value) && value.id + '.json' === entry.name)
        backups.push(value);
    } catch {
      /* skip malformed or half-written backups */
    }
  }
  return backups.sort(
    (a, b) =>
      b.created.localeCompare(a.created) || b.id.localeCompare(a.id),
  );
}

export async function readGameSkinBackup(
  dataDir: string,
  id: string,
): Promise<GameSkinBackup | null> {
  let text: string;
  try {
    text = await readFile(backupPath(dataDir, id), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  const value = JSON.parse(text) as unknown;
  return isBackup(value) ? value : null;
}

export async function deleteGameSkinBackup(
  dataDir: string,
  id: string,
): Promise<boolean> {
  const path = backupPath(dataDir, id);
  const backup = await readGameSkinBackup(dataDir, id);
  if (!backup) return false;
  await rm(path, { force: true });
  return true;
}

async function pruneGameSkinBackups(dataDir: string): Promise<void> {
  const root = gameSkinBackupRoot(dataDir);
  const backups = await listGameSkinBackups(dataDir);
  const excess = [
    ...backups.filter((item) => item.kind === 'auto').slice(AUTO_BACKUP_LIMIT),
    ...backups
      .filter((item) => item.kind === 'manual')
      .slice(MANUAL_BACKUP_LIMIT),
  ];
  await Promise.all(
    excess.map((item) => rm(join(root, item.id + '.json'), { force: true })),
  );
}

/**
 * Build a compact backup from the current `ud*.dat` profiles. An identical
 * newest snapshot is returned instead of writing a duplicate file.
 */
export async function createGameSkinBackup(
  options: GameSkinBackupOptions,
): Promise<GameSkinBackup> {
  const recipe = await buildPersonaRecipe({
    skinPacksRoot: options.skinPacksRoot,
    ...(options.appDataRoot ? { appDataRoot: options.appDataRoot } : {}),
    ...(options.userDir ? { userDir: options.userDir } : {}),
  });
  const compact = compactPersonaRecipe(recipe);
  const existing = await listGameSkinBackups(options.dataDir);
  const latest = existing[0];
  if (latest && fingerprint(latest) === fingerprint(compact))
    return { ...latest, deduplicated: true };

  const now = options.now ?? new Date();
  const id = `${now.getTime().toString(36)}-${randomUUID()
    .replace(/-/g, '')
    .slice(0, 8)}`;
  const label = options.label?.trim().slice(0, 120);
  const backup: GameSkinBackup = {
    version: 1,
    id,
    created: now.toISOString(),
    kind: options.kind,
    reason: options.reason,
    ...(label ? { label } : {}),
    lastUsedPersonaSlot: compact.lastUsedPersonaSlot,
    profiles: compact.profiles,
  };

  const root = gameSkinBackupRoot(options.dataDir);
  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, id + '.json'),
    JSON.stringify(backup, null, 2),
    'utf8',
  );
  await pruneGameSkinBackups(options.dataDir);
  return backup;
}
