/**
 * Pure RGBA sampling helpers shared by the platform adapters.
 *
 * The browser already samples through `sampleWrappedRgba`; the desktop adapter
 * needs footprint-aware sampling to resample a source region into a chart
 * without libvips per-chart pipelines. Both are deterministic and dependency
 * free.
 */
import { wrapIndex, type WrapMode } from '../texture-chart-math.ts';

export type Rgba = [number, number, number, number];

export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8Array;
}

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
 * Footprint-averaged sample (box filter) with wrap modes. Falls back to
 * bilinear when the footprint is smaller than one texel, and subsamples very
 * large footprints so a 4K source into a 3 px chart stays bounded.
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
