import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

export interface PersonaPieceRecipe {
  id: string;
  colors?: string[];
  name?: string;
  type?: string;
  thumbnail?: string;
  thumbnailUrl?: string;
}

export interface PersonaProfileRecipe {
  slot: string;
  kind: 'classic' | 'persona' | 'empty';
  lastUsed: boolean;
  base: {
    arm?: string;
    csArm?: string;
    skinColor?: string;
    skin: boolean;
  };
  pieces: PersonaPieceRecipe[];
  matchedCast: {
    file: string;
    name: string;
    uuid?: string;
    score: number;
    exact: boolean;
  } | null;
  rawAppearance: unknown[];
}

export interface PersonaRecipe {
  version: 1;
  exportedAt: string;
  gameRunning: boolean;
  source: {
    userDir: string;
    ud: string;
    modified: string;
    lastUsedPersonaSlot: string | null;
  };
  profiles: PersonaProfileRecipe[];
}

export interface PersonaRecipeSourceOptions {
  /** skin_packs root; definitions/persona is resolved as a sibling. */
  skinPacksRoot: string;
  /** Override %APPDATA% for tests or a non-default install. */
  appDataRoot?: string;
  /** Override the com.mojang user directory. */
  userDir?: string;
}

export interface PersonaRecipeOptions extends PersonaRecipeSourceOptions {
  /** Directory that receives the JSON file. */
  outputDir: string;
}

type Json = Record<string, any>;

function appData(): string {
  return (
    process.env.APPDATA ??
    join(process.env.USERPROFILE ?? '', 'AppData', 'Roaming')
  );
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function gameRunning(): boolean {
  try {
    const out = execFileSync(
      'tasklist',
      ['/FI', 'IMAGENAME eq Minecraft.Windows.exe', '/NH'],
      { encoding: 'utf8', windowsHide: true },
    );
    return out.toLowerCase().includes('minecraft.windows.exe');
  } catch {
    return false;
  }
}

async function findUserDir(root: string, override?: string) {
  if (override) {
    const ud = (await readdir(override)).find((name) => /^ud\d+\.dat$/i.test(name));
    if (!ud) throw new Error('指定目录里没有 ud*.dat: ' + override);
    return { dir: override, ud: join(override, ud) };
  }
  const users = join(root, 'Minecraft Bedrock', 'Users');
  if (!(await exists(users)))
    throw new Error('找不到 Minecraft Bedrock 用户目录: ' + users);
  const candidates: { dir: string; ud: string; mtime: number }[] = [];
  for (const user of await readdir(users, { withFileTypes: true })) {
    if (!user.isDirectory()) continue;
    const dir = join(users, user.name, 'games', 'com.mojang');
    if (!(await exists(dir))) continue;
    for (const name of await readdir(dir)) {
      if (!/^ud\d+\.dat$/i.test(name)) continue;
      const ud = join(dir, name);
      candidates.push({ dir, ud, mtime: (await stat(ud)).mtimeMs });
    }
  }
  if (!candidates.length)
    throw new Error('找不到角色创建器档案 ud*.dat；请先启动一次 Minecraft。');
  candidates.sort((a, b) => b.mtime - a.mtime);
  return { dir: candidates[0]!.dir, ud: candidates[0]!.ud };
}

function readUd(text: string): Json {
  return JSON.parse(text.replace(/^\uFEFF/, '')) as Json;
}

function profileKind(base: Json, pieces: Json[]): PersonaProfileRecipe['kind'] {
  if (base?.skin === true) return 'classic';
  return pieces.length ? 'persona' : 'empty';
}

function normalizeAppearance(appearance: Json[]): string[] {
  return appearance
    .filter((item) => typeof item?.id === 'string' && !item.id.endsWith('/de'))
    .map((item) => item.id + '|' + JSON.stringify(item.col ?? null));
}

function jaccard(a: string[], b: string[]): number {
  const left = new Set(a);
  const right = new Set(b);
  let intersection = 0;
  for (const value of left) if (right.has(value)) intersection++;
  const union = new Set([...left, ...right]).size;
  return union ? intersection / union : 0;
}

async function defaultCasts(skinPacksRoot: string) {
  const dir = resolve(skinPacksRoot, '..', 'definitions', 'persona');
  if (!(await exists(dir))) return [];
  const casts: { file: string; name: string; uuid?: string; appearance: Json[] }[] = [];
  for (const name of await readdir(dir)) {
    if (!name.endsWith('.json')) continue;
    try {
      const raw = (await readFile(join(dir, name), 'utf8')).replace(/\/\/.*$/gm, '');
      const value = JSON.parse(raw) as Json;
      if (Array.isArray(value.appearance))
        casts.push({
          file: name,
          name: String(value.name ?? name),
          ...(value.uuid ? { uuid: String(value.uuid) } : {}),
          appearance: value.appearance,
        });
    } catch {
      /* skip malformed definitions */
    }
  }
  return casts;
}

export async function readDefaultCastIcon(
  skinPacksRoot: string,
  castFile: string,
): Promise<Uint8Array | null> {
  const match = /^\d+[_\s]*(.+?)_Dcast\.json$/i.exec(castFile);
  if (!match) return null;
  const name = match[1]!.trim().toLowerCase().replace(/\s+/g, "_");
  const archive = resolve(
    skinPacksRoot,
    "..",
    "resource_packs",
    "persona",
    "__brarchive",
    "textures",
    "ui",
    "default_cast.brarchive",
  );
  if (!(await exists(archive))) return null;
  const entries = decodeBrarchive(await readFile(archive));
  const icon = entries.find(
    (entry) => entry.name.toLowerCase() === `${name}_icon.png`,
  );
  return icon ? new Uint8Array(icon.data) : null;
}

export async function readPersonaPieceThumbnail(
  skinPacksRoot: string,
  name: string,
): Promise<Uint8Array | null> {
  const safe = name.split("/").pop() ?? "";
  if (!/^[A-Za-z0-9_.-]+\.png$/i.test(safe)) return null;
  const archive = resolve(
    skinPacksRoot,
    "..",
    "resource_packs",
    "persona",
    "__brarchive",
    "textures",
    "persona_thumbnails.brarchive",
  );
  if (!(await exists(archive))) return null;
  const entries = decodeBrarchive(await readFile(archive));
  const icon = entries.find(
    (entry) => entry.name.toLowerCase() === safe.toLowerCase(),
  );
  return icon ? new Uint8Array(icon.data) : null;
}

function decodeBrarchive(bytes: Buffer) {
  if (bytes.length < 16) return [];
  const magic = bytes.readBigUInt64LE(0);
  if (magic !== 0x267052a0b125277dn) return [];
  const count = bytes.readUInt32LE(8);
  const base = 16 + count * 256;
  if (bytes.length < base) return [];
  const entries: { name: string; data: Buffer }[] = [];
  for (let index = 0; index < count; index++) {
    const offset = 16 + index * 256;
    const nameLength = bytes[offset]!;
    const name = bytes
      .subarray(offset + 1, offset + 1 + nameLength)
      .toString('utf8');
    const contentOffset = bytes.readUInt32LE(offset + 248);
    const contentLength = bytes.readUInt32LE(offset + 252);
    const start = base + contentOffset;
    entries.push({ name, data: bytes.subarray(start, start + contentLength) });
  }
  return entries;
}

/** Built-in persona pieces ship as plain .brarchive metadata. */
type PieceInfo = {
  name: string;
  type?: string;
  thumbnail?: string;
  thumbnailUrl?: string;
};

let marketplaceCache: Map<string, PieceInfo> | null = null;

/** Public Marketplace persona catalog, keyed by piece UUID. */
function marketplacePieces() {
  if (marketplaceCache) return marketplaceCache;
  const raw = JSON.parse(
    readFileSync(
      fileURLToPath(new URL("./persona-marketplace.json", import.meta.url)),
      "utf8",
    ),
  ) as Record<string, { name?: string; type?: string; icon?: string }>;
  marketplaceCache = new Map(
    Object.entries(raw).map(([id, value]) => [
      id.toLowerCase(),
      {
        name: String(value.name ?? ""),
        ...(value.type ? { type: String(value.type) } : {}),
        ...(value.icon ? { thumbnailUrl: String(value.icon) } : {}),
      },
    ]),
  );
  return marketplaceCache;
}

async function builtinPieceMap(skinPacksRoot: string) {
  const root = resolve(
    skinPacksRoot,
    '..',
    'resource_packs',
    'persona',
    '__brarchive',
    'pieces',
  );
  const map = new Map<string, PieceInfo>();
  if (!(await exists(root))) return map;
  const visit = async (dir: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(full);
        continue;
      }
      if (!entry.name.endsWith('.brarchive')) continue;
      const entries = decodeBrarchive(await readFile(full));
      let meta: Json | null = null;
      let store: Json | null = null;
      for (const item of entries) {
        try {
          if (item.name.endsWith('.meta.json'))
            meta = JSON.parse(item.data.toString('utf8')) as Json;
          else if (item.name.endsWith('.store_info.json'))
            store = JSON.parse(item.data.toString('utf8')) as Json;
        } catch {
          /* skip malformed metadata */
        }
      }
      if (typeof meta?.piece_id !== 'string') continue;
      const thumbnail =
        typeof store?.piece_thumbnail === 'string'
          ? store.piece_thumbnail.split('/').pop() +
            (store.piece_thumbnail.endsWith('.png') ? '' : '.png')
          : undefined;
      map.set(meta.piece_id, {
        name: String(meta.piece_name ?? ''),
        type: String(meta.piece_type ?? ''),
        ...(thumbnail ? { thumbnail } : {}),
      });
    }
  };
  await visit(root);
  return map;
}

const premiumMaps = new Map<string, Promise<Map<string, PieceInfo>>>();

function inferPremiumType(value: string) {
  const text = value.toLowerCase();
  if (/freckl|skin_/.test(text)) return 'persona_skin';
  if (/rabbit|mouth|teeth|lip/.test(text)) return 'persona_mouth';
  if (/eye/.test(text)) return 'persona_eyes';
  if (/hair/.test(text)) return 'persona_hair';
  if (/shirt|top|jacket|sweater|cardigan|dress|hoodie/.test(text))
    return 'persona_top';
  if (/pants|bottom|leg/.test(text)) return 'persona_bottom';
  if (/shoe|feet|boot/.test(text)) return 'persona_feet';
  if (/hat|hood|head/.test(text)) return 'persona_head';
  return undefined;
}

async function premiumPieceMap(appDataRoot: string) {
  const dir = join(
    appDataRoot,
    'Minecraft Bedrock',
    'premium_cache',
    'persona',
  );
  const cached = premiumMaps.get(dir);
  if (cached) return cached;
  const scan = (async () => {
    const map = new Map<string, PieceInfo>();
    if (!(await exists(dir))) return map;
    const files = (await readdir(dir)).filter((name) => name !== '.lru.json');
    let cursor = 0;
    const worker = async () => {
      while (cursor < files.length) {
        const file = files[cursor++]!;
        try {
          const zip = await JSZip.loadAsync(await readFile(join(dir, file)));
          const manifest = zip.file('manifest.json');
          if (!manifest) continue;
          const parsed = JSON.parse(await manifest.async('string')) as Json;
          const uuid = parsed.header?.uuid;
          if (typeof uuid !== 'string') continue;
          let name = '';
          const lang = zip.file('texts/en_US.lang');
          if (lang) {
            const text = await lang.async('string');
            const line = text.split(/\r?\n/).find((item) => item.includes('='));
            name = line?.split('=').slice(1).join('=').trim() ?? '';
          }
          const type = inferPremiumType(name + ' ' + file);
          map.set(uuid.toLowerCase(), {
            name,
            ...(type ? { type } : {}),
          });
        } catch {
          /* skip unreadable cache entry */
        }
      }
    };
    await Promise.all(Array.from({ length: 16 }, worker));
    return map;
  })();
  premiumMaps.set(dir, scan);
  return scan;
}

function summarizeProfile(
  slot: string,
  value: Json,
  lastUsed: boolean,
  pieceMap: Map<string, PieceInfo>,
  premiumMap: Map<string, PieceInfo>,
  marketplaceMap: Map<string, PieceInfo>,
  casts: Awaited<ReturnType<typeof defaultCasts>>,
): PersonaProfileRecipe {
  const appearance = (value?.personaCollection?.universalApp ?? []) as Json[];
  const base = appearance[0] ?? {};
  const rawPieces = appearance.slice(1);
  const normalized = normalizeAppearance(appearance);
  let matched: PersonaProfileRecipe['matchedCast'] = null;
  for (const cast of casts) {
    const castNormalized = normalizeAppearance(cast.appearance);
    const score = jaccard(normalized, castNormalized);
    if (!matched || score > matched.score)
      matched = {
        file: cast.file,
        name: cast.name,
        ...(cast.uuid ? { uuid: cast.uuid } : {}),
        score,
        exact:
          JSON.stringify(normalized) === JSON.stringify(castNormalized),
      };
  }
  const pieces: PersonaPieceRecipe[] = rawPieces
    .filter((item) => typeof item?.id === 'string')
    .map((item) => {
      const baseId = item.id.split('/')[0]!;
      const sources = [
        pieceMap.get(baseId),
        premiumMap.get(baseId),
        marketplaceMap.get(baseId),
      ];
      const name = sources.find((source) => source?.name)?.name;
      const type = sources.find((source) => source?.type)?.type;
      const thumbnail = sources.find((source) => source?.thumbnail)?.thumbnail;
      const thumbnailUrl = sources.find(
        (source) => source?.thumbnailUrl,
      )?.thumbnailUrl;
      return {
        id: String(item.id),
        ...(Array.isArray(item.col) ? { colors: item.col.map(String) } : {}),
        ...(name ? { name } : {}),
        ...(type ? { type } : {}),
        ...(thumbnail ? { thumbnail } : {}),
        ...(thumbnailUrl ? { thumbnailUrl } : {}),
      };
    });
  // Marketplace face pieces often have no readable meta. Infer the missing
  // eye/mouth slot from the profile order so the recipe is not just "unknown".
  for (const piece of pieces) {
    if (piece.name || piece.type || !piece.id.endsWith('/f')) continue;
    if (!pieces.some((item) => item.type === 'persona_eyes')) {
      piece.name = 'Marketplace 眼睛（推断）';
      piece.type = 'persona_eyes';
    } else if (!pieces.some((item) => item.type === 'persona_mouth')) {
      piece.name = 'Marketplace 嘴（推断）';
      piece.type = 'persona_mouth';
    } else {
      piece.name = 'Marketplace 面部部件（未缓存）';
      piece.type = 'persona_face';
    }
  }
  return {
    slot,
    kind: profileKind(base, rawPieces),
    lastUsed,
    base: {
      ...(base.arm ? { arm: String(base.arm) } : {}),
      ...(base.cs_arm ? { csArm: String(base.cs_arm) } : {}),
      ...(base.skcol ? { skinColor: String(base.skcol) } : {}),
      skin: base.skin === true,
    },
    pieces,
    matchedCast: matched && matched.score > 0 ? matched : null,
    rawAppearance: appearance,
  };
}

export async function buildPersonaRecipe(
  options: PersonaRecipeSourceOptions,
): Promise<PersonaRecipe> {
  const root = options.appDataRoot ?? appData();
  const user = await findUserDir(root, options.userDir);
  const udText = await readFile(user.ud, 'utf8');
  const document = readUd(udText);
  const sync = document.Synchronized ?? {};
  const index =
    sync.personaProfile?.personaCollection?.universalApp?.[0] ?? {};
  const lastUsedPersonaSlot =
    typeof index.lastUsedPersonaSlot === 'string'
      ? index.lastUsedPersonaSlot
      : null;
  const lastUsedSlot = lastUsedPersonaSlot
    ? 'personaProfile' + lastUsedPersonaSlot.replace('persona_profile_persona', '')
    : null;
  const [casts, pieceMap, premiumMap] = await Promise.all([
    defaultCasts(options.skinPacksRoot),
    builtinPieceMap(options.skinPacksRoot),
    premiumPieceMap(root),
  ]);
  const profiles: PersonaProfileRecipe[] = [];
  for (const key of Object.keys(sync)) {
    if (!/^personaProfile\d+$/.test(key)) continue;
    profiles.push(
      summarizeProfile(
        key,
        sync[key] ?? {},
        key === lastUsedSlot,
        pieceMap,
        premiumMap,
        marketplacePieces(),
        casts,
      ),
    );
  }
  profiles.sort((a, b) => a.slot.localeCompare(b.slot));
  const recipe: PersonaRecipe = {
    version: 1,
    exportedAt: new Date().toISOString(),
    gameRunning: gameRunning(),
    source: {
      userDir: user.dir,
      ud: user.ud,
      modified: (await stat(user.ud)).mtime.toISOString(),
      lastUsedPersonaSlot,
    },
    profiles,
  };
  return recipe;
}

export async function exportPersonaRecipes(options: PersonaRecipeOptions) {
  const recipe = await buildPersonaRecipe(options);
  await mkdir(options.outputDir, { recursive: true });
  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .slice(0, 19);
  const path = join(options.outputDir, `persona-recipes-${stamp}.json`);
  await writeFile(path, JSON.stringify(recipe, null, 2), 'utf8');
  return { path, recipe };
}
