import { createHash } from 'node:crypto';
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import JSZip from 'jszip';
import { dataRoot, storage, within } from '../src/workspace-storage.ts';
import { fileExists } from './fs.ts';
import { modelFiles, modelPattern } from './model-files.ts';

const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
const MAX_ARCHIVE_FILES = 2000;
const SIDECAR_PATTERN = /\.(png|jpe?g|tga|bmp|webp|dds|ktx2?|bin|mtl|json)$/i;

/** Import a model file, folder, or ZIP; extracted packages are content-addressed. */
export async function importLocal(path: string): Promise<string[]> {
  if (!isAbsolute(path)) throw Error('请输入本地绝对路径');
  const info = await stat(path);
  if (info.isDirectory()) return modelFiles(path);
  if (modelPattern.test(path)) return [path];
  if (!/\.zip$/i.test(path)) throw Error('请选择 ZIP、模型文件或模型文件夹');

  const bytes = await readFile(path);
  const key = createHash('sha256').update(bytes).digest('hex');
  const folder = resolve(storage.models, 'packages', key);
  if (await fileExists(resolve(folder, '.complete')))
    return modelFiles(folder);

  const zip = await JSZip.loadAsync(bytes);
  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  if (entries.length > MAX_ARCHIVE_FILES) throw Error('文件过多');
  let total = 0;
  for (const entry of entries) {
    const name =
      (entry as typeof entry & { unsafeOriginalName?: string })
        .unsafeOriginalName ?? entry.name;
    const parts = name.replaceAll('\\', '/').split('/');
    if (
      parts.some(
        (part) =>
          !part || part === '.' || part === '..' || /[:\x00-\x1f]/.test(part),
      )
    )
      throw Error('包内路径无效');
    const target = resolve(folder, parts.join('/'));
    const data = await entry.async('uint8array');
    total += data.length;
    if (total > MAX_ARCHIVE_BYTES) throw Error('解压内容超过 256 MB');
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, data);
  }
  await writeFile(resolve(folder, '.complete'), 'ok');
  return modelFiles(folder);
}

/** Keep the source model and its sidecars together, independent of Downloads. */
export async function ownModel(path: string): Promise<string> {
  if (within(dataRoot, path)) return path;
  if (!(await stat(path)).isFile()) throw Error('源模型文件不存在');
  const source = dirname(path);
  const key = createHash('sha256').update(path).digest('hex');
  const folder = resolve(storage.sources, 'local', key);
  const target = resolve(folder, relative(source, path));
  if (await fileExists(resolve(folder, '.complete'))) return target;

  let total = 0;
  let count = 0;
  const stage = folder + '.import-' + crypto.randomUUID();

  async function copy(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = resolve(dir, entry.name);
      const destination = resolve(stage, relative(source, file));
      if (
        within(dataRoot, file) ||
        entry.isSymbolicLink() ||
        ['node_modules', '.git', '.cache'].includes(entry.name)
      )
        continue;
      if (entry.isDirectory()) {
        await copy(file);
        continue;
      }
      if (modelPattern.test(file) && file !== path) continue;
      if (file !== path && !SIDECAR_PATTERN.test(file)) continue;
      total += (await stat(file)).size;
      count++;
      if (total > MAX_ARCHIVE_BYTES || count > MAX_ARCHIVE_FILES)
        throw Error(
          '模型及贴图超过 256 MB 或 2000 个文件，请将模型整理到独立文件夹后导入',
        );
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(file, destination);
    }
  }

  try {
    await copy(source);
    await writeFile(resolve(stage, '.complete'), 'ok');
    await mkdir(dirname(folder), { recursive: true });
    await rename(stage, folder);
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
  return target;
}
