import { lstat, readdir, statfs } from 'node:fs/promises';
import { join } from 'node:path';

const CATEGORY_KEYS = ['sources', 'models', 'skins', 'cache', 'other'] as const;
type Category = (typeof CATEGORY_KEYS)[number];
type Usage = Record<Category, { bytes: number; files: number }>;

/** File-size accounting for the data directory; links are never followed. */
export async function storageUsage(root: string) {
  const categories = Object.fromEntries(
    CATEGORY_KEYS.map((key) => [key, { bytes: 0, files: 0 }]),
  ) as Usage;
  let skipped = 0;

  async function visit(folder: string, category?: Category): Promise<void> {
    let entries;
    try {
      entries = await readdir(folder, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') skipped++;
      return;
    }
    for (let index = 0; index < entries.length; index += 32) {
      await Promise.all(
        entries.slice(index, index + 32).map(async (entry) => {
          const key =
            category ??
            (Object.hasOwn(categories, entry.name) && entry.name !== 'other'
              ? (entry.name as Category)
              : 'other');
          if (entry.isSymbolicLink()) return;
          const path = join(folder, entry.name);
          try {
            const info = await lstat(path);
            if (info.isSymbolicLink()) return;
            if (info.isDirectory()) await visit(path, key);
            else if (info.isFile()) {
              categories[key].bytes += info.size;
              categories[key].files++;
            }
          } catch {
            skipped++;
          }
        }),
      );
    }
  }

  await visit(root);
  const disk = await statfs(root)
    .then((value) => ({
      availableBytes: value.bavail * value.bsize,
      totalBytes: value.blocks * value.bsize,
    }))
    .catch(() => null);
  return {
    root,
    categories,
    bytes: Object.values(categories).reduce(
      (sum, value) => sum + value.bytes,
      0,
    ),
    files: Object.values(categories).reduce(
      (sum, value) => sum + value.files,
      0,
    ),
    skipped,
    disk,
    measuredAt: new Date().toISOString(),
  };
}
