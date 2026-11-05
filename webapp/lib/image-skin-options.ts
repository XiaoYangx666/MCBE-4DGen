/** Comfortable plane-height range exposed by the browser image studio. */
export const IMAGE_SKIN_HEIGHT_MIN = 8;
export const IMAGE_SKIN_HEIGHT_MAX = 64;
export const IMAGE_SKIN_HEIGHT_DEFAULT = 32;

/** Keep the number field and the range slider on the same integer range. */
export function clampImageSkinHeight(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return IMAGE_SKIN_HEIGHT_DEFAULT;
  return Math.min(IMAGE_SKIN_HEIGHT_MAX, Math.max(IMAGE_SKIN_HEIGHT_MIN, Math.round(value)));
}
