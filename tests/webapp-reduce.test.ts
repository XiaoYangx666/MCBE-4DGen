import { describe, expect, it } from 'vitest';
import { reduceBatches } from '../webapp/engine/reduce.ts';
import type { SourceBatch } from '../webapp/engine/types.ts';

/** A flat grid of `size × size` quads, as unwelded triangle soup. */
function grid(size: number): SourceBatch {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const push = (x: number, z: number) => {
    positions.push(x / size, 0, z / size);
    normals.push(0, 1, 0);
    uvs.push(x / size, z / size);
  };
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      push(x, z); push(x + 1, z); push(x + 1, z + 1);
      push(x, z); push(x + 1, z + 1); push(x, z + 1);
    }
  }
  return {
    key: 'mat',
    name: '测试材质',
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    color: [1, 1, 1],
    opacity: 1,
    alphaMode: 'BLEND',
    alphaCutoff: 0.5,
    doubleSided: false,
    texture: null,
    uvBounds: [0, 0, 1, 1],
    triangles: positions.length / 9,
    area: 1,
  };
}

describe('webapp mesh reduction', () => {
  it('keeps the requested share of triangles and matching attribute arrays', async () => {
    const source = grid(8);
    const result = await reduceBatches([source], { ratio: 0.5, maxError: 0.03 });

    expect(result.before).toBe(128);
    expect(result.after).toBeGreaterThan(0);
    expect(result.after).toBeLessThanOrEqual(70);
    const reduced = result.batches[0]!;
    expect(reduced.triangles).toBe(result.after);
    expect(reduced.positions.length).toBe(result.after * 9);
    expect(reduced.normals.length).toBe(result.after * 9);
    expect(reduced.uvs!.length).toBe(result.after * 6);
    expect(result.warnings.join()).toMatch(/减面/);
    expect(source.triangles).toBe(128);
  });

  it('reduces each player part separately and keeps one code per triangle', async () => {
    const source = grid(8);
    source.parts = Uint8Array.from(
      { length: source.triangles },
      (_, index) => index % 2,
    );
    const result = await reduceBatches([source], { ratio: 0.5, maxError: 0.03 });
    const reduced = result.batches[0]!;
    expect(reduced.parts).toBeInstanceOf(Uint8Array);
    expect(reduced.parts!.length).toBe(reduced.triangles);
    expect(new Set(reduced.parts)).toEqual(new Set([0, 1]));
  });

  it('passes batches through unchanged at 100%', async () => {
    const source = grid(4);
    const result = await reduceBatches([source], { ratio: 1, maxError: 0.03 });
    expect(result.batches[0]).toBe(source);
    expect(result.warnings).toEqual([]);
  });

  it('reports per-material progress for the UI', async () => {
    const calls: [number, number, string][] = [];
    await reduceBatches([grid(4), { ...grid(4), key: 'mat2', name: '第二材质' }], {
      ratio: 0.5,
      maxError: 0.03,
      onProgress: (done, total, name) => calls.push([done, total, name]),
    });
    expect(calls).toEqual([
      [0, 2, '测试材质'],
      [1, 2, '第二材质'],
      [2, 2, ''],
    ]);
  });

  it('rejects out-of-range settings', async () => {
    await expect(reduceBatches([grid(2)], { ratio: 0, maxError: 0.03 })).rejects.toThrow(/1%–100%/);
    await expect(reduceBatches([grid(2)], { ratio: 0.5, maxError: -1 })).rejects.toThrow(/不能为负数/);
  });
});
