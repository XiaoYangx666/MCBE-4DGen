/**
 * Yes Steve Model (YSM) folder-format parsing.
 *
 * The geometry inside a YSM model is regular Bedrock entity geometry. The
 * conversion below follows the official YSM `GeoBuilder` implementation so the
 * imported mesh keeps the same orientation, bone pivots, per-face UVs and
 * box-UV layout the mod renders. Only static geometry is produced: animations,
 * controllers, locators and the first-person arm model are intentionally out of
 * scope for the first import milestone.
 *
 * Reference (Apache-2.0): YesSteveModel/YesSteveModel,
 * src/main/java/com/elfmcys/ysm/format/parser/GeoBuilder.java.
 */

import {
  HUMANOID_PART_ROLES,
  HUMANOID_PARTS,
  HUMANOID_REQUIRED_ROLES,
  type HumanoidPart,
} from './humanoid-binding.ts';
import type { TextureHint } from './texture-policy.ts';
import type { ReductionHint } from './reduce-policy.ts';

export type V2 = [number, number];
export type V3 = [number, number, number];

export type YsmFace = 'north' | 'east' | 'south' | 'west' | 'up' | 'down';

export interface YsmFaceUv {
  uv: V2;
  uv_size: V2;
  uv_rotation?: number;
}

export type YsmCubeUv = V2 | Partial<Record<YsmFace, YsmFaceUv>>;

export interface YsmCube {
  origin?: V3;
  size?: V3;
  pivot?: V3;
  rotation?: V3;
  inflate?: number;
  mirror?: boolean;
  uv?: YsmCubeUv;
}

export interface YsmBone {
  name: string;
  parent?: string;
  pivot?: V3;
  rotation?: V3;
  inflate?: number;
  mirror?: boolean;
  cubes?: YsmCube[];
}

export interface YsmGeometry {
  textureWidth: number;
  textureHeight: number;
  bones: YsmBone[];
}

export interface YsmTexture {
  uv: string;
  normal?: string;
  specular?: string;
}

export interface YsmManifest {
  spec?: number;
  name?: string;
  tips?: string;
  authors: string[];
  license?: string;
  defaultTexture?: string;
  mainModel: string;
  armModel?: string;
  mainAnimation?: string;
  textures: YsmTexture[];
}

export interface YsmMeshPart {
  name: string;
  /** Original bone name, before duplicate-name suffixes. */
  bone: string;
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
}

export interface YsmMesh {
  parts: YsmMeshPart[];
  textureWidth: number;
  textureHeight: number;
  diagnostics: YsmDiagnostic[];
}

export interface ParsedYsmGeometry {
  geometry: YsmGeometry;
  diagnostics: YsmDiagnostic[];
}

/** Player roles a YSM skeleton must expose before six-part binding is used. */
export const YSM_HUMANOID_ROLES = HUMANOID_REQUIRED_ROLES;
export type YsmHumanoidRole = (typeof YSM_HUMANOID_ROLES)[number];

/**
 * Structured import diagnostics. Runtimes format these into their own user
 * language; the parser must not embed English or Chinese copy.
 */
export type YsmDiagnostic =
  | { code: 'cube-not-object'; cube: number }
  | { code: 'cube-without-uv'; cube: number }
  | { code: 'face-uv-rotation-ignored' }
  | { code: 'multiple-geometries'; count: number }
  | { code: 'bone-not-object'; bone: number }
  | { code: 'bone-without-name'; bone: number }
  | { code: 'duplicate-bone'; name: string }
  | { code: 'duplicate-bone-conflict'; name: string }
  | { code: 'cyclic-bone'; name: string }
  | { code: 'missing-parent'; name: string; parent: string }
  | { code: 'hidden-bones'; names: string[] }
  | { code: 'missing-role'; role: YsmHumanoidRole }
  | { code: 'hand-fallback'; side: 'left' | 'right'; name: string }
  | { code: 'incomplete-rig' }
  | { code: 'humanoid-mapped' }
  | { code: 'missing-part-geometry'; parts: HumanoidPart[] }
  | { code: 'static-binding' }
  | { code: 'pbr-textures-ignored' }
  | { code: 'default-texture-missing'; wanted: string; used: string }
  | { code: 'multiple-textures'; count: number; used: string }
  | { code: 'arm-model-ignored' }
  | { code: 'animations-not-evaluated' }
  | { code: 'imported-texture'; model: string; texture: string };

export interface YsmRig {
  /** Role → world pivot in meters, in the converter's source space. */
  roles: Partial<Record<YsmHumanoidRole, V3>>;
  /** Role → source bone name, for tagging the original hierarchy. */
  roleBones: Partial<Record<YsmHumanoidRole, string>>;
  /** Bone name → player part, used to tag mesh nodes before export. */
  parts: Record<string, HumanoidPart>;
  /** True when every required player role was found. */
  complete: boolean;
  diagnostics: YsmDiagnostic[];
}

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

function vector(value: unknown, length: 2 | 3): number[] | undefined {
  if (!Array.isArray(value) || value.length < length) return undefined;
  const result = value.slice(0, length);
  return result.every(finite) ? (result as number[]) : undefined;
}

function numberOr(value: unknown, fallback: number): number {
  return finite(value) ? value : fallback;
}

function stringOr(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** File name stem, matching how YSM resolves `default_texture` names. */
export function ysmTextureName(path: string): string {
  const normalized = path.replaceAll('\\', '/');
  const base = normalized.slice(normalized.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

function normalizeTexture(value: unknown): YsmTexture | undefined {
  if (typeof value === 'string') {
    const uv = stringOr(value);
    return uv ? { uv } : undefined;
  }
  if (!record(value)) return undefined;
  const uv = stringOr(value.uv);
  if (!uv) return undefined;
  const normal = stringOr(value.normal);
  const specular = stringOr(value.specular);
  return { uv, ...(normal ? { normal } : {}), ...(specular ? { specular } : {}) };
}

/** Parse and validate the `ysm.json` manifest used by folder-format models. */
export function parseYsmManifest(value: unknown): YsmManifest {
  if (!record(value)) throw new Error('YSM manifest is not a JSON object');
  const files = record(value.files) ? value.files : undefined;
  const player = files && record(files.player) ? files.player : undefined;
  const model = player && record(player.model) ? player.model : undefined;
  const mainModel = model ? stringOr(model.main) : undefined;
  if (!mainModel) throw new Error('YSM manifest is missing files.player.model.main');
  const armModel = model ? stringOr(model.arm) : undefined;
  const animation = player && record(player.animation) ? player.animation : undefined;
  const mainAnimation = animation ? stringOr(animation.main) : undefined;
  const textureValues = player && Array.isArray(player.texture) ? player.texture : [];
  const textures = textureValues
    .map(normalizeTexture)
    .filter((texture): texture is YsmTexture => !!texture);
  if (!textures.length) throw new Error('YSM manifest has no player textures');
  const properties = record(value.properties) ? value.properties : {};
  const metadata = record(value.metadata) ? value.metadata : {};
  const name = stringOr(metadata.name);
  const tips = stringOr(metadata.tips);
  const defaultTexture = stringOr(properties.default_texture);
  const authors = Array.isArray(metadata.authors)
    ? metadata.authors
        .map((author) => (typeof author === 'string' ? author : record(author) ? stringOr(author.name) : undefined))
        .filter((author): author is string => !!author)
    : [];
  const licenseValue = metadata.license;
  const license =
    typeof licenseValue === 'string'
      ? stringOr(licenseValue)
      : record(licenseValue)
        ? stringOr(licenseValue.type)
        : undefined;
  return {
    ...(finite(value.spec) ? { spec: value.spec } : {}),
    ...(name ? { name } : {}),
    ...(tips ? { tips } : {}),
    authors,
    ...(license ? { license } : {}),
    ...(defaultTexture ? { defaultTexture } : {}),
    mainModel,
    ...(armModel ? { armModel } : {}),
    ...(mainAnimation ? { mainAnimation } : {}),
    textures,
  };
}

/** Pick the texture YSM would show first: `default_texture`, else the first entry. */
export function selectYsmTexture(manifest: YsmManifest): YsmTexture {
  const wanted = manifest.defaultTexture?.toLowerCase();
  if (wanted) {
    const exact = manifest.textures.find((texture) => ysmTextureName(texture.uv).toLowerCase() === wanted);
    if (exact) return exact;
    const byPath = manifest.textures.find((texture) => texture.uv.toLowerCase() === wanted);
    if (byPath) return byPath;
    const byFile = manifest.textures.find((texture) => {
      const normalized = texture.uv.replaceAll('\\', '/');
      return normalized.slice(normalized.lastIndexOf('/') + 1).toLowerCase() === wanted;
    });
    if (byFile) return byFile;
  }
  return manifest.textures[0]!;
}

function parseCube(value: unknown, diagnostics: YsmDiagnostic[], cubeIndex: number): YsmCube | undefined {
  if (!record(value)) {
    diagnostics.push({ code: 'cube-not-object', cube: cubeIndex });
    return undefined;
  }
  const origin = vector(value.origin, 3);
  const size = vector(value.size, 3);
  const pivot = vector(value.pivot, 3);
  const rotation = vector(value.rotation, 3);
  const uvValue = value.uv;
  let uv: YsmCubeUv | undefined;
  if (Array.isArray(uvValue)) {
    const box = vector(uvValue, 2);
    if (box) uv = [box[0]!, box[1]!];
  } else if (record(uvValue)) {
    const faces: Partial<Record<YsmFace, YsmFaceUv>> = {};
    for (const face of ['north', 'east', 'south', 'west', 'up', 'down'] as const) {
      const faceValue = uvValue[face];
      if (!record(faceValue)) continue;
      const faceUv = vector(faceValue.uv, 2);
      const faceSize = vector(faceValue.uv_size, 2);
      if (!faceUv || !faceSize) continue;
      if (finite(faceValue.uv_rotation) && faceValue.uv_rotation !== 0)
        diagnostics.push({ code: 'face-uv-rotation-ignored' });
      faces[face] = {
        uv: [faceUv[0]!, faceUv[1]!],
        uv_size: [faceSize[0]!, faceSize[1]!],
      };
    }
    if (Object.keys(faces).length) uv = faces;
  }
  if (!uv) diagnostics.push({ code: 'cube-without-uv', cube: cubeIndex });
  return {
    ...(origin ? { origin: origin as V3 } : {}),
    ...(size ? { size: size as V3 } : {}),
    ...(pivot ? { pivot: pivot as V3 } : {}),
    ...(rotation ? { rotation: rotation as V3 } : {}),
    ...(finite(value.inflate) ? { inflate: value.inflate } : {}),
    ...(value.mirror === true ? { mirror: true } : {}),
    ...(uv ? { uv } : {}),
  };
}

/**
 * Parse a Bedrock geometry file (`format_version` 1.12+). Multiple geometry
 * entries are accepted; only the first is imported, matching YSM's own reader.
 */
export function parseYsmGeometry(value: unknown): ParsedYsmGeometry {
  if (!record(value)) throw new Error('YSM model geometry is not a JSON object');
  const diagnostics: YsmDiagnostic[] = [];
  let geometry: Record<string, unknown>;
  const list = value['minecraft:geometry'];
  if (Array.isArray(list)) {
    if (!list.length) throw new Error('YSM model has an empty minecraft:geometry list');
    if (list.length > 1) diagnostics.push({ code: 'multiple-geometries', count: list.length });
    if (!record(list[0])) throw new Error('YSM model geometry entry is not an object');
    geometry = list[0];
  } else if (Array.isArray(value.bones)) {
    geometry = value;
  } else {
    throw new Error('YSM model is missing minecraft:geometry');
  }
  const description = record(geometry.description) ? geometry.description : {};
  const textureWidth = numberOr(description.texture_width, 64);
  const textureHeight = numberOr(description.texture_height, 64);
  if (!(textureWidth > 0) || !(textureHeight > 0)) throw new Error('YSM model has an invalid texture size');
  if (!Array.isArray(geometry.bones)) throw new Error('YSM model geometry has no bones');
  const bones: YsmBone[] = [];
  for (const [index, raw] of geometry.bones.entries()) {
    if (!record(raw)) {
      diagnostics.push({ code: 'bone-not-object', bone: index });
      continue;
    }
    const name = stringOr(raw.name);
    if (!name) {
      diagnostics.push({ code: 'bone-without-name', bone: index });
      continue;
    }
    const pivot = vector(raw.pivot, 3);
    const rotation = vector(raw.rotation, 3);
    const parent = stringOr(raw.parent);
    const cubes = Array.isArray(raw.cubes)
      ? raw.cubes
          .map((cube, cubeIndex) => parseCube(cube, diagnostics, cubeIndex))
          .filter((cube): cube is YsmCube => !!cube)
      : undefined;
    bones.push({
      name,
      ...(parent ? { parent } : {}),
      ...(pivot ? { pivot: pivot as V3 } : {}),
      ...(rotation ? { rotation: rotation as V3 } : {}),
      ...(finite(raw.inflate) ? { inflate: raw.inflate } : {}),
      ...(raw.mirror === true ? { mirror: true } : {}),
      ...(cubes?.length ? { cubes } : {}),
    });
  }
  if (!bones.length) throw new Error('YSM model geometry has no named bones');
  return { geometry: { textureWidth, textureHeight, bones }, diagnostics };
}

interface Transform {
  /** Row-major 3x3 rotation. */
  r: number[];
  /** Translation. */
  t: V3;
}

const IDENTITY: Transform = { r: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] };

function multiply(a: Transform, b: Transform): Transform {
  const r = new Array<number>(9);
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 3; column++) {
      r[row * 3 + column] =
        a.r[row * 3]! * b.r[column]! +
        a.r[row * 3 + 1]! * b.r[3 + column]! +
        a.r[row * 3 + 2]! * b.r[6 + column]!;
    }
  }
  return {
    r,
    t: [
      a.r[0]! * b.t[0] + a.r[1]! * b.t[1] + a.r[2]! * b.t[2] + a.t[0],
      a.r[3]! * b.t[0] + a.r[4]! * b.t[1] + a.r[5]! * b.t[2] + a.t[1],
      a.r[6]! * b.t[0] + a.r[7]! * b.t[1] + a.r[8]! * b.t[2] + a.t[2],
    ],
  };
}

/** R = Rz * Ry * Rx, the order YSM's GeoBuilder applies cube/bone rotations in. */
function rotationMatrix(degrees: V3): number[] {
  const rx = (degrees[0] * Math.PI) / 180;
  const ry = (degrees[1] * Math.PI) / 180;
  const rz = (degrees[2] * Math.PI) / 180;
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);
  return [
    cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx,
    sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx,
    -sy, cy * sx, cy * cx,
  ];
}

function applyPoint(transform: Transform, point: V3): V3 {
  return [
    transform.r[0]! * point[0] + transform.r[1]! * point[1] + transform.r[2]! * point[2] + transform.t[0],
    transform.r[3]! * point[0] + transform.r[4]! * point[1] + transform.r[5]! * point[2] + transform.t[1],
    transform.r[6]! * point[0] + transform.r[7]! * point[1] + transform.r[8]! * point[2] + transform.t[2],
  ];
}

function applyVector(transform: Transform, vector: V3): V3 {
  return [
    transform.r[0]! * vector[0] + transform.r[1]! * vector[1] + transform.r[2]! * vector[2],
    transform.r[3]! * vector[0] + transform.r[4]! * vector[1] + transform.r[5]! * vector[2],
    transform.r[6]! * vector[0] + transform.r[7]! * vector[1] + transform.r[8]! * vector[2],
  ];
}

function pivotRotation(pivot: V3, rotation: V3): Transform {
  const r = rotationMatrix(rotation);
  const rotatedPivot = applyVector({ r, t: [0, 0, 0] }, pivot);
  return {
    r,
    t: [pivot[0] - rotatedPivot[0], pivot[1] - rotatedPivot[1], pivot[2] - rotatedPivot[2]],
  };
}

/** Mirror X into the same right-handed space the rest of the converter uses. */
const mirrorPoint = (value: V3): V3 => [-value[0], value[1], value[2]];
const mirrorPivot = (value: V3 | undefined): V3 => (value ? [-value[0], value[1], value[2]] : [0, 0, 0]);
const mirrorRotation = (value: V3 | undefined): V3 => (value ? [-value[0], -value[1], value[2]] : [0, 0, 0]);

const FACE_DIRECTION: Record<YsmFace, V3> = {
  north: [0, 0, -1],
  south: [0, 0, 1],
  west: [-1, 0, 0],
  east: [1, 0, 0],
  up: [0, 1, 0],
  down: [0, -1, 0],
};

interface Quad {
  points: [V3, V3, V3, V3];
  normal: V3;
  u1: number;
  v1: number;
  uSize: number;
  vSize: number;
}

function cubePoints(cube: YsmCube, boneInflate: number | undefined): V3[] {
  const size = cube.size ?? [1, 1, 1];
  const origin = cube.origin ?? [0, 0, 0];
  const inflate = cube.inflate ?? boneInflate ?? 0;
  const [sx, sy, sz] = size;
  const ox = -(origin[0] + size[0]);
  const oy = origin[1];
  const oz = origin[2];
  return [
    [ox - inflate, oy - inflate, oz - inflate],
    [ox - inflate, oy - inflate, oz + inflate + sz],
    [ox - inflate, oy + inflate + sy, oz - inflate],
    [ox - inflate, oy + inflate + sy, oz + inflate + sz],
    [ox + inflate + sx, oy - inflate, oz - inflate],
    [ox + inflate + sx, oy - inflate, oz + inflate + sz],
    [ox + inflate + sx, oy + inflate + sy, oz - inflate],
    [ox + inflate + sx, oy + inflate + sy, oz + inflate + sz],
  ];
}

/** Vertex order per face, mirroring `GeoBuilder.addPerFaceQuads` exactly. */
function perFaceVertices(points: V3[], mirroredLayout: boolean): Record<YsmFace, [V3, V3, V3, V3]> {
  const p = points as [V3, V3, V3, V3, V3, V3, V3, V3];
  if (mirroredLayout) {
    return {
      west: [p[6], p[7], p[5], p[4]],
      east: [p[3], p[2], p[0], p[1]],
      north: [p[2], p[6], p[4], p[0]],
      south: [p[7], p[3], p[1], p[5]],
      up: [p[0], p[4], p[5], p[1]],
      down: [p[3], p[7], p[6], p[2]],
    };
  }
  return {
    west: [p[3], p[2], p[0], p[1]],
    east: [p[6], p[7], p[5], p[4]],
    north: [p[2], p[6], p[4], p[0]],
    south: [p[7], p[3], p[1], p[5]],
    up: [p[3], p[7], p[6], p[2]],
    down: [p[0], p[4], p[5], p[1]],
  };
}

/**
 * Box-UV vertex order. Unlike per-face UVs, GeoBuilder keeps the up/down
 * vertex order unchanged for mirrored box layouts and only swaps west/east.
 */
function boxFaceVertices(points: V3[], mirroredLayout: boolean): Record<YsmFace, [V3, V3, V3, V3]> {
  const p = points as [V3, V3, V3, V3, V3, V3, V3, V3];
  return {
    west: mirroredLayout ? [p[6], p[7], p[5], p[4]] : [p[3], p[2], p[0], p[1]],
    east: mirroredLayout ? [p[3], p[2], p[0], p[1]] : [p[6], p[7], p[5], p[4]],
    north: [p[2], p[6], p[4], p[0]],
    south: [p[7], p[3], p[1], p[5]],
    up: [p[3], p[7], p[6], p[2]],
    down: [p[0], p[4], p[5], p[1]],
  };
}

function boxQuads(cube: YsmCube, points: V3[], mirroredLayout: boolean): Quad[] {
  if (!Array.isArray(cube.uv) || cube.uv.length < 2) return [];
  const [u, v] = cube.uv;
  const size = cube.size ?? [1, 1, 1];
  const x = Math.floor(size[0]);
  const y = Math.floor(size[1]);
  const z = Math.floor(size[2]);
  const vertices = boxFaceVertices(points, mirroredLayout);
  const face = (
    name: YsmFace,
    u1: number,
    v1: number,
    uSize: number,
    vSize: number,
  ): Quad => ({
    points: vertices[name],
    normal: FACE_DIRECTION[name],
    u1,
    v1,
    uSize,
    vSize,
  });
  return [
    face('west', u + z + x, v + z, z, y),
    face('east', u, v + z, z, y),
    face('north', u + z, v + z, x, y),
    face('south', u + z + x + z, v + z, x, y),
    face('up', u + z, v, x, z),
    face('down', u + z + x, v + z, x, -z),
  ];
}

function perFaceQuads(cube: YsmCube, points: V3[], mirroredLayout: boolean): Quad[] {
  if (!cube.uv || Array.isArray(cube.uv)) return [];
  const vertices = perFaceVertices(points, mirroredLayout);
  const result: Quad[] = [];
  for (const name of ['west', 'east', 'north', 'south', 'up', 'down'] as const) {
    const face = cube.uv[name];
    if (!face) continue;
    result.push({
      points: vertices[name],
      normal: FACE_DIRECTION[name],
      u1: face.uv[0],
      v1: face.uv[1],
      uSize: face.uv_size[0],
      vSize: face.uv_size[1],
    });
  }
  return result;
}

interface Builder {
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
  byKey: Map<string, number>;
}

function emptyBuilder(): Builder {
  return { positions: [], normals: [], uvs: [], indices: [], byKey: new Map() };
}

function rounded(value: number): string {
  return (Math.round(value * 100000) / 100000).toString();
}

function addQuad(
  builder: Builder,
  quad: Quad,
  cubeRotation: Transform,
  boneWorld: Transform,
  cubeMirror: boolean,
  textureWidth: number,
  textureHeight: number,
) {
  const u1 = quad.u1 / textureWidth;
  const v1 = quad.v1 / textureHeight;
  const u2 = (quad.u1 + quad.uSize) / textureWidth;
  const v2 = (quad.v1 + quad.vSize) / textureHeight;
  const uv = cubeMirror
    ? [[u1, v1], [u2, v1], [u2, v2], [u1, v2]]
    : [[u2, v1], [u1, v1], [u1, v2], [u2, v2]];
  const normal = applyVector(boneWorld, applyVector(cubeRotation, mirrorPointIf(quad.normal, cubeMirror)));
  const length = Math.hypot(normal[0], normal[1], normal[2]);
  if (!(length > 0)) return;
  const unit: V3 = [normal[0] / length, normal[1] / length, normal[2] / length];
  const quadIndices: number[] = [];
  for (let index = 0; index < 4; index++) {
    const point = applyPoint(boneWorld, applyPoint(cubeRotation, quad.points[index]!));
    const [u, v] = uv[index]!;
    const key = `${rounded(point[0])},${rounded(point[1])},${rounded(point[2])}|${rounded(unit[0])},${rounded(unit[1])},${rounded(unit[2])}|${rounded(u!)},${rounded(v!)}`;
    let vertex = builder.byKey.get(key);
    if (vertex === undefined) {
      vertex = builder.positions.length / 3;
      builder.byKey.set(key, vertex);
      builder.positions.push(point[0] / 16, point[1] / 16, point[2] / 16);
      builder.normals.push(unit[0], unit[1], unit[2]);
      builder.uvs.push(u!, v!);
    }
    quadIndices.push(vertex);
  }
  builder.indices.push(
    quadIndices[0]!, quadIndices[1]!, quadIndices[2]!,
    quadIndices[0]!, quadIndices[2]!, quadIndices[3]!,
  );
}

function mirrorPointIf(value: V3, mirror: boolean): V3 {
  return mirror ? mirrorPoint(value) : value;
}

function scaleIsZero(value: unknown): boolean {
  if (value === 0) return true;
  if (Array.isArray(value)) return value.length >= 3 && value.slice(0, 3).every((component) => component === 0);
  if (record(value)) {
    const keys = Object.keys(value).sort((a, b) => Number(a) - Number(b));
    const first = keys.length ? value[keys[0]!] : undefined;
    return scaleIsZero(first);
  }
  return false;
}

/**
 * Bones YSM hides before normal rendering. The `pre_parallel*` animations are
 * the mod's default pre-render state; GUI backgrounds, masks and overlay eyes
 * live there at scale 0 and must not become part of a converted skin.
 */
export function hiddenYsmBones(animation: unknown): string[] {
  if (!record(animation)) return [];
  const animations = record(animation.animations) ? animation.animations : {};
  const hidden = new Set<string>();
  for (const [name, value] of Object.entries(animations)) {
    if (!name.startsWith('pre_parallel') || !record(value) || !record(value.bones)) continue;
    for (const [bone, data] of Object.entries(value.bones)) {
      if (record(data) && 'scale' in data && scaleIsZero(data.scale)) hidden.add(bone);
    }
  }
  return [...hidden];
}

export interface YsmMeshOptions {
  /** Bones hidden by the model's default animations, plus their descendants. */
  hiddenBones?: Iterable<string>;
}

interface BoneWorlds {
  byName: Map<string, YsmBone>;
  worlds: Map<string, Transform>;
  /** Effective parent after missing-parent and cycle repair keyed by unique bone name. */
  parents: Map<string, string>;
  /** World transform for a specific occurrence, including duplicate names. */
  worldOfBone: (bone: YsmBone) => Transform;
  diagnostics: YsmDiagnostic[];
}

const sameVector = (a: V3 | undefined, b: V3 | undefined): boolean => {
  const left = a ?? [0, 0, 0];
  const right = b ?? [0, 0, 0];
  return left[0] === right[0] && left[1] === right[1] && left[2] === right[2];
};

/** Resolve every bone's world transform once, with cycle and missing-parent repair. */
function boneWorlds(geometry: YsmGeometry): BoneWorlds {
  const diagnostics: YsmDiagnostic[] = [];
  const byName = new Map<string, YsmBone>();
  const duplicateNames = new Set<string>();
  const conflictNames = new Set<string>();
  for (const bone of geometry.bones) {
    const first = byName.get(bone.name);
    if (first) {
      if (!duplicateNames.has(bone.name)) {
        duplicateNames.add(bone.name);
        diagnostics.push({ code: 'duplicate-bone', name: bone.name });
      }
      if (
        !conflictNames.has(bone.name) &&
        (first.parent !== bone.parent ||
          !sameVector(first.pivot, bone.pivot) ||
          !sameVector(first.rotation, bone.rotation))
      ) {
        conflictNames.add(bone.name);
        diagnostics.push({ code: 'duplicate-bone-conflict', name: bone.name });
      }
      continue;
    }
    byName.set(bone.name, bone);
  }

  const parents = new Map<string, string>();
  for (const [name, bone] of byName) {
    if (!bone.parent) continue;
    if (bone.parent === name) {
      diagnostics.push({ code: 'cyclic-bone', name });
      continue;
    }
    if (!byName.has(bone.parent)) {
      diagnostics.push({ code: 'missing-parent', name, parent: bone.parent });
      continue;
    }
    parents.set(name, bone.parent);
  }

  // Break cycles deterministically at the lexicographically smallest node in
  // each cycle. The remaining chain becomes a normal tree rooted there.
  const state = new Map<string, 1 | 2>();
  for (const start of byName.keys()) {
    if (state.has(start)) continue;
    const path: string[] = [];
    const index = new Map<string, number>();
    let current: string | undefined = start;
    while (current) {
      const existing = state.get(current);
      if (existing === 2) break;
      if (existing === 1) {
        const cycleStart = index.get(current);
        if (cycleStart !== undefined) {
          const cycle = path.slice(cycleStart);
          const broken = [...cycle].sort()[0]!;
          parents.delete(broken);
          diagnostics.push({ code: 'cyclic-bone', name: broken });
        }
        break;
      }
      state.set(current, 1);
      index.set(current, path.length);
      path.push(current);
      current = parents.get(current);
    }
    for (const name of path) state.set(name, 2);
  }

  const worlds = new Map<string, Transform>();
  const localOf = (bone: YsmBone): Transform =>
    pivotRotation(mirrorPivot(bone.pivot), mirrorRotation(bone.rotation));
  const worldOfFirst = (name: string, resolving = new Set<string>()): Transform => {
    const cached = worlds.get(name);
    if (cached) return cached;
    const bone = byName.get(name);
    if (!bone || resolving.has(name)) return IDENTITY;
    resolving.add(name);
    const parentName = parents.get(name);
    const parent = parentName ? worldOfFirst(parentName, resolving) : IDENTITY;
    const world = multiply(parent, localOf(bone));
    worlds.set(name, world);
    return world;
  };
  for (const name of byName.keys()) worldOfFirst(name);

  // Duplicate bones can declare a different hierarchy. Use their own local
  // transform and parent world so their cubes keep the original position.
  const worldOfBone = (bone: YsmBone): Transform => {
    const canonical = byName.get(bone.name);
    if (canonical === bone) return worldOfFirst(bone.name);
    const parentName = bone.parent && bone.parent !== bone.name && byName.has(bone.parent)
      ? bone.parent
      : undefined;
    const parent = parentName ? worldOfFirst(parentName) : IDENTITY;
    return multiply(parent, localOf(bone));
  };

  return { byName, worlds, parents, worldOfBone, diagnostics };
}

/**
 * Turn parsed Bedrock geometry into one indexed triangle mesh per bone.
 * Positions are meters with the feet at Y=0 and the model's right side at +X,
 * matching the rest of the converter's source space.
 */
export function buildYsmMesh(geometry: YsmGeometry, options: YsmMeshOptions = {}): YsmMesh {
  const worlds = boneWorlds(geometry);
  const mesh = buildYsmMeshFromWorlds(geometry, options, worlds);
  return {
    ...mesh,
    diagnostics: [...worlds.diagnostics, ...mesh.diagnostics],
  };
}

/** Expand hidden bones to their descendants, matching YSM's pre_parallel state. */
function resolveHiddenBones(geometry: YsmGeometry, seed?: Iterable<string>): Set<string> {
  const hidden = new Set(seed ?? []);
  if (!hidden.size) return hidden;
  let changed = true;
  while (changed) {
    changed = false;
    for (const bone of geometry.bones) {
      if (bone.parent && hidden.has(bone.parent) && !hidden.has(bone.name)) {
        hidden.add(bone.name);
        changed = true;
      }
    }
  }
  return hidden;
}

function buildYsmMeshFromWorlds(
  geometry: YsmGeometry,
  options: YsmMeshOptions,
  core: BoneWorlds,
): YsmMesh {
  const diagnostics: YsmDiagnostic[] = [];
  const hidden = resolveHiddenBones(geometry, options.hiddenBones);
  if (hidden.size) {
    diagnostics.push({ code: 'hidden-bones', names: [...hidden] });
  }
  // Duplicate bone names are merged by name, matching boneWorlds. Keep every
  // cube attached to the first world transform instead of dropping the second
  // mesh with a "#2" suffix later.
  const cubesByBone = new Map<string, { bone: YsmBone; cube: YsmCube }[]>();
  for (const bone of geometry.bones) {
    if (hidden.has(bone.name) || !bone.cubes?.length) continue;
    let entries = cubesByBone.get(bone.name);
    if (!entries) {
      entries = [];
      cubesByBone.set(bone.name, entries);
    }
    for (const cube of bone.cubes) entries.push({ bone, cube });
  }
  const parts: YsmMeshPart[] = [];
  for (const [name, entries] of cubesByBone) {
    const builder = emptyBuilder();
    for (const { bone, cube } of entries) {
      const points = cubePoints(cube, bone.inflate);
      const cubeRotation = pivotRotation(mirrorPivot(cube.pivot), mirrorRotation(cube.rotation));
      const mirroredLayout = bone.mirror === true || cube.mirror === true;
      const quads = Array.isArray(cube.uv)
        ? boxQuads(cube, points, mirroredLayout)
        : perFaceQuads(cube, points, mirroredLayout);
      for (const quad of quads)
        addQuad(builder, quad, cubeRotation, core.worldOfBone(bone), cube.mirror === true, geometry.textureWidth, geometry.textureHeight);
    }
    if (!builder.indices.length) continue;
    parts.push({
      name,
      bone: name,
      positions: new Float32Array(builder.positions),
      normals: new Float32Array(builder.normals),
      uvs: new Float32Array(builder.uvs),
      indices: new Uint32Array(builder.indices),
    });
  }
  if (!parts.length) throw new Error('YSM model produced no renderable geometry');
  return { parts, textureWidth: geometry.textureWidth, textureHeight: geometry.textureHeight, diagnostics };
}

const normalizeBoneName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

function findBone(bones: readonly YsmBone[], candidates: readonly string[]): YsmBone | undefined {
  for (const candidate of candidates) {
    const found = bones.find((bone) => normalizeBoneName(bone.name) === candidate);
    if (found) return found;
  }
  return undefined;
}

/** YSM bone names are close to the player conventions but not identical. */
const YSM_ROLE_CANDIDATES: Readonly<Record<YsmHumanoidRole, readonly string[]>> = {
  hips: ['allbody', 'mupbody', 'upbody', 'body', 'root', 'mroot'],
  head: ['head', 'allhead', 'mhead'],
  leftUpperArm: ['leftupperarm', 'leftarm', 'leftshoulder'],
  rightUpperArm: ['rightupperarm', 'rightarm', 'rightshoulder'],
  leftHand: ['lefthand', 'leftforearm', 'leftlowerarm', 'leftelbow'],
  rightHand: ['righthand', 'rightforearm', 'rightlowerarm', 'rightelbow'],
  leftUpperLeg: ['leftupperleg', 'leftleg', 'leftthigh'],
  rightUpperLeg: ['rightupperleg', 'rightleg', 'rightthigh'],
};

const PART_ROOT: Readonly<Record<'leftUpperArm' | 'rightUpperArm' | 'leftUpperLeg' | 'rightUpperLeg', HumanoidPart>> = {
  leftUpperArm: 'leftArm',
  rightUpperArm: 'rightArm',
  leftUpperLeg: 'leftLeg',
  rightUpperLeg: 'rightLeg',
};

/**
 * Map a YSM skeleton onto the six rigid player parts. The mapping is only
 * complete when the head, body and both arms/legs expose usable pivots; callers
 * should fall back to static whole-body binding otherwise.
 */
export function buildYsmRig(geometry: YsmGeometry): YsmRig {
  const worlds = boneWorlds(geometry);
  const rig = buildYsmRigFromWorlds(geometry, worlds);
  return { ...rig, diagnostics: [...worlds.diagnostics, ...rig.diagnostics] };
}

function buildYsmRigFromWorlds(geometry: YsmGeometry, core: BoneWorlds): YsmRig {
  const { byName, worlds } = core;
  const diagnostics: YsmDiagnostic[] = [];
  const roleBones = new Map<YsmHumanoidRole, YsmBone>();
  for (const role of YSM_HUMANOID_ROLES) {
    const bone = findBone(geometry.bones, YSM_ROLE_CANDIDATES[role]);
    if (bone) roleBones.set(role, bone);
    else diagnostics.push({ code: 'missing-role', role });
  }
  for (const side of ['left', 'right'] as const) {
    const handRole = `${side}Hand` as const;
    const hand = roleBones.get(handRole);
    if (hand && !normalizeBoneName(hand.name).includes('hand'))
      diagnostics.push({ code: 'hand-fallback', side, name: hand.name });
  }
  const partRoots = new Map<string, HumanoidPart>();
  const head = roleBones.get('head');
  if (head) partRoots.set(head.name, 'head');
  for (const role of ['leftUpperArm', 'rightUpperArm', 'leftUpperLeg', 'rightUpperLeg'] as const) {
    const bone = roleBones.get(role);
    if (bone) partRoots.set(bone.name, PART_ROOT[role]);
  }
  const parts: Record<string, HumanoidPart> = {};
  for (const bone of geometry.bones) {
    let current: YsmBone | undefined = bone;
    const seen = new Set<string>();
    let part: HumanoidPart = 'body';
    while (current && !seen.has(current.name)) {
      const found = partRoots.get(current.name);
      if (found) { part = found; break; }
      seen.add(current.name);
      const parentName = core.parents.get(current.name);
      current = parentName ? byName.get(parentName) : undefined;
    }
    parts[bone.name] = part;
  }
  const roles: Partial<Record<YsmHumanoidRole, V3>> = {};
  const roleBoneNames: Partial<Record<YsmHumanoidRole, string>> = {};
  for (const role of YSM_HUMANOID_ROLES) {
    const bone = roleBones.get(role);
    if (!bone) continue;
    roleBoneNames[role] = bone.name;
    const world = worlds.get(bone.name) ?? IDENTITY;
    const pivot = applyPoint(world, mirrorPivot(bone.pivot));
    roles[role] = [pivot[0] / 16, pivot[1] / 16, pivot[2] / 16];
  }
  const complete = YSM_HUMANOID_ROLES.every((role) => roles[role] !== undefined);
  if (!complete) diagnostics.push({ code: 'incomplete-rig' });
  return { roles, roleBones: roleBoneNames, parts, complete, diagnostics };
}

export interface YsmBoneMesh {
  name: string;
  parent?: string;
  /** World-space bone pivot in meters. */
  pivot: V3;
  part: HumanoidPart;
  role?: YsmHumanoidRole;
  /** World-space geometry; omitted for empty and hidden bones. */
  mesh?: YsmMeshPart;
}

export interface YsmBoneMeshSet {
  bones: YsmBoneMesh[];
  diagnostics: YsmDiagnostic[];
  textureWidth: number;
  textureHeight: number;
}

/** One node in the runtime-neutral YSM scene graph. */
export interface YsmSceneNode {
  name: string;
  /** Local translation in meters; roots are relative to the scene origin. */
  translation: V3;
  /** Set on synthetic `__ysm_*` role nodes. */
  role?: YsmHumanoidRole;
  /** Set on bone and mesh nodes. */
  part?: HumanoidPart;
  /** Original bone name. */
  bone?: string;
  /** Geometry attached to this node. */
  mesh?: YsmMeshPart;
  children: YsmSceneNode[];
}

export interface YsmScene {
  roots: YsmSceneNode[];
  /** Unique bones in source order, with world pivots in meters. */
  bones: YsmBoneMesh[];
  roles: Partial<Record<YsmHumanoidRole, V3>>;
  /** True when role nodes and six-part tags were produced. */
  humanoid: boolean;
  textureWidth: number;
  textureHeight: number;
  textureHint: TextureHint;
  diagnostics: YsmDiagnostic[];
}

/** YSM ships one prepared player atlas; skin packs must fit the client's 128px limit. */
export const YSM_TEXTURE_HINT: TextureHint = { preserve: true, maxSize: 128 };

/** Small YSM models are already lightweight; keep them at 100% by default. */
export const YSM_REDUCTION_HINT: ReductionHint = { retainBelowTriangles: 10_000 };

const subtract = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const negate = (a: V3): V3 => [-a[0], -a[1], -a[2]];

/**
 * Build the complete runtime-neutral scene: synthetic role nodes, hand
 * reparenting, per-bone local offsets, mesh offsets and player-part tags.
 * Node and webapp adapters only instantiate nodes from this description.
 */
export function buildYsmScene(geometry: YsmGeometry, options: YsmMeshOptions = {}): YsmScene {
  const core = boneWorlds(geometry);
  const mesh = buildYsmMeshFromWorlds(geometry, options, core);
  const rig = buildYsmRigFromWorlds(geometry, core);
  const partsByBone = new Map<string, YsmMeshPart>();
  for (const part of mesh.parts) partsByBone.set(part.bone, part);
  const roleByBone = new Map<string, YsmHumanoidRole>();
  for (const [role, name] of Object.entries(rig.roleBones)) {
    if (name) roleByBone.set(name, role as YsmHumanoidRole);
  }
  // boneWorlds already merged duplicate names; iterate first occurrences once.
  // Hidden bones (and their descendants) are omitted from the scene entirely.
  const hidden = resolveHiddenBones(geometry, options.hiddenBones);
  const uniqueBones = [...core.byName.values()].filter((bone) => !hidden.has(bone.name));
  const pivots = new Map<string, V3>();
  const bones: YsmBoneMesh[] = [];
  for (const bone of uniqueBones) {
    const world = core.worlds.get(bone.name) ?? IDENTITY;
    const pivot = applyPoint(world, mirrorPivot(bone.pivot));
    const meterPivot: V3 = [pivot[0] / 16, pivot[1] / 16, pivot[2] / 16];
    pivots.set(bone.name, meterPivot);
    const role = roleByBone.get(bone.name);
    const part = rig.parts[bone.name] ?? 'body';
    const geometryPart = partsByBone.get(bone.name);
    const parent = core.parents.get(bone.name);
    bones.push({
      name: bone.name,
      ...(parent ? { parent } : {}),
      pivot: meterPivot,
      part,
      ...(role ? { role } : {}),
      ...(geometryPart ? { mesh: geometryPart } : {}),
    });
  }
  const partGeometry = new Set<HumanoidPart>();
  for (const bone of bones) if (bone.mesh) partGeometry.add(bone.part);
  const missingParts = HUMANOID_PARTS.filter((part) => !partGeometry.has(part));
  const humanoid = rig.complete && missingParts.length === 0;
  const diagnostics: YsmDiagnostic[] = [
    ...core.diagnostics,
    ...mesh.diagnostics,
    ...rig.diagnostics,
  ];
  if (humanoid) diagnostics.push({ code: 'humanoid-mapped' });
  else if (rig.complete && missingParts.length)
    diagnostics.push({ code: 'missing-part-geometry', parts: missingParts });
  else diagnostics.push({ code: 'static-binding' });

  const roots: YsmSceneNode[] = [];
  const roleNodes = new Map<YsmHumanoidRole, YsmSceneNode>();
  if (humanoid) {
    for (const role of YSM_HUMANOID_ROLES) {
      const pivot = rig.roles[role];
      if (!pivot) continue;
      const node: YsmSceneNode = {
        name: `__ysm_${role}`,
        translation: [...pivot],
        role,
        children: [],
      };
      roots.push(node);
      roleNodes.set(role, node);
    }
    for (const side of ['left', 'right'] as const) {
      const armRole = `${side}UpperArm` as const;
      const handRole = `${side}Hand` as const;
      const arm = roleNodes.get(armRole);
      const hand = roleNodes.get(handRole);
      if (!arm || !hand) continue;
      const index = roots.indexOf(hand);
      if (index >= 0) roots.splice(index, 1);
      hand.translation = subtract(rig.roles[handRole]!, rig.roles[armRole]!);
      arm.children.push(hand);
    }
  }

  const boneNodes = new Map<string, YsmSceneNode>();
  for (const bone of bones) {
    const node: YsmSceneNode = {
      name: bone.name,
      translation: [0, 0, 0],
      part: bone.part,
      bone: bone.name,
      children: [],
    };
    if (bone.mesh) {
      node.children.push({
        name: bone.name,
        translation: negate(bone.pivot),
        part: bone.part,
        bone: bone.name,
        mesh: bone.mesh,
        children: [],
      });
    }
    boneNodes.set(bone.name, node);
  }
  for (const bone of bones) {
    const node = boneNodes.get(bone.name)!;
    const pivot = pivots.get(bone.name)!;
    const parentName = core.parents.get(bone.name);
    const parent = parentName ? core.byName.get(parentName) : undefined;
    const parentPart = parent ? rig.parts[parent.name] ?? 'body' : undefined;
    const role = humanoid ? HUMANOID_PART_ROLES[bone.part] : undefined;
    if (humanoid && role && (!parent || parentPart !== bone.part)) {
      const rolePivot = rig.roles[role];
      const roleNode = roleNodes.get(role);
      if (rolePivot && roleNode) {
        node.translation = subtract(pivot, rolePivot);
        roleNode.children.push(node);
      } else {
        node.translation = pivot;
        roots.push(node);
      }
    } else if (parent) {
      node.translation = subtract(pivot, pivots.get(parent.name)!);
      boneNodes.get(parent.name)!.children.push(node);
    } else {
      node.translation = pivot;
      roots.push(node);
    }
  }
  return {
    roots,
    bones,
    roles: rig.roles,
    humanoid,
    textureWidth: geometry.textureWidth,
    textureHeight: geometry.textureHeight,
    textureHint: YSM_TEXTURE_HINT,
    diagnostics,
  };
}

/**
 * Backwards-compatible flat view used by diagnostics/tests. New code should
 * consume `buildYsmScene` so the hierarchy and mesh offsets are not rebuilt.
 */
export function buildYsmBoneMeshes(geometry: YsmGeometry, options: YsmMeshOptions = {}): YsmBoneMeshSet {
  const scene = buildYsmScene(geometry, options);
  return {
    bones: scene.bones,
    diagnostics: scene.diagnostics,
    textureWidth: scene.textureWidth,
    textureHeight: scene.textureHeight,
  };
}

export interface YsmImportPlan {
  scene: YsmScene;
  texture: YsmTexture;
  textureName: string;
  textureHint: TextureHint;
  reductionHint: ReductionHint;
  diagnostics: YsmDiagnostic[];
}

/** Resolve manifest texture choice plus hidden bones into one import plan. */
export function buildYsmImportPlan(
  manifest: YsmManifest,
  geometry: YsmGeometry,
  animation?: unknown,
): YsmImportPlan {
  const hiddenBones = animation ? hiddenYsmBones(animation) : [];
  const scene = buildYsmScene(geometry, { hiddenBones });
  const diagnostics: YsmDiagnostic[] = [...scene.diagnostics];
  const texture = selectYsmTexture(manifest);
  const textureName = ysmTextureName(texture.uv);
  if (texture.normal || texture.specular) diagnostics.push({ code: 'pbr-textures-ignored' });
  if (manifest.defaultTexture && textureName.toLowerCase() !== manifest.defaultTexture.toLowerCase())
    diagnostics.push({ code: 'default-texture-missing', wanted: manifest.defaultTexture, used: textureName });
  if (manifest.textures.length > 1)
    diagnostics.push({ code: 'multiple-textures', count: manifest.textures.length, used: textureName });
  if (manifest.armModel) diagnostics.push({ code: 'arm-model-ignored' });
  diagnostics.push({ code: 'animations-not-evaluated' });
  return {
    scene,
    texture,
    textureName,
    textureHint: scene.textureHint,
    reductionHint: YSM_REDUCTION_HINT,
    diagnostics,
  };
}
