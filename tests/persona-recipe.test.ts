import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildPersonaRecipe, exportPersonaRecipes } from '../src/persona-recipe.ts';

const roots: string[] = [];

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), '4dgen-persona-'));
  roots.push(root);
  const user = join(root, 'user');
  const definitions = join(root, 'definitions', 'persona');
  const skinPacks = join(root, 'skin_packs');
  await mkdir(user, { recursive: true });
  await mkdir(definitions, { recursive: true });
  await mkdir(skinPacks, { recursive: true });
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
            { arm: 'wide', cs_arm: 'wide', skcol: '#ffb37b62', skin: false },
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
  await writeFile(join(user, 'ud123.dat'), '\uFEFF' + JSON.stringify(ud));
  await writeFile(
    join(definitions, '01_Test_Dcast.json'),
    JSON.stringify({
      name: 'persona.test_name.title',
      uuid: '00000000-0000-0000-0000-000000000001',
      appearance: [
        { arm: 'wide', cs_arm: 'wide', skcol: '#ffb37b62', skin: false },
        { id: 'piece-a/d', col: ['#ff000000'] },
      ],
    }),
  );
  return { root, user, skinPacks, output: join(root, 'out') };
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('persona recipe export', () => {
  it('exports all profiles with the last-used slot and a matched cast', async () => {
    const f = await fixture();
    const result = await exportPersonaRecipes({
      skinPacksRoot: f.skinPacks,
      outputDir: f.output,
      userDir: f.user,
    });
    const saved = JSON.parse(await readFile(result.path, 'utf8'));
    expect(saved.source.lastUsedPersonaSlot).toBe('persona_profile_persona2');
    expect(saved.profiles).toHaveLength(2);
    expect(saved.profiles[0]).toMatchObject({
      slot: 'personaProfile1',
      kind: 'persona',
      lastUsed: false,
      base: { arm: 'wide', skinColor: '#ffb37b62', skin: false },
    });
    expect(saved.profiles[0].pieces[0]).toMatchObject({
      id: 'piece-a/d',
      colors: ['#ff000000'],
    });
    expect(saved.profiles[0].matchedCast).toMatchObject({
      file: '01_Test_Dcast.json',
      exact: true,
      score: 1,
    });
    expect(saved.profiles[1]).toMatchObject({
      slot: 'personaProfile2',
      lastUsed: true,
      base: { arm: 'slim', skinColor: '#ffffffff' },
    });
  });

  it('builds a minimal recipe for backups without decoration lookups', async () => {
    const f = await fixture();
    const recipe = await buildPersonaRecipe({
      skinPacksRoot: f.skinPacks,
      userDir: f.user,
      minimal: true,
    });

    expect(recipe.profiles[0]).toMatchObject({
      slot: 'personaProfile1',
      kind: 'persona',
      pieces: [{ id: 'piece-a/d', colors: ['#ff000000'] }],
      matchedCast: null,
    });
    expect(recipe.profiles[0]?.pieces[0]).not.toHaveProperty('name');
    expect(recipe.profiles[0]?.pieces[0]).not.toHaveProperty('type');
  });
});
