/**
 * VRM humanoid bone table reader shared by the Node importer and the browser
 * loader. VRM 0.x stores bones as an array, VRM 1.0 as an object; both reduce
 * to the same role → node list.
 *
 * This parser is deliberately lenient: it never validates specVersion or
 * throws. The desktop importer keeps its strict checks before calling it.
 */

export interface VrmHumanBone {
  bone: string;
  node: number;
}

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * Read humanoid bones from a glTF root (`{ extensions: ... }`) or from a single
 * VRM / VRMC_vrm extension object. Invalid entries are dropped; malformed
 * structures yield an empty list.
 */
export function readVrmHumanBones(json: unknown): VrmHumanBone[] {
  const extensions = record(json) && record(json.extensions) ? json.extensions : null;
  // VRM 0.x 在前、VRM 1.0 在后，保持网页端原本的覆盖顺序。
  const candidates = extensions ? [extensions.VRM, extensions.VRMC_vrm] : [json];
  const bones: VrmHumanBone[] = [];
  for (const extension of candidates) {
    if (!record(extension)) continue;
    const humanoid = record(extension.humanoid) ? extension.humanoid : null;
    const table = humanoid?.humanBones;
    if (Array.isArray(table)) {
      for (const entry of table) {
        if (!record(entry) || typeof entry.bone !== 'string' || typeof entry.node !== 'number') continue;
        bones.push({ bone: entry.bone, node: entry.node });
      }
    } else if (record(table)) {
      for (const [bone, entry] of Object.entries(table)) {
        if (!record(entry) || typeof entry.node !== 'number') continue;
        bones.push({ bone, node: entry.node });
      }
    }
  }
  return bones;
}
