import { test } from 'vitest';
import assert from 'node:assert/strict';
import { planAtlasBudget } from '../src/atlas-core/plan.ts';
import type { ChartInput } from '../src/atlas-core/types.ts';

const chart = (id: string, worldArea: number, textureSize: number): ChartInput => ({
  id,
  material: id,
  materialKey: id,
  texture: { width: textureSize, height: textureSize, key: `texture-${id}` },
  color: [1, 1, 1],
  opacity: 1,
  alphaMode: 'OPAQUE',
  alphaCutoff: 0.5,
  wrap: ['repeat', 'repeat'],
  bounds: [0, 0, 1, 1],
  uvs: Float32Array.from([0, 0, 1, 0, 1, 1]),
  triangleAreas: Float32Array.from([worldArea]),
  area: worldArea,
});

const plan = (target: 'density' | 'retention' | 'balanced') =>
  planAtlasBudget(
    [
      // Huge on screen, but sampled from a tiny flat-ish texture.
      chart('big', 1000, 32),
      // Tiny on screen, but sampled from a detailed 4K texture.
      chart('detail', 1, 4096),
    ],
    { size: 128, pad: 0, target, coverageAware: false, merge: 'none' },
  );

const share = (target: 'density' | 'retention' | 'balanced') => {
  const result = plan(target);
  const total = result.charts.reduce((sum, entry) => sum + entry.targetArea, 0);
  const big = result.charts.find((entry) => entry.chartId.startsWith('big'))!;
  return big.targetArea / total;
};

test('balanced allocation blends area and source-detail shares', () => {
  const density = share('density');
  const retention = share('retention');
  const balanced = share('balanced');
  assert.ok(density > 0.9, `density share was ${density}`);
  assert.ok(retention < 0.1, `retention share was ${retention}`);
  // Raw units must not dominate: the balanced big-material share sits between
  // the two bases, around one half.
  assert.ok(balanced > 0.35 && balanced < 0.65, `balanced share was ${balanced}`);
  assert.ok(balanced < density && balanced > retention);
});
