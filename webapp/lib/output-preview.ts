import * as THREE from 'three';
import type { BedrockGeometryFile } from '../../src/bedrock-types.ts';
import {
  buildPolyMeshPreview,
  firstGeometryIdentifier,
  type PolyMeshPreview,
} from '../../web/shared/poly-mesh-preview.ts';

/**
 * Browser-side preview of the exact exported poly_mesh: double-sided cutout
 * with flat, texture-accurate lighting-friendly materials. Exports mirror X
 * for Bedrock's handedness, so previews mirror it back to keep the source
 * chirality (the desktop workbench and pack previews do the same).
 */
export function buildGeometryPreview(
  geometry: BedrockGeometryFile,
  textureUrl: string,
  options: { identifier?: `geometry.${string}`; mirrorX?: boolean } = {},
): PolyMeshPreview {
  return buildPolyMeshPreview(geometry, textureUrl, {
    identifier: options.identifier ?? firstGeometryIdentifier(geometry),
    // Model exports mirror X for Bedrock's handedness, so their previews mirror
    // it back. Flat image skins are authored directly in Bedrock coordinates
    // and must keep their original orientation.
    mirrorX: options.mirrorX ?? true,
    // Exports duplicate backfaces for double-sided source materials, so one
    // side already covers both viewing directions. DoubleSide would draw
    // translucent 目影 twice and turn its 50% black into 75% black.
    side: THREE.FrontSide,
    alphaTest: 0.01,
    transparent: true,
  });
}
