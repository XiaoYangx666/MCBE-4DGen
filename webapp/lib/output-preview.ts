import * as THREE from 'three';
import type { BedrockGeometryFile } from '../../src/bedrock-types.ts';
import {
  buildPolyMeshPreview,
  firstGeometryIdentifier,
  type PolyMeshPreview,
} from '../../web/shared/poly-mesh-preview.ts';

/**
 * Browser-side preview of the exact exported poly_mesh: double-sided cutout
 * with flat, texture-accurate lighting-friendly materials.
 */
export function buildGeometryPreview(
  geometry: BedrockGeometryFile,
  textureUrl: string,
  identifier: `geometry.${string}` = firstGeometryIdentifier(geometry),
): PolyMeshPreview {
  return buildPolyMeshPreview(geometry, textureUrl, {
    identifier,
    side: THREE.DoubleSide,
    alphaTest: 0.01,
    transparent: true,
  });
}
