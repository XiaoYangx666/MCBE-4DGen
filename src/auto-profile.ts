import type { Document, Node } from '@gltf-transform/core';
import type { HumanoidProfile } from './humanoid.ts';

/** Recognize explicit rig conventions; ambiguous names never silently win. */
export function autoProfile(doc: Document): HumanoidProfile | null {
  const nodes = doc.getRoot().listNodes();
  const aliases: Record<string, string[]> = {
    hips: ['腰', '下半身', 'hips'], head: ['頭', '头', 'head'], neck: ['首', 'neck'],
    leftUpperArm: ['左腕', '左臂', 'leftUpperArm'], rightUpperArm: ['右腕', '右臂', 'rightUpperArm'],
    leftHand: ['左手首', '左手腕', 'leftHand'], rightHand: ['右手首', '右手腕', 'rightHand'],
    leftUpperLeg: ['左足D', '左足', 'leftUpperLeg'], rightUpperLeg: ['右足D', '右足', 'rightUpperLeg'],
  };
  const selected = new Map<string, Node>();
  for (const [role, names] of Object.entries(aliases)) {
    const semantic = nodes.filter(n => (n.getExtras()._vrmHumanBone ?? n.getExtras()._humanoidRole) === role);
    if (semantic.length === 1) { selected.set(role, semantic[0]!); continue; }
    for (const name of names) {
      const matches = nodes.filter(n => n.getName().toLowerCase() === name.toLowerCase());
      if (matches.length === 1) { selected.set(role, matches[0]!); break; }
      if (matches.length > 1) break;
    }
  }
  if (['hips', 'head', 'leftUpperArm', 'rightUpperArm', 'leftHand', 'rightHand', 'leftUpperLeg', 'rightUpperLeg'].some(r => !selected.has(r))) return null;
  for (const side of ['left', 'right']) {
    let node: Node | null = selected.get(side + 'Hand')!;
    const arm = selected.get(side + 'UpperArm');
    while (node && node !== arm) node = node.getParentNode();
    if (!node) return null;
  }
  const boneMap: Record<string, string> = {};
  for (const [role, node] of selected) {
    if ((node.getExtras()._vrmHumanBone ?? node.getExtras()._humanoidRole) === role) continue;
    if (nodes.filter(n => n.getName() === node.getName()).length !== 1) return null;
    boneMap[role] = node.getName();
  }
  return { boneMap, rotationYDegrees: doc.getRoot().listNodes().some(n => n.getName() === '左腕') ? 180 : 0, armSpreadDegrees: 0, shoulderOutset: 0 };
}
