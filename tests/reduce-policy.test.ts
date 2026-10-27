import { describe, expect, it } from 'vitest';
import {
  isValidReduceMaxError,
  isValidReduceRatio,
  REDUCE_ATTRIBUTE_WEIGHTS,
  REDUCE_SIMPLIFY_OPTIONS,
} from '../src/reduce-policy.ts';

describe('shared reduction policy', () => {
  it('accepts the workbench range and rejects out-of-range ratios', () => {
    for (const ratio of [0.01, 0.2, 0.999, 1]) expect(isValidReduceRatio(ratio)).toBe(true);
    for (const ratio of [0, -0.1, 1.01, Number.NaN, Number.POSITIVE_INFINITY])
      expect(isValidReduceRatio(ratio)).toBe(false);
  });

  it('accepts any finite non-negative error budget', () => {
    for (const value of [0, 0.03, 1]) expect(isValidReduceMaxError(value)).toBe(true);
    for (const value of [-0.01, Number.NaN]) expect(isValidReduceMaxError(value)).toBe(false);
  });

  it('keeps position/normal above UV in the attribute weights', () => {
    expect([...REDUCE_ATTRIBUTE_WEIGHTS]).toEqual([0.25, 0.25, 0.25, 1, 1]);
    expect([...REDUCE_SIMPLIFY_OPTIONS]).toEqual(['Permissive']);
  });
});
