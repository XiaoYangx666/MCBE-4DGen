import * as THREE from 'three';
import type { BedrockGeometryFile } from '../../src/bedrock-types.ts';
import { decodeGeometryTriangles } from '../../src/geometry-validator.ts';

/** Exported packs may use any identifier, so preview the first geometry in the file. */
export function firstGeometryIdentifier(geometry: BedrockGeometryFile): `geometry.${string}` {
  const identifier = Object.keys(geometry).find((key) => key.startsWith('geometry.'));
  if (!identifier) throw new Error('文件里没有可预览的 poly_mesh 几何');
  return identifier as `geometry.${string}`;
}

/**
 * Build a three.js preview from the exact exported poly_mesh. Bedrock UVs use
 * a bottom-left origin, matching three's default texture flipY behaviour.
 */
export function buildGeometryPreview(
  geometry: BedrockGeometryFile,
  textureUrl: string,
  identifier: `geometry.${string}` = firstGeometryIdentifier(geometry),
): { object: THREE.Group; dispose: () => void } {
  const triangles = decodeGeometryTriangles(geometry, identifier);
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  for (const triangle of triangles) {
    for (const corner of triangle) {
      positions.push(corner.position[0], corner.position[1], corner.position[2]);
      normals.push(corner.normal[0], corner.normal[1], corner.normal[2]);
      uvs.push(corner.uv[0], corner.uv[1]);
    }
  }
  const buffer = new THREE.BufferGeometry();
  buffer.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  buffer.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  buffer.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  buffer.computeBoundingBox();
  buffer.computeBoundingSphere();

  const material = new THREE.MeshStandardMaterial({
    roughness: 1,
    metalness: 0,
    side: THREE.DoubleSide,
    transparent: true,
    alphaTest: 0.01,
  });
  const texture = new THREE.TextureLoader().load(textureUrl, (loaded) => {
    loaded.magFilter = THREE.NearestFilter;
    loaded.minFilter = THREE.NearestFilter;
    loaded.generateMipmaps = false;
    loaded.colorSpace = THREE.SRGBColorSpace;
    material.map = loaded;
    material.needsUpdate = true;
  });
  texture.colorSpace = THREE.SRGBColorSpace;

  const mesh = new THREE.Mesh(buffer, material);
  mesh.name = '4D skin';
  const group = new THREE.Group();
  group.add(mesh);
  return {
    object: group,
    dispose: () => {
      buffer.dispose();
      material.dispose();
      texture.dispose();
    },
  };
}
