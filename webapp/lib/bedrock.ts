import type {
  BedrockBone,
  BedrockGeometryFile,
  PolyMesh,
  V2,
  V3,
  VertexRef,
} from '../../src/bedrock-types.ts';
import { validateGeometry } from '../../src/geometry-validator.ts';
import type { SourceBatch } from './types.ts';

export type DoubleSidedPolicy = 'source' | 'all' | 'front';

export interface GeometryOptions {
  height: number;
  doubleSided: DoubleSidedPolicy;
  identifier?: `geometry.${string}`;
}

export interface GeometryReport {
  sourceTriangles: number;
  triangles: number;
  addedBackfaces: number;
  skippedDegenerate: number;
  positions: number;
  normals: number;
  uvs: number;
  bounds: { min: V3; max: V3 };
  materials: { name: string; triangles: number }[];
  warnings: string[];
}

class Stream<T extends number[]> {
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

const defaultPivot = (): V3 => [0, 24, 0];

function isDegenerate(a: V3, b: V3, c: V3) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const x = uy * vz - uz * vy;
  const y = uz * vx - ux * vz;
  const z = ux * vy - uy * vx;
  return Math.hypot(x, y, z) < 1e-9;
}

/**
 * Convert world-space triangle soup into a legacy Bedrock poly_mesh. The model
 * is centered on X/Z, placed on the ground, scaled to `height` and mirrored on
 * X to match Bedrock's handedness.
 */
export function buildBedrockGeometry(batches: readonly SourceBatch[], options: GeometryOptions) {
  const height = options.height;
  if (!Number.isFinite(height) || height < 1 || height > 128)
    throw new Error('模型高度需在 1–128 之间');
  const identifier = options.identifier ?? 'geometry.skin0';
  if (identifier !== 'geometry.skin0')
    throw new Error('单皮肤导出只支持 geometry.skin0');

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let sourceTriangles = 0;
  for (const batch of batches) {
    sourceTriangles += batch.triangles;
    for (let i = 0; i < batch.positions.length; i += 3) {
      const x = batch.positions[i]!, y = batch.positions[i + 1]!, z = batch.positions[i + 2]!;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
  }
  if (!Number.isFinite(minX) || !(maxY - minY > 1e-9))
    throw new Error('模型高度为 0，无法生成 4D 皮肤');
  const scale = height / (maxY - minY);
  const centerX = -(minX + maxX) / 2;
  const centerZ = -(minZ + maxZ) / 2;
  const groundY = -minY;

  const positions = new Stream<V3>();
  const normals = new Stream<V3>();
  const backNormals = new Stream<V3>();
  const uvs = new Stream<V2>();
  const pm: PolyMesh = {
    normalized_uvs: true,
    positions: positions.values,
    normals: normals.values,
    uvs: uvs.values,
    polys: [],
  };

  let addedBackfaces = 0;
  let skippedDegenerate = 0;
  const materials: { name: string; triangles: number }[] = [];

  const addPosition = (x: number, y: number, z: number): number =>
    positions.add([
      -((x + centerX) * scale),
      (y + groundY) * scale,
      (z + centerZ) * scale,
    ]);
  const addNormal = (x: number, y: number, z: number): number => {
    const length = Math.hypot(x, y, z);
    return length > 0 ? normals.add([-x / length, y / length, z / length]) : normals.add([0, 1, 0]);
  };
  const addBackNormal = (x: number, y: number, z: number): number => {
    const length = Math.hypot(x, y, z);
    return length > 0
      ? backNormals.add([x / length, -y / length, -z / length])
      : backNormals.add([0, 1, 0]);
  };
  const addUv = (u: number, v: number): number =>
    uvs.add([
      Number.isFinite(u) ? Math.min(1, Math.max(0, u)) : 0.5,
      Number.isFinite(v) ? Math.min(1, Math.max(0, 1 - v)) : 0.5,
    ]);

  for (const batch of batches) {
    const duplicate = options.doubleSided === 'all' ||
      (options.doubleSided === 'source' && batch.doubleSided);
    let kept = 0;
    const triangleCount = Math.floor(batch.positions.length / 9);
    for (let t = 0; t < triangleCount; t++) {
      const offset = t * 9;
      const a = addPosition(batch.positions[offset]!, batch.positions[offset + 1]!, batch.positions[offset + 2]!);
      const b = addPosition(batch.positions[offset + 3]!, batch.positions[offset + 4]!, batch.positions[offset + 5]!);
      const c = addPosition(batch.positions[offset + 6]!, batch.positions[offset + 7]!, batch.positions[offset + 8]!);
      if (a === b || b === c || c === a || isDegenerate(positions.values[a]!, positions.values[b]!, positions.values[c]!)) {
        skippedDegenerate++;
        continue;
      }
      const na = addNormal(batch.normals[offset]!, batch.normals[offset + 1]!, batch.normals[offset + 2]!);
      const nb = addNormal(batch.normals[offset + 3]!, batch.normals[offset + 4]!, batch.normals[offset + 5]!);
      const nc = addNormal(batch.normals[offset + 6]!, batch.normals[offset + 7]!, batch.normals[offset + 8]!);
      const uvOffset = t * 6;
      const ua = addUv(batch.uvs?.[uvOffset] ?? 0.5, batch.uvs?.[uvOffset + 1] ?? 0.5);
      const ub = addUv(batch.uvs?.[uvOffset + 2] ?? 0.5, batch.uvs?.[uvOffset + 3] ?? 0.5);
      const uc = addUv(batch.uvs?.[uvOffset + 4] ?? 0.5, batch.uvs?.[uvOffset + 5] ?? 0.5);
      pm.polys.push([[a, na, ua], [b, nb, ub], [c, nc, uc], [c, nc, uc]]);
      kept++;
      if (duplicate) {
        const ba = addBackNormal(batch.normals[offset]!, batch.normals[offset + 1]!, batch.normals[offset + 2]!);
        const bb = addBackNormal(batch.normals[offset + 3]!, batch.normals[offset + 4]!, batch.normals[offset + 5]!);
        const bc = addBackNormal(batch.normals[offset + 6]!, batch.normals[offset + 7]!, batch.normals[offset + 8]!);
        pm.polys.push([[c, bc, uc], [b, bb, ub], [a, ba, ua], [a, ba, ua]] as [VertexRef, VertexRef, VertexRef, VertexRef]);
        addedBackfaces++;
      }
    }
    if (kept) materials.push({ name: batch.name, triangles: kept });
  }

  if (!pm.polys.length) throw new Error('没有可导出的三角面（可能全部退化）');

  const bones: BedrockBone[] = [{ name: 'body', pivot: defaultPivot(), poly_mesh: pm }];
  const min: V3 = [Infinity, Infinity, Infinity];
  const max: V3 = [-Infinity, -Infinity, -Infinity];
  for (const p of positions.values) {
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis]!, p[axis]!);
      max[axis] = Math.max(max[axis]!, p[axis]!);
    }
  }
  const file: BedrockGeometryFile = { format_version: '1.8.0' };
  file[identifier] = {
    texturewidth: 128,
    textureheight: 128,
    visible_bounds_width: Math.max(max[0] - min[0], max[2] - min[2]) / 16 + 0.25,
    visible_bounds_height: (max[1] - min[1]) / 16 + 0.25,
    visible_bounds_offset: [(min[0] + max[0]) / 32, (min[1] + max[1]) / 32, (min[2] + max[2]) / 32],
    bones,
  };

  const warnings: string[] = [];
  if (skippedDegenerate) warnings.push(`跳过了 ${skippedDegenerate} 个退化三角面。`);
  const triangles = pm.polys.length;
  if (addedBackfaces) warnings.push(`已为双面材质补充 ${addedBackfaces} 个背面三角面。`);
  if (triangles > 52_106)
    warnings.push(`输出包含 ${triangles.toLocaleString('zh-CN')} 个三角面，超过已验证样本约 52,106 面，建议在实际客户端确认。`);

  validateGeometry(file, {
    expectedIdentifier: identifier,
    textureSize: { width: 128, height: 128 },
    atlasUVs: true,
  });

  const report: GeometryReport = {
    sourceTriangles,
    triangles,
    addedBackfaces,
    skippedDegenerate,
    positions: positions.values.length,
    normals: normals.values.length,
    uvs: uvs.values.length,
    bounds: { min, max },
    materials,
    warnings,
  };
  return { file, report };
}
