export type TextureTarget = 'density' | 'retention';

/** UI labels are density/retention; the server and saved config use texel-*. */
export const toServerTextureTarget = (target: TextureTarget) =>
  target === 'density' ? 'texel-density' : 'texel-retention';

export const fromServerTextureTarget = (target?: string): TextureTarget =>
  target === 'texel-density' || target === 'density' ? 'density' : 'retention';
