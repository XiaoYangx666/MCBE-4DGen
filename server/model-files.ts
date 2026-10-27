import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { IMPORTABLE_MODEL_EXTENSIONS } from '../src/model-candidates.ts';

/** Extensions the desktop importer can open, shared with the browser build. */
export const modelPattern = new RegExp(
  `\\.(${IMPORTABLE_MODEL_EXTENSIONS.join('|')})$`,
  'i',
);

/** Recursively list importable model files without following links. */
export async function modelFiles(folder: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const path = resolve(folder, entry.name);
    if (entry.isDirectory()) files.push(...(await modelFiles(path)));
    else if (modelPattern.test(path)) files.push(path);
  }
  return files;
}
