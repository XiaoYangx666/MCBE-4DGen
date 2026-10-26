import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const engine = fileURLToPath(new URL('../webapp/engine', import.meta.url));

const FORBIDDEN_IMPORTS = [
  /^import\b.*\bfrom\s+['"]react(?:\/|['"])/,
  /^import\b.*\bfrom\s+['"]react-dom(?:\/|['"])/,
  /^import\b.*\bfrom\s+['"]\.\.\/components\//,
  /^import\b.*\bfrom\s+['"]\.\.\/lib\//,
  /^import\b.*\bfrom\s+['"]\.\.\/App(?:\.tsx?)?['"]/,
  /^import\b.*\bfrom\s+['"]node:/,
];

describe('webapp engine boundary', () => {
  it('keeps the browser conversion engine free of React and app state', async () => {
    const files = (await readdir(engine)).filter((name) => /\.(ts|tsx)$/.test(name));
    expect(files.length).toBeGreaterThan(0);
    const violations: string[] = [];
    for (const name of files) {
      const source = await readFile(join(engine, name), 'utf8');
      for (const line of source.split(/\r?\n/)) {
        if (FORBIDDEN_IMPORTS.some((pattern) => pattern.test(line))) {
          violations.push(`${name}: ${line.trim()}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
