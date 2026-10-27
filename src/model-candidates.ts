/**
 * Model file detection and ranking shared by the desktop server, the workbench
 * UI and the browser build. Keeping this in one place means every importer
 * lists the same candidates for an archive that holds several models.
 */

export type ModelFormat =
  | 'glb'
  | 'gltf'
  | 'obj'
  | 'fbx'
  | 'stl'
  | 'ply'
  | 'dae'
  | 'pmx'
  | 'pmd';

/** Extension -> loader family. VRM is a glTF container, so it loads as GLB. */
const FORMAT_BY_EXTENSION: Readonly<Record<string, ModelFormat>> = {
  glb: 'glb',
  vrm: 'glb',
  gltf: 'gltf',
  obj: 'obj',
  fbx: 'fbx',
  stl: 'stl',
  ply: 'ply',
  dae: 'dae',
  pmx: 'pmx',
  pmd: 'pmd',
};

/** Every extension the importers recognise, including desktop-only PMD. */
export const MODEL_EXTENSIONS: readonly string[] = Object.keys(FORMAT_BY_EXTENSION);

/** Extensions the desktop server can open; PMD has no loader there yet. */
export const IMPORTABLE_MODEL_EXTENSIONS: readonly string[] = MODEL_EXTENSIONS.filter(
  (extension) => extension !== 'pmd',
);

/**
 * Lower rank wins when nobody picked a model: prefer formats that load
 * directly over ones that need a conversion step first.
 */
export const MODEL_FORMAT_RANK: Readonly<Record<ModelFormat, number>> = {
  glb: 0,
  gltf: 1,
  fbx: 2,
  obj: 3,
  dae: 4,
  stl: 5,
  ply: 6,
  pmx: 7,
  pmd: 8,
};

export interface ModelCandidateEntry {
  /** Archive-relative path, or a bare file name for loose files. */
  path: string;
  bytes?: number;
}

export interface ModelCandidate {
  path: string;
  name: string;
  format: ModelFormat;
  bytes: number;
}

/** File name portion of an archive-relative path. */
export function modelFileName(path: string): string {
  const normalized = path.replaceAll('\\', '/');
  return normalized.slice(normalized.lastIndexOf('/') + 1);
}

/** Loader family for a file name or path, or null when it is not a model. */
export function modelFormatOf(path: string): ModelFormat | null {
  const name = modelFileName(path);
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return null;
  return FORMAT_BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? null;
}

/** Sort model entries by loader preference, then by path for stable output. */
export function listModelCandidates(
  entries: readonly ModelCandidateEntry[],
): ModelCandidate[] {
  const candidates: ModelCandidate[] = [];
  for (const entry of entries) {
    const format = modelFormatOf(entry.path);
    if (!format) continue;
    candidates.push({
      path: entry.path,
      name: modelFileName(entry.path),
      format,
      bytes: entry.bytes ?? 0,
    });
  }
  return candidates.sort((a, b) =>
    MODEL_FORMAT_RANK[a.format] - MODEL_FORMAT_RANK[b.format] ||
    a.path.localeCompare(b.path));
}

/**
 * Default pick for a multi-model archive: skip obvious props such as weapons
 * and closed-eye variants, then fall back to the highest-ranked candidate.
 */
export function defaultModelCandidate(
  candidates: readonly ModelCandidate[],
  disabledFormats: readonly ModelFormat[] = [],
): ModelCandidate | undefined {
  const usable = candidates.filter((candidate) => !disabledFormats.includes(candidate.format));
  const pool = usable.length ? usable : candidates;
  return pool.find((candidate) => !/(weapon|闭眼)/i.test(candidate.name)) ?? pool[0];
}
