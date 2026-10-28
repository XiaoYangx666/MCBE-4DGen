/**
 * Deterministic CPU rasterizer / sampler used by the research harness.
 *
 * Production drawing lives behind two platform adapters (`sharp` on the
 * desktop, canvas in the browser). Research experiments need one renderer for
 * every candidate so planner differences are not confounded by libvips vs
 * canvas resampling. This module is that renderer: pure arithmetic, no I/O.
 */
import { wrapIndex, type WrapMode } from '../../../src/texture-chart-math.ts';
import type { RgbaImage } from './types.ts';

export type Rgba = [number, number, number, number];

/** Bilinear sample with wrap modes; straight alpha, premultiplied blending. */
export function sampleBilinear(
  image: RgbaImage,
  u: number,
  v: number,
  wrapU: WrapMode,
  wrapV: WrapMode,
): Rgba {
  const { width, height, data } = image;
  if (width <= 0 || height <= 0) return [0, 0, 0, 0];
  const x = u * width - 0.5;
  const y = v * height - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  let red = 0;
  let green = 0;
  let blue = 0;
  let alpha = 0;
  for (let dy = 0; dy < 2; dy++) {
    const wy = dy === 0 ? 1 - fy : fy;
    if (wy === 0) continue;
    const sy = wrapIndex(y0 + dy, height, wrapV);
    for (let dx = 0; dx < 2; dx++) {
      const weight = (dx === 0 ? 1 - fx : fx) * wy;
      if (weight === 0) continue;
      const sx = wrapIndex(x0 + dx, width, wrapU);
      const index = (sy * width + sx) * 4;
      const a = (data[index + 3]! / 255) * weight;
      red += data[index]! * a;
      green += data[index + 1]! * a;
      blue += data[index + 2]! * a;
      alpha += a;
    }
  }
  if (alpha <= 0) return [0, 0, 0, 0];
  return [red / alpha, green / alpha, blue / alpha, alpha * 255];
}

/**
 * Footprint-averaged sample (box filter) with wrap modes.
 *
 * `[u0,u1) x [v0,v1)` is the source region covered by one destination texel.
 * When the footprint is smaller than a texel this falls back to bilinear so
 * upsampling stays smooth. Very large footprints are subsampled with a stride
 * so a 4K source into a 3 px chart stays bounded.
 */
export function sampleArea(
  image: RgbaImage,
  u0: number,
  v0: number,
  u1: number,
  v1: number,
  wrapU: WrapMode,
  wrapV: WrapMode,
): Rgba {
  const { width, height, data } = image;
  if (width <= 0 || height <= 0) return [0, 0, 0, 0];
  const x0 = Math.min(u0, u1) * width;
  const x1 = Math.max(u0, u1) * width;
  const y0 = Math.min(v0, v1) * height;
  const y1 = Math.max(v0, v1) * height;
  if (!(x1 - x0 > 1e-9) || !(y1 - y0 > 1e-9))
    return sampleBilinear(image, (u0 + u1) / 2, (v0 + v1) / 2, wrapU, wrapV);
  if (x1 - x0 <= 1 && y1 - y0 <= 1)
    return sampleBilinear(image, (u0 + u1) / 2, (v0 + v1) / 2, wrapU, wrapV);

  const span = Math.max(x1 - x0, y1 - y0);
  const stride = span > 96 ? Math.ceil(span / 96) : 1;
  let red = 0;
  let green = 0;
  let blue = 0;
  let alpha = 0;
  let total = 0;
  for (let ty = Math.floor(y0); ty < Math.ceil(y1); ty += stride) {
    const wy = Math.min(y1, ty + stride) - Math.max(y0, ty);
    if (wy <= 0) continue;
    const sy = wrapIndex(ty, height, wrapV);
    for (let tx = Math.floor(x0); tx < Math.ceil(x1); tx += stride) {
      const wx = Math.min(x1, tx + stride) - Math.max(x0, tx);
      if (wx <= 0) continue;
      const weight = wx * wy;
      const sx = wrapIndex(tx, width, wrapU);
      const index = (sy * width + sx) * 4;
      const a = (data[index + 3]! / 255) * weight;
      red += data[index]! * a;
      green += data[index + 1]! * a;
      blue += data[index + 2]! * a;
      alpha += a;
      total += weight;
    }
  }
  if (alpha <= 0 || total <= 0) return [0, 0, 0, 0];
  return [red / alpha, green / alpha, blue / alpha, (alpha / total) * 255];
}

/** sRGB byte to linear 0..1. */
export const toLinear = (value: number): number =>
  value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;

/** Linear 0..1 to sRGB byte. */
export const toSrgbByte = (value: number): number => {
  const clamped = Math.min(1, Math.max(0, value));
  const srgb =
    clamped <= 0.0031308
      ? 12.92 * clamped
      : 1.055 * clamped ** (1 / 2.4) - 0.055;
  return Math.round(srgb * 255);
};

/** Alpha semantics identical to `src/texture-pixels.ts`. */
export function resolveAlpha(
  alpha: number,
  mode: 'OPAQUE' | 'MASK' | 'BLEND',
  cutoff: number,
): number {
  const value = Math.min(1, Math.max(0, alpha));
  if (mode === 'OPAQUE') return 1;
  if (mode === 'MASK') return value >= cutoff ? 1 : 0;
  return value;
}

export interface BakeOptions {
  /** sRGB display color. */
  color: [number, number, number];
  opacity: number;
  alphaMode: 'OPAQUE' | 'MASK' | 'BLEND';
  alphaCutoff: number;
}

/** Bake base color + alpha into a linear RGBA sample (mirrors production). */
export function bakeSample(sample: Rgba, options: BakeOptions): Rgba {
  const [red, green, blue, alpha] = sample;
  return [
    toLinear(red / 255) * toLinear(options.color[0]),
    toLinear(green / 255) * toLinear(options.color[1]),
    toLinear(blue / 255) * toLinear(options.color[2]),
    resolveAlpha((alpha / 255) * options.opacity, options.alphaMode, options.alphaCutoff),
  ];
}

/** Decode an already-baked sRGB atlas pixel into linear RGBA. */
export function atlasPixelToLinear(
  pixels: Uint8Array,
  index: number,
): Rgba {
  return [
    toLinear(pixels[index]! / 255),
    toLinear(pixels[index + 1]! / 255),
    toLinear(pixels[index + 2]! / 255),
    pixels[index + 3]! / 255,
  ];
}

/** Bilinear sample of a baked atlas (clamp to edge, never wraps). */
export function sampleAtlasLinear(
  image: RgbaImage,
  u: number,
  v: number,
): Rgba {
  return sampleBilinear(image, u, v, 'clamp', 'clamp').map((value, channel) =>
    channel === 3 ? value / 255 : toLinear(value / 255),
  ) as Rgba;
}
