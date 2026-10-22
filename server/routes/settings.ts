import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  dataRoot,
  requestStorageLocation,
  storage,
} from '../../src/workspace-storage.ts';
import { json } from '../http.ts';
import { route } from '../route.ts';
import { storageUsage } from '../storage-usage.ts';

export const settingsRoutes = [
  route('GET', '/api/settings/storage-usage', async () =>
    json(await storageUsage(dataRoot)),
  ),

  route('GET', '/api/settings', async ({ studio }) => {
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
    const packageInfo = await readFile(
      resolve(process.cwd(), 'package.json'),
      'utf8',
    )
      .then((value) => JSON.parse(value) as { version?: string })
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
      version: packageInfo?.version ?? '0.0.0',
      runtime: {
        electron: process.versions.electron ?? null,
        node: process.versions.node,
        chrome: process.versions.chrome ?? null,
      },
    });
  }),

  route('POST', '/api/settings/game-directory', async ({ studio, req }) => {
    const body = (await req.json()) as { path?: string };
    const gameRoot = await studio.setGameDirectory(
      String(body.path ?? '').trim(),
    );
    return json({ message: '游戏目录已保存，立即生效。', gameRoot });
  }),

  route('GET', '/api/storage', async () =>
    json({
      root: dataRoot,
      models: storage.models,
      sources: storage.sources,
      skins: storage.skins,
      cache: storage.cache,
      environment: !!process.env.FOURDGEN_DATA_DIR,
    }),
  ),

  route('POST', '/api/storage', async ({ req }) => {
    const body = (await req.json()) as { path?: string };
    await requestStorageLocation(String(body.path ?? ''));
    return json({
      restartRequired: true,
      message: '数据目录已设置，重启后自动复制数据。旧目录保留。',
    });
  }),
];
