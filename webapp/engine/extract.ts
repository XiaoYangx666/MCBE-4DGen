import * as THREE from 'three';
import { dominantHumanoidPart } from '../../src/humanoid-binding.ts';
import { humanoidPivots, type HumanoidRig } from './humanoid.ts';
import { sourceAlphaOf } from './preview-materials.ts';
import {
  PART_CODE,
  type AlphaMode,
  type HumanoidPart,
  type SourceBatch,
  type SourcePart,
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
  /** Stable material key used by conversion settings; `uuid` stays runtime-only. */
  materialKey: string;
  key: string;
  name: string;
  positions: number[];
  normals: number[];
  uvs: number[] | null;
  color: Vec3;
  opacity: number;
  alphaMode: AlphaMode;
  alphaCutoff: number;
  doubleSided: boolean;
  texture: TextureSource | null;
  /** PART_CODE per triangle. */
  parts: number[];
  /** Stable part id per triangle, and the table it indexes. */
  sourceParts: number[];
  sourcePartTable: SourcePart[];
  sourcePartIndex: Map<string, number>;
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
  alphaTest?: number;
  transparent?: boolean;
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
  const stableMaterialKeys = stableMaterialKeyMap(scene);

  let meshIndex = 0;
  scene.traverseVisible((object) => {
    const mesh = object as THREE.Mesh;
    if (!(mesh as unknown as { isMesh?: boolean }).isMesh || !mesh.geometry) return;
    const currentMesh = meshIndex++;
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
      for (let corner = 0; corner < 3; corner++) {
        const vertexIndex = corner === 0 ? a : corner === 1 ? b : c;
        for (let i = 0; i < 4; i++) {
          const weight = skinWeight!.getComponent(vertexIndex, i);
          if (!(weight > 0)) continue;
          const joint = skeleton!.bones[skinIndex!.getComponent(vertexIndex, i)];
          const part = rig!.partForNode(joint);
          partScores.set(part, (partScores.get(part) ?? 0) + weight);
        }
      }
      return dominantHumanoidPart(partScores);
    };

    for (const [groupIndex, group] of groups.entries()) {
      const material = materials[group.materialIndex ?? 0] as (THREE.Material & MaterialFields) | undefined;
      if (!material || material.visible === false || material.colorWrite === false) continue;
      if ((material.opacity ?? 1) <= 0) continue;
      const materialKey = stableMaterialKeys.get(material.uuid) ?? `m:${material.name || material.uuid}#1`;
      const accumulator = accumulatorFor(accumulators, material, materialKey, warnings);
      if (!accumulator.materialKey) accumulator.materialKey = materialKey;
      const partId = `w${currentMesh}.${groupIndex}`;
      const baseName = mesh.name?.trim() || `mesh${currentMesh}`;
      const partName = groups.length > 1 ? `${baseName}#${groupIndex}` : baseName;
      let partIndex = accumulator.sourcePartIndex.get(partId);
      if (partIndex === undefined) {
        partIndex = accumulator.sourcePartTable.length;
        accumulator.sourcePartIndex.set(partId, partIndex);
        accumulator.sourcePartTable.push({
          id: partId,
          name: partName,
          mesh: baseName,
          group: groupIndex,
          materialKey,
        });
      }
      const start = Math.max(0, group.start);
      const end = Math.min(indexCount, group.start + group.count);
      for (let i = start; i + 2 < end; i += 3) {
        let ia = index ? index.getX(i) : i;
        let ib = index ? index.getX(i + 1) : i + 1;
        let ic = index ? index.getX(i + 2) : i + 2;
        if (mirrored) [ib, ic] = [ic, ib];
        triangleIndices[0] = ia;
        triangleIndices[1] = ib;
        triangleIndices[2] = ic;

        cornerPositionInto(position, ia, matrix, skinned, bake, cornerA);
        cornerPositionInto(position, ib, matrix, skinned, bake, cornerB);
        cornerPositionInto(position, ic, matrix, skinned, bake, cornerC);
        const edge1x = cornerB[0]! - cornerA[0]!, edge1y = cornerB[1]! - cornerA[1]!, edge1z = cornerB[2]! - cornerA[2]!;
        const edge2x = cornerC[0]! - cornerA[0]!, edge2y = cornerC[1]! - cornerA[1]!, edge2z = cornerC[2]! - cornerA[2]!;
        const crossX = edge1y * edge2z - edge1z * edge2y;
        const crossY = edge1z * edge2x - edge1x * edge2z;
        const crossZ = edge1x * edge2y - edge1y * edge2x;
        const crossLength = Math.hypot(crossX, crossY, crossZ);
        // Unit face normal, falling back to +Y for degenerate triangles.
        const faceX = crossLength > 0 ? crossX / crossLength : 0;
        const faceY = crossLength > 0 ? crossY / crossLength : 1;
        const faceZ = crossLength > 0 ? crossZ / crossLength : 0;

        for (let corner = 0; corner < 3; corner++) {
          const point = corner === 0 ? cornerA : corner === 1 ? cornerB : cornerC;
          accumulator.positions.push(point[0]!, point[1]!, point[2]!);
          let nx = faceX, ny = faceY, nz = faceZ;
          if (normal) {
            const vertexIndex = triangleIndices[corner]!;
            if (bake && skinnedNormalInto(skinned, vertexIndex, scratchNormal)) {
              skinnedNormalVector
                .set(scratchNormal[0]!, scratchNormal[1]!, scratchNormal[2]!)
                .applyMatrix3(normalMatrix);
              const length = skinnedNormalVector.length();
              if (length > 0) {
                nx = skinnedNormalVector.x / length;
                ny = skinnedNormalVector.y / length;
                nz = skinnedNormalVector.z / length;
              }
            } else {
              vertexInto(normal, vertexIndex, null, normalMatrix, scratchNormal);
              const length = Math.hypot(scratchNormal[0]!, scratchNormal[1]!, scratchNormal[2]!);
              if (length > 0) {
                nx = scratchNormal[0]! / length;
                ny = scratchNormal[1]! / length;
                nz = scratchNormal[2]! / length;
              }
            }
          }
          accumulator.normals.push(nx, ny, nz);
        }

        if (uv) {
          if (!accumulator.uvs) accumulator.uvs = [];
          for (let corner = 0; corner < 3; corner++) {
            imageUvInto(accumulator.material.map ?? null, uv, triangleIndices[corner]!, scratchUv);
            const u = scratchUv[0]!, v = scratchUv[1]!;
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

        accumulator.area += crossLength / 2;
        accumulator.parts.push(PART_CODE[partOfTriangle(ia, ib, ic)]);
        accumulator.sourceParts.push(partIndex);
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
      warnings.add(`材质「${accumulator.name}」的 UV 超出 0–1，将按贴图环绕模式展开图集。`);
    if (accumulator.missingUv && !accumulator.texture)
      warnings.add(`材质「${accumulator.name}」没有 UV，已使用纯色填充。`);
    if (accumulator.vertexColors)
      warnings.add(`材质「${accumulator.name}」使用顶点色，网页版只保留基础色与贴图。`);
    const hasBounds = Number.isFinite(accumulator.minU) && Number.isFinite(accumulator.minV);
    // Keep the continuous range: negative / seam-crossing UVs are rendered
    // with the source wrap mode instead of being clipped to a single tile.
    const bounds: [number, number, number, number] | null = hasBounds
      ? [
          accumulator.minU,
          accumulator.minV,
          accumulator.maxU,
          accumulator.maxV,
        ]
      : null;
    batches.push({
      key: accumulator.key,
      name: accumulator.name,
      materialKey: accumulator.materialKey,
      positions: new Float32Array(accumulator.positions),
      normals: new Float32Array(accumulator.normals),
      uvs: accumulator.uvs ? new Float32Array(accumulator.uvs) : null,
      color: accumulator.color,
      opacity: clamp01(accumulator.material.opacity ?? 1),
      alphaMode: accumulator.alphaMode,
      alphaCutoff: accumulator.alphaCutoff,
      doubleSided: accumulator.doubleSided,
      texture: accumulator.texture,
      uvBounds: bounds && bounds[2] - bounds[0] > 1e-6 && bounds[3] - bounds[1] > 1e-6 ? bounds : null,
      triangles: accumulator.triangles,
      area: accumulator.area,
      sourceParts: Uint16Array.from(accumulator.sourceParts),
      sourcePartTable: accumulator.sourcePartTable,
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

/**
 * Stable material identity for one imported scene. The same material name can
 * appear several times; the occurrence suffix keeps each sampler distinct.
 * Runtime `uuid`s are only used inside one extraction.
 */
function stableMaterialKeyMap(root: THREE.Object3D): Map<string, string> {
  const keys = new Map<string, string>();
  const seen = new Map<string, number>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!(mesh as unknown as { isMesh?: boolean }).isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      const value = material as THREE.Material | undefined;
      if (!value || keys.has(value.uuid)) continue;
      const name = value.name?.trim() || `材质 ${keys.size + 1}`;
      const occurrence = (seen.get(name) ?? 0) + 1;
      seen.set(name, occurrence);
      keys.set(value.uuid, `m:${name}#${occurrence}`);
    }
  });
  return keys;
}

function accumulatorFor(
  map: Map<string, Accumulator>,
  material: THREE.Material & MaterialFields,
  materialKey: string,
  warnings: Set<string>,
): Accumulator {
  const existing = map.get(material.uuid);
  if (existing) return existing;
  const texture = textureSource(material.map ?? null, warnings);
  const color = material.color ? srgb(material.color) : ([1, 1, 1] as Vec3);
  const alphaTest = material.alphaTest ?? 0;
  // The preview policy may have rewritten alphaTest/transparent for display;
  // conversions must keep the alpha semantics the source file declared.
  const sourceAlpha = sourceAlphaOf(material);
  const accumulator: Accumulator = {
    material,
    materialKey,
    key: materialKey,
    name: material.name?.trim() || `材质 ${map.size + 1}`,
    positions: [],
    normals: [],
    uvs: null,
    color,
    opacity: material.opacity ?? 1,
    // Same mapping the Node importer relies on: glTF alphaTest => MASK,
    // transparent => BLEND, everything else is opaque.
    alphaMode: sourceAlpha?.alphaMode ?? (alphaTest > 0 ? 'MASK' : material.transparent ? 'BLEND' : 'OPAQUE'),
    alphaCutoff: sourceAlpha?.alphaCutoff ?? (alphaTest > 0 ? alphaTest : 0.5),
    doubleSided: material.side === THREE.DoubleSide,
    texture,
    parts: [],
    sourceParts: [],
    sourcePartTable: [],
    sourcePartIndex: new Map<string, number>(),
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
  return {
    image: image as CanvasImageSource,
    width,
    height,
    key,
    // PMX / glTF samplers default to repeat; three exposes 1000/1001/1002.
    wrapS: map.wrapS ?? 1000,
    wrapT: map.wrapT ?? 1000,
  };
}

function imageUvInto(
  map: THREE.Texture | null,
  attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  index: number,
  out: number[],
) {
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
  out[0] = u;
  out[1] = v;
}

/** Reused corner buffers: extraction runs over millions of triangles. */
const cornerA: Vec3 = [0, 0, 0];
const cornerB: Vec3 = [0, 0, 0];
const cornerC: Vec3 = [0, 0, 0];
const scratchNormal: Vec3 = [0, 0, 0];
const scratchUv = [0, 0];
const triangleIndices = [0, 0, 0];

const matrixVector = new THREE.Vector3();
const normalVector = new THREE.Vector3();
const skinnedPosition = new THREE.Vector3();
const skinnedNormalVector = new THREE.Vector3();
const skinAccumulator = new THREE.Matrix4();
const skinBoneMatrix = new THREE.Matrix4();
const skinNormalMatrix = new THREE.Matrix3();

function cornerPositionInto(
  attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  index: number,
  matrix: THREE.Matrix4,
  mesh: THREE.SkinnedMesh,
  bake: boolean,
  out: Vec3,
) {
  if (bake) {
    skinnedPosition.set(attribute.getX(index), attribute.getY(index), attribute.getZ(index));
    mesh.applyBoneTransform(index, skinnedPosition);
    skinnedPosition.applyMatrix4(matrix);
    out[0] = skinnedPosition.x;
    out[1] = skinnedPosition.y;
    out[2] = skinnedPosition.z;
    return;
  }
  vertexInto(attribute, index, matrix, undefined, out);
}

/** Skinned normal in mesh-local space, matching three's skinning shader. */
function skinnedNormalInto(mesh: THREE.SkinnedMesh, index: number, out: Vec3): boolean {
  const geometry = mesh.geometry;
  const skinIndex = geometry.getAttribute('skinIndex');
  const skinWeight = geometry.getAttribute('skinWeight');
  const normal = geometry.getAttribute('normal');
  if (!skinIndex || !skinWeight || !normal || !mesh.skeleton) return false;

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
  if (skinnedNormalVector.lengthSq() < 1e-12) return false;
  skinnedNormalVector.normalize();
  out[0] = skinnedNormalVector.x;
  out[1] = skinnedNormalVector.y;
  out[2] = skinnedNormalVector.z;
  return true;
}

function vertexInto(
  attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  index: number,
  matrix: THREE.Matrix4 | null,
  normalMatrix: THREE.Matrix3 | undefined,
  out: Vec3,
) {
  const x = attribute.getX(index);
  const y = attribute.getY(index);
  const z = attribute.getZ(index);
  if (matrix) {
    matrixVector.set(x, y, z).applyMatrix4(matrix);
    out[0] = matrixVector.x;
    out[1] = matrixVector.y;
    out[2] = matrixVector.z;
    return;
  }
  if (normalMatrix) {
    normalVector.set(x, y, z).applyMatrix3(normalMatrix);
    out[0] = normalVector.x;
    out[1] = normalVector.y;
    out[2] = normalVector.z;
    return;
  }
  out[0] = x;
  out[1] = y;
  out[2] = z;
}

function srgb(color: THREE.Color): Vec3 {
  const converted = color.clone();
  if (THREE.ColorManagement.enabled) converted.convertLinearToSRGB();
  return [clamp01(converted.r), clamp01(converted.g), clamp01(converted.b)];
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
