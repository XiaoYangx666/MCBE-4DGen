import { createHash } from 'node:crypto';
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { storage, within } from '../src/workspace-storage.ts';
import { modelPattern } from './model-files.ts';

export const libraryRoot = storage.models;

export interface EditSettings {
  binding: string;
  ratio: number;
  maxError: number;
  height: number;
  excluded: string[];
  materialWeights: Record<string, number>;
  profile: unknown;
}

export interface ModelEntry {
  id: string;
  path: string;
  name: string;
  created: string;
  updated: string;
  settings?: EditSettings;
  packIds?: string[];
  profile?: unknown;
  stats?: { triangles: number; materials: number; bytes: number };
  previewKey?: string;
  sourceAvailable?: boolean;
}

function entryPath(id: string): string {
  if (!/^[a-f0-9]{64}$/.test(id)) throw Error('模型 ID 无效');
  return resolve(libraryRoot, 'entries', id + '.json');
}

async function store(entry: ModelEntry): Promise<ModelEntry> {
  const path = entryPath(entry.id);
  await mkdir(resolve(path, '..'), { recursive: true });
  const temp = path + '.' + crypto.randomUUID() + '.tmp';
  await writeFile(temp, JSON.stringify(entry));
  await rename(temp, path);
  return entry;
}

export async function rememberModel(
  path: string,
  name: string,
  details: Partial<ModelEntry> = {},
  existingId?: string,
): Promise<ModelEntry> {
  const id = existingId ?? createHash('sha256').update(path).digest('hex');
  const previous = await readFile(entryPath(id), 'utf8')
    .then((value) => JSON.parse(value) as ModelEntry)
    .catch(() => null);
  return store({
    id,
    name,
    created: previous?.created ?? new Date().toISOString(),
    ...previous,
    ...details,
    path,
    updated: new Date().toISOString(),
  });
}

export async function updateModel(
  id: string,
  patch: {
    name?: string;
    settings?: EditSettings;
    packIds?: string[];
    path?: string;
  },
): Promise<ModelEntry> {
  const entry = JSON.parse(await readFile(entryPath(id), 'utf8')) as ModelEntry;
  if (
    patch.path !== undefined &&
    (!isAbsolute(patch.path) ||
      !modelPattern.test(patch.path) ||
      !(await stat(patch.path)).isFile())
  )
    throw Error('请选择有效的模型文件绝对路径');
  if (
    patch.name !== undefined &&
    (!patch.name.trim() || patch.name.length > 120)
  )
    throw Error('名称需为 1–120 个字符');
  if (patch.settings) {
    const settings = patch.settings;
    if (
      !['static', 'humanoid'].includes(settings.binding) ||
      !Number.isFinite(settings.ratio) ||
      settings.ratio <= 0 ||
      settings.ratio > 1 ||
      !Number.isFinite(settings.height) ||
      settings.height <= 0 ||
      !Number.isFinite(settings.maxError) ||
      settings.maxError < 0 ||
      !Array.isArray(settings.excluded) ||
      settings.excluded.some((value) => typeof value !== 'string') ||
      !settings.materialWeights ||
      Object.values(settings.materialWeights).some(
        (value) => !Number.isFinite(value) || value < 0 || value > 20,
      )
    )
      throw Error('编辑配置无效');
  }
  return store({
    ...entry,
    ...patch,
    ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
    updated: new Date().toISOString(),
  });
}

export async function removeModel(
  id: string,
  deleteSource = false,
): Promise<void> {
  const entry = JSON.parse(await readFile(entryPath(id), 'utf8')) as ModelEntry;
  if (deleteSource) {
    const ownedRoots = [storage.sources, resolve(libraryRoot, 'packages')];
    const source = resolve(entry.path);
    const ownedRoot = ownedRoots.find(
      (root) => within(root, source) && root !== source,
    );
    if (
      ownedRoot &&
      (await stat(source)
        .then(() => true)
        .catch(() => false))
    ) {
      // Never follow linked paths or delete shared source folders.
      const canonical = await realpath(source);
      if (
        resolve(canonical).toLowerCase() !== source.toLowerCase() ||
        (await lstat(source)).isSymbolicLink()
      )
        throw Error('源文件是链接，请先重新定位');
      const others = (await listModels()).filter((model) => model.id !== id);
      if (
        !others.some(
          (model) => resolve(model.path).toLowerCase() === source.toLowerCase(),
        )
      ) {
        const parts = relative(ownedRoot, source).split(/[\\/]/);
        const group =
          ownedRoot === storage.sources &&
          ['local', 'uploads'].includes(parts[0] ?? '') &&
          parts.length > 2
            ? resolve(ownedRoot, parts[0]!, parts[1]!)
            : ownedRoot !== storage.sources && parts.length > 1
              ? resolve(ownedRoot, parts[0]!)
              : null;
        if (
          group &&
          within(ownedRoot, group) &&
          !(await lstat(group)).isSymbolicLink() &&
          !others.some((model) => within(group, resolve(model.path)))
        ) {
          const actual = await realpath(group);
          if (resolve(actual).toLowerCase() !== group.toLowerCase())
            throw Error('源目录是链接，请先重新定位');
          await rm(group, { recursive: true });
        } else await unlink(source);
      }
    }
  }
  await unlink(entryPath(id));
}

export async function listModels(): Promise<ModelEntry[]> {
  const folder = resolve(libraryRoot, 'entries');
  const files = (await readdir(folder).catch(() => [] as string[])).filter((file) =>
    /^[a-f0-9]{64}\.json$/.test(file),
  );
  const result = await Promise.all(
    files.map(async (file) => {
      const path = resolve(folder, file);
      const entry = JSON.parse(await readFile(path, 'utf8')) as ModelEntry;
      const info = await stat(path);
      return {
        ...entry,
        sourceAvailable: await stat(entry.path)
          .then((value) => value.isFile())
          .catch(() => false),
        created: entry.created ?? info.birthtime.toISOString(),
        updated: entry.updated ?? info.mtime.toISOString(),
      };
    }),
  );
  return result.sort((a, b) => b.updated.localeCompare(a.updated));
}
