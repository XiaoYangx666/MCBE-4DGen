import type { BedrockGeometryFile, Polygon, PolyMesh, V3, VertexRef } from './bedrock-types.ts';
import { isGeometryIdentifier } from './bedrock-types.ts';

type Dict = Record<string, unknown>;
const object = (v: unknown): v is Dict => typeof v === 'object' && v !== null && !Array.isArray(v);
function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid Bedrock geometry: ${message}`);
}
function tuple(v: unknown, size: number, label: string): asserts v is number[] {
  check(Array.isArray(v) && v.length === size && v.every((n) => typeof n === 'number' && Number.isFinite(n)), `${label} must contain ${size} finite numbers`);
}
const positiveInteger = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
const sameRef = (a: VertexRef, b: VertexRef) => a.every((v, i) => v === b[i]);
/** True when the three points span no area, matching `Math.hypot(cross) > 0`. */
function degeneratePositions(a: V3, b: V3, c: V3) {
  const ux = b[0] - a[0]!, uy = b[1] - a[1]!, uz = b[2] - a[2]!;
  const vx = c[0] - a[0]!, vy = c[1] - a[1]!, vz = c[2] - a[2]!;
  return uy * vz - uz * vy === 0 && uz * vx - ux * vz === 0 && ux * vy - uy * vx === 0;
}
export const isPaddedTriangle = (p: Polygon) => p.length === 3 || (p.length === 4 && sameRef(p[2], p[3]));

export interface GeometryValidationOptions {
  textureSize?: { width: number; height: number };
  expectedIdentifier?: string;
  atlasUVs?: boolean;
}

/** Independent structural validator: never invokes the exporter or repairs JSON. */
export function validateGeometry(value: unknown, options: GeometryValidationOptions = {}) {
  check(object(value), 'root must be an object');
  check(value.format_version === '1.8.0', 'format_version must be 1.8.0');
  const identifiers = Object.keys(value).filter((k) => k.startsWith('geometry.'));
  check(identifiers.length, 'no geometry definition found');
  if (options.expectedIdentifier) check(identifiers.includes(options.expectedIdentifier), 'expected geometry identifier is missing');
  const summaries = [];
  for (const identifier of identifiers) {
    check(isGeometryIdentifier(identifier), 'invalid geometry identifier');
    const g = value[identifier]; check(object(g), `${identifier} must be an object`);
    check(positiveInteger(g.texturewidth) && positiveInteger(g.textureheight), 'texture dimensions must be positive integers');
    if (options.textureSize) check(g.texturewidth === options.textureSize.width && g.textureheight === options.textureSize.height, 'texture dimensions do not match PNG');
    for (const name of ['visible_bounds_width', 'visible_bounds_height']) {
      if (g[name] !== undefined) check(typeof g[name] === 'number' && Number.isFinite(g[name]) && g[name] > 0, `invalid ${name}`);
    }
    if (g.visible_bounds_offset !== undefined) tuple(g.visible_bounds_offset, 3, 'visible_bounds_offset');
    check(Array.isArray(g.bones) && g.bones.length > 0, 'bones must be a non-empty array');
    const parents = new Map<string, string | undefined>();
    let polyBones = 0, polygons = 0, triangles = 0, paddedTriangles = 0;
    const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
    for (const bone of g.bones) {
      check(object(bone) && typeof bone.name === 'string' && bone.name.length && !/[\x00-\x1f]/.test(bone.name), 'invalid bone name');
      check(!parents.has(bone.name), `duplicate bone ${bone.name}`);
      check(bone.parent === undefined || typeof bone.parent === 'string', 'parent must be a bone name');
      parents.set(bone.name, bone.parent as string | undefined);
      if (bone.pivot !== undefined) tuple(bone.pivot, 3, `${bone.name}.pivot`);
      if (bone.rotation !== undefined) tuple(bone.rotation, 3, `${bone.name}.rotation`);
      if (bone.cubes !== undefined && (!Array.isArray(bone.cubes) || bone.cubes.length)) throw new Error('Unsupported Bedrock geometry: cubes are outside the indexed poly_mesh validation profile');
      if (bone.poly_mesh === undefined) continue;
      const pm = bone.poly_mesh;
      check(object(pm) && typeof pm.normalized_uvs === 'boolean', 'poly_mesh requires normalized_uvs');
      for (const [key, size] of [['positions', 3], ['normals', 3], ['uvs', 2]] as const) {
        const array = pm[key]; check(Array.isArray(array) && array.length > 0, `poly_mesh.${key} must be non-empty`);
        for (const row of array) tuple(row, size, key);
      }
      const mesh = pm as unknown as PolyMesh;
      for (const n of mesh.normals) check(Math.hypot(...n) > 0, 'zero-length normal');
      if (options.atlasUVs) {
        check(pm.normalized_uvs, 'atlas UVs must be normalized');
        check(mesh.uvs.every((uv) => uv.every((v) => v >= -1e-6 && v <= 1 + 1e-6)), 'atlas UV outside texture bounds');
      }
      if (typeof pm.polys === 'string') throw new Error('Unsupported Bedrock geometry: tri_list/quad_list streams are outside the indexed validation profile');
      check(Array.isArray(pm.polys) && pm.polys.length > 0, 'polys must be a non-empty indexed polygon array');
      const positionCount = mesh.positions.length;
      const normalCount = mesh.normals.length;
      const uvCount = mesh.uvs.length;
      // Hot loop: every exported polygon lands here, so keep it allocation-free.
      for (const poly of pm.polys) {
        check(Array.isArray(poly) && (poly.length === 3 || poly.length === 4), 'polygon must have three or four corners');
        for (const corner of poly as Polygon) {
          tuple(corner, 3, 'polygon reference');
          const [positionIndex, normalIndex, uvIndex] = corner;
          check(
            Number.isSafeInteger(positionIndex) && positionIndex >= 0 && positionIndex < positionCount &&
            Number.isSafeInteger(normalIndex) && normalIndex >= 0 && normalIndex < normalCount &&
            Number.isSafeInteger(uvIndex) && uvIndex >= 0 && uvIndex < uvCount,
            'polygon position/normal/UV index outside range',
          );
        }
        const p = poly as Polygon;
        const padded = p.length === 4 && sameRef(p[2]!, p[3]!);
        const tri = p.length === 3 || padded;
        const i0 = p[0]![0], i1 = p[1]![0], i2 = p[2]![0];
        const repeats = i0 === i1 || i0 === i2 || i1 === i2 || (tri
          ? false
          : i0 === p[3]![0] || i1 === p[3]![0] || i2 === p[3]![0]);
        check(!repeats, 'polygon repeats a position except for padded triangle corner');
        const a = mesh.positions[i0]!;
        const b = mesh.positions[i1]!;
        const c = mesh.positions[i2]!;
        check(!degeneratePositions(a, b, c), 'degenerate polygon');
        if (!tri) check(!degeneratePositions(a, c, mesh.positions[p[3]![0]]!), 'degenerate polygon');
        for (let slot = 0; slot < (tri ? 3 : 4); slot++) {
          const point = mesh.positions[p[slot]![0]]!;
          for (let axis = 0; axis < 3; axis++) {
            const x = point[axis]!; min[axis] = Math.min(min[axis]!, x); max[axis] = Math.max(max[axis]!, x);
          }
        }
        polygons++; triangles += tri ? 1 : 2; if (tri && p.length === 4) paddedTriangles++;
      }
      polyBones++;
    }
    for (const [bone, parent] of parents) {
      if (parent !== undefined) check(parents.has(parent), `missing parent ${parent}`);
      const seen = new Set([bone]); let next = parent;
      while (next !== undefined) { check(!seen.has(next), 'cyclic bone hierarchy'); seen.add(next); next = parents.get(next); }
    }
    check(polyBones > 0, 'no poly_mesh geometry');
    summaries.push({ identifier, bones: parents.size, polyBones, polygons, triangles, paddedTriangles, bounds: { min, max } });
  }
  return { file: value as unknown as BedrockGeometryFile, geometries: summaries };
}

export function parseGeometryJSON(json: string, options: GeometryValidationOptions = {}) {
  return validateGeometry(JSON.parse(json) as unknown, options);
}

/** Dereference independent position/normal/UV streams; true quads become two triangles. */
export function decodeGeometryTriangles(file: BedrockGeometryFile, identifier: `geometry.${string}`) {
  const geometry = file[identifier];
  if (!geometry) throw new Error('Geometry not found');
  const result: { bone: string; position: V3; normal: V3; uv: [number, number] }[][] = [];
  for (const bone of geometry.bones) {
    const p = bone.poly_mesh; if (!p) continue;
    const corner = (r: VertexRef) => ({ bone: bone.name, position: [...p.positions[r[0]]!] as V3,
      normal: [...p.normals[r[1]]!] as V3, uv: p.normalized_uvs ? [...p.uvs[r[2]]!] as [number, number]
        : [p.uvs[r[2]]![0] / geometry.texturewidth, p.uvs[r[2]]![1] / geometry.textureheight] as [number, number] });
    for (const poly of p.polys) {
      result.push([corner(poly[0]), corner(poly[1]), corner(poly[2])]);
      if (!isPaddedTriangle(poly) && poly.length === 4) result.push([corner(poly[0]), corner(poly[2]), corner(poly[3])]);
    }
  }
  return result;
}
