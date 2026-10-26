import type {
  BedrockBone,
  BedrockGeometryFile,
  V3,
  VertexRef,
} from '../../src/bedrock-types.ts';
import { validateGeometry } from '../../src/geometry-validator.ts';
import {
  createPolyMeshStreams,
  mirrorX,
  visibleBounds,
  VertexStream,
} from '../../src/poly-mesh-writer.ts';
import type { SourceBatch } from './types.ts';

export type DoubleSidedPolicy = 'source' | 'all' | 'front';

export interface GeometryOptions {
  height: number;
  doubleSided: DoubleSidedPolicy;
  identifier?: `geometry.${string}`;
  /** Pre-reduction triangle count, for the report only. */
  sourceTriangles?: number;
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

  const { positions, normals, uvs, polyMesh: pm } = createPolyMeshStreams();
  const backNormals = new VertexStream<V3>();

  let addedBackfaces = 0;
  let skippedDegenerate = 0;
  const materials: { name: string; triangles: number }[] = [];

  const addPosition = (x: number, y: number, z: number): number =>
    positions.add(mirrorX([
      (x + centerX) * scale,
      (y + groundY) * scale,
      (z + centerZ) * scale,
    ]));
  const addNormal = (x: number, y: number, z: number): number => {
    const length = Math.hypot(x, y, z);
    return length > 0
      ? normals.add(mirrorX([x / length, y / length, z / length]))
      : normals.add([0, 1, 0]);
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
  const bounds = visibleBounds(positions.values);
  const file: BedrockGeometryFile = { format_version: '1.8.0' };
  file[identifier] = {
    texturewidth: 128,
    textureheight: 128,
    visible_bounds_width: bounds.visible_bounds_width,
    visible_bounds_height: bounds.visible_bounds_height,
    visible_bounds_offset: bounds.visible_bounds_offset,
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
    sourceTriangles: options.sourceTriangles ?? sourceTriangles,
    triangles,
    addedBackfaces,
    skippedDegenerate,
    positions: positions.values.length,
    normals: normals.values.length,
    uvs: uvs.values.length,
    bounds: { min: bounds.min, max: bounds.max },
    materials,
    warnings,
  };
  return { file, report };
}
