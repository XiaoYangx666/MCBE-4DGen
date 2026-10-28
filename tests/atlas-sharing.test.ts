import { test } from 'vitest';
import assert from 'node:assert/strict';
import { planAtlasBudget } from '../src/atlas-core/plan.ts';
import type { ChartInput } from '../src/atlas-core/types.ts';

const quad = (
  id: string,
  material: string,
  materialKey: string,
  triangle0: number[],
  triangle1: number[],
): ChartInput => ({
  id,
  material,
  materialKey,
  texture: { width: 256, height: 256, key: 'shared-texture' },
  color: [1, 1, 1],
  opacity: 1,
  alphaMode: 'OPAQUE',
  alphaCutoff: 0.5,
  wrap: ['repeat', 'repeat'],
  bounds: [0, 0, 1, 1],
  uvs: Float32Array.from([...triangle0, ...triangle1]),
  triangleAreas: Float32Array.from([0.5, 0.5]),
  area: 1,
});

const plan = (inputs: ChartInput[]) =>
  planAtlasBudget(inputs, {
    size: 128,
    pad: 1,
    target: 'retention',
    coverageAware: false,
    sharing: 'safe',
    merge: 'none',
  });

const rectOf = (result: ReturnType<typeof plan>, chartId: string) => {
  const chart = result.plan.charts.find((entry) => entry.chartId === chartId)!;
  return `${chart.rect.x},${chart.rect.y},${chart.rect.width},${chart.rect.height}`;
};

test('safe sharing only overlays charts with bit-identical UVs', () => {
  const a = quad(
    'a',
    'A',
    'k:a',
    [0, 0, 1, 0, 1, 1],
    [0, 0, 1, 1, 0, 1],
  );
  const b = quad(
    'b',
    'B',
    'k:b',
    [0, 0, 1, 0, 0, 1],
    [1, 0, 1, 1, 0, 1],
  );
  const result = plan([a, b]);
  // Same texture, same bbox, same sampler, different interior mapping.
  assert.equal(result.plan.charts.find((chart) => chart.chartId === 'a#0')!.origin, 'island');
  assert.equal(result.plan.charts.find((chart) => chart.chartId === 'b#0')!.origin, 'island');
  assert.notEqual(rectOf(result, 'a#0'), rectOf(result, 'b#0'));
  assert.equal(result.budget.sharedCharts, 0);
});

test('safe sharing overlays identical charts and counts the saved rect once', () => {
  const a = quad('a', 'A', 'k:a', [0, 0, 1, 0, 1, 1], [0, 0, 1, 1, 0, 1]);
  const b = quad('b', 'B', 'k:b', [0, 0, 1, 0, 1, 1], [0, 0, 1, 1, 0, 1]);
  const result = plan([a, b]);
  assert.equal(rectOf(result, 'a#0'), rectOf(result, 'b#0'));
  assert.equal(result.plan.charts[0]!.origin, 'shared');
  assert.equal(result.plan.charts[1]!.origin, 'shared');
  assert.equal(result.budget.sharedCharts, 2);
  assert.ok(result.budget.sharedSavedPixels > 0);
  // Content/allocated are per slot, never double counted.
  const rect = result.plan.charts[0]!.rect;
  assert.equal(
    result.budget.contentPixels,
    (rect.width - rect.pad * 2) * (rect.height - rect.pad * 2),
  );
});

test('duplicate display names keep distinct material keys', () => {
  const a = quad('a', 'Body', 'k:body-1', [0, 0, 0.5, 0, 0.5, 1], [0, 0, 0.5, 1, 0, 1]);
  const b = quad('b', 'Body', 'k:body-2', [0.5, 0, 1, 0, 1, 1], [0.5, 0, 1, 1, 0.5, 1]);
  const result = planAtlasBudget([a, b], {
    size: 128,
    pad: 1,
    target: 'retention',
    coverageAware: false,
    sharing: 'none',
    merge: 'none',
    weights: { 'k:body-2': 4 },
  });
  const first = result.plan.charts.find((chart) => chart.chartId === 'a#0')!;
  const second = result.plan.charts.find((chart) => chart.chartId === 'b#0')!;
  assert.deepEqual(first.materialKeys, ['k:body-1']);
  assert.deepEqual(second.materialKeys, ['k:body-2']);
  assert.ok(
    second.rect.width * second.rect.height > first.rect.width * first.rect.height,
  );
});
