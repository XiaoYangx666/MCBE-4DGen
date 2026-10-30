import { json } from '../../http.ts';
import { route, type RouteContext, type RouteHandler } from '../../route.ts';
import { backupGameSkins } from './shared.ts';

const GAME_REQUIRED =
  '请先配置游戏 skin_packs 目录；本地保存和导出仍可使用';

/** Reject game-slot mutations until a Minecraft skin_packs directory exists. */
function gameRoute(
  method: string,
  path: string,
  handler: RouteHandler,
  message = GAME_REQUIRED,
) {
  return route(method, path, async (context: RouteContext) => {
    if (!context.studio.gameConfigured) throw Error(message);
    return handler(context);
  });
}

export const gameRoutes = [
  gameRoute(
    'POST',
    '/api/packs/apply-update',
    async ({ studio, req }) => {
      const body = (await req.json()) as { id: string; slot: string };
      const manager = studio.requireManager();
      const result = await manager.updateEnabled(body.slot, body.id);
      await manager.pruneBackups(body.slot).catch(() => {});
      if (body.slot === 'custom')
        await backupGameSkins(studio, 'custom:apply-update');
      return json(result);
    },
    '请先配置游戏目录',
  ),

  route('POST', '/api/packs/edit-installed', async ({ studio, req }) => {
    const body = (await req.json()) as {
      slot: string;
      name?: string;
      skinIndex?: number;
      skinName?: string;
      remove?: boolean;
      revision?: string;
    };
    const manager = studio.requireManager();
    const result = await manager.editInstalled(String(body.slot ?? ''), body);
    await manager.pruneBackups(String(body.slot ?? '')).catch(() => {});
    if (body.slot === 'custom') await backupGameSkins(studio, 'custom:edit');
    return json(result);
  }),

  gameRoute('POST', '/api/packs/enable', async ({ studio, req }) => {
    const body = (await req.json()) as {
      slot?: string;
      id?: string;
      skins?: number[];
    };
    const manager = studio.requireManager();
    const slot = String(body.slot ?? '');
    const skins = Array.isArray(body.skins)
      ? body.skins.filter((index) => Number.isInteger(index))
      : [];
    const result = skins.length
      ? await manager.enableSkins(slot, String(body.id ?? ''), skins)
      : await manager.enable(slot, String(body.id ?? ''));
    await manager.pruneBackups(slot).catch(() => {});
    if (slot === 'custom') await backupGameSkins(studio, 'custom:enable');
    return json(result);
  }),

  gameRoute('POST', '/api/packs/disable', async ({ studio, req }) => {
    const body = (await req.json()) as {
      slot?: string;
      id?: string;
      skinIndex?: number;
    };
    const manager = studio.requireManager();
    const slot = String(body.slot ?? '');
    const result = Number.isInteger(body.skinIndex)
      ? await manager.disableSkin(slot, String(body.id ?? ''), body.skinIndex!)
      : await manager.disable(slot, String(body.id ?? ''));
    await manager.pruneBackups(slot).catch(() => {});
    if (slot === 'custom') await backupGameSkins(studio, 'custom:disable');
    return json(result);
  }),

  gameRoute('POST', '/api/packs/restore', async ({ studio, req }) => {
    const body = (await req.json()) as { slot?: string };
    const manager = studio.requireManager();
    const slot = String(body.slot ?? '');
    const result = await manager.restore(slot);
    await manager.pruneBackups(slot).catch(() => {});
    if (slot === 'custom') await backupGameSkins(studio, 'custom:restore');
    return json(result);
  }),

  gameRoute('POST', '/api/packs/recover', async ({ studio, req }) => {
    const body = (await req.json()) as { slot?: string };
    const slot = String(body.slot ?? '');
    const manager = studio.requireManager();
    const result = await manager.recover(slot);
    await manager.pruneBackups(slot).catch(() => {});
    return json(result);
  }),

  gameRoute('POST', '/api/packs/reattach', async ({ studio, req }) => {
    const body = (await req.json()) as { slot?: string };
    const slot = String(body.slot ?? '');
    const manager = studio.requireManager();
    const result = await manager.reattach(slot);
    await manager.pruneBackups(slot).catch(() => {});
    if (slot === 'custom') await backupGameSkins(studio, 'custom:reattach');
    return json(result);
  }),
];
