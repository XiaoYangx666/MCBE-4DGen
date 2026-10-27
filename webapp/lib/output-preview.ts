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
  identifier: `geometry.${string}` = firstGeometryIdentifier(geometry),
): PolyMeshPreview {
  return buildPolyMeshPreview(geometry, textureUrl, {
    identifier,
    mirrorX: true,
    side: THREE.DoubleSide,
    alphaTest: 0.01,
    transparent: true,
  });
}
