/**
 * Stable selection identity shared by the Node workbench and the browser studio.
 *
 * Materials are addressed by `m:{name}#{occurrence}` (duplicate display names
 * stay distinct) and parts by their document/part id. Names and runtime UUIDs
 * are accepted only as a migration fallback, and only when unambiguous. A
 * fingerprint ties a saved selection to the model structure it was made on, so
 * relinking a library entry to a different file cannot silently reuse it.
 */

export interface MaterialIdentity {
  key: string;
  name: string;
  triangles?: number;
}

export interface PartIdentity {
  id: string;
  name: string;
}

export interface SelectionValues {
  /** Material keys to hide/remove. Legacy saves may contain names. */
  excluded?: readonly string[];
  /** Relative quality per material key. Legacy saves may contain names. */
  materialWeights?: Readonly<Record<string, number>>;
  /** Part ids to keep; an empty list is not the same as "all". */
  includedParts?: readonly string[];
  /** Structure fingerprint when the selection was saved. */
  fingerprint?: string;
}

export interface NormalizedSelection {
  excluded: string[];
  materialWeights: Record<string, number>;
  includedParts: string[] | null;
  /** Values that belong to another model or a removed object. */
  unmatched: string[];
  /** Legacy names that resolved to a unique current material. */
  migrated: { from: string; to: string }[];
  /** True when the saved fingerprint described a different structure. */
  structureChanged: boolean;
}

const MAX_WEIGHT = 20;

/** Duplicate names map to `null` so callers never guess which sampler was meant. */
export function materialKeysByName(
  materials: readonly MaterialIdentity[],
): Map<string, string | null> {
  const map = new Map<string, string | null>();
  for (const material of materials) {
    if (!map.has(material.name)) map.set(material.name, material.key);
    else map.set(material.name, null);
  }
  return map;
}

/** Disambiguated labels; keys remain the only persisted identity. */
export function materialDisplayLabels(
  materials: readonly { key: string; name: string }[],
): Map<string, string> {
  const totals = new Map<string, number>();
  for (const material of materials) {
    const name = material.name || '(默认)';
    totals.set(name, (totals.get(name) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  const labels = new Map<string, string>();
  for (const material of materials) {
    const name = material.name || '(默认)';
    const index = (seen.get(name) ?? 0) + 1;
    seen.set(name, index);
    labels.set(
      material.key,
      (totals.get(name) ?? 1) > 1 ? `${name} #${index}` : name,
    );
  }
  return labels;
}

export function clampMaterialWeight(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(MAX_WEIGHT, Math.max(0, value));
}

/** FNV-1a over the ordered structure, short enough to persist. */
export function selectionFingerprint(
  materials: readonly MaterialIdentity[],
  parts: readonly PartIdentity[],
): string {
  const text = [
    ...materials
      .map((material) => `${material.key}:${material.triangles ?? ''}`)
      .sort(),
    ...parts.map((part) => part.id).sort(),
  ].join('|');
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `v1:${(hash >>> 0).toString(16).padStart(8, '0')}:${parts.length}`;
}

export function normalizeSelection(
  materials: readonly MaterialIdentity[],
  parts: readonly PartIdentity[],
  values: SelectionValues,
): NormalizedSelection {
  const keys = new Set(materials.map((material) => material.key));
  const names = materialKeysByName(materials);
  const partIds = new Set(parts.map((part) => part.id));
  const unmatched: string[] = [];
  const migrated: { from: string; to: string }[] = [];
  const currentFingerprint = selectionFingerprint(materials, parts);
  const structureChanged =
    typeof values.fingerprint === 'string' &&
    values.fingerprint.length > 0 &&
    values.fingerprint !== currentFingerprint;

  const resolveMaterial = (value: string): string | null => {
    if (keys.has(value)) return value;
    const byName = names.get(value);
    if (byName) {
      if (!migrated.some((entry) => entry.from === value && entry.to === byName))
        migrated.push({ from: value, to: byName });
      return byName;
    }
    return null;
  };

  const excluded: string[] = [];
  for (const value of values.excluded ?? []) {
    if (structureChanged) break;
    const key = resolveMaterial(value);
    if (key && !excluded.includes(key)) excluded.push(key);
    else if (!key) unmatched.push(value);
  }

  const materialWeights: Record<string, number> = {};
  for (const [value, raw] of Object.entries(values.materialWeights ?? {})) {
    if (structureChanged) break;
    const key = resolveMaterial(value);
    const weight = clampMaterialWeight(raw);
    if (!key || weight === null) {
      if (!key) unmatched.push(value);
      continue;
    }
    materialWeights[key] = weight;
  }

  let includedParts: string[] | null = null;
  if (!structureChanged && values.includedParts) {
    const kept: string[] = [];
    for (const id of values.includedParts) {
      if (partIds.has(id)) kept.push(id);
      else unmatched.push(id);
    }
    includedParts = kept;
  }

  return {
    excluded: structureChanged ? [] : excluded,
    materialWeights: structureChanged ? {} : materialWeights,
    includedParts,
    unmatched,
    migrated,
    structureChanged,
  };
}

/** Ids of materials referenced by at least one mesh primitive. */
export function activeMaterialKeys(
  materials: readonly { key: string; triangles: number }[],
): Set<string> {
  return new Set(
    materials.filter((material) => material.triangles > 0).map((material) => material.key),
  );
}
