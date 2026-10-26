import { describe, expect, it } from 'vitest';
import {
  createPolyMeshStreams,
  mirrorX,
  visibleBounds,
  VertexStream,
} from '../src/poly-mesh-writer.ts';

describe('shared poly_mesh writer primitives', () => {
  it('deduplicates tuples and normalizes -0', () => {
    const stream = new VertexStream<[number, number, number]>();
    expect(stream.add([1, 2, 3])).toBe(0);
    expect(stream.add([1, 2, 3])).toBe(0);
    expect(stream.add([-0, 2, 3])).toBe(1);
    expect(stream.values).toEqual([[1, 2, 3], [0, 2, 3]]);
  });

  it('creates a normalized poly_mesh backed by the same streams', () => {
    const { positions, normals, uvs, polyMesh } = createPolyMeshStreams();
    const index = positions.add([1, 2, 3]);
    normals.add([0, 1, 0]);
    uvs.add([0.25, 0.75]);
    expect(index).toBe(0);
    expect(polyMesh.normalized_uvs).toBe(true);
    expect(polyMesh.positions).toBe(positions.values);
    expect(polyMesh.normals).toBe(normals.values);
    expect(polyMesh.uvs).toBe(uvs.values);
  });

  it('mirrors X and normalizes negative zero', () => {
    expect(mirrorX([2, 3, 4])).toEqual([-2, 3, 4]);
    expect(Object.is(mirrorX([0, 3, 4])[0], -0)).toBe(false);
  });

  it('derives the legacy visible bounds from all positions', () => {
    const bounds = visibleBounds([[0, 0, 0], [16, 32, 16]]);
    expect(bounds.min).toEqual([0, 0, 0]);
    expect(bounds.max).toEqual([16, 32, 16]);
    expect(bounds.visible_bounds_width).toBe(1.25);
    expect(bounds.visible_bounds_height).toBe(2.25);
    expect(bounds.visible_bounds_offset).toEqual([0.5, 1, 0.5]);
  });
});
