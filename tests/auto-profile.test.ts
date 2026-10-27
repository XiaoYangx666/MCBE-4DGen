import { test, expect } from 'vitest';
import { Document } from '@gltf-transform/core';
import { autoProfile } from '../src/auto-profile.ts';

function rig() {
  const doc = new Document();
  const scene = doc.createScene();
  const hips = doc.createNode('腰');
  scene.addChild(hips);
  for (const name of ['頭', '左足D', '右足D']) hips.addChild(doc.createNode(name));
  for (const side of ['左', '右']) hips.addChild(doc.createNode(side + '腕').addChild(doc.createNode(side + '手首')));
  return doc;
}
test('MMD mapping resolves arms and hands consistently for preview and conversion', () => {
  const profile = autoProfile(rig());
  expect(profile?.boneMap?.leftUpperArm).toBe('左腕');
  expect(profile?.boneMap?.leftHand).toBe('左手首');
  expect(profile?.boneMap?.rightUpperLeg).toBe('右足D');
  expect(profile?.rotationYDegrees).toBe(180);
});
test('missing, ambiguous or disconnected arm chains do not enable humanoid mode', () => {
  const missing = rig();
  missing.getRoot().listNodes().find(n => n.getName() === '左手首')!.dispose();
  expect(autoProfile(missing)).toBeNull();
  const duplicate = rig();
  duplicate.createNode('左腕');
  expect(autoProfile(duplicate)).toBeNull();
  const disconnected = rig();
  const hand = disconnected.getRoot().listNodes().find(n => n.getName() === '左手首')!;
  disconnected.getRoot().listScenes()[0]!.addChild(hand);
  expect(autoProfile(disconnected)).toBeNull();
});
