import { mkdir, readFile, writeFile, readdir, stat, rename, unlink } from 'node:fs/promises';
import { resolve, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';

export const libraryRoot = resolve(import.meta.dir, '../.cache/model-library');
export const modelPattern = /\.(pmx|vrm|glb|gltf|obj|fbx|dae|stl|ply)$/i;
export async function modelFiles(folder: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const path = resolve(folder, entry.name);
    if (entry.isDirectory()) files.push(...await modelFiles(path));
    else if (modelPattern.test(path)) files.push(path);
  }
  return files;
}
export async function importLocal(path: string) {
  if (!isAbsolute(path)) throw Error('请输入本地绝对路径');
  const info = await stat(path);
  if (info.isDirectory()) return modelFiles(path);
  if (modelPattern.test(path)) return [path];
  if (!/\.zip$/i.test(path)) throw Error('请选择 ZIP、模型文件或模型文件夹');
  const bytes = await readFile(path);
  const key = createHash('sha256').update(bytes).digest('hex');
  const folder = resolve(libraryRoot, 'packages', key);
  if (await Bun.file(resolve(folder, '.complete')).exists()) return modelFiles(folder);
  const zip = await JSZip.loadAsync(bytes);
  const entries = Object.values(zip.files).filter(e => !e.dir);
  if (entries.length > 2000) throw Error('文件过多');
  let total = 0;
  for (const entry of entries) {
    const name = (entry as typeof entry & { unsafeOriginalName?: string }).unsafeOriginalName ?? entry.name;
    if (name.replaceAll('\\', '/').split('/').some(p => !p || p === '.' || p === '..' || /[:\x00-\x1f]/.test(p))) throw Error('包内路径无效');
    const target = resolve(folder, name);
    const data = await entry.async('uint8array');
    total += data.length;
    if (total > 256 * 1024 * 1024) throw Error('解压内容超过 256 MB');
    await mkdir(resolve(target, '..'), { recursive: true });
    await writeFile(target, data);
  }
  await writeFile(resolve(folder, '.complete'), 'ok');
  return modelFiles(folder);
}
export interface EditSettings {
  binding: string; ratio: number; maxError: number; height: number;
  excluded: string[]; materialWeights: Record<string, number>; profile: unknown;
}
export interface ModelEntry {
  id: string; path: string; name: string; created: string; updated: string;
  settings?: EditSettings; packIds?: string[]; profile?: unknown;
  stats?: { triangles: number; materials: number; bytes: number }; previewKey?: string;
}
function entryPath(id: string) {
  if (!/^[a-f0-9]{64}$/.test(id)) throw Error('模型 ID 无效');
  return resolve(libraryRoot, 'entries', id + '.json');
}
async function store(entry: ModelEntry) {
  const path = entryPath(entry.id);
  await mkdir(resolve(path, '..'), { recursive: true });
  const temp = path + '.' + crypto.randomUUID() + '.tmp';
  await writeFile(temp, JSON.stringify(entry));
  await rename(temp, path);
  return entry;
}
export async function rememberModel(path: string, name: string, details: Partial<ModelEntry> = {}) {
  const id = createHash('sha256').update(path).digest('hex');
  const old = await readFile(entryPath(id), 'utf8').then(v => JSON.parse(v) as ModelEntry).catch(() => null);
  return store({ id, path, name, created: old?.created ?? new Date().toISOString(), ...old, ...details, updated: new Date().toISOString() });
}
export async function updateModel(id: string, patch: { name?: string; settings?: EditSettings; packIds?: string[] }) {
  const entry = JSON.parse(await readFile(entryPath(id), 'utf8')) as ModelEntry;
  if (patch.name !== undefined && (!patch.name.trim() || patch.name.length > 120)) throw Error('名称需为 1–120 个字符');
  if (patch.settings) {
    const s = patch.settings;
    if (!['static', 'humanoid'].includes(s.binding) || !Number.isFinite(s.ratio) || s.ratio <= 0 || s.ratio > 1 || !Number.isFinite(s.height) || s.height <= 0 || !Number.isFinite(s.maxError) || s.maxError < 0 || !Array.isArray(s.excluded) || s.excluded.some(v => typeof v !== 'string') || !s.materialWeights || Object.values(s.materialWeights).some(v => !Number.isFinite(v) || v < 0 || v > 20)) throw Error('编辑配置无效');
  }
  return store({ ...entry, ...patch, ...(patch.name !== undefined ? { name: patch.name.trim() } : {}), updated: new Date().toISOString() });
}
export async function removeModel(id: string) { await unlink(entryPath(id)); }
export async function listModels(): Promise<ModelEntry[]> {
  const folder = resolve(libraryRoot, 'entries');
  const result: ModelEntry[] = [];
  for (const file of await readdir(folder).catch(() => [] as string[])) {
    if (!/^[a-f0-9]{64}\.json$/.test(file)) continue;
    const entry = JSON.parse(await readFile(resolve(folder, file), 'utf8')) as ModelEntry;
    const info = await stat(resolve(folder, file));
    result.push({ ...entry, created: entry.created ?? info.birthtime.toISOString(), updated: entry.updated ?? info.mtime.toISOString() });
  }
  return result.sort((a,b) => b.updated.localeCompare(a.updated));
}
