import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { BedrockGeometryFile } from '../src/bedrock-types.ts';
import { buildGeometryPreview } from '../webapp/lib/output-preview.ts';

function triangleFile(): BedrockGeometryFile {
  return {
    format_version: '1.8.0',
    'geometry.skin0': {
      texturewidth: 128,
      textureheight: 128,
      visible_bounds_width: 1,
      visible_bounds_height: 1,
      visible_bounds_offset: [0, 0, 0],
      bones: [{
        name: 'body',
        pivot: [0, 0, 0],
        poly_mesh: {
          normalized_uvs: true,
          positions: [[2, 0, 0], [0, 0, 0], [0, 2, 0]],
          normals: [[0, 0, 1], [0, 0, 1], [0, 0, 1]],
          uvs: [[0, 0], [1, 0], [0, 1]],
          polys: [[[0, 0, 0], [1, 1, 1], [2, 2, 2], [2, 2, 2]]],
        },
      }],
    },
  } as BedrockGeometryFile;
}

describe('webapp output preview', () => {
  afterEach(() => vi.restoreAllMocks());

  it('mirrors X back so the preview matches the source chirality', () => {
    vi.spyOn(THREE.TextureLoader.prototype, 'load').mockReturnValue(new THREE.Texture());
    const preview = buildGeometryPreview(triangleFile(), 'unused');
    let mesh: THREE.Mesh | null = null;
    preview.object.traverse((object) => {
      if (!mesh && (object as THREE.Mesh).isMesh) mesh = object as THREE.Mesh;
    });
    expect(mesh).not.toBeNull();
    const positions = mesh!.geometry.getAttribute('position');
    expect(positions.getX(0)).toBe(-2);
    expect(positions.getY(0)).toBe(0);
    preview.dispose();
  });
});
