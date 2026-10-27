import type { Document, Node } from '@gltf-transform/core';
import type { HumanoidProfile } from './humanoid.ts';
import { HUMANOID_ROLE_ALIASES, humanoidAliases } from './humanoid-roles.ts';

/** Recognize explicit rig conventions; ambiguous names never silently win. */
export function autoProfile(doc: Document): HumanoidProfile | null {
  const nodes = doc.getRoot().listNodes();
  const selected = new Map<string, Node>();
  for (const role of Object.keys(HUMANOID_ROLE_ALIASES)) {
    const semantic = nodes.filter(n => (n.getExtras()._vrmHumanBone ?? n.getExtras()._humanoidRole) === role);
    if (semantic.length === 1) { selected.set(role, semantic[0]!); continue; }
    // 桌面端只认 MMD 与规范角色名，历史行为保持不变。
    for (const name of humanoidAliases(role, ['mmd', 'generic'])) {
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
