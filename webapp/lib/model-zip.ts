import JSZip from 'jszip';

const MODEL_EXTENSIONS = new Set(['glb', 'gltf', 'vrm', 'fbx', 'obj', 'dae', 'stl', 'ply', 'pmx', 'pmd']);
const SIDECAR_EXTENSIONS = new Set([
  'bin', 'mtl',
  'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'svg', 'tga', 'dds',
]);

const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 512 * 1024 * 1024;
const MAX_ENTRIES = 2000;

const MIME_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  tga: 'image/x-tga',
  dds: 'image/vnd-ms.dds',
  bin: 'application/octet-stream',
  mtl: 'text/plain',
  gltf: 'model/gltf+json',
  obj: 'text/plain',
  dae: 'model/vnd.collada+xml',
  fbx: 'application/octet-stream',
  pmx: 'application/octet-stream',
  pmd: 'application/octet-stream',
};

export interface ExpandedModelFiles {
  files: File[];
  warnings: string[];
}

export function isModelArchive(file: File): boolean {
  return /\.zip$/i.test(file.name);
}

export function isModelAsset(name: string): boolean {
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  return MODEL_EXTENSIONS.has(extension) || SIDECAR_EXTENSIONS.has(extension);
}

/**
 * Unpack ZIP archives into File objects so the existing model loader can read
 * them. Entries keep their archive-relative path, which lets sidecar buffers
 * and textures resolve across nested folders.
 */
export async function expandModelArchives(input: File[]): Promise<ExpandedModelFiles> {
  const files = input.filter((file) => !isModelArchive(file));
  const warnings: string[] = [];
  for (const archive of input.filter(isModelArchive)) {
    files.push(...await readArchive(archive, warnings));
  }
  return { files, warnings };
}

async function readArchive(file: File, warnings: string[]): Promise<File[]> {
  if (file.size > MAX_ARCHIVE_BYTES)
    throw new Error(`ZIP「${file.name}」超过 256 MB，请拆分后再导入。`);

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(await file.arrayBuffer(), { createFolders: false });
  } catch {
    throw new Error(`无法读取 ZIP「${file.name}」，请确认文件没有损坏。`);
  }

  const entries = Object.keys(zip.files)
    .filter((name) => !zip.files[name]?.dir)
    .map((name) => ({ name, entry: zip.files[name]! }))
    .filter(({ name }) => !isIgnored(name));

  const accepted = entries.filter(({ name }) => isModelAsset(name));
  if (looksLikeSkinPack(entries.map(({ name }) => normalizePath(name))))
    throw new Error(`ZIP「${file.name}」是一个皮肤包，请到「我的皮肤包」页导入。`);
  if (!accepted.length)
    throw new Error(`ZIP「${file.name}」里没有找到模型或贴图文件。`);
  if (accepted.length > MAX_ENTRIES)
    throw new Error(`ZIP「${file.name}」里文件过多（超过 ${MAX_ENTRIES} 个），请精简后再导入。`);

  let expected = 0;
  for (const { entry } of accepted) {
    const size = uncompressedSize(entry);
    if (size > 0) expected += size;
    if (expected > MAX_UNPACKED_BYTES)
      throw new Error(`ZIP「${file.name}」解压后超过 512 MB，请精简贴图或模型。`);
  }

  const skipped = entries.length - accepted.length;
  if (skipped > 0)
    warnings.push(`ZIP「${file.name}」里已跳过 ${skipped} 个非模型/贴图文件。`);

  const unpacked: File[] = [];
  let actual = 0;
  for (const { name, entry } of accepted) {
    const bytes = await entry.async('uint8array');
    actual += bytes.length;
    if (actual > MAX_UNPACKED_BYTES)
      throw new Error(`ZIP「${file.name}」解压后超过 512 MB，请精简贴图或模型。`);

    const path = normalizePath(name);
    const base = path.slice(path.lastIndexOf('/') + 1);
    const type = MIME_TYPES[base.split('.').pop()?.toLowerCase() ?? ''] ?? '';
    const buffer = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
      ? bytes.buffer
      : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const extracted = new File([buffer as ArrayBuffer], base, {
      type,
      lastModified: entry.date?.getTime() ?? Date.now(),
    });
    // The loader registers both the basename and this relative path, so glTF
    // references such as "textures/body.png" resolve inside the archive.
    Object.defineProperty(extracted, 'webkitRelativePath', { value: path });
    unpacked.push(extracted);
  }
  return unpacked;
}

function looksLikeSkinPack(paths: string[]): boolean {
  const has = (name: string) => paths.some((path) => path === name || path.endsWith(`/${name}`));
  return has('manifest.json') && has('skins.json');
}

function isIgnored(name: string): boolean {
  const parts = normalizePath(name).split('/');
  if (parts.some((part) => part === '__MACOSX' || part.startsWith('._'))) return true;
  const base = parts[parts.length - 1]?.toLowerCase() ?? '';
  return base === '.ds_store' || base === 'thumbs.db' || base === 'desktop.ini';
}

function normalizePath(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

function uncompressedSize(entry: JSZip.JSZipObject): number {
  const data = (entry as unknown as { _data?: { uncompressedSize?: unknown } })._data;
  return typeof data?.uncompressedSize === 'number' ? data.uncompressedSize : 0;
}
