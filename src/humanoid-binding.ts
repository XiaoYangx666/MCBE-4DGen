import type { V3 } from './bedrock-types.ts';

/**
 * Dependency-free six-part player binding rules shared by the Node exporter and
 * the browser exporter. Environment adapters still read their own mesh data,
 * but role ownership, player skeleton and pivots stay identical.
 */

export type HumanoidPart =
  | 'body'
  | 'head'
  | 'leftArm'
  | 'rightArm'
  | 'leftLeg'
  | 'rightLeg';

export const HUMANOID_PARTS: readonly HumanoidPart[] = [
  'body',
  'head',
  'leftArm',
  'rightArm',
  'leftLeg',
  'rightLeg',
];

/** Player part → canonical source role used for its pivot. */
export const HUMANOID_PART_ROLES = {
  body: 'hips',
  head: 'head',
  leftArm: 'leftUpperArm',
  rightArm: 'rightUpperArm',
  leftLeg: 'leftUpperLeg',
  rightLeg: 'rightUpperLeg',
} as const satisfies Record<HumanoidPart, string>;

/** Source roles required before six-part binding may be used. */
export const HUMANOID_REQUIRED_ROLES = [
  'hips',
  'head',
  'leftUpperArm',
  'rightUpperArm',
  'leftHand',
  'rightHand',
  'leftUpperLeg',
  'rightUpperLeg',
] as const;

/** Every source role that owns geometry, including secondary roles. */
export const HUMANOID_ROLE_PART: Readonly<Record<string, HumanoidPart>> = {
  hips: 'body',
  head: 'head',
  neck: 'head',
  leftUpperArm: 'leftArm',
  rightUpperArm: 'rightArm',
  leftUpperLeg: 'leftLeg',
  rightUpperLeg: 'rightLeg',
};

export function partForHumanoidRole(role: unknown): HumanoidPart | null {
  return typeof role === 'string' ? HUMANOID_ROLE_PART[role] ?? null : null;
}

/** One byte per triangle, so reduction and batching can preserve ownership. */
export const PART_CODE: Record<HumanoidPart, number> = {
  body: 0,
  head: 1,
  leftArm: 2,
  rightArm: 3,
  leftLeg: 4,
  rightLeg: 5,
};

export const CODE_PART: readonly HumanoidPart[] = [
  'body',
  'head',
  'leftArm',
  'rightArm',
  'leftLeg',
  'rightLeg',
];

/**
 * Pick the part with the largest summed source weight. Insertion order breaks
 * ties, matching both exporters' previous triangle-soup behaviour.
 */
export function dominantHumanoidPart(
  scores: ReadonlyMap<HumanoidPart, number>,
): HumanoidPart {
  let best: HumanoidPart = 'body';
  let bestWeight = 0;
  for (const [part, weight] of scores)
    if (weight > bestWeight) { best = part; bestWeight = weight; }
  return best;
}

export interface PlayerSkeletonBone {
  name: string;
  parent?: string;
  pivot: V3;
}

/** Standard player skeleton used by static and humanoid exports. */
export const PLAYER_SKELETON: readonly PlayerSkeletonBone[] = [
  { name: 'root', pivot: [0, 0, 0] },
  { name: 'waist', parent: 'root', pivot: [0, 12, 0] },
  { name: 'body', parent: 'waist', pivot: [0, 24, 0] },
  { name: 'head', parent: 'body', pivot: [0, 24, 0] },
  { name: 'leftArm', parent: 'body', pivot: [-5, 22, 0] },
  { name: 'rightArm', parent: 'body', pivot: [5, 22, 0] },
  { name: 'leftLeg', parent: 'root', pivot: [-1.9, 12, 0] },
  { name: 'rightLeg', parent: 'root', pivot: [1.9, 12, 0] },
];

/**
 * Fit source-space points into Bedrock space: center X/Z, put the feet on the
 * ground and scale to the requested height. X mirroring stays separate.
 */
export function createBoundsFitter(
  bounds: { min: V3; max: V3 },
  scale: number,
) {
  const offsetX = -(bounds.min[0] + bounds.max[0]) / 2;
  const offsetY = -bounds.min[1];
  const offsetZ = -(bounds.min[2] + bounds.max[2]) / 2;
  return (x: number, y: number, z: number): V3 => [
    (x + offsetX) * scale,
    (y + offsetY) * scale,
    (z + offsetZ) * scale,
  ];
}
