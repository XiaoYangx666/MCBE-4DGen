import { readFileSync } from 'node:fs';
import {
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ManagerConfig } from './pack-manager.ts';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const storageConfigPath = resolve(
  process.env.FOURDGEN_CONFIG_DIR ?? appRoot,
  'storage.local.json',
);

type StorageConfig = { dataDir: string; migrateFrom?: string };

const configured: StorageConfig = (() => {
  try {
    return JSON.parse(readFileSync(storageConfigPath, 'utf8')) as StorageConfig;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return {
        dataDir: process.env.FOURDGEN_DEFAULT_DATA_DIR ?? '4dgen-data',
      };
    throw error;
  }
})();

export const dataRoot = resolve(
  appRoot,
  process.env.FOURDGEN_DATA_DIR || configured.dataDir,
);

export const storage = {
  root: dataRoot,
  models: resolve(dataRoot, 'models'),
  sources: resolve(dataRoot, 'sources'),
  skins: resolve(dataRoot, 'skins'),
  cache: resolve(dataRoot, 'cache'),
};

async function exists(path: string): Promise<boolean> {
  return stat(path)
    .then(() => true)
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return false;
      throw error;
    });
}

export function within(root: string, path: string): boolean {
  const rel = relative(root, path);
  return !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep);
}

async function copyOnce(source: string, destination: string): Promise<void> {
  if (source === destination || !(await exists(source))) return;
  if (await exists(destination)) {
    if ((await readdir(destination)).length) return;
    await rm(destination, { recursive: true });
  }
  const stage = destination + '.import-' + crypto.randomUUID();
  try {
    await mkdir(dirname(destination), { recursive: true });
    await cp(source, stage, { recursive: true, dereference: false });
    await rename(stage, destination);
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

async function rewriteEntries(
  from: string,
  to: string,
  entriesRoot = storage.models,
): Promise<void> {
  const folder = resolve(entriesRoot, 'entries');
  for (const name of await readdir(folder).catch(() => [] as string[])) {
    if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
    const path = resolve(folder, name);
    const entry = JSON.parse(await readFile(path, 'utf8'));
    if (within(from, entry.path)) {
      entry.path = resolve(to, relative(from, entry.path));
      await writeFile(path, JSON.stringify(entry));
    }
  }
}

/** Copy old data, keeping originals available. Completed destinations are reused. */
let initialization: Promise<void> | undefined;

export function initializeStorage(): Promise<void> {
  return (initialization ??= initialize().catch((error) => {
    initialization = undefined;
    throw error;
  }));
}

async function initialize(): Promise<void> {
  if (configured.migrateFrom && !process.env.FOURDGEN_DATA_DIR) {
    const from = resolve(appRoot, configured.migrateFrom);
    if (within(from, dataRoot) || within(dataRoot, from))
      throw Error('新旧数据目录不能互相包含');
    await migrateStorageDirectory(from, dataRoot);
    await writeFile(
      storageConfigPath,
      JSON.stringify({ dataDir: dataRoot }, null, 2),
    );
  }
  await mkdir(dataRoot, { recursive: true });
  // An explicit workspace is independent of the application's legacy caches.
  if (process.env.FOURDGEN_DATA_DIR) return;
  await copyOnce(resolve(appRoot, '.cache/model-library'), storage.models);
  await copyOnce(
    resolve(appRoot, '.cache/web-uploads'),
    resolve(storage.sources, 'uploads'),
  );
  await copyOnce(
    resolve(appRoot, '.cache/web-preview'),
    resolve(storage.cache, 'web-preview'),
  );
  await copyOnce(
    resolve(appRoot, '.cache/web-models'),
    resolve(storage.cache, 'web-models'),
  );
  await rewriteEntries(
    resolve(appRoot, '.cache/web-uploads'),
    resolve(storage.sources, 'uploads'),
  );
  await rewriteEntries(
    resolve(appRoot, '.cache/model-library'),
    storage.models,
  );
}

export async function resolveManagerConfig(
  config: ManagerConfig,
  configPath: string,
): Promise<ManagerConfig> {
  await initializeStorage();
  const legacy = resolve(dirname(configPath), config.stateDir);
  await copyOnce(legacy, storage.skins);
  return {
    ...config,
    skinPacksRoot: resolve(dirname(configPath), config.skinPacksRoot),
    stateDir: storage.skins,
  };
}

export async function requestStorageLocation(path: string): Promise<void> {
  if (process.env.FOURDGEN_DATA_DIR)
    throw Error('当前由 FOURDGEN_DATA_DIR 设置，请修改该环境变量后重启');
  if (!isAbsolute(path)) throw Error('请输入数据目录的绝对路径');
  const next = resolve(path);
  if (next === dataRoot) return;
  if (within(dataRoot, next) || within(next, dataRoot))
    throw Error('新旧数据目录不能互相包含');
  if ((await exists(next)) && (await readdir(next)).length)
    throw Error('请选择空目录，避免覆盖现有文件');
  await writeFile(
    storageConfigPath,
    JSON.stringify({ dataDir: next, migrateFrom: dataRoot }, null, 2),
  );
}

/** Move the logical workspace by copying; reject unrelated destination data. */
export async function migrateStorageDirectory(
  from: string,
  to: string,
): Promise<void> {
  if (within(from, to) || within(to, from))
    throw Error('新旧数据目录不能互相包含');
  if (!(await exists(from))) throw Error('旧数据目录不存在：' + from);
  const marker = resolve(to, '.storage-origin');
  const previous = await readFile(marker, 'utf8').catch(() => '');
  if ((await exists(to)) && (await readdir(to)).length && previous !== from)
    throw Error('新数据目录不为空，停止复制');
  if (previous !== from) {
    const stage = to + '.import-' + crypto.randomUUID();
    try {
      await mkdir(dirname(to), { recursive: true });
      await cp(from, stage, { recursive: true });
      await writeFile(resolve(stage, '.storage-origin'), from);
      if (await exists(to)) await rm(to, { recursive: true });
      await rename(stage, to);
    } finally {
      await rm(stage, { recursive: true, force: true });
    }
  }
  await rewriteEntries(from, to, resolve(to, 'models'));

  const library = resolve(to, 'skins/library');
  async function rewriteMeta(folder: string): Promise<void> {
    for (const item of await readdir(folder, { withFileTypes: true }).catch(
      () => [],
    )) {
      const path = resolve(folder, item.name);
      if (item.isDirectory()) await rewriteMeta(path);
      else if (item.name.endsWith('.json')) {
        const value = JSON.parse(await readFile(path, 'utf8'));
        let changed = false;
        for (const meta of [value.meta, ...(value.meta?.skinOrigins ?? [])])
          if (typeof meta?.source === 'string' && within(from, meta.source)) {
            meta.source = resolve(to, relative(from, meta.source));
            changed = true;
          }
        if (changed) await writeFile(path, JSON.stringify(value));
      }
    }
  }
  await rewriteMeta(library);
}
