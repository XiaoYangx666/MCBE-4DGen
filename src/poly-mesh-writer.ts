import type { PolyMesh, V2, V3 } from './bedrock-types.ts';

/**
 * Deduplicate numeric vertex tuples while preserving first-seen order. Shared
 * by the Node glTF exporter and the browser triangle-soup exporter.
 */
export class VertexStream<T extends number[]> {
  readonly values: T[] = [];
  private readonly indices = new Map<string, number>();

  add(value: T): number {
    const clean = value.map((v) => (Object.is(v, -0) ? 0 : v)) as T;
    const key = clean.join(',');
    const existing = this.indices.get(key);
    if (existing !== undefined) return existing;
    const index = this.values.length;
    this.values.push(clean);
    this.indices.set(key, index);
    return index;
  }
}

export interface PolyMeshStreams {
  positions: VertexStream<V3>;
  normals: VertexStream<V3>;
  uvs: VertexStream<V2>;
  polyMesh: PolyMesh;
}

/** One normalized-UV poly_mesh with deduplicated position/normal/UV streams. */
export function createPolyMeshStreams(): PolyMeshStreams {
  const positions = new VertexStream<V3>();
  const normals = new VertexStream<V3>();
  const uvs = new VertexStream<V2>();
  return {
    positions,
    normals,
    uvs,
    polyMesh: {
      normalized_uvs: true,
      positions: positions.values,
      normals: normals.values,
      uvs: uvs.values,
      polys: [],
    },
  };
}

/** Mirror X for Bedrock's handedness, normalizing -0. */
export function mirrorX(value: V3): V3 {
  return [-value[0] || 0, value[1], value[2]];
}

export interface VisibleBounds {
  min: V3;
  max: V3;
  visible_bounds_width: number;
  visible_bounds_height: number;
  visible_bounds_offset: V3;
}

/** Legacy geometry envelope derived from every emitted position. */
export function visibleBounds(positions: Iterable<V3>): VisibleBounds {
  const min: V3 = [Infinity, Infinity, Infinity];
  const max: V3 = [-Infinity, -Infinity, -Infinity];
  for (const value of positions) {
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis]!, value[axis]!);
      max[axis] = Math.max(max[axis]!, value[axis]!);
    }
  }
  return {
    min,
    max,
    visible_bounds_width: Math.max(max[0] - min[0], max[2] - min[2]) / 16 + 0.25,
    visible_bounds_height: (max[1] - min[1]) / 16 + 0.25,
    visible_bounds_offset: [
      (min[0] + max[0]) / 32,
      (min[1] + max[1]) / 32,
      (min[2] + max[2]) / 32,
    ],
  };
}
