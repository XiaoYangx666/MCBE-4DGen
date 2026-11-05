const GENERIC_PART_NAME =
  /^(?:\(?(?:mesh|node|object|group|primitive|default)\)?[\s._-]*\d*|mesh\d+|node\d+|object\d+|group\d+|primitive\d*|部件\s*\d+)$/i;

/** Generated split names such as `舌_1`, `body#3` or `part-12`. */
const INDEXED_SUFFIX = /^(.*?)(?:[\s._-]+#?\d+|#\d+)$/;

export function isGenericPartName(value: string | null | undefined) {
  const name = value?.trim();
  return !name || GENERIC_PART_NAME.test(name);
}

/**
 * Base of a generated split name (`舌_1` -> `舌`), or null when the name is not
 * an indexed variant. Used to prefer material names over exporter placeholders.
 */
export function indexedPartBase(value: string | null | undefined) {
  const name = value?.trim();
  if (!name) return null;
  const base = INDEXED_SUFFIX.exec(name)?.[1]?.trim();
  return base && base !== name ? base : null;
}

/**
 * Pick a human-readable part name from the node/mesh/primitive data instead of
 * showing engine placeholders such as `(mesh)` or `mesh0`.
 */
export function readablePartName(
  values: readonly (string | null | undefined)[],
  index: number,
  prefix = '部件',
) {
  for (const value of values) {
    const name = value?.trim();
    if (name && !GENERIC_PART_NAME.test(name)) return name;
  }
  return `${prefix} ${index + 1}`;
}

/** Disambiguate repeated readable names without losing the source name. */
export function uniquePartNames(names: readonly string[]) {
  const totals = new Map<string, number>();
  for (const name of names) totals.set(name, (totals.get(name) ?? 0) + 1);
  const seen = new Map<string, number>();
  return names.map((name) => {
    if ((totals.get(name) ?? 1) <= 1) return name;
    const index = (seen.get(name) ?? 0) + 1;
    seen.set(name, index);
    return `${name} #${index}`;
  });
}

export interface PartNameInput {
  name?: string | null;
  node?: string | null;
  mesh?: string | null;
  material?: string | null;
}

/**
 * Display names for a part list. When many primitives share one mesh/node,
 * their material names are more useful than repeating `model_mesh#0..n`.
 */
export function partDisplayNames(
  parts: readonly PartNameInput[],
  prefix = '部件',
) {
  const nodeCounts = new Map<string, number>();
  const meshCounts = new Map<string, number>();
  const indexedCounts = new Map<string, number>();
  for (const part of parts) {
    const node = part.node?.trim();
    const mesh = part.mesh?.trim();
    if (node) nodeCounts.set(node, (nodeCounts.get(node) ?? 0) + 1);
    if (mesh) meshCounts.set(mesh, (meshCounts.get(mesh) ?? 0) + 1);
    const bases = new Set<string>();
    for (const value of [part.name, node, mesh]) {
      const base = indexedPartBase(value);
      if (base) bases.add(base);
    }
    for (const base of bases)
      indexedCounts.set(base, (indexedCounts.get(base) ?? 0) + 1);
  }
  return uniquePartNames(
    parts.map((part, index) => {
      const node = part.node?.trim();
      const mesh = part.mesh?.trim();
      const material = part.material?.trim();
      const sharedNode = !!node && (nodeCounts.get(node) ?? 0) > 1;
      const sharedMesh = !!mesh && (meshCounts.get(mesh) ?? 0) > 1;
      // Exporter splits such as `舌_1`…`舌_52`: the material name is the only
      // human-readable label, so use it instead of the generated suffix.
      const indexed = [part.name, node, mesh].some((value) => {
        const base = indexedPartBase(value);
        return !!base && (indexedCounts.get(base) ?? 0) > 1;
      });
      if ((sharedNode || sharedMesh || indexed) && material && !isGenericPartName(material))
        return material;
      return readablePartName([part.name, node, mesh], index, prefix);
    }),
  );
}

/**
 * Group labels for a part list. Generated splits of one mesh are collapsed
 * (`舌_1`…`舌_52` -> `舌`) so the browser does not show dozens of fake groups.
 */
export function partGroupNames(
  parts: readonly PartNameInput[],
  fallback = '模型结构',
) {
  const bases = new Map<string, number>();
  for (const part of parts) {
    const base = indexedPartBase(part.mesh ?? part.node);
    if (base) bases.set(base, (bases.get(base) ?? 0) + 1);
  }
  return parts.map((part) => {
    const mesh = part.mesh?.trim() || part.node?.trim();
    const base = indexedPartBase(mesh);
    if (base && (bases.get(base) ?? 0) > 1) return base;
    return mesh || fallback;
  });
}
