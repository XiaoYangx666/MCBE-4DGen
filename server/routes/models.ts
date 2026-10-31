import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import type { HumanoidProfile } from '../../src/humanoid.ts';
import { fileExists, fileResponse } from '../fs.ts';
import { HttpError, json, withBusy } from '../http.ts';
import {
  listModels,
  removeModel,
  updateModel,
} from '../model-library.ts';
import type { EditSettings } from '../model-library.ts';
import { route, type RouteContext } from '../route.ts';
import { importLocal } from '../source-archive.ts';

export const modelRoutes = [
  route('GET', '/api/models', async () => json(await listModels())),

  route('GET', '/api/activity', async ({ studio }) =>
    json({ activity: studio.activity }),
  ),

  route('POST', '/api/models/update', async ({ studio, req }) => {
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
  }),

  route('POST', '/api/models/relink', async ({ req }) => {
    const body = (await req.json()) as { id: string; path: string };
    return json(await updateModel(body.id, { path: body.path }));
  }),

  route('POST', '/api/models/delete', async ({ req }) => {
    const body = (await req.json()) as { id: string; deleteSource?: boolean };
    await removeModel(body.id, body.deleteSource === true);
    return json({ removed: true });
  }),

  route('GET', '/api/models/:id/preview', async ({ studio, params }) => {
    const entry = (await listModels()).find((model) => model.id === params.id);
    if (!entry?.previewKey) throw Error('请先打开模型生成预览');
    return fileResponse(studio.previewCachePath(entry.previewKey), {
      headers: { 'Content-Type': 'model/gltf-binary' },
    });
  }),

  route('POST', '/api/local-import', openModel),
  route('POST', '/api/models/open', openModel),

  route('*', '/api/presets', async ({ studio }) => {
    const available = [];
    for (const preset of studio.presets)
      if (await fileExists(resolve(studio.root, preset.path)))
        available.push({ id: preset.id, name: preset.name });
    return json(available);
  }),

  route('POST', '/api/load', ({ studio, req }) =>
    withBusy(studio, async () => {
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
    }),
  ),

  route('GET', '/api/session/:id/preview', async ({ studio, params }) => {
    const session = studio.sessions.get(params.id!);
    if (!session) throw new HttpError('模型会话不存在', 404);
    return new Response(session.preview as BodyInit, {
      headers: { 'Content-Type': 'model/gltf-binary' },
    });
  }),

  /** Release an idle workbench session so its model and previews leave memory. */
  route('DELETE', '/api/session/:id', async ({ studio, params }) => {
    studio.releaseSession(params.id!);
    return json({ ok: true });
  }),
];

async function openModel({ studio, req }: RouteContext) {
  return withBusy(studio, async () => {
    const body = (await req.json()) as {
      path?: string;
      id?: string;
      main?: string;
    };
    const entry = body.id
      ? (await listModels()).find((model) => model.id === body.id)
      : null;
    if (body.id && !entry) throw new HttpError('模型库条目不存在', 404);
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
}
