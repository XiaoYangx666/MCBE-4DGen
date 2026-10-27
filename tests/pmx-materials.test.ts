import { describe, expect, it } from 'vitest';
import { planPmxMaterials } from '../src/pmx-materials.ts';

describe('shared PMX material plan', () => {
  it('restores names, diffuse alpha and the double-sided flag in order', () => {
    const plan = planPmxMaterials([
      { name: 'Hair_Bangs', alpha: 1, doubleSided: true },
      { name: 'Hair_Bangs+', alpha: 0.6, doubleSided: false },
    ], 2);
    expect(plan).toEqual([
      { name: 'Hair_Bangs', alpha: 1, doubleSided: true, alphaMode: 'BLEND' },
      { name: 'Hair_Bangs+', alpha: 0.6, doubleSided: false, alphaMode: 'BLEND' },
    ]);
  });

  it('clamps out-of-range alpha instead of producing invalid pixels', () => {
    const plan = planPmxMaterials([{ name: 'a', alpha: 1.4, doubleSided: false }], 1);
    expect(plan?.[0]?.alpha).toBe(1);
  });

  it('returns null when the converted material count does not match', () => {
    expect(planPmxMaterials([{ name: 'a', alpha: 1, doubleSided: false }], 2)).toBeNull();
    expect(planPmxMaterials([], 1)).toBeNull();
  });
});
