import { readdir, rm, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { listModels } from './model-library.ts';
import { storage } from '../src/workspace-storage.ts';

export type CacheCleanMode = 'unused' | 'all';
export type CacheCleanResult = {
  mode: CacheCleanMode;
  bytes: number;
  files: number;
};

async function removeFile(path: string): Promise<number> {
  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) return 0;
  await rm(path, { force: true }).catch(() => {});
  return info.size;
}

/** Delete a folder's contents while reporting what was freed. */
async function clearFolder(
  folder: string,
): Promise<{ bytes: number; files: number }> {
  let bytes = 0;
  let files = 0;
  for (const entry of await readdir(folder, { withFileTypes: true }).catch(
    () => [],
  )) {
    if (entry.isSymbolicLink()) continue;
    const path = resolve(folder, entry.name);
    if (entry.isDirectory()) {
      const nested = await clearFolder(path);
      bytes += nested.bytes;
      files += nested.files;
      await rm(path, { recursive: true, force: true }).catch(() => {});
    } else {
      const size = await removeFile(path);
      if (size) {
        bytes += size;
        files++;
      }
    }
  }
  return { bytes, files };
}

/**
 * Drop rebuildable caches. `unused` keeps the previews and parsed models that
 * a library entry still points at; `all` forces a full rebuild.
 */
export async function cleanCache(
  cacheRoot: string,
  referenced: ReadonlySet<string>,
  mode: CacheCleanMode = 'unused',
): Promise<CacheCleanResult> {
  let bytes = 0;
  let files = 0;
  const remove = async (path: string): Promise<void> => {
    const size = await removeFile(path);
    if (size) {
      bytes += size;
      files++;
    }
  };

  const models = resolve(cacheRoot, 'web-models');
  for (const name of await readdir(models).catch(() => [] as string[])) {
    if (!/\.(glb|json)$/.test(name)) continue;
    if (mode === 'unused' && referenced.has(name.replace(/\.(glb|json)$/, '')))
      continue;
    await remove(resolve(models, name));
  }

  const previews = resolve(cacheRoot, 'web-preview');
  for (const name of await readdir(previews).catch(() => [] as string[])) {
    if (!name.endsWith('.glb')) continue;
    if (mode === 'unused' && referenced.has(name.slice(0, -4))) continue;
    await remove(resolve(previews, name));
  }

  // Icons and temporary pack imports are always disposable.
  for (const folder of ['source-icons', 'pack-imports']) {
    const result = await clearFolder(resolve(cacheRoot, folder));
    bytes += result.bytes;
    files += result.files;
  }

  return { mode, bytes, files };
}

export async function cleanDerivedCache(
  mode: CacheCleanMode = 'unused',
): Promise<CacheCleanResult> {
  const referenced = new Set(
    (await listModels())
      .map((entry) => entry.previewKey)
      .filter((key): key is string => !!key),
  );
  return cleanCache(storage.cache, referenced, mode);
}
