import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  createGameSkinBackup,
  deleteGameSkinBackup,
  listGameSkinBackups,
  readGameSkinBackup,
  type GameSkinBackupReason,
} from '../../src/game-skins.ts';
import {
  buildPersonaRecipe,
  exportPersonaRecipes,
  readDefaultCastIcon,
  readPersonaPieceThumbnail,
} from '../../src/persona-recipe.ts';
import { storage, within } from '../../src/workspace-storage.ts';
import { json } from '../http.ts';
import type { Studio } from '../studio.ts';

const GAME_REQUIRED_ROUTES = new Set([
  '/api/packs/enable',
  '/api/packs/disable',
  '/api/packs/restore',
  '/api/packs/recover',
  '/api/packs/apply-update',
]);

/**
 * Snapshot the character-creator profiles whenever the custom slot changes.
 * This is deliberately best-effort: a failed backup must never undo or block
 * the game operation that already succeeded.
 */
async function backupGameSkins(
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

export async function handlePacks(
  studio: Studio,
  req: Request,
  url: URL,
  parts: string[],
): Promise<Response | null> {
  if (url.pathname === '/api/packs') {
    if (!studio.manager)
      return json({
        configured: false,
        configPath: studio.managerConfigPath,
        error: studio.managerError,
      });
    const manager = studio.manager;
    const [status, library] = await Promise.all([
      studio.gameConfigured ? manager.status() : Promise.resolve([]),
      manager.ensureStats(),
    ]);
    let persona: unknown = null;
    let personaError = '';
    if (studio.gameConfigured) {
      try {
        persona = await buildPersonaRecipe({
          skinPacksRoot: manager.config.skinPacksRoot,
        });
      } catch (error) {
        personaError = error instanceof Error ? error.message : String(error);
      }
    }
    return json({
      configured: true,
      gameConfigured: studio.gameConfigured,
      ...(studio.gameConfigured ? {} : { gameError: studio.managerError }),
      configPath: studio.managerConfigPath,
      root: manager.config.skinPacksRoot,
      stateDir: manager.config.stateDir,
      slots: studio.gameConfigured ? manager.config.slots : {},
      status,
      library: library.sort((a, b) => b.imported.localeCompare(a.imported)),
      ...(persona ? { persona } : {}),
      ...(personaError ? { personaError } : {}),
    });
  }

  if (
    url.pathname === '/api/persona/marketplace-icon' &&
    req.method === 'GET'
  ) {
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
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=31536000',
        },
      });
    } catch {
      /* cache miss */
    }
    const response = await fetch(target.href);
    if (!response.ok) return new Response('Not found', { status: 404 });
    const bytes = new Uint8Array(await response.arrayBuffer());
    await mkdir(dir, { recursive: true });
    await writeFile(file, bytes);
    return new Response(bytes, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=31536000',
      },
    });
  }

  if (
    url.pathname === '/api/persona/piece-icon' &&
    req.method === 'GET'
  ) {
    if (!studio.gameConfigured) throw Error('请先配置游戏 skin_packs 目录');
    const icon = await readPersonaPieceThumbnail(
      studio.requireManager().config.skinPacksRoot,
      url.searchParams.get('name') ?? '',
    );
    if (!icon) return new Response('Not found', { status: 404 });
    return new Response(icon as BodyInit, {
      headers: { 'Content-Type': 'image/png' },
    });
  }

  if (
    url.pathname === '/api/persona/icon' &&
    req.method === 'GET'
  ) {
    if (!studio.gameConfigured) throw Error('请先配置游戏 skin_packs 目录');
    const icon = await readDefaultCastIcon(
      studio.requireManager().config.skinPacksRoot,
      url.searchParams.get('cast') ?? '',
    );
    if (!icon) return new Response('Not found', { status: 404 });
    return new Response(icon as BodyInit, {
      headers: { 'Content-Type': 'image/png' },
    });
  }

  if (
    parts[0] === 'api' &&
    parts[1] === 'packs' &&
    parts[3] === 'icon' &&
    req.method === 'GET'
  ) {
    const icon = await studio.requireManager().icon(parts[2]!);
    if (!icon) return new Response('Not found', { status: 404 });
    return new Response(icon as BodyInit, {
      headers: { 'Content-Type': 'image/png' },
    });
  }

  if (
    parts[0] === 'api' &&
    parts[1] === 'packs' &&
    parts[3] === 'scene' &&
    req.method === 'GET'
  ) {
    const scene = await studio
      .requireManager()
      .scene(parts[2]!, Number(url.searchParams.get('skin') ?? 0));
    return json({
      name: scene.name,
      identifier: scene.identifier,
      geometry: scene.geometry,
      skins: scene.skins,
      texture: `data:image/png;base64,${Buffer.from(scene.texture).toString('base64')}`,
    });
  }

  if (
    parts[0] === 'api' &&
    parts[1] === 'packs' &&
    parts[3] === 'skins' &&
    req.method === 'GET'
  )
    return json(await studio.requireManager().contents(parts[2]!));

  if (
    parts[0] === 'api' &&
    parts[1] === 'packs' &&
    parts[3] === 'texture' &&
    req.method === 'GET'
  ) {
    const scene = await studio
      .requireManager()
      .scene(parts[2]!, Number(url.searchParams.get('skin') ?? 0));
    return new Response(scene.texture as BodyInit, {
      headers: { 'Content-Type': 'image/png' },
    });
  }

  if (
    parts[0] === 'api' &&
    parts[1] === 'preset-packs' &&
    req.method === 'GET'
  ) {
    const manager = studio.requireManager();
    const slot = parts[2]!;
    if (parts[3] === 'skins') return json(await manager.presetContents(slot));
    const scene = await manager.presetScene(
      slot,
      Number(url.searchParams.get('skin') ?? 0),
    );
    if (parts[3] === 'texture')
      return new Response(scene.texture as BodyInit, {
        headers: { 'Content-Type': 'image/png' },
      });
    if (parts[3] === 'scene')
      return json({
        ...scene,
        texture: `data:image/png;base64,${Buffer.from(scene.texture).toString('base64')}`,
      });
  }

  if (
    parts[0] === 'api' &&
    parts[1] === 'packs' &&
    parts[3] === 'source-image' &&
    req.method === 'GET'
  ) {
    const pack = (await studio.requireManager().list()).find(
      (item) => item.id === parts[2],
    );
    const source = pack?.meta?.source;
    if (
      pack?.meta?.template !== 'image' ||
      typeof source !== 'string' ||
      !within(storage.sources, source)
    )
      throw Error('没有可编辑的模板源图片');
    return new Response(new Uint8Array(await readFile(source)), {
      headers: { 'Content-Type': pack.meta?.sourceMime ?? 'image/png' },
    });
  }

  if (
    parts[0] === 'api' &&
    parts[1] === 'packs' &&
    parts[3] === 'download' &&
    req.method === 'GET'
  ) {
    const folder = resolve(storage.cache, 'pack-exports', crypto.randomUUID());
    await mkdir(folder, { recursive: true });
    const output = resolve(folder, 'skin.zip');
    try {
      await studio.requireManager().exportPack(parts[2]!, output);
      return new Response(new Uint8Array(await readFile(output)), {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': 'attachment; filename="skin.zip"',
        },
      });
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  }

  if (url.pathname === '/api/persona/export' && req.method === 'POST') {
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
  }

  if (url.pathname === '/api/persona/backup' && req.method === 'POST') {
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
  }

  if (url.pathname === '/api/persona/backups' && req.method === 'GET')
    return json({ backups: await listGameSkinBackups(storage.skins) });

  if (
    parts[0] === 'api' &&
    parts[1] === 'persona' &&
    parts[2] === 'backups' &&
    parts.length === 4 &&
    req.method === 'GET'
  ) {
    const id = parts[3]!;
    const backup = await readGameSkinBackup(storage.skins, id);
    if (!backup) return new Response('Not found', { status: 404 });
    return new Response(JSON.stringify(backup, null, 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="game-skins-${id}.json"`,
      },
    });
  }

  if (
    url.pathname === '/api/persona/backups/delete' &&
    req.method === 'POST'
  ) {
    const body = (await req.json()) as { id?: string };
    const id = String(body.id ?? '');
    return json({ id, deleted: await deleteGameSkinBackup(storage.skins, id) });
  }

  if (
    parts[0] === 'api' &&
    parts[1] === 'persona' &&
    parts[2] === 'backups' &&
    parts.length === 4 &&
    req.method === 'DELETE'
  ) {
    const id = parts[3]!;
    return json({ id, deleted: await deleteGameSkinBackup(storage.skins, id) });
  }

  if (url.pathname === '/api/packs/create' && req.method === 'POST') {
    const body = (await req.json()) as { name?: string };
    return json(
      await studio.requireManager().createPack(String(body.name ?? '')),
    );
  }

  if (url.pathname === '/api/packs/add-skins' && req.method === 'POST') {
    const body = (await req.json()) as {
      target: string;
      source: string;
      indices: number[];
    };
    if (!Array.isArray(body.indices)) throw Error('请选择皮肤');
    return json(
      await studio
        .requireManager()
        .addSkins(body.target, body.source, body.indices),
    );
  }

  if (url.pathname === '/api/packs/import' && req.method === 'POST') {
    const manager = studio.requireManager();
    const id = 'pack-' + crypto.randomUUID();
    if (req.headers.get('content-type')?.includes('application/json')) {
      const body = (await req.json()) as { path?: string };
      const path = String(body.path ?? '');
      if (!/^(?:[a-z]:[\\/]|\/)/i.test(path)) throw Error('请输入本地绝对路径');
      return json(await manager.importPack(id, path));
    }
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File) || !/\.(mcpack|zip)$/i.test(file.name))
      throw Error('请选择 .mcpack 或皮肤包 ZIP');
    const folder = resolve(storage.cache, 'pack-imports');
    await mkdir(folder, { recursive: true });
    const path = resolve(folder, id + '.mcpack');
    try {
      await writeFile(path, new Uint8Array(await file.arrayBuffer()), {
        flag: 'wx',
      });
      return json(await manager.importPack(id, path));
    } finally {
      await rm(path, { force: true });
    }
  }

  if (url.pathname === '/api/packs/remove-skin' && req.method === 'POST') {
    const body = (await req.json()) as { id: string; skinIndex: number };
    return json(
      await studio.requireManager().removeSkin(body.id, body.skinIndex),
    );
  }

  if (url.pathname === '/api/packs/rename' && req.method === 'POST') {
    const body = (await req.json()) as {
      id: string;
      name?: string;
      skinIndex?: number;
      skinName?: string;
    };
    return json(await studio.requireManager().renameNames(body.id, body));
  }

  if (url.pathname === '/api/packs/apply-update' && req.method === 'POST') {
    if (!studio.gameConfigured) throw Error('请先配置游戏目录');
    const body = (await req.json()) as { id: string; slot: string };
    const result = await studio
      .requireManager()
      .updateEnabled(body.slot, body.id);
    if (body.slot === 'custom')
      await backupGameSkins(studio, 'custom:apply-update');
    return json(result);
  }

  if (url.pathname === '/api/packs/install' && req.method === 'POST') {
    const manager = studio.requireManager();
    const body = (await req.json()) as {
      job?: string;
      label?: string;
      id?: string;
      slot?: string;
    };
    const job = studio.jobs.get(body.job ?? '');
    if (!job || job.status !== 'done' || !job.files)
      throw Error('转换结果不存在或尚未完成');
    const pack = await manager.importFiles(
      String(
        body.id ?? 'skin-' + Date.now() + '-' + crypto.randomUUID().slice(0, 6),
      ),
      job.files,
      ['texts'],
      {
        ...job.meta,
        versionName:
          String(body.label ?? '')
            .trim()
            .slice(0, 120) ||
          new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
      },
    );
    if (body.label?.trim())
      await manager.renameNames(pack.id, {
        name: body.label.trim().slice(0, 120),
        skinIndex: 0,
        skinName: body.label.trim().slice(0, 120),
      });
    if (!body.slot || !studio.gameConfigured)
      return json({ pack, enabled: false });
    try {
      await manager.enable(body.slot, pack.id);
      if (body.slot === 'custom')
        await backupGameSkins(studio, 'custom:enable');
      return json({ pack, enabled: true });
    } catch (error) {
      return json({
        pack,
        enabled: false,
        warning: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (GAME_REQUIRED_ROUTES.has(url.pathname) && !studio.gameConfigured)
    throw Error('请先配置游戏 skin_packs 目录；本地保存和导出仍可使用');

  if (url.pathname === '/api/packs/edit-installed' && req.method === 'POST') {
    const body = (await req.json()) as {
      slot: string;
      name?: string;
      skinIndex?: number;
      skinName?: string;
      remove?: boolean;
      revision?: string;
    };
    const result = await studio
      .requireManager()
      .editInstalled(String(body.slot ?? ''), body);
    if (body.slot === 'custom') await backupGameSkins(studio, 'custom:edit');
    return json(result);
  }

  if (url.pathname === '/api/packs/enable' && req.method === 'POST') {
    const body = (await req.json()) as { slot?: string; id?: string };
    const manager = studio.requireManager();
    const slot = String(body.slot ?? '');
    const result = await manager.enable(slot, String(body.id ?? ''));
    await manager.pruneBackups(slot).catch(() => {});
    if (slot === 'custom') await backupGameSkins(studio, 'custom:enable');
    return json(result);
  }

  if (url.pathname === '/api/packs/disable' && req.method === 'POST') {
    const body = (await req.json()) as { slot?: string; id?: string };
    const manager = studio.requireManager();
    const slot = String(body.slot ?? '');
    const result = await manager.disable(slot, String(body.id ?? ''));
    await manager.pruneBackups(slot).catch(() => {});
    if (slot === 'custom') await backupGameSkins(studio, 'custom:disable');
    return json(result);
  }

  if (url.pathname === '/api/packs/restore' && req.method === 'POST') {
    const body = (await req.json()) as { slot?: string };
    const manager = studio.requireManager();
    const slot = String(body.slot ?? '');
    const result = await manager.restore(slot);
    await manager.pruneBackups(slot).catch(() => {});
    if (slot === 'custom') await backupGameSkins(studio, 'custom:restore');
    return json(result);
  }

  if (url.pathname === '/api/packs/recover' && req.method === 'POST') {
    const body = (await req.json()) as { slot?: string };
    return json(await studio.requireManager().recover(String(body.slot ?? '')));
  }

  if (url.pathname === '/api/packs/delete' && req.method === 'POST') {
    const body = (await req.json()) as { id?: string };
    return json(await studio.requireManager().remove(String(body.id ?? '')));
  }

  return null;
}
