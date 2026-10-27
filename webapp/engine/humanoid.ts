import * as THREE from 'three';
import {
  HUMANOID_PART_ROLES,
  HUMANOID_REQUIRED_ROLES,
  partForHumanoidRole,
} from '../../src/humanoid-binding.ts';
import {
  HUMANOID_ROLE_ALIASES,
  humanoidAliases,
} from '../../src/humanoid-roles.ts';
import { readVrmHumanBones } from '../../src/vrm-humanoid.ts';
import type { HumanoidPart, Vec3 } from './types.ts';

export interface HumanoidRig {
  /** Scene root that owns the rig; used for matrix updates. */
  root: THREE.Object3D;
  /** Canonical VRM-style role → source node. */
  roles: Record<string, THREE.Object3D>;
  /** Part → the node whose world position is the part pivot. */
  partNodes: Record<HumanoidPart, THREE.Object3D>;
  /** Walk up the hierarchy and resolve the owning player part. */
  partForNode: (node: THREE.Object3D | null | undefined) => HumanoidPart;
}

export interface HumanoidPivots {
  /** World-space pivot per part, before fitting and X mirroring. */
  pivots: Partial<Record<HumanoidPart, Vec3>>;
}

const normalize = (name: string) =>
  name.toLowerCase().replace(/[\s_.:\-]/g, '');

/**
 * Read VRM 0.x / VRM 1.0 humanoid role metadata from the glTF JSON and map
 * node indices back to the objects created by GLTFLoader.
 */
export function vrmHumanoidRoles(
  json: unknown,
  nodeForIndex: (index: number) => THREE.Object3D | undefined,
): Record<string, THREE.Object3D> {
  const roles: Record<string, THREE.Object3D> = {};
  // 共享解析只给 role → node 索引；找不到对象时保持跳过。
  for (const { bone, node } of readVrmHumanBones(json)) {
    const object = nodeForIndex(node);
    if (object) roles[bone] = object;
  }
  return roles;
}

/** Find a full six-part humanoid rig, otherwise return null. */
export function detectHumanoidRig(
  root: THREE.Object3D,
  provided: Record<string, THREE.Object3D> = {},
): HumanoidRig | null {
  const objects: THREE.Object3D[] = [];
  const seen = new Set<THREE.Object3D>();
  const collect = (object: THREE.Object3D) => {
    if (seen.has(object)) return;
    seen.add(object);
    objects.push(object);
  };
  root.traverse((object) => {
    collect(object);
    // Some exporters keep joints outside the visible scene graph.
    if ((object as THREE.SkinnedMesh).isSkinnedMesh)
      for (const bone of (object as THREE.SkinnedMesh).skeleton?.bones ?? [])
        collect(bone);
  });
  const available = seen;
  const bones = objects.filter((object): object is THREE.Bone =>
    (object as THREE.Bone).isBone);

  const selected = new Map<string, THREE.Object3D>();
  for (const [role, object] of Object.entries(provided))
    if (available.has(object)) selected.set(role, object);

  for (const role of Object.keys(HUMANOID_ROLE_ALIASES)) {
    if (selected.has(role)) continue;
    const aliases = humanoidAliases(role);
    const found = uniqueMatch(bones, aliases) ?? uniqueMatch(objects, aliases);
    if (found) selected.set(role, found);
  }

  for (const role of HUMANOID_REQUIRED_ROLES)
    if (!selected.has(role)) return null;
  for (const side of ['left', 'right']) {
    const arm = selected.get(side + 'UpperArm')!;
    let node: THREE.Object3D | null = selected.get(side + 'Hand')!;
    while (node && node !== arm && node !== root) node = node.parent;
    if (node !== arm) return null;
  }

  const roles: Record<string, THREE.Object3D> = {};
  for (const [role, object] of selected) {
    roles[role] = object;
    object.userData._humanoidRole = role;
  }

  const partNodes = {} as Record<HumanoidPart, THREE.Object3D>;
  for (const [part, role] of Object.entries(HUMANOID_PART_ROLES) as [HumanoidPart, string][]) {
    const node = selected.get(role);
    if (node) partNodes[part] = node;
  }

  const roleByObject = new Map<THREE.Object3D, HumanoidPart>();
  for (const [role, object] of Object.entries(roles)) {
    const part = partForHumanoidRole(role);
    if (part) roleByObject.set(object, part);
  }
  const cache = new WeakMap<THREE.Object3D, HumanoidPart>();
  const partForNode = (node: THREE.Object3D | null | undefined): HumanoidPart => {
    const chain: THREE.Object3D[] = [];
    let current = node ?? null;
    let part: HumanoidPart = 'body';
    while (current) {
      const cached = cache.get(current);
      if (cached) { part = cached; break; }
      const found = roleByObject.get(current);
      if (found) { part = found; break; }
      chain.push(current);
      current = current.parent;
    }
    for (const item of chain) cache.set(item, part);
    return part;
  };

  return { root, roles, partNodes, partForNode };
}

/** World-space pivots for every part, in the scene's current pose. */
export function humanoidPivots(
  rig: HumanoidRig,
  rotation?: THREE.Matrix4 | null,
): HumanoidPivots {
  const point = new THREE.Vector3();
  const pivots: Partial<Record<HumanoidPart, Vec3>> = {};
  for (const [part, node] of Object.entries(rig.partNodes) as [HumanoidPart, THREE.Object3D][]) {
    node.getWorldPosition(point);
    if (rotation) point.applyMatrix4(rotation);
    pivots[part] = [point.x, point.y, point.z];
  }
  return { pivots };
}

function uniqueMatch(
  objects: THREE.Object3D[],
  aliases: readonly string[],
): THREE.Object3D | null {
  for (const alias of aliases) {
    const found = objects.filter((object) => normalize(object.name) === alias);
    if (found.length === 1) return found[0]!;
    if (found.length > 1) {
      const bones = found.filter((object) => (object as THREE.Bone).isBone);
      if (bones.length === 1) return bones[0]!;
    }
  }
  return null;
}
