/**
 * Base-color and alpha baking shared by the Node atlas (`sharp` raw buffers)
 * and the browser atlas (canvas `ImageData`).
 *
 * glTF base-color factors are linear, so the multiply happens in linear space.
 * Alpha follows the material's glTF alpha mode, which is the only way OPAQUE
 * textures with a stray alpha channel and MASK cut-outs match on both sides.
 */

export type AlphaMode = 'OPAQUE' | 'MASK' | 'BLEND';

export const srgbToLinear = (value: number) =>
  value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;

export const linearToSrgb = (value: number) =>
  value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export interface BaseColorBake {
  /** Linear RGBA factor; alpha is a straight multiplier, not gamma encoded. */
  factor: readonly [number, number, number, number];
  alphaMode: AlphaMode;
  /** MASK threshold, defaults to 0.5. */
  alphaCutoff?: number;
}

/** Final alpha for one pixel, following the material's alpha mode. */
export function resolveAlpha(alpha: number, alphaMode: AlphaMode, alphaCutoff = 0.5): number {
  const value = clamp01(alpha);
  if (alphaMode === 'OPAQUE') return 1;
  if (alphaMode === 'MASK') return value >= alphaCutoff ? 1 : 0;
  return value;
}

/**
 * Bake the base-color factor and alpha mode into straight RGBA bytes in place.
 * Works on Node `Buffer`s and canvas `Uint8ClampedArray`s alike.
 */
export function bakeBaseColorPixels(
  pixels: Uint8Array | Uint8ClampedArray,
  options: BaseColorBake,
): void {
  const { factor, alphaMode } = options;
  const [red, green, blue, alpha] = factor;
  for (const value of [red, green, blue, alpha]) {
    if (!Number.isFinite(value) || value < 0 || value > 1)
      throw new Error(`Invalid base-color factor: ${[...factor].join(', ')}`);
  }
  const cutoff = options.alphaCutoff ?? 0.5;
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = Math.round(linearToSrgb(srgbToLinear(pixels[i]! / 255) * red) * 255);
    pixels[i + 1] = Math.round(linearToSrgb(srgbToLinear(pixels[i + 1]! / 255) * green) * 255);
    pixels[i + 2] = Math.round(linearToSrgb(srgbToLinear(pixels[i + 2]! / 255) * blue) * 255);
    const source = (pixels[i + 3]! / 255) * alpha;
    pixels[i + 3] = Math.round(resolveAlpha(source, alphaMode, cutoff) * 255);
  }
}
