import { describe, expect, it } from 'vitest';
import {
  bakeBaseColorPixels,
  linearToSrgb,
  resolveAlpha,
  srgbToLinear,
} from '../src/texture-pixels.ts';

function pixels(values: number[]) {
  return new Uint8Array(values);
}

describe('shared base-color baking', () => {
  it('round-trips sRGB <-> linear', () => {
    for (const value of [0, 0.02, 0.25, 0.5, 0.75, 1]) {
      expect(linearToSrgb(srgbToLinear(value))).toBeCloseTo(value, 6);
    }
  });

  it('multiplies the factor in linear space, not on sRGB bytes', () => {
    const data = pixels([128, 128, 128, 255]);
    bakeBaseColorPixels(data, {
      factor: [0.5, 0.5, 0.5, 1],
      alphaMode: 'BLEND',
    });
    // Linear multiply: 128 -> ~92. Naive sRGB multiply would give 64.
    expect(data[0]).toBe(92);
    expect(data[0]).not.toBe(64);
  });

  it('keeps pixels untouched for a white opaque factor', () => {
    const data = pixels([10, 20, 30, 255]);
    bakeBaseColorPixels(data, {
      factor: [1, 1, 1, 1],
      alphaMode: 'OPAQUE',
    });
    expect([...data]).toEqual([10, 20, 30, 255]);
  });

  it('applies each alpha mode to the alpha channel', () => {
    const opaque = pixels([200, 200, 200, 0]);
    bakeBaseColorPixels(opaque, { factor: [1, 1, 1, 1], alphaMode: 'OPAQUE' });
    expect(opaque[3]).toBe(255);

    const mask = pixels([200, 200, 200, 100, 200, 200, 200, 200]);
    bakeBaseColorPixels(mask, { factor: [1, 1, 1, 1], alphaMode: 'MASK', alphaCutoff: 0.5 });
    expect([mask[3], mask[7]]).toEqual([0, 255]);

    const blend = pixels([200, 200, 200, 255]);
    bakeBaseColorPixels(blend, { factor: [1, 1, 1, 0.6], alphaMode: 'BLEND' });
    expect(blend[3]).toBe(153);
  });

  it('resolves alpha without touching RGB', () => {
    expect(resolveAlpha(0.4, 'OPAQUE')).toBe(1);
    expect(resolveAlpha(0.4, 'MASK', 0.5)).toBe(0);
    expect(resolveAlpha(0.6, 'MASK', 0.5)).toBe(1);
    expect(resolveAlpha(0.4, 'BLEND')).toBe(0.4);
  });

  it('rejects out-of-range factors', () => {
    expect(() => bakeBaseColorPixels(pixels([0, 0, 0, 0]), {
      factor: [1.2, 1, 1, 1],
      alphaMode: 'BLEND',
    })).toThrow(/Invalid base-color factor/);
  });
});
