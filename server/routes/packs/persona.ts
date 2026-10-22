import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  createGameSkinBackup,
  deleteGameSkinBackup,
  listGameSkinBackups,
  readGameSkinBackup,
} from '../../../src/game-skins.ts';
import {
  exportPersonaRecipes,
  readDefaultCastIcon,
  readPersonaPieceThumbnail,
} from '../../../src/persona-recipe.ts';
import { storage } from '../../../src/workspace-storage.ts';
import { json } from '../../http.ts';
import { route } from '../../route.ts';

const PNG_CACHE_HEADERS = {
  'Content-Type': 'image/png',
  'Cache-Control': 'public, max-age=31536000',
};

export const personaRoutes = [
  route('GET', '/api/persona/marketplace-icon', async ({ url }) => {
    const raw = url.searchParams.get('url') ?? '';
    let target: URL;
    try {
      target = new URL(raw);
    } catch {
      throw Error('无效的图标地址');
    }
    if (
      target.protocol !== 'https:' ||
      !/^xforgeassets\d*\.xboxlive\.com$/i.test(target.hostname) ||
      !/\.png$/i.test(target.pathname)
    )
      throw Error('不支持的图标地址');
    const dir = resolve(storage.skins, 'cache', 'marketplace-icons');
    const file = resolve(
      dir,
      createHash('sha256').update(target.href).digest('hex') + '.png',
    );
    try {
      const cached = await readFile(file);
      return new Response(new Uint8Array(cached), {
        headers: PNG_CACHE_HEADERS,
      });
    } catch {
      /* cache miss */
    }
    const response = await fetch(target.href);
    if (!response.ok) return new Response('Not found', { status: 404 });
    const bytes = new Uint8Array(await response.arrayBuffer());
    await mkdir(dir, { recursive: true });
    await writeFile(file, bytes);
    return new Response(bytes, { headers: PNG_CACHE_HEADERS });
  }),

  route('GET', '/api/persona/piece-icon', async ({ studio, url }) => {
    if (!studio.gameConfigured) throw Error('请先配置游戏 skin_packs 目录');
    const icon = await readPersonaPieceThumbnail(
      studio.requireManager().config.skinPacksRoot,
      url.searchParams.get('name') ?? '',
    );
    if (!icon) return new Response('Not found', { status: 404 });
    return new Response(icon as BodyInit, {
      headers: { 'Content-Type': 'image/png' },
    });
  }),

  route('GET', '/api/persona/icon', async ({ studio, url }) => {
    if (!studio.gameConfigured) throw Error('请先配置游戏 skin_packs 目录');
    const icon = await readDefaultCastIcon(
      studio.requireManager().config.skinPacksRoot,
      url.searchParams.get('cast') ?? '',
    );
    if (!icon) return new Response('Not found', { status: 404 });
    return new Response(icon as BodyInit, {
      headers: { 'Content-Type': 'image/png' },
    });
  }),

  route('GET', '/api/packs/:id/icon', async ({ studio, params }) => {
    const icon = await studio.requireManager().icon(params.id!);
    if (!icon) return new Response('Not found', { status: 404 });
    return new Response(icon as BodyInit, {
      headers: { 'Content-Type': 'image/png' },
    });
  }),

  route('POST', '/api/persona/export', async ({ studio }) => {
    if (!studio.gameConfigured) throw Error('请先配置游戏 skin_packs 目录');
    const manager = studio.requireManager();
    const result = await exportPersonaRecipes({
      skinPacksRoot: manager.config.skinPacksRoot,
      outputDir: resolve(storage.skins, 'exports'),
    });
    return json({
      path: result.path,
      profiles: result.recipe.profiles.length,
      gameRunning: result.recipe.gameRunning,
      lastUsedPersonaSlot: result.recipe.source.lastUsedPersonaSlot,
    });
  }),

  route('POST', '/api/persona/backup', async ({ studio, req }) => {
    if (!studio.gameConfigured) throw Error('请先配置游戏 skin_packs 目录');
    const body = (await req.json().catch(() => ({}))) as { label?: string };
    const manager = studio.requireManager();
    return json(
      await createGameSkinBackup({
        skinPacksRoot: manager.config.skinPacksRoot,
        dataDir: storage.skins,
        kind: 'manual',
        reason: 'manual',
        ...(body.label?.trim() ? { label: body.label.trim() } : {}),
      }),
    );
  }),

  route('GET', '/api/persona/backups', async () =>
    json({ backups: await listGameSkinBackups(storage.skins) }),
  ),

  route('GET', '/api/persona/backups/:id', async ({ params }) => {
    const backup = await readGameSkinBackup(storage.skins, params.id!);
    if (!backup) return new Response('Not found', { status: 404 });
    return new Response(JSON.stringify(backup, null, 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="game-skins-${params.id}.json"`,
      },
    });
  }),

  route('POST', '/api/persona/backups/delete', async ({ req }) => {
    const body = (await req.json()) as { id?: string };
    const id = String(body.id ?? '');
    return json({ id, deleted: await deleteGameSkinBackup(storage.skins, id) });
  }),

  route('DELETE', '/api/persona/backups/:id', async ({ params }) => {
    const id = params.id!;
    return json({ id, deleted: await deleteGameSkinBackup(storage.skins, id) });
  }),
];
