/**
 * Humanoid bone-name aliases shared by the Node auto-profile pass and the
 * browser rig detector.
 *
 * Only the alias data lives here. Each side keeps its own matching rules
 * (desktop compares lower-cased node names, browser strips separators, and a
 * unique hit is required) because those rules are tuned to different scene
 * graphs. Matching walks the list in order, so the order is part of the data.
 */

/** Rig naming convention an alias comes from. */
export type HumanoidRigConvention = 'mmd' | 'generic' | 'mixamo' | 'biped' | 'mmd-extra';

export interface HumanoidRoleAlias {
  /** Lower-case, separator-free form; callers normalize node names before comparing. */
  name: string;
  convention: HumanoidRigConvention;
}

/**
 * Canonical role → aliases, ordered from the most specific convention to the
 * loosest. `mmd-extra` marks MMD names the desktop auto-profile never matched;
 * adding them to its `mmd` set would change which models enable humanoid mode.
 */
export const HUMANOID_ROLE_ALIASES: Readonly<Record<string, readonly HumanoidRoleAlias[]>> = {
  hips: [
    { name: '腰', convention: 'mmd' },
    { name: '下半身', convention: 'mmd' },
    { name: 'hips', convention: 'generic' },
    { name: 'pelvis', convention: 'biped' },
    { name: 'jbipchips', convention: 'biped' },
  ],
  head: [
    { name: '頭', convention: 'mmd' },
    { name: '头', convention: 'mmd' },
    { name: 'head', convention: 'generic' },
    { name: 'jbipchead', convention: 'biped' },
  ],
  neck: [
    { name: '首', convention: 'mmd' },
    { name: 'neck', convention: 'generic' },
    { name: 'jbipcneck', convention: 'biped' },
  ],
  leftUpperArm: [
    { name: '左腕', convention: 'mmd' },
    { name: '左臂', convention: 'mmd' },
    { name: 'leftupperarm', convention: 'generic' },
    { name: 'leftarm', convention: 'biped' },
    { name: 'mixamorigleftarm', convention: 'mixamo' },
    { name: 'upperarml', convention: 'biped' },
    { name: 'larm', convention: 'biped' },
    { name: 'lupperarm', convention: 'biped' },
    { name: 'jbiplupperarm', convention: 'biped' },
  ],
  rightUpperArm: [
    { name: '右腕', convention: 'mmd' },
    { name: '右臂', convention: 'mmd' },
    { name: 'rightupperarm', convention: 'generic' },
    { name: 'rightarm', convention: 'biped' },
    { name: 'mixamorigrightarm', convention: 'mixamo' },
    { name: 'upperarmr', convention: 'biped' },
    { name: 'rarm', convention: 'biped' },
    { name: 'rupperarm', convention: 'biped' },
    { name: 'jbiprupperarm', convention: 'biped' },
  ],
  leftHand: [
    { name: '左手首', convention: 'mmd' },
    { name: '左手腕', convention: 'mmd' },
    { name: 'lefthand', convention: 'generic' },
    { name: 'mixamoriglefthand', convention: 'mixamo' },
    { name: 'handl', convention: 'biped' },
    { name: 'lhand', convention: 'biped' },
    { name: 'jbiplhand', convention: 'biped' },
  ],
  rightHand: [
    { name: '右手首', convention: 'mmd' },
    { name: '右手腕', convention: 'mmd' },
    { name: 'righthand', convention: 'generic' },
    { name: 'mixamorigrighthand', convention: 'mixamo' },
    { name: 'handr', convention: 'biped' },
    { name: 'rhand', convention: 'biped' },
    { name: 'jbiprhand', convention: 'biped' },
  ],
  leftUpperLeg: [
    { name: '左足d', convention: 'mmd' },
    { name: '左足', convention: 'mmd' },
    { name: '左太もも', convention: 'mmd-extra' },
    { name: 'leftupperleg', convention: 'generic' },
    { name: 'leftupleg', convention: 'biped' },
    { name: 'mixamorigleftupleg', convention: 'mixamo' },
    { name: 'thighl', convention: 'biped' },
    { name: 'lupperleg', convention: 'biped' },
    { name: 'jbiplupperleg', convention: 'biped' },
  ],
  rightUpperLeg: [
    { name: '右足d', convention: 'mmd' },
    { name: '右足', convention: 'mmd' },
    { name: '右太もも', convention: 'mmd-extra' },
    { name: 'rightupperleg', convention: 'generic' },
    { name: 'rightupleg', convention: 'biped' },
    { name: 'mixamorigrightupleg', convention: 'mixamo' },
    { name: 'thighr', convention: 'biped' },
    { name: 'rupperleg', convention: 'biped' },
    { name: 'jbiprupperleg', convention: 'biped' },
  ],
};

/** Aliases for a role, optionally limited to some conventions; order is preserved. */
export function humanoidAliases(
  role: string,
  conventions?: readonly HumanoidRigConvention[],
): string[] {
  const aliases = HUMANOID_ROLE_ALIASES[role] ?? [];
  return aliases
    .filter((alias) => !conventions || conventions.includes(alias.convention))
    .map((alias) => alias.name);
}
