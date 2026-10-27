import { describe, expect, it } from 'vitest';
import {
  backMultiplier,
  materialLabels,
  modelResultKey,
  sourceTriangleCount,
} from '../webapp/engine/model-job.ts';
import type { SourceBatch } from '../webapp/engine/types.ts';

function batch(
  key: string,
  name: string,
  triangles: number,
  doubleSided = false,
): SourceBatch {
  return {
    key,
    name,
    positions: new Float32Array(0),
    normals: new Float32Array(0),
    uvs: null,
    color: [1, 1, 1],
    opacity: 1,
    alphaMode: 'BLEND',
    alphaCutoff: 0.5,
    doubleSided,
    texture: null,
    uvBounds: null,
    triangles,
    area: 1,
  };
}

describe('browser model job helpers', () => {
  it('applies the double-sided face multiplier', () => {
    const single = batch('a', 'Body', 10, false);
    const double = batch('b', 'Cloth', 10, true);
    expect(backMultiplier(single, 'source')).toBe(1);
    expect(backMultiplier(double, 'source')).toBe(2);
    expect(backMultiplier(double, 'front')).toBe(1);
    expect(backMultiplier(single, 'all')).toBe(2);
  });

  it('counts only included materials with their final backfaces', () => {
    const batches = [
      batch('body', 'Body', 10, false),
      batch('cloth', 'Cloth', 20, true),
      batch('skip', 'Skip', 100, true),
    ];
    expect(sourceTriangleCount(batches, new Set(['body', 'cloth']), 'source')).toBe(50);
    expect(sourceTriangleCount(batches, new Set(['body', 'cloth']), 'front')).toBe(30);
    expect(sourceTriangleCount(batches, new Set(['body', 'cloth']), 'all')).toBe(60);
  });

  it('numbers duplicate material display names', () => {
    const labels = materialLabels([
      batch('a', 'Body', 1),
      batch('b', 'Body', 1),
      batch('c', 'Cloth', 1),
      batch('d', 'Body', 1),
    ]);
    expect(labels.get('a')).toBe('Body #1');
    expect(labels.get('b')).toBe('Body #2');
    expect(labels.get('c')).toBe('Cloth');
    expect(labels.get('d')).toBe('Body #3');
  });

  it('keeps the stale-result key stable and order-independent', () => {
    const base = {
      name: ' Skin ',
      height: 32,
      rotationY: 0,
      armSpread: 0,
      doubleSided: 'source' as const,
      ratio: 0.2,
      maxError: 0.03,
      included: new Set(['b', 'a']),
      weights: { b: 2, a: 1 },
      modelTriangles: 100,
    };
    expect(modelResultKey(base)).toBe(modelResultKey({
      ...base,
      included: new Set(['a', 'b']),
      weights: { a: 1, b: 2 },
    }));
    expect(modelResultKey(base)).not.toBe(modelResultKey({ ...base, height: 33 }));
  });
});
