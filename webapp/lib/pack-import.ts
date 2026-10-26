import JSZip from 'jszip';
import type { BedrockGeometryFile } from '../../src/bedrock-types.ts';
import { validateGeometry } from '../../src/geometry-validator.ts';
import {
  isPng,
  isUuid,
  pngDimensions,
  randomUuid,
} from '../../src/skin-pack-files.ts';
import type { StoredSkin } from './pack-types.ts';

export interface ImportedPack {
  name: string;
  headerId: string | null;
  moduleId: string | null;
  skins: StoredSkin[];
  skipped: string[];
}

/**
 * Import a legacy poly_mesh skin pack ZIP (flat or wrapped in one folder).
 * Built-in humanoid skins and cube-based geometry are reported as skipped.
 */
export async function importSkinPackZip(file: File): Promise<ImportedPack> {
  if (file.size > 128 * 1024 * 1024) throw new Error('ZIP 超过 128 MB，无法导入');
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(await file.arrayBuffer(), { checkCRC32: true, createFolders: false });
  } catch {
    throw new Error('无法读取 ZIP，请确认文件没有损坏');
  }
  const entries = Object.keys(zip.files).filter((name) => !zip.files[name]?.dir);
  const manifestPath = entries
    .filter((name) => name === 'manifest.json' || name.endsWith('/manifest.json'))
    .sort((a, b) => a.length - b.length)[0];
  if (!manifestPath) throw new Error('ZIP 里没有 manifest.json，不像是皮肤包');

  const root = manifestPath.slice(0, -'manifest.json'.length);
  const read = (name: string) => zip.file(root + name) ?? zip.file(name);
  const readJson = async (name: string): Promise<unknown> => {
    const entry = read(name);
    if (!entry) throw new Error(`皮肤包缺少 ${name}`);
    try {
      return JSON.parse(await entry.async('string')) as unknown;
    } catch {
      throw new Error(`${name} 不是有效的 JSON`);
    }
  };

  const manifest = await readJson('manifest.json') as {
    header?: { name?: unknown; uuid?: unknown };
    modules?: { type?: unknown; uuid?: unknown }[];
  };
  const module = manifest.modules?.find((item) => item.type === 'skin_pack');
  if (!module) throw new Error('manifest.json 里没有 skin_pack 模块');

  const skinsRoot = await readJson('skins.json') as {
    serialize_name?: unknown;
    localization_name?: unknown;
    skins?: unknown;
  };
  if (!Array.isArray(skinsRoot.skins) || !skinsRoot.skins.length)
    throw new Error('skins.json 里没有皮肤');
  if (skinsRoot.skins.length > 200) throw new Error('皮肤数量超过 200，无法导入');

  let geometryRoot: Record<string, unknown> | null = null;
  if (read('geometry.json')) {
    const parsed = await readJson('geometry.json') as Record<string, unknown>;
    if (parsed.format_version !== '1.8.0')
      throw new Error('暂只支持 format_version 1.8.0 的 poly_mesh 皮肤包');
    geometryRoot = parsed;
  }

  const langEntry = read('texts/zh_CN.lang') ?? read('texts/en_US.lang');
  const lang = langEntry ? await langEntry.async('string') : '';
  const langNames = new Map<string, string>();
  for (const line of lang.split(/\r?\n/)) {
    const index = line.indexOf('=');
    if (index > 0) langNames.set(line.slice(0, index).trim(), line.slice(index + 1).trim());
  }
  const key = typeof skinsRoot.serialize_name === 'string'
    ? skinsRoot.serialize_name
    : typeof skinsRoot.localization_name === 'string' ? skinsRoot.localization_name : null;

  const skins: StoredSkin[] = [];
  const skipped: string[] = [];
  const now = Date.now();
  for (const [index, raw] of skinsRoot.skins.entries()) {
    const entry = raw as Record<string, unknown>;
    const identifier = typeof entry.geometry === 'string' ? entry.geometry : '';
    const textureName = typeof entry.texture === 'string' ? entry.texture : '';
    const localization = typeof entry.localization_name === 'string'
      ? entry.localization_name : `skin${index}`;
    let name = `${localization}`;
    if (key) name = langNames.get(`skin.${key}.${localization}`) ?? name;
    name = name.trim().slice(0, 128) || `导入皮肤 ${index + 1}`;

    if (!identifier.startsWith('geometry.') || !/^[A-Za-z0-9_.:'-]+$/.test(identifier)) {
      skipped.push(`${name}：几何标识无效`);
      continue;
    }
    if (/^geometry\.humanoid\./.test(identifier)) {
      skipped.push(`${name}：内置人形皮肤无法合并到 4D 皮肤包`);
      continue;
    }
    if (!geometryRoot || !geometryRoot[identifier]) {
      skipped.push(`${name}：缺少 geometry.json 里的 ${identifier}`);
      continue;
    }
    if (!/^[A-Za-z0-9_.-]+\.png$/i.test(textureName)) {
      skipped.push(`${name}：贴图文件名无效`);
      continue;
    }
    const texture = read(textureName);
    if (!texture || texture.dir) {
      skipped.push(`${name}：缺少贴图 ${textureName}`);
      continue;
    }
    const png = await texture.async('uint8array');
    if (png.length > 8 * 1024 * 1024 || !isPng(png)) {
      skipped.push(`${name}：贴图不是有效的 PNG`);
      continue;
    }
    const rawGeometry = geometryRoot[identifier] as { texturewidth?: unknown; textureheight?: unknown };
    const size = pngDimensions(png);
    if (!size || size.width !== rawGeometry.texturewidth || size.height !== rawGeometry.textureheight) {
      skipped.push(`${name}：贴图尺寸与几何不一致`);
      continue;
    }
    const wrapper = { format_version: '1.8.0' } as BedrockGeometryFile;
    wrapper[identifier as `geometry.${string}`] = geometryRoot[identifier] as BedrockGeometryFile[`geometry.${string}`];
    let triangles = 0;
    try {
      const validation = validateGeometry(wrapper, { expectedIdentifier: identifier as `geometry.${string}` });
      triangles = validation.geometries[0]?.triangles ?? 0;
    } catch {
      skipped.push(`${name}：几何不是可用的 poly_mesh`);
      continue;
    }
    skins.push({
      id: randomUuid(),
      name,
      source: 'import',
      createdAt: now,
      updatedAt: now,
      triangles,
      geometry: wrapper,
      png,
    });
  }
  if (!skins.length) {
    throw new Error(skipped.length
      ? `没有可导入的皮肤：${skipped.slice(0, 2).join('；')}`
      : 'ZIP 里没有可导入的皮肤');
  }
  const headerId = isUuid(manifest.header?.uuid) ? manifest.header.uuid : null;
  const moduleId = isUuid(module.uuid) ? module.uuid : null;
  return {
    name: typeof manifest.header?.name === 'string' && manifest.header.name.trim()
      ? manifest.header.name.trim().slice(0, 128) : '导入的皮肤包',
    headerId,
    moduleId,
    skins,
    skipped,
  };
}
