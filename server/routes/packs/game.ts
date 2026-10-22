import { json } from '../../http.ts';
import type { Studio } from '../../studio.ts';
import { backupGameSkins, GAME_REQUIRED_ROUTES } from './shared.ts';

export async function handleGame(
  studio: Studio,
  req: Request,
  url: URL,
  parts: string[],
): Promise<Response | null> {
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
    const body = (await req.json()) as { slot?: string; id?: string; skins?: number[] };
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
  }

  if (url.pathname === '/api/packs/disable' && req.method === 'POST') {
    const body = (await req.json()) as { slot?: string; id?: string; skinIndex?: number };
    const manager = studio.requireManager();
    const slot = String(body.slot ?? '');
    const result = Number.isInteger(body.skinIndex)
      ? await manager.disableSkin(slot, String(body.id ?? ''), body.skinIndex!)
      : await manager.disable(slot, String(body.id ?? ''));
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

  return null;
}
