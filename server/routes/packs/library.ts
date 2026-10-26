import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildPersonaRecipe } from '../../../src/persona-recipe.ts';
import { storage, within } from '../../../src/workspace-storage.ts';
import { HttpError, json } from '../../http.ts';
import { route } from '../../route.ts';
import { backupGameSkins } from './shared.ts';

const PNG_HEADERS = { 'Content-Type': 'image/png' };

function sceneResponse(scene: {
  name: string;
  identifier: string;
  geometry: unknown;
  skins: unknown;
  texture: Uint8Array;
}) {
  return json({
    name: scene.name,
    identifier: scene.identifier,
    geometry: scene.geometry,
    skins: scene.skins,
    texture: `data:image/png;base64,${Buffer.from(scene.texture).toString('base64')}`,
  });
}

export const libraryRoutes = [
  route('GET', '/api/packs', async ({ studio }) => {
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
  }),

  route('GET', '/api/packs/:id/scene', async ({ studio, params, url }) =>
    sceneResponse(
      await studio
        .requireManager()
        .scene(params.id!, Number(url.searchParams.get('skin') ?? 0)),
    ),
  ),

  route('GET', '/api/packs/:id/skins', async ({ studio, params }) =>
    json(await studio.requireManager().contents(params.id!)),
  ),

  route('GET', '/api/packs/:id/texture', async ({ studio, params, url }) =>
    new Response(
      (
        await studio
          .requireManager()
          .scene(params.id!, Number(url.searchParams.get('skin') ?? 0))
      ).texture as BodyInit,
      { headers: PNG_HEADERS },
    ),
  ),

  route('GET', '/api/preset-packs/:slot/skins', async ({ studio, params }) =>
    json(await studio.requireManager().presetContents(params.slot!)),
  ),

  route('GET', '/api/preset-packs/:slot/export', async ({
    studio,
    params,
    url,
  }) => {
    if (!studio.gameConfigured) throw Error('请先配置游戏 skin_packs 目录');
    const raw = url.searchParams.get('skins');
    const skins = raw
      ? raw
          .split(',')
          .filter(Boolean)
          .map((value) => {
            const index = Number(value);
            if (!Number.isInteger(index)) throw Error('请选择有效皮肤');
            return index;
          })
      : [];
    const result = await studio.requireManager().exportInstalled(
      params.slot!,
      skins,
      { name: url.searchParams.get('name') ?? '' },
    );
    const filename =
      result.name
        .replace(/[\\/:*?"<>|\x00-\x1f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80) || 'game-skin-pack';
    return new Response(result.bytes as BodyInit, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="game-skin-pack.zip"; filename*=UTF-8''${encodeURIComponent(filename + '.zip')}`,
        'Cache-Control': 'no-store',
      },
    });
  }),

  route('GET', '/api/preset-packs/:slot/texture', async ({
    studio,
    params,
    url,
  }) =>
    new Response(
      (
        await studio
          .requireManager()
          .presetScene(params.slot!, Number(url.searchParams.get('skin') ?? 0))
      ).texture as BodyInit,
      { headers: PNG_HEADERS },
    ),
  ),

  route('GET', '/api/preset-packs/:slot/scene', async ({
    studio,
    params,
    url,
  }) =>
    sceneResponse(
      await studio
        .requireManager()
        .presetScene(params.slot!, Number(url.searchParams.get('skin') ?? 0)),
    ),
  ),

  route('GET', '/api/packs/:id/source-image', async ({ studio, params }) => {
    const pack = (await studio.requireManager().list()).find(
      (item) => item.id === params.id,
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
  }),

  route('GET', '/api/packs/:id/download', async ({ studio, params }) => {
    const manager = studio.requireManager();
    const pack = (await manager.list()).find((item) => item.id === params.id);
    const folder = resolve(storage.cache, 'pack-exports', crypto.randomUUID());
    await mkdir(folder, { recursive: true });
    const output = resolve(folder, 'skin.zip');
    try {
      await manager.exportPack(params.id!, output);
      const stem = (pack?.name ?? '')
        .replace(/[\\/:*?"<>|\x00-\x1f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80) || '4d-skin';
      const ascii = stem.replace(/[^\x20-\x7e]/g, '-').trim() || '4d-skin';
      return new Response(new Uint8Array(await readFile(output)), {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${ascii}.zip"; filename*=UTF-8''${encodeURIComponent(stem + '.zip')}`,
        },
      });
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  }),

  route('POST', '/api/packs/create', async ({ studio, req }) => {
    const body = (await req.json()) as { name?: string };
    return json(
      await studio.requireManager().createPack(String(body.name ?? '')),
    );
  }),

  route('POST', '/api/packs/add-skins', async ({ studio, req }) => {
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
  }),

  route('POST', '/api/packs/import', async ({ studio, req }) => {
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
  }),

  route('POST', '/api/packs/remove-skin', async ({ studio, req }) => {
    const body = (await req.json()) as { id: string; skinIndex: number };
    return json(
      await studio.requireManager().removeSkin(body.id, body.skinIndex),
    );
  }),

  route('POST', '/api/packs/rename', async ({ studio, req }) => {
    const body = (await req.json()) as {
      id: string;
      name?: string;
      skinIndex?: number;
      skinName?: string;
    };
    return json(await studio.requireManager().renameNames(body.id, body));
  }),

  route('POST', '/api/packs/install', async ({ studio, req }) => {
    const manager = studio.requireManager();
    const body = (await req.json()) as {
      job?: string;
      label?: string;
      id?: string;
      slot?: string;
      target?: string;
    };
    const job = studio.jobs.get(body.job ?? '');
    if (!job || job.status !== 'done' || !job.files)
      throw new HttpError('转换结果不存在或尚未完成', 404);
    const label = String(body.label ?? '')
      .trim()
      .slice(0, 120);
    const target = String(body.target ?? '').trim();
    if (target) {
      // Save directly into the chosen pack: stage the conversion as a hidden
      // temporary pack, copy its only skin, then remove the staging pack so no
      // extra collection entry is left behind.
      const temp = 'pack-' + crypto.randomUUID();
      let result: unknown;
      try {
        const staged = await manager.importFiles(temp, job.files, ['texts'], {
          ...job.meta,
          versionName:
            label ||
            new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
        });
        if (label)
          await manager.renameNames(staged.id, {
            name: label,
            skinIndex: 0,
            skinName: label,
          });
        await manager.addSkins(target, temp, [0], { originPackId: target });
        const pack = (await manager.list()).find((item) => item.id === target);
        if (!pack) throw new HttpError('目标皮肤包不存在', 404);
        result = { pack, enabled: false };
      } finally {
        await manager.remove(temp).catch(() => {});
      }
      return json(result);
    }
    const pack = await manager.importFiles(
      String(
        body.id ?? 'skin-' + Date.now() + '-' + crypto.randomUUID().slice(0, 6),
      ),
      job.files,
      ['texts'],
      {
        ...job.meta,
        versionName:
          label ||
          new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
      },
    );
    if (label)
      await manager.renameNames(pack.id, {
        name: label,
        skinIndex: 0,
        skinName: label,
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
  }),

  route('POST', '/api/packs/delete', async ({ studio, req }) => {
    const body = (await req.json()) as { id?: string };
    return json(await studio.requireManager().remove(String(body.id ?? '')));
  }),
];
