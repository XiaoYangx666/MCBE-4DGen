/**
 * Semantic part grouping for skeletal models.
 *
 * A YSM player model can contain secondary submodels (the wine_fox `FOX`
 * subtree, hair, tail, clothes) inside the main skeleton. Grouping by raw mesh
 * name gives dozens of unrelated rows; grouping by the first branch below the
 * nearest skeleton joint makes those submodels selectable as one unit while
 * keeping the normal per-part checkboxes.
 */

const SKELETON_JOINTS = new Set([
  "root",
  "allbody",
  "upbody",
  "upperbody",
  "downbody",
  "body",
  "head",
  "allhead",
  "neck",
  "arm",
  "leftarm",
  "rightarm",
  "forearm",
  "leftforearm",
  "rightforearm",
  "hand",
  "lefthand",
  "righthand",
  "leg",
  "leftleg",
  "rightleg",
  "lowerleg",
  "leftlowerleg",
  "rightlowerleg",
  "foot",
  "leftfoot",
  "rightfoot",
  "hips",
  "pelvis",
  "spine",
  "chest",
]);

const normalize = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Strip mirror/helper prefixes used by YSM (`MTail`, `MHead`, `F...`). */
const stripHelperPrefix = (name: string) => name.replace(/^[MF](?=[A-Z][a-z])/, "");

function jointCore(name: string): string {
  const value = normalize(name);
  return value.length > 3 && (value.startsWith("m") || value.startsWith("f"))
    ? value.slice(1)
    : value;
}

export function isSkeletonJointName(name: string): boolean {
  return SKELETON_JOINTS.has(jointCore(name));
}

/**
 * Pick a stable submodel group from an ancestor path (outermost to the mesh).
 * Returns undefined for scenes without recognizable skeleton joints, so normal
 * GLB/OBJ part grouping falls back to its previous mesh-based labels.
 */
export function semanticPartGroup(path: readonly string[]): string | undefined {
  const names = path.filter((name) => name && !name.startsWith("__ysm_"));
  // Prefer the outermost non-joint branch that sits below a skeleton joint.
  // This keeps all numbered/mirrored bones inside a submodel (YSM `FOX`,
  // `Hair`, `Tail`) together, even when a child is itself called `Body` or
  // `LeftLeg2`.
  let sawJoint = false;
  for (const name of names) {
    if (isSkeletonJointName(name)) {
      sawJoint = true;
      continue;
    }
    if (sawJoint) return stripHelperPrefix(name) || name;
  }
  // No named submodel branch: fall back to the nearest joint's child, or the
  // joint itself for a mesh directly below it.
  for (let index = names.length - 1; index >= 0; index--) {
    if (!isSkeletonJointName(names[index]!)) continue;
    const branch = names[index + 1] ?? names[index]!;
    return stripHelperPrefix(branch) || branch;
  }
  return undefined;
}
