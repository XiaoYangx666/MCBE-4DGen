import * as THREE from 'three';
import type { HumanoidRig } from './humanoid.ts';

export interface ArmRig {
  root: THREE.Object3D;
  leftArm: THREE.Object3D;
  rightArm: THREE.Object3D;
  leftHand: THREE.Object3D;
  rightHand: THREE.Object3D;
  initial: Map<THREE.Object3D, { position: THREE.Vector3; quaternion: THREE.Quaternion }>;
}

const LEFT_UPPER = new Set([
  '左腕', 'leftupperarm', 'leftarm', 'lupperarm', 'upperarml', 'upperarmleft',
  'arml', 'larm', 'jbiplupperarm', 'mixamorigleftarm', 'leftupperarmbone',
]);
const RIGHT_UPPER = new Set([
  '右腕', 'rightupperarm', 'rightarm', 'rupperarm', 'upperarmr', 'upperarmright',
  'armr', 'rarm', 'jbiprupperarm', 'mixamorigrightarm', 'rightupperarmbone',
]);
const LEFT_HAND = new Set([
  '左手首', 'lefthand', 'lhand', 'handl', 'handleft', 'jbiplhand', 'mixamoriglefthand',
]);
const RIGHT_HAND = new Set([
  '右手首', 'righthand', 'rhand', 'handr', 'handright', 'jbiprhand', 'mixamorigrighthand',
]);
const LEFT_ELBOW = new Set([
  '左ひじ', '左肘', 'leftforearm', 'leftlowerarm', 'leftelbow', 'lforearm', 'lelbow',
  'forearml', 'lowerarml', 'jbipllowerarm', 'mixamorigleftforearm',
]);
const RIGHT_ELBOW = new Set([
  '右ひじ', '右肘', 'rightforearm', 'rightlowerarm', 'rightelbow', 'rforearm', 'relbow',
  'forearmr', 'lowerarmr', 'jbiprlowerarm', 'mixamorigrightforearm',
]);

const normalize = (name: string) => name.toLowerCase().replace(/[\s_.:\-]/g, '');

/**
 * Find the upper-arm and hand (or elbow) bones by common MMD, VRM and Mixamo
 * names. Returns null when the rig does not expose both sides.
 */
export function detectArmRig(root: THREE.Object3D): ArmRig | null {
  const bones: THREE.Bone[] = [];
  root.traverse((object) => {
    if ((object as THREE.Bone).isBone) bones.push(object as THREE.Bone);
  });
  const find = (sets: Set<string>[]) => {
    for (const set of sets) {
      const found = bones.find((bone) => set.has(normalize(bone.name)));
      if (found) return found;
    }
    return null;
  };
  const leftArm = find([LEFT_UPPER]);
  const rightArm = find([RIGHT_UPPER]);
  const leftHand = find([LEFT_HAND, LEFT_ELBOW]);
  const rightHand = find([RIGHT_HAND, RIGHT_ELBOW]);
  if (!leftArm || !rightArm || !leftHand || !rightHand) return null;

  const initial = new Map<THREE.Bone, { position: THREE.Vector3; quaternion: THREE.Quaternion }>();
  for (const bone of [leftArm, rightArm, leftHand, rightHand]) {
    initial.set(bone, { position: bone.position.clone(), quaternion: bone.quaternion.clone() });
  }
  return { root, leftArm, rightArm, leftHand, rightHand, initial };
}

/** Reuse a detected humanoid rig when the name-only arm detector misses it. */
export function armRigFromHumanoid(rig: HumanoidRig | null): ArmRig | null {
  if (!rig) return null;
  const leftArm = rig.roles.leftUpperArm;
  const rightArm = rig.roles.rightUpperArm;
  const leftHand = rig.roles.leftHand;
  const rightHand = rig.roles.rightHand;
  if (!leftArm || !rightArm || !leftHand || !rightHand) return null;
  let root: THREE.Object3D = rig.root;
  while (root.parent) root = root.parent;
  const initial = new Map<THREE.Object3D, { position: THREE.Vector3; quaternion: THREE.Quaternion }>();
  for (const bone of [leftArm, rightArm, leftHand, rightHand]) {
    initial.set(bone, { position: bone.position.clone(), quaternion: bone.quaternion.clone() });
  }
  return { root, leftArm, rightArm, leftHand, rightHand, initial };
}

const pivot = new THREE.Vector3();
const hand = new THREE.Vector3();
const direction = new THREE.Vector3();
const axis = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0);
const delta = new THREE.Quaternion();
const world = new THREE.Quaternion();
const parentWorld = new THREE.Quaternion();

/**
 * Lower or raise both arms by rotating the upper-arm bones around the axis
 * perpendicular to the arm and the world up vector. 0 keeps the source pose,
 * positive values lower the arms.
 */
export function applyArmPose(rig: ArmRig, degrees: number) {
  const spread = Math.min(90, Math.max(-45, degrees));
  for (const [bone, transform] of rig.initial) {
    bone.position.copy(transform.position);
    bone.quaternion.copy(transform.quaternion);
  }
  rig.root.updateMatrixWorld(true);

  for (const [arm, end] of [
    [rig.leftArm, rig.leftHand],
    [rig.rightArm, rig.rightHand],
  ] as const) {
    arm.getWorldPosition(pivot);
    end.getWorldPosition(hand);
    direction.copy(hand).sub(pivot);
    if (direction.lengthSq() < 1e-10) continue;
    direction.normalize();
    axis.crossVectors(up, direction);
    if (axis.lengthSq() < 1e-10) continue;
    axis.normalize();

    delta.setFromAxisAngle(axis, (spread * Math.PI) / 180);
    arm.getWorldQuaternion(world);
    world.premultiply(delta);
    if (arm.parent) {
      arm.parent.getWorldQuaternion(parentWorld).invert();
      arm.quaternion.copy(parentWorld.multiply(world));
    } else {
      arm.quaternion.copy(world);
    }
    rig.root.updateMatrixWorld(true);
  }

  rig.root.updateMatrixWorld(true);
  rig.root.traverse((object) => {
    const mesh = object as THREE.SkinnedMesh;
    if (mesh.isSkinnedMesh) mesh.skeleton.update();
  });
}
