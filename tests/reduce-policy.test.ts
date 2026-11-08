import { describe, expect, it } from 'vitest';
import {
  isValidReduceMaxError,
  isValidReduceRatio,
  partReduceRatio,
  REDUCE_ATTRIBUTE_WEIGHTS,
  REDUCE_SIMPLIFY_OPTIONS,
  sanitizePartRatios,
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

  it('resolves per-part overrides and falls back to the global ratio', () => {
    const ratios = { head: 0.6, body: 0.1 };
    expect(partReduceRatio('head', 0.2, ratios)).toBe(0.6);
    expect(partReduceRatio('body', 0.2, ratios)).toBe(0.1);
    expect(partReduceRatio('arms', 0.2, ratios)).toBe(0.2);
    expect(partReduceRatio(undefined, 0.2, ratios)).toBe(0.2);
    expect(partReduceRatio('head', 0.2, undefined)).toBe(0.2);
    // Invalid stored values must never reach the simplifier.
    expect(partReduceRatio('head', 0.2, { head: 0 })).toBe(0.2);
    expect(partReduceRatio('head', 0.2, { head: 2 })).toBe(0.2);
  });

  it('sanitizes persisted part ratios', () => {
    expect(sanitizePartRatios(undefined)).toEqual({});
    expect(sanitizePartRatios([0.5])).toEqual({});
    expect(
      sanitizePartRatios({ head: 0.5, body: 0, arms: 1.2, legs: '0.2', ok: 1 }),
    ).toEqual({ head: 0.5, ok: 1 });
    expect(
      sanitizePartRatios(JSON.parse('{"__proto__":{"polluted":true},"head":0.5}')),
    ).toEqual({ head: 0.5 });
  });
});
