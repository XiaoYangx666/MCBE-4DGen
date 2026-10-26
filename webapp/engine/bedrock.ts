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
} from '../../src/poly-mesh-writer.ts';
import { CODE_PART, type HumanoidPart, type SourceBatch } from './types.ts';

export type DoubleSidedPolicy = 'source' | 'all' | 'front';

export interface GeometryRig {
  /** World-space source pivots before fitting and X mirroring. */
  pivots: Partial<Record<HumanoidPart, V3>>;
}

export interface GeometryOptions {
  height: number;
  doubleSided: DoubleSidedPolicy;
  identifier?: `geometry.${string}`;
  /** Pre-reduction triangle count, for the report only. */
  sourceTriangles?: number;
  /** Enables the six-part player skeleton instead of one static body bone. */
  rig?: GeometryRig;
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
  parts?: Partial<Record<HumanoidPart, number>>;
  warnings: string[];
}

const defaultPivot = (): V3 => [0, 24, 0];

/** Player skeleton shared by static and six-part exports. */
const PLAYER_SKELETON: { name: string; parent?: string; pivot: V3 }[] = [
  { name: 'root', pivot: [0, 0, 0] },
  { name: 'waist', parent: 'root', pivot: [0, 12, 0] },
  { name: 'body', parent: 'waist', pivot: [0, 24, 0] },
  { name: 'head', parent: 'body', pivot: [0, 24, 0] },
  { name: 'leftArm', parent: 'body', pivot: [-5, 22, 0] },
  { name: 'rightArm', parent: 'body', pivot: [5, 22, 0] },
  { name: 'leftLeg', parent: 'root', pivot: [-1.9, 12, 0] },
  { name: 'rightLeg', parent: 'root', pivot: [1.9, 12, 0] },
];

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
  const rig = options.rig;

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

  const streams = new Map<HumanoidPart, ReturnType<typeof createPolyMeshStreams>>();
  const streamFor = (part: HumanoidPart) => {
    let stream = streams.get(part);
    if (!stream) {
      stream = createPolyMeshStreams();
      streams.set(part, stream);
    }
    return stream;
  };

  let addedBackfaces = 0;
  let skippedDegenerate = 0;
  const materials: { name: string; triangles: number }[] = [];

  const fit = (x: number, y: number, z: number): V3 => [
    (x + centerX) * scale,
    (y + groundY) * scale,
    (z + centerZ) * scale,
  ];
  const addPosition = (stream: ReturnType<typeof createPolyMeshStreams>, point: V3): number =>
    stream.positions.add(mirrorX(point));
  const addNormal = (
    stream: ReturnType<typeof createPolyMeshStreams>,
    x: number,
    y: number,
    z: number,
    back = false,
  ): number => {
    const length = Math.hypot(x, y, z);
    if (!(length > 0)) return stream.normals.add([0, 1, 0]);
    const sign = back ? -1 : 1;
    return stream.normals.add(mirrorX([(sign * x) / length, (sign * y) / length, (sign * z) / length]));
  };
  const addUv = (stream: ReturnType<typeof createPolyMeshStreams>, u: number, v: number): number =>
    stream.uvs.add([
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
      const a3 = fit(batch.positions[offset]!, batch.positions[offset + 1]!, batch.positions[offset + 2]!);
      const b3 = fit(batch.positions[offset + 3]!, batch.positions[offset + 4]!, batch.positions[offset + 5]!);
      const c3 = fit(batch.positions[offset + 6]!, batch.positions[offset + 7]!, batch.positions[offset + 8]!);
      if (isDegenerate(a3, b3, c3)) {
        skippedDegenerate++;
        continue;
      }
      const part: HumanoidPart = rig
        ? (CODE_PART[batch.parts?.[t] ?? 0] ?? 'body')
        : 'body';
      const stream = streamFor(part);
      const a = addPosition(stream, a3);
      const b = addPosition(stream, b3);
      const c = addPosition(stream, c3);
      const na = addNormal(stream, batch.normals[offset]!, batch.normals[offset + 1]!, batch.normals[offset + 2]!);
      const nb = addNormal(stream, batch.normals[offset + 3]!, batch.normals[offset + 4]!, batch.normals[offset + 5]!);
      const nc = addNormal(stream, batch.normals[offset + 6]!, batch.normals[offset + 7]!, batch.normals[offset + 8]!);
      const uvOffset = t * 6;
      const ua = addUv(stream, batch.uvs?.[uvOffset] ?? 0.5, batch.uvs?.[uvOffset + 1] ?? 0.5);
      const ub = addUv(stream, batch.uvs?.[uvOffset + 2] ?? 0.5, batch.uvs?.[uvOffset + 3] ?? 0.5);
      const uc = addUv(stream, batch.uvs?.[uvOffset + 4] ?? 0.5, batch.uvs?.[uvOffset + 5] ?? 0.5);
      stream.polyMesh.polys.push([[a, na, ua], [b, nb, ub], [c, nc, uc], [c, nc, uc]]);
      kept++;
      if (duplicate) {
        const ba = addNormal(stream, batch.normals[offset]!, batch.normals[offset + 1]!, batch.normals[offset + 2]!, true);
        const bb = addNormal(stream, batch.normals[offset + 3]!, batch.normals[offset + 4]!, batch.normals[offset + 5]!, true);
        const bc = addNormal(stream, batch.normals[offset + 6]!, batch.normals[offset + 7]!, batch.normals[offset + 8]!, true);
        stream.polyMesh.polys.push(
          [[c, bc, uc], [b, bb, ub], [a, ba, ua], [a, ba, ua]] as [VertexRef, VertexRef, VertexRef, VertexRef],
        );
        addedBackfaces++;
      }
    }
    if (kept) materials.push({ name: batch.name, triangles: kept });
  }

  if (![...streams.values()].some((stream) => stream.polyMesh.polys.length))
    throw new Error('没有可导出的三角面（可能全部退化）');

  const mainStream = streams.get('body') ?? [...streams.values()][0]!;
  const bones: BedrockBone[] = rig
    ? PLAYER_SKELETON.map((bone) => {
        const part = bone.name as HumanoidPart;
        const pivot = rig.pivots[part];
        const fitted = pivot ? mirrorX(fit(pivot[0], pivot[1], pivot[2])) : mirrorX(bone.pivot);
        const stream = streams.get(part);
        return {
          name: bone.name,
          ...(bone.parent ? { parent: bone.parent } : {}),
          pivot: fitted,
          ...(stream ? { poly_mesh: stream.polyMesh } : {}),
        };
      })
    : [{ name: 'body', pivot: defaultPivot(), poly_mesh: mainStream.polyMesh }];

  if (rig) {
    const waist = bones.find((bone) => bone.name === 'waist');
    const body = bones.find((bone) => bone.name === 'body');
    if (waist && body?.pivot) waist.pivot = [...body.pivot];
  }

  function* emittedPositions() {
    for (const stream of streams.values()) yield* stream.positions.values;
  }
  const bounds = visibleBounds(emittedPositions());
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
  let triangles = 0;
  const parts: Partial<Record<HumanoidPart, number>> = {};
  for (const [part, stream] of streams) {
    triangles += stream.polyMesh.polys.length;
    parts[part] = stream.polyMesh.polys.length;
  }
  if (rig) {
    const empty = (Object.keys(rig.pivots) as HumanoidPart[])
      .filter((part) => !streams.has(part));
    if (empty.length)
      warnings.push(`这些部位没有三角面，导出后不会跟随动作：${empty.join('、')}。`);
    warnings.push('六部位刚性绑定：头、躯干、双臂、双腿会跟随玩家动作；肘膝弯曲、手指和物理不会保留。');
  }
  if (addedBackfaces) warnings.push(`已为双面材质补充 ${addedBackfaces} 个背面三角面。`);
  if (triangles > 52_106)
    warnings.push(`输出包含 ${triangles.toLocaleString('zh-CN')} 个三角面，超过已验证样本约 52,106 面，建议在实际客户端确认。`);

  validateGeometry(file, {
    expectedIdentifier: identifier,
    textureSize: { width: 128, height: 128 },
    atlasUVs: true,
  });

  const positions = [...streams.values()].reduce((sum, stream) => sum + stream.positions.values.length, 0);
  const normals = [...streams.values()].reduce((sum, stream) => sum + stream.normals.values.length, 0);
  const uvs = [...streams.values()].reduce((sum, stream) => sum + stream.uvs.values.length, 0);
  const report: GeometryReport = {
    sourceTriangles: options.sourceTriangles ?? sourceTriangles,
    triangles,
    addedBackfaces,
    skippedDegenerate,
    positions,
    normals,
    uvs,
    bounds: { min: bounds.min, max: bounds.max },
    materials,
    ...(rig ? { parts } : {}),
    warnings,
  };
  return { file, report };
}
