import type { BedrockGeometryFile, VertexRef } from './bedrock-types.ts';

export interface ImageSkinGeometryInput {
  /** Plane width in Bedrock units. */
  width: number;
  /** Plane height in Bedrock units. */
  height: number;
  /** Normalized image rectangle inside the 128×128 texture. */
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

/**
 * Shared geometry for the flat two-sided image skin. The desktop image
 * template (sharp) and the browser image mode both build from this function.
 */
export function buildImageSkinGeometry(input: ImageSkinGeometryInput): BedrockGeometryFile {
  const { width, height, u0, v0, u1, v1 } = input;
  if (![width, height, u0, v0, u1, v1].every(Number.isFinite) || !(width > 0) || !(height > 0))
    throw new Error('Invalid image skin geometry');
  const refs = (a: number, b: number, c: number, n: number): [VertexRef, VertexRef, VertexRef] =>
    [[a, n, a], [b, n, b], [c, n, c]];
  return {
    format_version: '1.8.0',
    'geometry.skin0': {
      texturewidth: 128,
      textureheight: 128,
      visible_bounds_width: Math.max(width, height) / 16 + 1,
      visible_bounds_height: height / 16 + 1,
      visible_bounds_offset: [0, height / 32, 0],
      bones: [{
        name: 'body',
        pivot: [0, 24, 0],
        poly_mesh: {
          normalized_uvs: true,
          positions: [
            [-width / 2, 0, 0], [width / 2, 0, 0],
            [width / 2, height, 0], [-width / 2, height, 0],
          ],
          normals: [[0, 0, -1], [0, 0, 1]],
          // Viewed from the player's front (-Z) world +X appears on the left,
          // so +X must carry the image's left edge to avoid a mirrored skin.
          uvs: [[u1, v0], [u0, v0], [u0, v1], [u1, v1]],
          polys: [
            refs(0, 2, 1, 0),
            refs(0, 3, 2, 0),
            refs(0, 1, 2, 1),
            refs(0, 2, 3, 1),
          ],
        },
      }],
    },
  };
}
