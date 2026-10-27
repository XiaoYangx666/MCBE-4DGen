import { normalizePath } from './paths.ts';

interface Entry {
  file: File;
  /** Archive-relative path, lower-cased. */
  path: string;
  /** Path relative to the selected model's directory, lower-cased. */
  local: string | null;
  base: string;
}

export interface ResourceIndex {
  /** Files with the selected model's own directory first. */
  readonly files: readonly File[];
  /** Archive-relative path of a file without the model's directory prefix. */
  localPath(file: File): string | null;
  /** Resolve a reference from the selected model, then the archive root, then by name. */
  find(raw: string): File | undefined;
}

const baseOf = (path: string) => path.slice(path.lastIndexOf('/') + 1);

const dirOf = (path: string) => {
  const at = path.lastIndexOf('/');
  return at < 0 ? '' : path.slice(0, at);
};

/** Join a relative reference onto a directory, resolving `.` and `..`. */
export function joinModelPath(directory: string, relative: string): string {
  const parts = directory ? directory.split('/') : [];
  const out = [...parts];
  for (const part of relative.replaceAll('\\', '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

/**
 * Archives often contain several models that reuse texture names. Looking
 * files up by basename alone can then mix one model's textures into another,
 * so prefer paths relative to the model the user picked before falling back
 * to the archive root and finally to a bare filename match.
 */
export function indexResources(files: readonly File[], mainPath: string): ResourceIndex {
  const main = normalizePath(mainPath, { lowerCase: true });
  const modelDir = dirOf(main);
  const entries: Entry[] = files.map((file) => {
    const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
    const path = normalizePath(relative || file.name, { lowerCase: true });
    const local = modelDir && path.startsWith(`${modelDir}/`)
      ? path.slice(modelDir.length + 1)
      : modelDir
        ? null
        : path;
    return { file, path, local, base: baseOf(path) };
  });
  const byPath = new Map<string, Entry>();
  const byLocalBase = new Map<string, Entry>();
  const byBase = new Map<string, Entry>();
  for (const entry of entries) {
    if (!byPath.has(entry.path)) byPath.set(entry.path, entry);
    if (entry.local && !byLocalBase.has(entry.base)) byLocalBase.set(entry.base, entry);
    if (!byBase.has(entry.base)) byBase.set(entry.base, entry);
  }
  const localFirst = [
    ...entries.filter((entry) => entry.local !== null),
    ...entries.filter((entry) => entry.local === null),
  ];
  const suffixMatch = (path: string) =>
    entries.find((entry) => entry.path.endsWith(`/${path}`));

  return {
    files: localFirst.map((entry) => entry.file),
    localPath(file) {
      return entries.find((entry) => entry.file === file)?.local ?? null;
    },
    find(raw) {
      const path = normalizePath(raw, { lowerCase: true });
      if (!path) return undefined;
      const local = joinModelPath(modelDir, path);
      return (byPath.get(local) ?? byPath.get(path))?.file
        ?? byLocalBase.get(baseOf(path))?.file
        ?? byBase.get(baseOf(path))?.file
        ?? suffixMatch(path)?.file;
    },
  };
}
