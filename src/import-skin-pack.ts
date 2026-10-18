import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { decodeTGA } from './tga.ts';
import type { SkinPackFiles } from './skin-pack.ts';

/** JSON with comments/trailing commas, without rewriting quoted text. */
export function parsePackJSON(bytes: Uint8Array): any {
  const raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
  let clean = '', quoted = false, escape = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]!;
    if (quoted) { clean += c; if (escape) escape = false; else if (c === '\\') escape = true; else if (c === '"') quoted = false; continue; }
    if (c === '"') { quoted = true; clean += c; continue; }
    if (c === '/' && raw[i + 1] === '/') { while (i < raw.length && raw[i] !== '\n') i++; clean += '\n'; continue; }
    if (c === '/' && raw[i + 1] === '*') { const end = raw.indexOf('*/', i + 2); if (end < 0) throw Error('Unterminated JSON comment'); i = end + 1; clean += ' '; continue; }
    clean += c;
  }
  let result = ''; quoted = false; escape = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i]!;
    if (quoted) { result += c; if (escape) escape = false; else if (c === '\\') escape = true; else if (c === '"') quoted = false; continue; }
    if (c === '"') quoted = true;
    if (c === ',') { let j = i + 1; while (/\s/.test(clean[j] ?? '') && j < clean.length) j++; if (clean[j] === '}' || clean[j] === ']') continue; }
    result += c;
  }
  return JSON.parse(result);
}
export function safeExternalAsset(name: string) {
  if (/^(manifest|skins|geometry)\.json$/.test(name)) return true;
  if (/^texts\/[A-Za-z0-9_-]+\.(lang|json)$/.test(name)) return true;
  return !/[\\/:<>"|?*\x00-\x1f]/.test(name) && !name.startsWith('.') && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])\./i.test(name) && /\.(png|tga)$/i.test(name);
}

/** Normalize a local copy only. Source filenames, labels and geometry are not edited. */
export async function normalizeImportedPack(raw: SkinPackFiles) {
  const warnings: string[] = [];
  const manifest = parsePackJSON(raw['manifest.json']!);
  const data = parsePackJSON(raw['skins.json']!);
  if (!Array.isArray(data.skins)) throw Error('Invalid skin pack: skins must be an array');
  const geometry = raw['geometry.json'] ? parsePackJSON(raw['geometry.json']) : null;
  if (geometry) for (const [key, value] of Object.entries(geometry) as [string, any][]) {
    if (key.startsWith('geometry.') && value && typeof value === 'object') {
      value.texturewidth ??= 64;
      value.textureheight ??= 64;
    }
  }
  const output: SkinPackFiles = Object.create(null);
  const strings = new Map<string, Map<string, string>>();
  for (const [path, bytes] of Object.entries(raw)) if (/^texts\/.*\.lang$/.test(path)) {
    const labels = new Map<string,string>();
    for (const line of new TextDecoder().decode(bytes).split(/\r?\n/)) { const i = line.indexOf('='); if(i>0) labels.set(line.slice(0,i),line.slice(i+1)); }
    strings.set(path, labels);
  }
  if (!strings.size) { strings.set('texts/en_US.lang',new Map()); strings.set('texts/zh_CN.lang',new Map()); }
  const oldKey = data.localization_name ?? data.serialize_name;
  const packKey = 'Imported_' + randomUUID().replaceAll('-', '');
  const names = Object.keys(raw);
  const textures = new Map<string,string>();
  const labels = new Map<string,string[]>();
  for (const path of strings.keys()) labels.set(path, [`skinpack.${packKey}=${strings.get(path)?.get(manifest.header?.name) ?? manifest.header?.name ?? 'Imported Skin Pack'}`]);
  const skins: any[] = [];
  const usedGeometry = new Set<string>();
  for (const [index, entry] of data.skins.entries()) {
    if (!entry || typeof entry !== 'object') { warnings.push(`皮肤 ${index+1}：条目无效，未导入`); continue; }
    const label = entry.localization_name ?? `皮肤 ${index+1}`;
    if (typeof entry.texture !== 'string' || !safeExternalAsset(entry.texture)) { warnings.push(`皮肤 ${index+1} (${label})：贴图路径无效，未导入`); continue; }
    const candidates = names.filter(n => n.toLowerCase() === entry.texture.toLowerCase());
    const source = Object.hasOwn(raw,entry.texture) ? entry.texture : candidates.length===1 ? candidates[0] : undefined;
    if (!source) { warnings.push(`皮肤 ${index+1} (${label})：缺少贴图 ${entry.texture}，未导入`); continue; }
    if (!geometry?.[entry.geometry] && !['geometry.humanoid.custom','geometry.humanoid.customSlim'].includes(entry.geometry)) { warnings.push(`皮肤 ${index+1} (${label})：缺少几何 ${entry.geometry}，未导入`); continue; }
    let target = textures.get(source);
    if (!target) {
      target = `texture_${textures.size}.png`;
      let bytes = raw[source]!;
      if (/\.tga$/i.test(source)) { const decoded = decodeTGA(bytes); bytes = new Uint8Array(await sharp(decoded.data,{raw:{width:decoded.width,height:decoded.height,channels:4}}).png().toBuffer()); }
      else if ((await sharp(bytes).metadata()).format !== 'png') bytes = new Uint8Array(await sharp(bytes).png().toBuffer());
      output[target] = bytes;
      textures.set(source,target);
    }
    const id = 'skin_' + skins.length;
    skins.push({...entry, localization_name:id, texture:target, type:entry.type ?? 'free'});
    usedGeometry.add(entry.geometry);
    for (const [path, map] of strings) labels.get(path)!.push(`skin.${packKey}.${id}=${map.get(`skin.${oldKey}.${entry.localization_name}`) ?? label}`);
  }
  if (!skins.length) throw Error('没有可导入的有效皮肤：' + warnings.slice(0,3).join('；'));
  const encode = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
  output['manifest.json'] = encode(manifest);
  output['skins.json'] = encode({...data, serialize_name:packKey,localization_name:packKey,skins});
  if (geometry) {
    const filtered: Record<string,unknown> = {format_version:geometry.format_version ?? '1.8.0'};
    for (const key of usedGeometry) if (geometry[key]) filtered[key] = geometry[key];
    if(Object.keys(filtered).length>1) output['geometry.json'] = encode(filtered);
  }
  output['texts/languages.json'] = encode([...strings.keys()].map(p=>p.slice(6,-5)));
  for (const [path, lines] of labels) output[path] = new TextEncoder().encode(lines.join('\n')+'\n');
  if(raw['pack_icon.png']) output['pack_icon.png'] = raw['pack_icon.png'];
  return { files:output, warnings };
}
