import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  compactPersonaRecipe,
  createGameSkinBackup,
  deleteGameSkinBackup,
  gameSkinBackupRoot,
  listGameSkinBackups,
  readGameSkinBackup,
  type GameSkinBackupReason,
} from '../src/game-skins.ts';
import type { PersonaRecipe } from '../src/persona-recipe.ts';

const roots: string[] = [];

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), '4dgen-game-skins-'));
  roots.push(root);
  const user = join(root, 'user');
  const skinPacks = join(root, 'skin_packs');
  const dataDir = join(root, 'data', 'skins');
  await mkdir(user, { recursive: true });
  await mkdir(skinPacks, { recursive: true });
  await mkdir(dataDir, { recursive: true });
  await writeUd(user, '#ffb37b62');
  return { root, user, skinPacks, dataDir };
}

async function writeUd(user: string, skinColor: string) {
  const ud = {
    Synchronized: {
      personaProfile: {
        personaCollection: {
          universalApp: [{ lastUsedPersonaSlot: 'persona_profile_persona2' }],
        },
      },
      personaProfile1: {
        personaCollection: {
          universalApp: [
            { arm: 'wide', cs_arm: 'wide', skcol: skinColor, skin: false },
            { id: 'piece-a/d', col: ['#ff000000'] },
          ],
        },
      },
      personaProfile2: {
        personaCollection: {
          universalApp: [
            { arm: 'slim', cs_arm: 'slim', skcol: '#ffffffff', skin: false },
            { id: 'piece-b/d' },
          ],
        },
      },
    },
  };
  await writeFile(join(user, 'ud123.dat'), JSON.stringify(ud));
}

function backupOptions(
  f: Awaited<ReturnType<typeof fixture>>,
  extra: {
    kind: 'auto' | 'manual';
    reason: GameSkinBackupReason;
    now?: Date;
  },
) {
  return {
    skinPacksRoot: f.skinPacks,
    dataDir: f.dataDir,
    appDataRoot: f.root,
    userDir: f.user,
    ...extra,
  };
}

afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

describe('compact game skin backups', () => {
  it('drops raw appearance, names, thumbnails and matched casts', () => {
    const recipe: PersonaRecipe = {
      version: 1,
      exportedAt: '2026-01-01T00:00:00.000Z',
      gameRunning: false,
      source: {
        userDir: 'C:/user',
        ud: 'C:/user/ud1.dat',
        modified: '2026-01-01T00:00:00.000Z',
        lastUsedPersonaSlot: 'persona_profile_persona2',
      },
      profiles: [
        {
          slot: 'personaProfile1',
          kind: 'persona',
          lastUsed: false,
          base: {
            arm: 'wide',
            csArm: 'wide',
            skinColor: '#ffb37b62',
            skin: false,
          },
          pieces: [
            {
              id: 'piece-a/d',
              colors: ['#ff000000'],
              name: 'Hair',
              type: 'persona_hair',
              thumbnail: 'hair.png',
              thumbnailUrl: 'https://example.invalid/hair.png',
            },
          ],
          matchedCast: {
            file: '01_Test_Dcast.json',
            name: 'persona.test_name.title',
            score: 1,
            exact: true,
          },
          rawAppearance: [{ id: 'piece-a/d', col: ['#ff000000'] }],
        },
      ],
    };

    const compact = compactPersonaRecipe(recipe);
    expect(compact).toEqual({
      version: 1,
      lastUsedPersonaSlot: 'persona_profile_persona2',
      profiles: [
        {
          slot: 'personaProfile1',
          kind: 'persona',
          lastUsed: false,
          base: {
            arm: 'wide',
            csArm: 'wide',
            skinColor: '#ffb37b62',
            skin: false,
          },
          pieces: [{ id: 'piece-a/d', colors: ['#ff000000'] }],
        },
      ],
    });
    const text = JSON.stringify(compact);
    expect(text).not.toContain('rawAppearance');
    expect(text).not.toContain('thumbnail');
    expect(text).not.toContain('matchedCast');
    expect(text).not.toContain('Hair');
    expect(text).not.toContain('persona.test_name.title');
  });

  it('creates a compact file and skips an identical backup', async () => {
    const f = await fixture();
    const first = await createGameSkinBackup(
      backupOptions(f, {
        kind: 'auto',
        reason: 'custom:enable',
        now: new Date(Date.UTC(2026, 0, 1, 0, 0, 0)),
      }),
    );
    expect(first).toMatchObject({
      version: 1,
      kind: 'auto',
      reason: 'custom:enable',
      lastUsedPersonaSlot: 'persona_profile_persona2',
    });
    expect(first.profiles).toHaveLength(2);
    expect(first.profiles[0]?.pieces).toEqual([
      { id: 'piece-a/d', colors: ['#ff000000'] },
    ]);

    const saved = JSON.parse(
      await readFile(
        join(gameSkinBackupRoot(f.dataDir), first.id + '.json'),
        'utf8',
      ),
    );
    expect(saved).toEqual(first);

    const second = await createGameSkinBackup(
      backupOptions(f, {
        kind: 'auto',
        reason: 'custom:disable',
        now: new Date(Date.UTC(2026, 0, 1, 0, 0, 5)),
      }),
    );
    expect(second.id).toBe(first.id);
    expect(second.deduplicated).toBe(true);
    expect(await listGameSkinBackups(f.dataDir)).toHaveLength(1);
  });

  it('keeps the newest 10 backups in total', async () => {
    const f = await fixture();
    await writeUd(f.user, '#aaaaaaa1');
    const manual = await createGameSkinBackup(
      backupOptions(f, {
        kind: 'manual',
        reason: 'manual',
        now: new Date(Date.UTC(2026, 0, 1, 0, 0, 0)),
      }),
    );

    const created: string[] = [];
    for (let index = 0; index < 12; index++) {
      await writeUd(f.user, `#ff0000${index.toString(16).padStart(2, '0')}`);
      const backup = await createGameSkinBackup(
        backupOptions(f, {
          kind: 'auto',
          reason: 'custom:edit',
          now: new Date(Date.UTC(2026, 0, 1, 0, 0, index + 1)),
        }),
      );
      created.push(backup.id);
    }

    const list = await listGameSkinBackups(f.dataDir);
    expect(list).toHaveLength(10);
    expect(list.filter((item) => item.kind === 'auto')).toHaveLength(10);
    expect(list.map((item) => item.id)).toEqual(created.slice(2).reverse());
    expect(list.some((item) => item.id === manual.id)).toBe(false);
    const files = await readdir(gameSkinBackupRoot(f.dataDir));
    expect(files).toHaveLength(10);
  });

  it('lists newest first, reads and deletes backups', async () => {
    const f = await fixture();
    const first = await createGameSkinBackup(
      backupOptions(f, {
        kind: 'auto',
        reason: 'custom:enable',
        now: new Date(Date.UTC(2026, 0, 1, 0, 0, 0)),
      }),
    );
    await writeUd(f.user, '#11111111');
    const second = await createGameSkinBackup(
      backupOptions(f, {
        kind: 'manual',
        reason: 'manual',
        now: new Date(Date.UTC(2026, 0, 1, 0, 0, 1)),
      }),
    );

    expect((await listGameSkinBackups(f.dataDir)).map((item) => item.id)).toEqual(
      [second.id, first.id],
    );
    expect(await readGameSkinBackup(f.dataDir, first.id)).toMatchObject({
      id: first.id,
      kind: 'auto',
    });
    expect(await readGameSkinBackup(f.dataDir, 'missing')).toBeNull();

    expect(await deleteGameSkinBackup(f.dataDir, first.id)).toBe(true);
    expect(await readGameSkinBackup(f.dataDir, first.id)).toBeNull();
    expect(await deleteGameSkinBackup(f.dataDir, first.id)).toBe(false);
    expect(await listGameSkinBackups(f.dataDir)).toHaveLength(1);
  });
});
