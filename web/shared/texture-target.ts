export type TextureTarget = 'density' | 'retention' | 'balanced';

/** UI labels are density/retention/balanced; saved config uses texel-*. */
export const toServerTextureTarget = (target: TextureTarget) =>
  target === 'density'
    ? 'texel-density'
    : target === 'retention'
      ? 'texel-retention'
      : 'texel-balanced';

export const fromServerTextureTarget = (target?: string): TextureTarget =>
  target === 'texel-density' || target === 'density'
    ? 'density'
    : target === 'texel-retention' || target === 'retention'
      ? 'retention'
      : 'balanced';
