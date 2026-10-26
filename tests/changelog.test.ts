import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  BUILD_LABEL,
  CHANGELOG,
  CURRENT_BUILD,
} from '../web/shared/build-log.ts';

test('build log is newest-first, unique and drives the visible build label', () => {
  assert.ok(CHANGELOG.length >= 1);
  assert.equal(CURRENT_BUILD, CHANGELOG[0]);
  assert.equal(BUILD_LABEL, `BETA ${CURRENT_BUILD.build}`);
  assert.match(CURRENT_BUILD.build, /^\d{4}\.\d{2}\.\d{2}\.\d+$/);

  const builds = new Set<string>();
  for (const [index, entry] of CHANGELOG.entries()) {
    assert.ok(!builds.has(entry.build), `duplicate build ${entry.build}`);
    builds.add(entry.build);
    assert.match(entry.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(entry.title.trim());
    assert.ok(entry.changes.length > 0);
    if (index > 0)
      assert.ok(
        entry.build < CHANGELOG[index - 1]!.build,
        `${entry.build} should sort after ${CHANGELOG[index - 1]!.build}`,
      );
  }
});
