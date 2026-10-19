import { test, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { storageUsage } from '../server/storage-usage.ts';

test('storage usage counts categories, nested files and root extras without following directory links', async () => {
  const root = await mkdtemp(join(tmpdir(), '4d-usage-')),
    outside = await mkdtemp(join(tmpdir(), '4d-outside-'));
  try {
    for (const name of ['sources', 'models', 'skins', 'cache'])
      await mkdir(join(root, name, 'nested'), { recursive: true });
    await writeFile(join(root, 'sources/nested/a'), Buffer.alloc(101));
    await writeFile(join(root, 'models/a'), Buffer.alloc(11));
    await writeFile(join(root, 'skins/a'), Buffer.alloc(37));
    await writeFile(join(root, 'cache/a'), Buffer.alloc(59));
    await writeFile(join(root, 'extra'), Buffer.alloc(7));
    await writeFile(join(outside, 'do-not-count'), Buffer.alloc(300));
    await symlink(
      outside,
      join(root, 'sources/external'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const usage = await storageUsage(root);
    expect(usage.bytes).toBe(215);
    expect(usage.files).toBe(5);
    expect(usage.categories.sources?.bytes).toBe(101);
    expect(usage.categories.other?.bytes).toBe(7);
    expect(usage.skipped).toBe(0);
    expect(usage.disk?.availableBytes).toBeGreaterThan(0);
    await writeFile(join(root, 'cache/a'), Buffer.alloc(100));
    expect((await storageUsage(root)).bytes).toBe(256);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
