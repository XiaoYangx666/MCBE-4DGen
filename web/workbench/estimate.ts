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
  return { source: Math.round(source), target: Math.round(source * ratio) };
}

export {
  FACE_GREEN_MAX,
  FACE_YELLOW_MAX,
  faceBand,
  triangleBudget,
} from "../shared/triangle-budget.ts";
export type { FaceBand } from "../shared/triangle-budget.ts";
