/**
 * Source texture policy shared by the Node and browser pipelines.
 *
 * Importers may suggest that a model already ships a usable texture layout
 * (for example YSM's single player atlas). That suggestion is only a default:
 * an explicit user choice to pack an atlas, or an explicit texture size, still
 * wins. Keeping the decision here avoids checking source formats in each
 * route, CLI command or UI component.
 */

export interface TextureHint {
  /** Prefer keeping the imported source texture and UVs instead of packing an atlas. */
  preserve?: boolean;
  /** Default maximum edge when preserving; ignored when the user sets one. */
  maxSize?: number;
}

export interface TexturePolicyOptions {
  /** The user explicitly asked for a packed atlas. */
  forceAtlas?: boolean;
  /** The user or a format pipeline supplied a maximum source edge. */
  maxTextureSize?: number;
  /** True only when maxTextureSize came from an explicit user setting. */
  maxTextureSizeExplicit?: boolean;
}

export interface ResolvedTexturePolicy {
  preserve: boolean;
  maxTextureSize?: number;
}

export function resolveTexturePolicy(
  hint: TextureHint | null | undefined,
  options: TexturePolicyOptions = {},
): ResolvedTexturePolicy {
  const preserve = !!hint?.preserve && !options.forceAtlas;
  const maxTextureSize = options.maxTextureSizeExplicit
    ? options.maxTextureSize
    : hint?.maxSize ?? options.maxTextureSize;
  return {
    preserve,
    ...(maxTextureSize !== undefined ? { maxTextureSize } : {}),
  };
}
