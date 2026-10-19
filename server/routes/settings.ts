import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  dataRoot,
  requestStorageLocation,
  storage,
} from '../../src/workspace-storage.ts';
import { json } from '../http.ts';
import type { Studio } from '../studio.ts';
import { storageUsage } from '../storage-usage.ts';

export async function handleSettings(
  studio: Studio,
  req: Request,
  url: URL,
): Promise<Response | null> {
  if (url.pathname === '/api/settings/storage-usage' && req.method === 'GET')
    return json(await storageUsage(dataRoot));

  if (url.pathname === '/api/settings' && req.method === 'GET') {
    const stored = await readFile(
      resolve(
        process.env.FOURDGEN_CONFIG_DIR ?? studio.root,
        'storage.local.json',
      ),
      'utf8',
    )
      .then(
        (value) =>
          JSON.parse(value) as { dataDir?: string; migrateFrom?: string },
      )
      .catch(() => null);
    return json({
      dataRoot,
      gameRoot: studio.gameConfigured
        ? studio.requireManager().config.skinPacksRoot
        : '',
      environment: !!process.env.FOURDGEN_DATA_DIR,
      pendingDataRoot: stored?.migrateFrom ? (stored.dataDir ?? null) : null,
      gameConfigured: studio.gameConfigured,
      managerError: studio.managerError,
    });
  }

  if (
    url.pathname === '/api/settings/game-directory' &&
    req.method === 'POST'
  ) {
    const body = (await req.json()) as { path?: string };
    const gameRoot = await studio.setGameDirectory(
      String(body.path ?? '').trim(),
    );
    return json({ message: '游戏目录已保存，立即生效。', gameRoot });
  }

  if (url.pathname === '/api/storage' && req.method === 'GET')
    return json({
      root: dataRoot,
      models: storage.models,
      sources: storage.sources,
      skins: storage.skins,
      cache: storage.cache,
      environment: !!process.env.FOURDGEN_DATA_DIR,
    });

  if (url.pathname === '/api/storage' && req.method === 'POST') {
    const body = (await req.json()) as { path?: string };
    await requestStorageLocation(String(body.path ?? ''));
    return json({
      restartRequired: true,
      message: '数据目录已设置，重启后自动复制数据。旧目录保留。',
    });
  }

  return null;
}
