import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { BedrockGeometryFile } from '../src/bedrock-types.ts';
import {
  buildPolyMeshPreview,
  firstGeometryIdentifier,
  fitPreviewCamera,
} from '../web/shared/poly-mesh-preview.ts';

/** One triangle on `body` plus a true quad on `arm` (two decoded triangles). */
function fixture(identifier: `geometry.${string}` = 'geometry.demo'): BedrockGeometryFile {
  return {
    format_version: '1.8.0',
    [identifier]: {
      texturewidth: 64,
      textureheight: 64,
      bones: [
        {
          name: 'body',
          poly_mesh: {
            normalized_uvs: true,
            positions: [[2, 3, 4], [3, 3, 4], [3, 4, 4]],
            normals: [[0.5, 0, 0.5], [0.5, 0, 0.5], [0.5, 0, 0.5]],
            uvs: [[0, 0], [1, 0], [1, 1]],
            polys: [[[0, 0, 0], [1, 0, 1], [2, 0, 2]]],
          },
        },
        {
          name: 'arm',
          poly_mesh: {
            normalized_uvs: true,
            positions: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]],
            normals: [[0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1]],
            uvs: [[0, 0], [1, 0], [1, 1], [0, 1]],
            polys: [[[0, 0, 0], [1, 0, 1], [2, 0, 2], [3, 0, 3]]],
          },
        },
      ],
    },
  } as unknown as BedrockGeometryFile;
}

function texture(): THREE.Texture {
  return new THREE.Texture();
}

describe('shared poly_mesh preview', () => {
  it('decodes the exported triangles into one mesh by default', () => {
    const preview = buildPolyMeshPreview(fixture(), '', { texture: texture() });
    expect(preview.object.children).toHaveLength(1);
    const mesh = preview.object.children[0] as THREE.Mesh;
    expect(mesh.name).toBe('4D skin');
    expect(mesh.geometry.getAttribute('position').count).toBe(9); // 3 triangles
    expect(mesh.geometry.getAttribute('uv').count).toBe(9);
    expect(mesh.material).toBeInstanceOf(THREE.MeshStandardMaterial);
    preview.dispose();
  });

  it('groups meshes by bone and keeps the bone names', () => {
    const preview = buildPolyMeshPreview(fixture(), '', {
      groupByBone: true,
      texture: texture(),
    });
    expect(preview.object.children.map((child) => child.name)).toEqual(['body', 'arm']);
    const body = preview.object.children[0] as THREE.Mesh;
    const arm = preview.object.children[1] as THREE.Mesh;
    expect(body.geometry.getAttribute('position').count).toBe(3);
    expect(arm.geometry.getAttribute('position').count).toBe(6);
    preview.dispose();
  });

  it('mirrors positions and normals on X only when asked', () => {
    const plain = buildPolyMeshPreview(fixture(), '', { texture: texture() });
    const plainMesh = plain.object.children[0] as THREE.Mesh;
    expect(plainMesh.geometry.getAttribute('position').getX(0)).toBe(2);
    expect(plainMesh.geometry.getAttribute('normal').getX(0)).toBe(0.5);

    const mirrored = buildPolyMeshPreview(fixture(), '', {
      mirrorX: true,
      texture: texture(),
    });
    const mirroredMesh = mirrored.object.children[0] as THREE.Mesh;
    expect(mirroredMesh.geometry.getAttribute('position').getX(0)).toBe(-2);
    expect(mirroredMesh.geometry.getAttribute('position').getY(0)).toBe(3);
    expect(mirroredMesh.geometry.getAttribute('position').getZ(0)).toBe(4);
    expect(mirroredMesh.geometry.getAttribute('normal').getX(0)).toBe(-0.5);
    plain.dispose();
    mirrored.dispose();
  });

  it('finds the first geometry identifier and uses it by default', () => {
    const file = fixture('geometry.imported_model');
    expect(firstGeometryIdentifier(file)).toBe('geometry.imported_model');
    expect(() => firstGeometryIdentifier({ format_version: '1.8.0' })).toThrow(/poly_mesh/);

    const preview = buildPolyMeshPreview(file, '', { texture: texture() });
    expect(preview.object.children).toHaveLength(1);
    preview.dispose();
  });

  it('applies the requested material and keeps caller-owned textures alive', () => {
    const owned = texture();
    let disposed = false;
    owned.addEventListener('dispose', () => { disposed = true; });
    const preview = buildPolyMeshPreview(fixture(), '', {
      texture: owned,
      side: THREE.FrontSide,
      alphaTest: 0.5,
    });
    const material = (preview.object.children[0] as THREE.Mesh)
      .material as THREE.MeshStandardMaterial;
    expect(material.map).toBe(owned);
    expect(material.side).toBe(THREE.FrontSide);
    expect(material.alphaTest).toBe(0.5);
    expect(material.transparent).toBe(false);

    expect(() => preview.dispose()).not.toThrow();
    expect(() => preview.dispose()).not.toThrow();
    expect(disposed).toBe(false);
  });

  it('frames the same object differently for angle and front views', () => {
    const object = new THREE.Group();
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(4, 8, 2),
      new THREE.MeshBasicMaterial(),
    );
    object.add(mesh);

    const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 10000);
    const controls = {
      target: new THREE.Vector3(),
      minDistance: 0,
      maxDistance: Infinity,
      update: () => true,
    };
    expect(fitPreviewCamera(camera, controls, object, {
      strategy: 'extent',
      aspect: 1,
      padding: 1.16,
    })).toBe(true);
    const angle = camera.position.clone();

    expect(fitPreviewCamera(camera, controls, object, {
      view: 'front',
      strategy: 'extent',
      aspect: 1,
      padding: 1.16,
    })).toBe(true);
    expect(camera.position.z).toBeLessThan(angle.z);
    expect(camera.position.x).toBeCloseTo(0, 5);
  });
});
