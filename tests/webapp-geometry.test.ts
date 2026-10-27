import { describe, expect, it } from 'vitest';
import { buildImageSkinGeometry } from '../src/image-skin-geometry.ts';
import { validateGeometry } from '../src/geometry-validator.ts';
import { buildBedrockGeometry } from '../webapp/engine/bedrock.ts';
import type { SourceBatch } from '../webapp/engine/types.ts';

function quad(overrides: Partial<SourceBatch> = {}): SourceBatch {
  return {
    key: 'mat',
    name: '材质',
    positions: new Float32Array([
      -1, 0, 0, 1, 0, 0, 1, 2, 0,
      -1, 0, 0, 1, 2, 0, -1, 2, 0,
    ]),
    normals: new Float32Array([
      0, 0, 1, 0, 0, 1, 0, 0, 1,
      0, 0, 1, 0, 0, 1, 0, 0, 1,
    ]),
    uvs: new Float32Array([
      0, 0, 1, 0, 1, 1,
      0, 0, 1, 1, 0, 1,
    ]),
    color: [1, 1, 1],
    opacity: 1,
    alphaMode: 'BLEND',
    alphaCutoff: 0.5,
    doubleSided: false,
    texture: null,
    uvBounds: [0, 0, 1, 1],
    triangles: 2,
    area: 4,
    ...overrides,
  };
}

describe('webapp bedrock export', () => {
  it('scales, grounds and mirrors a quad', () => {
    const { file, report } = buildBedrockGeometry([quad()], { height: 32, doubleSided: 'source' });
    const geometry = file['geometry.skin0'];
    expect(geometry.texturewidth).toBe(128);
    expect(report.triangles).toBe(2);
    const mesh = geometry.bones[0]!.poly_mesh!;
    const xs = mesh.positions.map((position) => position[0]);
    const ys = mesh.positions.map((position) => position[1]);
    expect(Math.min(...xs)).toBe(-16);
    expect(Math.max(...xs)).toBe(16);
    expect(Math.min(...ys)).toBe(0);
    expect(Math.max(...ys)).toBe(32);
    // image-space v=0 becomes Bedrock bottom-origin v=1
    expect(mesh.uvs[0]).toEqual([0, 1]);
    expect(mesh.polys[0]).toHaveLength(4);
    expect(mesh.polys[0]![2]).toEqual(mesh.polys[0]![3]);
  });

  it('adds backfaces for all and source policies', () => {
    expect(buildBedrockGeometry([quad()], { height: 32, doubleSided: 'all' }).report.triangles).toBe(4);
    expect(buildBedrockGeometry([quad({ doubleSided: true })], { height: 32, doubleSided: 'source' }).report.triangles).toBe(4);
    expect(buildBedrockGeometry([quad({ doubleSided: true })], { height: 32, doubleSided: 'front' }).report.triangles).toBe(2);
  });

  it('rejects invalid heights and empty meshes', () => {
    expect(() => buildBedrockGeometry([quad()], { height: 0, doubleSided: 'source' })).toThrow(/高度/);
    expect(() => buildBedrockGeometry([], { height: 32, doubleSided: 'source' })).toThrow();
  });

  it('shares the flat image geometry between desktop and browser', () => {
    const file = buildImageSkinGeometry({ width: 24, height: 32, u0: 0.25, v0: 0.25, u1: 0.75, v1: 0.75 });
    const geometry = file['geometry.skin0'];
    const mesh = geometry.bones[0]!.poly_mesh!;
    expect(mesh.polys).toHaveLength(4);
    // From the -Z front view world +X is on the left, so it carries u0.
    expect(mesh.positions[1]![0]).toBeGreaterThan(0);
    expect(mesh.uvs[1]).toEqual([0.25, 0.25]);
    expect(mesh.uvs[0]).toEqual([0.75, 0.25]);
    expect(() => validateGeometry(file, {
      expectedIdentifier: 'geometry.skin0',
      textureSize: { width: 128, height: 128 },
      atlasUVs: true,
    })).not.toThrow();
    expect(() => buildImageSkinGeometry({ width: 0, height: 32, u0: 0, v0: 0, u1: 1, v1: 1 })).toThrow();
  });

  it('centers on X and Z', () => {
    const shifted = quad({
      positions: new Float32Array([
        9, 0, 4, 11, 0, 4, 11, 2, 4,
        9, 0, 4, 11, 2, 4, 9, 2, 4,
      ]),
    });
    const { file } = buildBedrockGeometry([shifted], { height: 32, doubleSided: 'front' });
    const mesh = file['geometry.skin0'].bones[0]!.poly_mesh!;
    const xs = mesh.positions.map((position) => position[0]);
    const zs = mesh.positions.map((position) => position[2]);
    expect(Math.min(...xs)).toBe(-16);
    expect(Math.max(...xs)).toBe(16);
    expect(Math.min(...zs)).toBe(0);
    expect(Math.max(...zs)).toBe(0);
  });
});
