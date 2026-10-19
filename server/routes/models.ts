import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import type { HumanoidProfile } from '../../src/humanoid.ts';
import { fileExists, fileResponse } from '../fs.ts';
import { json, withBusy } from '../http.ts';
import {
  listModels,
  removeModel,
  updateModel,
} from '../model-library.ts';
import type { EditSettings } from '../model-library.ts';
import { importLocal } from '../source-archive.ts';
import type { Studio } from '../studio.ts';

export async function handleModels(
  studio: Studio,
  req: Request,
  url: URL,
  parts: string[],
): Promise<Response | null> {
  if (url.pathname === '/api/models' && req.method === 'GET')
    return json(await listModels());

  if (url.pathname === '/api/models/update' && req.method === 'POST') {
    const body = (await req.json()) as {
      id: string;
      name?: string;
      settings?: EditSettings;
      packId?: string;
    };
    let packIds: string[] | undefined;
    if (body.packId) {
      if (
        !(await studio.requireManager().list()).some(
          (pack) => pack.id === body.packId,
        )
      )
        throw Error('皮肤版本不存在');
      const entries = await listModels();
      if (
        entries.some(
          (entry) =>
            entry.id !== body.id && entry.packIds?.includes(body.packId!),
        )
      )
        throw Error('该皮肤版本已关联其他模型');
      packIds = [
        ...new Set([
          ...(entries.find((entry) => entry.id === body.id)?.packIds ?? []),
          body.packId,
        ]),
      ];
    }
    return json(
      await updateModel(body.id, {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.settings ? { settings: body.settings } : {}),
        ...(packIds ? { packIds } : {}),
      }),
    );
  }

  if (url.pathname === '/api/models/relink' && req.method === 'POST') {
    const body = (await req.json()) as { id: string; path: string };
    return json(await updateModel(body.id, { path: body.path }));
  }

  if (url.pathname === '/api/models/delete' && req.method === 'POST') {
    const body = (await req.json()) as { id: string; deleteSource?: boolean };
    await removeModel(body.id, body.deleteSource === true);
    return json({ removed: true });
  }

  if (
    parts[0] === 'api' &&
    parts[1] === 'models' &&
    parts[3] === 'preview' &&
    req.method === 'GET'
  ) {
    const entry = (await listModels()).find((model) => model.id === parts[2]);
    if (!entry?.previewKey) throw Error('请先打开模型生成预览');
    return fileResponse(studio.previewCachePath(entry.previewKey), {
      headers: { 'Content-Type': 'model/gltf-binary' },
    });
  }

  if (
    (url.pathname === '/api/local-import' ||
      url.pathname === '/api/models/open') &&
    req.method === 'POST'
  )
    return withBusy(studio, async () => {
      const body = (await req.json()) as {
        path?: string;
        id?: string;
        main?: string;
      };
      const entry = body.id
        ? (await listModels()).find((model) => model.id === body.id)
        : null;
      if (body.id && !entry) throw Error('模型库条目不存在');
      const candidates = entry
        ? [entry.path]
        : await importLocal(String(body.path ?? ''));
      if (!candidates.length) throw Error('没有找到模型文件');
      if (candidates.length > 1 && !body.main)
        return json({ local: body.path, candidates });
      const main = body.main ?? candidates[0]!;
      if (!candidates.includes(main)) throw Error('请选择包内模型');
      return json(
        await studio.load(main, entry?.name ?? basename(main), null, {
          ...(entry?.id ? { existingId: entry.id } : {}),
        }),
      );
    });

  if (url.pathname === '/api/presets') {
    const available = [];
    for (const preset of studio.presets)
      if (await fileExists(resolve(studio.root, preset.path)))
        available.push({ id: preset.id, name: preset.name });
    return json(available);
  }

  if (url.pathname === '/api/load' && req.method === 'POST')
    return withBusy(studio, async () => {
      const body = (await req.json()) as { preset: string };
      const preset = studio.presets.find((item) => item.id === body.preset);
      if (!preset) throw Error('未知示例');
      return json(
        await studio.load(
          resolve(studio.root, preset.path),
          preset.name,
          JSON.parse(
            await readFile(resolve(studio.root, preset.profile), 'utf8'),
          ) as HumanoidProfile,
          { ...(preset.cache ? { cache: preset.cache } : {}) },
        ),
      );
    });

  if (parts[0] === 'api' && parts[1] === 'session' && parts[3] === 'preview') {
    const session = studio.sessions.get(parts[2]!);
    if (!session) throw Error('模型会话不存在');
    return new Response(session.preview as BodyInit, {
      headers: { 'Content-Type': 'model/gltf-binary' },
    });
  }

  return null;
}
