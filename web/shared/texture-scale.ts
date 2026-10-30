/**
 * Texture density scale shared by the slider tuner and the inline table.
 * The slider is logarithmic so 0.1×–20× stays usable in the middle range.
 */
export const QUALITY_MIN = 0.1;
export const QUALITY_MAX = 20;

const QUALITY_LOG = Math.log(QUALITY_MAX / QUALITY_MIN);

export const qualityToSlider = (quality: number) =>
  Math.round(
    (Math.log(Math.min(QUALITY_MAX, Math.max(QUALITY_MIN, quality)) / QUALITY_MIN) /
      QUALITY_LOG) *
      100,
  );

export const sliderToQuality = (value: number) =>
  QUALITY_MIN * Math.exp((value / 100) * QUALITY_LOG);

export const formatQuality = (quality: number) =>
  String(Math.round(quality * 100) / 100);
