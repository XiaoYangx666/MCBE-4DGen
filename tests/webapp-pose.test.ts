import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { applyArmPose, detectArmRig } from '../webapp/lib/pose.ts';

function rigScene() {
  const root = new THREE.Group();
  const leftArm = new THREE.Bone();
  leftArm.name = '左腕';
  leftArm.position.set(1, 0, 0);
  const leftHand = new THREE.Bone();
  leftHand.name = '左手首';
  leftHand.position.set(1, 0, 0);
  leftArm.add(leftHand);

  const rightArm = new THREE.Bone();
  rightArm.name = '右腕';
  rightArm.position.set(-1, 0, 0);
  const rightHand = new THREE.Bone();
  rightHand.name = '右手首';
  rightHand.position.set(1, 0, 0);
  rightArm.add(rightHand);

  root.add(leftArm, rightArm);
  root.updateMatrixWorld(true);
  return { root, leftHand, rightHand };
}

describe('webapp arm pose', () => {
  it('detects MMD/VRM/Mixamo-style arm bones', () => {
    const { root } = rigScene();
    const rig = detectArmRig(root);
    expect(rig).not.toBeNull();
    expect(rig!.leftArm.name).toBe('左腕');
    expect(rig!.rightHand.name).toBe('右手首');
  });

  it('lowers arms by the requested angle and resets at 0', () => {
    const { root, leftHand, rightHand } = rigScene();
    const rig = detectArmRig(root)!;

    applyArmPose(rig, 90);
    const left = leftHand.getWorldPosition(new THREE.Vector3());
    const right = rightHand.getWorldPosition(new THREE.Vector3());
    expect(left.x).toBeCloseTo(1, 3);
    expect(left.y).toBeCloseTo(-1, 3);
    expect(right.x).toBeCloseTo(-1, 3);
    expect(right.y).toBeCloseTo(-1, 3);

    applyArmPose(rig, 0);
    expect(leftHand.getWorldPosition(new THREE.Vector3()).x).toBeCloseTo(2, 3);
    expect(rightHand.getWorldPosition(new THREE.Vector3()).x).toBeCloseTo(0, 3);
  });

  it('returns null without a complete arm rig', () => {
    const root = new THREE.Group();
    const arm = new THREE.Bone();
    arm.name = '左腕';
    root.add(arm);
    expect(detectArmRig(root)).toBeNull();
  });
});
