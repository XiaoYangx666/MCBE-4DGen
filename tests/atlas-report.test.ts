import { test } from 'vitest';
import assert from 'node:assert/strict';
import { planAtlasBudget } from '../src/atlas-core/plan.ts';
import { summarizePlan } from '../src/atlas-core/report.ts';
import type { ChartInput } from '../src/atlas-core/types.ts';

const quad = (id: string, partIndex: number[]): ChartInput => ({
  id,
  material: 'Body',
  materialKey: id === 'a' ? 'm:Body#1' : 'm:Body#2',
  texture: { width: 256, height: 256, key: 'tex' },
  color: [1, 1, 1],
  opacity: 1,
  alphaMode: 'OPAQUE',
  alphaCutoff: 0.5,
  wrap: ['repeat', 'repeat'],
  bounds: [0, 0, 1, 1],
  uvs: Float32Array.from([
    0, 0, 1, 0, 1, 1,
    0, 0, 1, 1, 0, 1,
  ]),
  triangleAreas: Float32Array.from([0.5, 0.5]),
  area: 1,
  partIndex: Uint16Array.from(partIndex),
  parts: [
    { id: 'p0', name: 'body' },
    { id: 'p1', name: 'prop' },
  ],
});

test('summarizePlan reports per-material and per-part demand', () => {
  const a = quad('a', [0, 0]);
  const b = quad('b', [1, 1]);
  const plan = planAtlasBudget([a, b], {
    size: 128,
    pad: 1,
    target: 'retention',
    coverageAware: false,
    sharing: 'safe',
    merge: 'none',
  });
  const report = summarizePlan([a, b], plan.plan, {
    sharedSavedPixels: plan.budget.sharedSavedPixels,
  });
  assert.equal(report.slots, 1);
  assert.equal(report.charts, 2);
  assert.equal(report.sharedCharts, 2);
  assert.ok(report.sharedSavedPixels > 0);
  // Shared rectangle is counted once.
  const rect = plan.plan.charts[0]!.rect;
  assert.equal(
    report.contentPixels,
    (rect.width - rect.pad * 2) * (rect.height - rect.pad * 2),
  );
  assert.equal(report.materials.length, 2);
  for (const material of report.materials) {
    assert.ok(material.atlasTexels > 0);
    assert.ok(material.uvPixels > 0);
    assert.equal(material.wastePixels, 0);
  }
  assert.equal(report.parts.length, 2);
  assert.ok(report.parts.every((part) => part.triangles === 2));
  assert.ok(report.parts.every((part) => part.atlasTexels > 0));
});

test('summarizePlan flags floor-bound charts and requested area', () => {
  const tiny: ChartInput = {
    ...quad('tiny', [0, 0]),
    materialKey: 'm:tiny#1',
    bounds: [0, 0, 0.01, 0.01],
    uvs: Float32Array.from([
      0, 0, 0.01, 0, 0.01, 0.01,
      0, 0, 0.01, 0.01, 0, 0.01,
    ]),
    triangleAreas: Float32Array.from([0.0001, 0.0001]),
    area: 0.0002,
  };
  const big: ChartInput = {
    ...quad('big', [0, 0]),
    materialKey: 'm:big#1',
    area: 10,
    triangleAreas: Float32Array.from([5, 5]),
  };
  const plan = planAtlasBudget([tiny, big], {
    size: 128,
    pad: 1,
    target: 'density',
    coverageAware: false,
    sharing: 'none',
    merge: 'none',
  });
  const floors = new Set(plan.charts.filter((chart) => chart.floorBound).map((chart) => chart.chartId));
  const targets = new Map(plan.charts.map((chart) => [chart.chartId, chart.targetArea]));
  const report = summarizePlan([tiny, big], plan.plan, { floorBound: floors, targetArea: targets });
  assert.ok(report.materials.some((material) => material.floorCharts === 1));
  assert.ok(report.materials.every((material) => material.targetArea >= 0));
});
