import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildPersonaRecipe } from '../../../src/persona-recipe.ts';
import { storage, within } from '../../../src/workspace-storage.ts';
import { json } from '../../http.ts';
import type { Studio } from '../../studio.ts';
import { backupGameSkins } from './shared.ts';

export async function handleLibrary(
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

  if (url.pathname === '/api/packs/install' && req.method === 'POST') {
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
      throw Error('转换结果不存在或尚未完成');
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
          versionName: label || new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
        });
        if (label)
          await manager.renameNames(staged.id, {
            name: label,
            skinIndex: 0,
            skinName: label,
          });
        await manager.addSkins(target, temp, [0], { originPackId: target });
        const pack = (await manager.list()).find((item) => item.id === target);
        if (!pack) throw Error('目标皮肤包不存在');
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
          label || new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
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
  }

  if (url.pathname === '/api/packs/delete' && req.method === 'POST') {
    const body = (await req.json()) as { id?: string };
    return json(await studio.requireManager().remove(String(body.id ?? '')));
  }

  return null;
}
