import * as THREE from 'three';
import { dominantHumanoidPart } from '../../src/humanoid-binding.ts';
import { humanoidPivots, type HumanoidRig } from './humanoid.ts';
import {
  PART_CODE,
  type HumanoidPart,
  type SourceBatch,
  type TextureSource,
  type Vec3,
} from './types.ts';

export interface ExtractedModel {
  batches: SourceBatch[];
  warnings: string[];
  /** Present when extracted with a complete humanoid rig. */
  rig: { pivots: Partial<Record<HumanoidPart, Vec3>> } | null;
  stats: {
    triangles: number;
    materials: number;
    textures: number;
    vertices: number;
  };
}

interface Accumulator {
  material: THREE.Material & MaterialFields;
  key: string;
  name: string;
  positions: number[];
  normals: number[];
  uvs: number[] | null;
  color: Vec3;
  opacity: number;
  doubleSided: boolean;
  texture: TextureSource | null;
  /** PART_CODE per triangle. */
  parts: number[];
  minU: number;
  minV: number;
  maxU: number;
  maxV: number;
  area: number;
  triangles: number;
  outsideUv: boolean;
  missingUv: boolean;
  vertexColors: boolean;
}

interface MaterialFields {
  color?: THREE.Color;
  map?: THREE.Texture | null;
  opacity?: number;
  side?: THREE.Side;
  colorWrite?: boolean;
  vertexColors?: boolean;
  visible?: boolean;
}

const IDENTITY_NORMAL = new THREE.Matrix3();

export interface ExtractOptions {
  /** Rotate the whole model around its origin before baking, in degrees. */
  rotationYDegrees?: number;
  /** Bake the current skeleton pose (used for arm/pose adjustments). */
  bakeSkinning?: boolean;
  /** Complete humanoid rig; when set, triangles are classified per part. */
  rig?: HumanoidRig | null;
}

/**
 * Bake the loaded scene's bind pose into flat triangle soup grouped by
 * material. Skinning, morphs and animation are deliberately not evaluated
 * unless `bakeSkinning` is set for an explicit pose adjustment.
 */
export function extractModel(
  scene: THREE.Object3D,
  options: ExtractOptions = {},
): ExtractedModel {
  scene.updateMatrixWorld(true);
  if (options.bakeSkinning) {
    scene.traverse((object) => {
      const mesh = object as THREE.SkinnedMesh;
      if (mesh.isSkinnedMesh) mesh.skeleton.update();
    });
  }
  const angle = ((options.rotationYDegrees ?? 0) * Math.PI) / 180;
  const rotation = Math.abs(angle) > 1e-6
    ? new THREE.Matrix4().makeRotationY(angle)
    : null;
  const accumulators = new Map<string, Accumulator>();
  const warnings = new Set<string>();
  let sourceTriangles = 0;
  let skippedMeshes = 0;
  const rig = options.rig ?? null;
  const pivots = rig ? humanoidPivots(rig, rotation) : null;

  scene.traverseVisible((object) => {
    const mesh = object as THREE.Mesh;
    if (!(mesh as unknown as { isMesh?: boolean }).isMesh || !mesh.geometry) return;
    if ((object as THREE.SkinnedMesh).isSkinnedMesh) {
      warnings.add(options.rig
        ? '模型包含骨骼网格：按当前绑定姿势导出六部位，播放中的源动画不会保留。'
        : '模型包含骨骼动画网格：网页版使用绑定姿势（T-pose）导出，不评估当前动作。');
    }
    if (mesh.morphTargetInfluences?.some((influence) => Math.abs(influence) > 1e-6)) {
      warnings.add('模型包含表情/形态键：网页版忽略这些变形，仅导出基础网格。');
    }
    const geometry = mesh.geometry as THREE.BufferGeometry;
    const position = geometry.getAttribute('position');
    if (!position) {
      skippedMeshes++;
      return;
    }
    const normal = geometry.getAttribute('normal');
    const uv = geometry.getAttribute('uv');
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const index = geometry.getIndex();
    const indexCount = index ? index.count : position.count;
    const groups = mesh.material && Array.isArray(mesh.material) && geometry.groups.length
      ? geometry.groups
      : [{ start: 0, count: indexCount, materialIndex: 0 }];

    const matrix = rotation
      ? new THREE.Matrix4().multiplyMatrices(rotation, mesh.matrixWorld)
      : mesh.matrixWorld;
    const normalMatrix = geometry.getAttribute('normal')
      ? new THREE.Matrix3().getNormalMatrix(matrix)
      : IDENTITY_NORMAL;
    const mirrored = matrix.determinant() < 0;
    const skinned = mesh as THREE.SkinnedMesh;
    const bake = !!options.bakeSkinning && skinned.isSkinnedMesh &&
      !!geometry.getAttribute('skinIndex') && !!geometry.getAttribute('skinWeight');
    const skinIndex = geometry.getAttribute('skinIndex');
    const skinWeight = geometry.getAttribute('skinWeight');
    const skeleton = skinned.isSkinnedMesh ? skinned.skeleton : null;
    const classify = !!rig && !!skeleton && !!skinIndex && !!skinWeight;
    const partScores = new Map<HumanoidPart, number>();
    const partOfTriangle = (a: number, b: number, c: number): HumanoidPart => {
      if (!classify) return 'body';
      partScores.clear();
      for (const index of [a, b, c]) {
        for (let i = 0; i < 4; i++) {
          const weight = skinWeight!.getComponent(index, i);
          if (!(weight > 0)) continue;
          const joint = skeleton!.bones[skinIndex!.getComponent(index, i)];
          const part = rig!.partForNode(joint);
          partScores.set(part, (partScores.get(part) ?? 0) + weight);
        }
      }
      return dominantHumanoidPart(partScores);
    };

    for (const group of groups) {
      const material = materials[group.materialIndex ?? 0] as (THREE.Material & MaterialFields) | undefined;
      if (!material || material.visible === false || material.colorWrite === false) continue;
      if ((material.opacity ?? 1) <= 0) continue;
      const accumulator = accumulatorFor(accumulators, material, warnings);
      const start = Math.max(0, group.start);
      const end = Math.min(indexCount, group.start + group.count);
      for (let i = start; i + 2 < end; i += 3) {
        let ia = index ? index.getX(i) : i;
        let ib = index ? index.getX(i + 1) : i + 1;
        let ic = index ? index.getX(i + 2) : i + 2;
        if (mirrored) [ib, ic] = [ic, ib];

        const a = cornerPosition(position, ia, matrix, skinned, bake);
        const b = cornerPosition(position, ib, matrix, skinned, bake);
        const c = cornerPosition(position, ic, matrix, skinned, bake);
        const face = faceNormal(a, b, c);
        const corners = [
          { index: ia, position: a },
          { index: ib, position: b },
          { index: ic, position: c },
        ];
        for (const corner of corners) {
          accumulator.positions.push(corner.position[0], corner.position[1], corner.position[2]);
          let n: Vec3;
          if (normal) {
            const posed = bake ? skinnedNormal(skinned, corner.index) : null;
            if (posed) {
              skinnedNormalVector.set(posed[0], posed[1], posed[2]).applyMatrix3(normalMatrix);
              const length = skinnedNormalVector.length();
              n = length > 0
                ? [skinnedNormalVector.x / length, skinnedNormalVector.y / length, skinnedNormalVector.z / length]
                : face;
            } else {
              n = vertex(normal, corner.index, null, normalMatrix);
              const length = Math.hypot(n[0], n[1], n[2]);
              n = length > 0 ? [n[0] / length, n[1] / length, n[2] / length] : face;
            }
          } else {
            n = face;
          }
          accumulator.normals.push(n[0], n[1], n[2]);
        }

        if (uv) {
          if (!accumulator.uvs) accumulator.uvs = [];
          for (const corner of corners) {
            const [u, v] = imageUv(accumulator.material.map ?? null, uv, corner.index);
            accumulator.uvs.push(u, v);
            accumulator.minU = Math.min(accumulator.minU, u);
            accumulator.minV = Math.min(accumulator.minV, v);
            accumulator.maxU = Math.max(accumulator.maxU, u);
            accumulator.maxV = Math.max(accumulator.maxV, v);
            if (u < -1e-4 || u > 1.0001 || v < -1e-4 || v > 1.0001) accumulator.outsideUv = true;
          }
        } else {
          accumulator.missingUv = true;
        }

        const edge1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]] as Vec3;
        const edge2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]] as Vec3;
        accumulator.area += Math.hypot(
          edge1[1] * edge2[2] - edge1[2] * edge2[1],
          edge1[2] * edge2[0] - edge1[0] * edge2[2],
          edge1[0] * edge2[1] - edge1[1] * edge2[0],
        ) / 2;
        accumulator.parts.push(PART_CODE[partOfTriangle(ia, ib, ic)]);
        accumulator.triangles++;
        sourceTriangles++;
      }
    }
  });

  if (skippedMeshes) warnings.add(`${skippedMeshes} 个网格没有顶点数据，已跳过。`);
  if (!accumulators.size) {
    throw new Error('没有找到可导出的网格。请确认文件包含三角面，而不是纯骨骼或纯点云。');
  }

  const batches: SourceBatch[] = [];
  for (const accumulator of accumulators.values()) {
    if (!accumulator.triangles) continue;
    if (accumulator.outsideUv)
      warnings.add(`材质「${accumulator.name}」的 UV 超出 0–1，已按裁切后的范围导出。`);
    if (accumulator.missingUv && !accumulator.texture)
      warnings.add(`材质「${accumulator.name}」没有 UV，已使用纯色填充。`);
    if (accumulator.vertexColors)
      warnings.add(`材质「${accumulator.name}」使用顶点色，网页版只保留基础色与贴图。`);
    const hasBounds = Number.isFinite(accumulator.minU) && Number.isFinite(accumulator.minV);
    const bounds: [number, number, number, number] | null = hasBounds
      ? [
          Math.max(0, accumulator.minU),
          Math.max(0, accumulator.minV),
          Math.min(1, accumulator.maxU),
          Math.min(1, accumulator.maxV),
        ]
      : null;
    batches.push({
      key: accumulator.key,
      name: accumulator.name,
      positions: new Float32Array(accumulator.positions),
      normals: new Float32Array(accumulator.normals),
      uvs: accumulator.uvs ? new Float32Array(accumulator.uvs) : null,
      color: accumulator.color,
      opacity: clamp01(accumulator.material.opacity ?? 1),
      doubleSided: accumulator.doubleSided,
      texture: accumulator.texture,
      uvBounds: bounds && bounds[2] - bounds[0] > 1e-6 && bounds[3] - bounds[1] > 1e-6 ? bounds : null,
      triangles: accumulator.triangles,
      area: accumulator.area,
      ...(rig ? { parts: Uint8Array.from(accumulator.parts) } : {}),
    });
  }

  const textures = new Set(batches.map((batch) => batch.texture?.key).filter(Boolean));
  return {
    batches,
    warnings: [...warnings],
    rig: pivots,
    stats: {
      triangles: sourceTriangles,
      materials: batches.length,
      textures: textures.size,
      vertices: batches.reduce((sum, batch) => sum + batch.positions.length / 3, 0),
    },
  };
}

function accumulatorFor(
  map: Map<string, Accumulator>,
  material: THREE.Material & MaterialFields,
  warnings: Set<string>,
): Accumulator {
  const existing = map.get(material.uuid);
  if (existing) return existing;
  const texture = textureSource(material.map ?? null, warnings);
  const color = material.color ? srgb(material.color) : ([1, 1, 1] as Vec3);
  const accumulator: Accumulator = {
    material,
    key: material.uuid,
    name: material.name?.trim() || `材质 ${map.size + 1}`,
    positions: [],
    normals: [],
    uvs: null,
    color,
    opacity: material.opacity ?? 1,
    doubleSided: material.side === THREE.DoubleSide,
    texture,
    parts: [],
    minU: Infinity,
    minV: Infinity,
    maxU: -Infinity,
    maxV: -Infinity,
    area: 0,
    triangles: 0,
    outsideUv: false,
    missingUv: false,
    vertexColors: !!material.vertexColors,
  };
  map.set(material.uuid, accumulator);
  return accumulator;
}

function textureSource(map: THREE.Texture | null, warnings: Set<string>): TextureSource | null {
  if (!map) return null;
  if ((map as THREE.CompressedTexture).isCompressedTexture) {
    warnings.add('检测到压缩纹理（KTX2/DDS 等），网页版无法解码，将使用材质基础色。');
    return null;
  }
  const image = map.image as unknown as {
    width?: number;
    height?: number;
    naturalWidth?: number;
    naturalHeight?: number;
    data?: unknown;
  } | null;
  if (!image || image.data) {
    if (image?.data) warnings.add('检测到原始像素纹理，网页版无法直接读取，将使用材质基础色。');
    return null;
  }
  const width = image.naturalWidth ?? image.width ?? 0;
  const height = image.naturalHeight ?? image.height ?? 0;
  if (!(width > 0 && height > 0)) return null;
  const source = map.source;
  const key = `${source?.uuid ?? map.uuid}:${map.flipY ? 'flip' : 'keep'}`;
  return { image: image as CanvasImageSource, width, height, key };
}

function imageUv(
  map: THREE.Texture | null,
  attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  index: number,
): [number, number] {
  let u = attribute.getX(index);
  let v = attribute.getY(index);
  if (map) {
    if (map.matrixAutoUpdate) map.updateMatrix();
    const e = map.matrix.elements;
    const transformedU = e[0]! * u + e[3]! * v + e[6]!;
    const transformedV = e[1]! * u + e[4]! * v + e[7]!;
    u = transformedU;
    v = transformedV;
    if (map.flipY) v = 1 - v;
  }
  return [u, v];
}

const matrixVector = new THREE.Vector3();
const normalVector = new THREE.Vector3();
const skinnedPosition = new THREE.Vector3();
const skinnedNormalVector = new THREE.Vector3();
const skinAccumulator = new THREE.Matrix4();
const skinBoneMatrix = new THREE.Matrix4();
const skinNormalMatrix = new THREE.Matrix3();

function cornerPosition(
  attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  index: number,
  matrix: THREE.Matrix4,
  mesh: THREE.SkinnedMesh,
  bake: boolean,
): Vec3 {
  if (bake) {
    skinnedPosition.set(attribute.getX(index), attribute.getY(index), attribute.getZ(index));
    mesh.applyBoneTransform(index, skinnedPosition);
    skinnedPosition.applyMatrix4(matrix);
    return [skinnedPosition.x, skinnedPosition.y, skinnedPosition.z];
  }
  return vertex(attribute, index, matrix);
}

/** Skinned normal in mesh-local space, matching three's skinning shader. */
function skinnedNormal(mesh: THREE.SkinnedMesh, index: number): Vec3 | null {
  const geometry = mesh.geometry;
  const skinIndex = geometry.getAttribute('skinIndex');
  const skinWeight = geometry.getAttribute('skinWeight');
  const normal = geometry.getAttribute('normal');
  if (!skinIndex || !skinWeight || !normal || !mesh.skeleton) return null;

  skinAccumulator.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  const accumulated = skinAccumulator.elements;
  for (let i = 0; i < 4; i++) {
    const weight = skinWeight.getComponent(index, i);
    if (!weight) continue;
    const boneIndex = skinIndex.getComponent(index, i);
    const bone = mesh.skeleton.bones[boneIndex];
    const inverse = mesh.skeleton.boneInverses[boneIndex];
    if (!bone || !inverse) continue;
    skinBoneMatrix
      .multiplyMatrices(bone.matrixWorld, inverse)
      .premultiply(mesh.bindMatrixInverse)
      .multiply(mesh.bindMatrix);
    const elements = skinBoneMatrix.elements;
    for (let j = 0; j < 16; j++) accumulated[j]! += elements[j]! * weight;
  }

  skinNormalMatrix.setFromMatrix4(skinAccumulator);
  skinnedNormalVector
    .set(normal.getX(index), normal.getY(index), normal.getZ(index))
    .applyMatrix3(skinNormalMatrix);
  if (skinnedNormalVector.lengthSq() < 1e-12) return null;
  skinnedNormalVector.normalize();
  return [skinnedNormalVector.x, skinnedNormalVector.y, skinnedNormalVector.z];
}

function vertex(
  attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  index: number,
  matrix: THREE.Matrix4 | null,
  normalMatrix?: THREE.Matrix3,
): Vec3 {
  const x = attribute.getX(index);
  const y = attribute.getY(index);
  const z = attribute.getZ(index);
  if (matrix) {
    matrixVector.set(x, y, z).applyMatrix4(matrix);
    return [matrixVector.x, matrixVector.y, matrixVector.z];
  }
  if (normalMatrix) {
    normalVector.set(x, y, z).applyMatrix3(normalMatrix);
    return [normalVector.x, normalVector.y, normalVector.z];
  }
  return [x, y, z];
}

function faceNormal(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const x = uy * vz - uz * vy;
  const y = uz * vx - ux * vz;
  const z = ux * vy - uy * vx;
  const length = Math.hypot(x, y, z);
  return length > 0 ? [x / length, y / length, z / length] : [0, 1, 0];
}

function srgb(color: THREE.Color): Vec3 {
  const converted = color.clone();
  if (THREE.ColorManagement.enabled) converted.convertLinearToSRGB();
  return [clamp01(converted.r), clamp01(converted.g), clamp01(converted.b)];
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
