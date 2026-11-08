export function estimateTriangles(
  materials: {
    key?: string;
    name: string;
    triangles: number;
    alpha: number;
    doubleSided?: boolean;
    transparent?: boolean;
  }[],
  excluded: string[],
  ratio: number,
  binding: string,
  parts: { id: string; materialKey: string; triangles: number }[] = [],
  includedParts: ReadonlySet<string> = new Set(),
  partRatios: Readonly<Record<string, number>> = {},
) {
  const removedByMaterial = new Map<string, number>();
  for (const part of parts)
    if (!includedParts.has(part.id))
      removedByMaterial.set(
        part.materialKey,
        (removedByMaterial.get(part.materialKey) ?? 0) + part.triangles,
      );
  const source = materials
    .filter(
      (m) =>
        !excluded.includes(m.key ?? m.name) &&
        !(binding === "humanoid" && m.transparent && m.alpha === 0),
    )
    .reduce((n, m) => {
      const key = m.key ?? m.name;
      const triangles = Math.max(0, m.triangles - (removedByMaterial.get(key) ?? 0));
      return n + triangles * (m.doubleSided ? 2 : 1);
    }, 0);
  if (!parts.length)
    return { source: Math.round(source), target: Math.round(source * ratio) };

  // Per-part retention: included parts contribute their own ratio, and any
  // geometry the part list does not cover falls back to the global ratio.
  const byKey = new Map(materials.map((material) => [material.key ?? material.name, material]));
  let partSource = 0;
  let target = 0;
  for (const part of parts) {
    if (!includedParts.has(part.id)) continue;
    const material = byKey.get(part.materialKey);
    if (!material) continue;
    const key = material.key ?? material.name;
    if (excluded.includes(key)) continue;
    if (binding === "humanoid" && material.transparent && material.alpha === 0) continue;
    const multiplier = material.doubleSided ? 2 : 1;
    partSource += part.triangles * multiplier;
    target += part.triangles * multiplier * (partRatios[part.id] ?? ratio);
  }
  target += Math.max(0, source - partSource) * ratio;
  return { source: Math.round(source), target: Math.round(target) };
}

export {
  FACE_GREEN_MAX,
  FACE_YELLOW_MAX,
  faceBand,
  triangleBudget,
} from "../shared/triangle-budget.ts";
export type { FaceBand } from "../shared/triangle-budget.ts";
