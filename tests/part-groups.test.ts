import { test } from 'vitest';
import assert from 'node:assert/strict';
import { semanticPartGroup } from '../src/part-groups.ts';

test('semantic groups isolate YSM submodels below the nearest skeleton joint', () => {
  assert.equal(
    semanticPartGroup(['Root', 'MAllbody', 'UpBody', 'MTail', 'Tail2']),
    'Tail',
  );
  assert.equal(
    semanticPartGroup(['Root', 'MAllbody', 'UpBody', 'UpperBody', 'Head', 'Hair', 'BaseHair']),
    'Hair',
  );
  assert.equal(
    semanticPartGroup(['Root', 'FOX', 'AllBody2', 'UpBody2', 'UpperBody2', 'Head2']),
    'FOX',
  );
  assert.equal(
    semanticPartGroup(['Root', 'MAllbody', 'UpBody', 'Arm', 'LeftArm', 'LeftArm']),
    'LeftArm',
  );
  assert.equal(semanticPartGroup(['__ysm_hips', 'Root', 'FOX', 'FoxBody']), 'FOX');
});

test('non-skeletal meshes keep their previous grouping fallback', () => {
  assert.equal(semanticPartGroup(['scene', 'weapon', 'blade']), undefined);
  assert.equal(semanticPartGroup([]), undefined);
});
