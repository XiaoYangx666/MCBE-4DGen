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
  assert.equal(BUILD_LABEL, CURRENT_BUILD.build);
  assert.match(CURRENT_BUILD.build, /^#\d+$/);

  const builds = new Set<string>();
  const numbers = CHANGELOG.map((entry) => {
    assert.ok(!builds.has(entry.build), `duplicate build ${entry.build}`);
    builds.add(entry.build);
    assert.match(entry.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(entry.title.trim());
    assert.ok(entry.changes.length > 0);
    const match = /^#(\d+)$/.exec(entry.build);
    assert.ok(match, `invalid build ${entry.build}`);
    return Number(match![1]);
  });
  for (let index = 1; index < numbers.length; index++)
    assert.equal(
      numbers[index],
      numbers[index - 1]! - 1,
      'build numbers must be contiguous and newest-first',
    );
});
