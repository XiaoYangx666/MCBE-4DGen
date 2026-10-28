import { describe, expect, it } from 'vitest';
import {
  demandOf,
  solveBudget,
  type ChartDemand,
} from '../scripts/research/atlas/core/budget.ts';

const chart = (id: string, extra: Partial<ChartDemand> = {}): ChartDemand => ({
  id,
  worldArea: 1,
  sourceTexels: 1000,
  bboxSourceTexels: 1000,
  aspect: 1,
  minEdge: 3,
  weight: 1,
  ...extra,
});

const areaOf = (outcome: ReturnType<typeof solveBudget>, id: string) => {
  const found = outcome.allocations.find((allocation) => allocation.id === id)!;
  return found.width * found.height;
};

describe('texel-density budget', () => {
  it('makes texel density linear in the weight', () => {
    const outcome = solveBudget(
      [chart('a', { weight: 1 }), chart('b', { weight: 2 })],
      { size: 128, pad: 1, target: 'density' },
    );
    const ratio = areaOf(outcome, 'b') / areaOf(outcome, 'a');
    // Area ratio 4 means density ratio 2 for equal world area.
    expect(ratio).toBeGreaterThan(3.8);
    expect(ratio).toBeLessThan(4.2);
  });

  it('doubling the weight doubles density relative to the other material', () => {
    const two = solveBudget([chart('a', { weight: 2 }), chart('b')], {
      size: 128,
      pad: 1,
      target: 'density',
    });
    const densityRatio = areaOf(two, 'a') / areaOf(two, 'b');
    // Equal world area, weights 2:1 -> density 2:1 -> area 4:1.
    expect(densityRatio).toBeGreaterThan(3.8);
    expect(densityRatio).toBeLessThan(4.2);
    // Absolute growth is smaller because the atlas is a fixed budget.
    const one = solveBudget([chart('a'), chart('b')], {
      size: 128,
      pad: 1,
      target: 'density',
    });
    const absolute = areaOf(two, 'a') / areaOf(one, 'a');
    expect(absolute).toBeGreaterThan(1.5);
    expect(absolute).toBeLessThan(1.8);
  });

  it('equalises native-texel retention when weights are equal', () => {
    const outcome = solveBudget(
      [
        chart('small', { sourceTexels: 1000 }),
        chart('large', { sourceTexels: 4000 }),
      ],
      { size: 128, pad: 1, target: 'retention' },
    );
    const small = areaOf(outcome, 'small') / 1000;
    const large = areaOf(outcome, 'large') / 4000;
    expect(Math.abs(small - large) / Math.max(small, large)).toBeLessThan(0.08);
  });

  it('makes retention linear in the weight', () => {
    const two = solveBudget([chart('a', { weight: 2 }), chart('b')], {
      size: 128,
      pad: 1,
      target: 'retention',
    });
    const retention = areaOf(two, 'a') / areaOf(two, 'b');
    expect(retention).toBeGreaterThan(1.85);
    expect(retention).toBeLessThan(2.15);
  });

  it('reports the technical floor instead of pretending a weight works', () => {
    const charts = [
      chart('hero', { worldArea: 500, sourceTexels: 500_000 }),
      ...Array.from({ length: 30 }, (_, index) =>
        chart(`tiny${index}`, { worldArea: 0.001, sourceTexels: 100 }),
      ),
    ];
    const outcome = solveBudget(charts, { size: 128, pad: 1, target: 'density' });
    const tiny = outcome.allocations.filter((allocation) => allocation.id.startsWith('tiny'));
    expect(tiny.every((allocation) => allocation.floorBound)).toBe(true);
    expect(outcome.floorBoundCharts).toBe(30);
    expect(
      outcome.allocations.find((allocation) => allocation.id === 'hero')!.floorBound,
    ).toBe(false);
  });

  it('never exceeds the atlas, including gutters', () => {
    for (const target of ['density', 'retention', 'legacy'] as const) {
      const charts = Array.from({ length: 18 }, (_, index) =>
        chart(`c${index}`, {
          worldArea: 0.01 * (index + 1),
          sourceTexels: 500 * (index + 1),
          aspect: 0.5 + (index % 3),
        }),
      );
      const outcome = solveBudget(charts, { size: 128, pad: 1, target });
      expect(outcome.allocatedPixels).toBeLessThanOrEqual(128 * 128);
    }
  });

  it('keeps the legacy curve available for comparison only', () => {
    const legacy = demandOf(chart('a', { worldArea: 16 }), 'legacy');
    expect(legacy).toBeCloseTo(Math.pow(16, 0.85), 8);
    const density = demandOf(chart('a', { worldArea: 16 }), 'density');
    expect(density).toBe(16);
  });

  it('is deterministic', () => {
    const charts = Array.from({ length: 12 }, (_, index) =>
      chart(`c${index}`, { worldArea: 0.1 + index * 0.07, aspect: 0.4 + index * 0.1 }),
    );
    const a = solveBudget(charts, { size: 128, pad: 1, target: 'density' });
    const b = solveBudget(charts, { size: 128, pad: 1, target: 'density' });
    expect(a.allocations).toEqual(b.allocations);
  });
});
