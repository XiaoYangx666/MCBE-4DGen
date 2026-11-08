import { test } from 'vitest';
import assert from 'node:assert/strict';
import { growPackedBoxes, packBoxes, type PackBox } from '../src/atlas-core/pack.ts';

const overlaps = (
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) =>
  a.x < b.x + b.width &&
  a.x + a.width > b.x &&
  a.y < b.y + b.height &&
  a.y + a.height > b.y;

test('growth spends atlas area that uniform scaling leaves empty', () => {
  const boxes: PackBox[] = [
    { key: 'a', width: 40, height: 40 },
    { key: 'b', width: 40, height: 40 },
  ];
  const packed = packBoxes(boxes, 128, 0);
  assert.ok(packed);
  const before = [...packed.chosen.values()].reduce(
    (sum, size) => sum + size.width * size.height,
    0,
  );
  const grown = growPackedBoxes(boxes, 128, 0, packed);
  const after = [...grown.chosen.values()].reduce(
    (sum, size) => sum + size.width * size.height,
    0,
  );
  assert.ok(grown.grown > 0);
  assert.ok(after > before * 1.5);
  const rects = [...grown.rects.values()];
  for (let i = 0; i < rects.length; i++)
    for (let j = i + 1; j < rects.length; j++)
      assert.ok(!overlaps(rects[i]!, rects[j]!), 'grown rectangles must not overlap');
  for (const rect of rects)
    assert.ok(
      rect.x >= 0 &&
        rect.y >= 0 &&
        rect.x + rect.width <= 128 &&
        rect.y + rect.height <= 128,
    );
});

test('growth keeps the aspect ratio and skips flat charts', () => {
  const boxes: PackBox[] = [
    { key: 'wide', width: 60, height: 30 },
    { key: 'small', width: 10, height: 10 },
    { key: 'flat', width: 1, height: 1, growable: false },
  ];
  const packed = packBoxes(boxes, 128, 0);
  assert.ok(packed);
  const grown = growPackedBoxes(boxes, 128, 0, packed);
  assert.equal(grown.chosen.get('flat')!.width, 1);
  for (const key of ['wide', 'small']) {
    const before: { width: number; height: number } = packed.chosen.get(key)!;
    const after: { width: number; height: number } = grown.chosen.get(key)!;
    const ratio: number = before.width / before.height;
    const grownRatio: number = after.width / after.height;
    assert.ok(Math.abs(grownRatio - ratio) < 0.12, `${key} aspect drifted`);
  }
});
