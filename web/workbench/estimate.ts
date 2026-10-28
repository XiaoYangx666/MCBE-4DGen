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
) {
  const source = materials
    .filter(
      (m) =>
        !excluded.includes(m.key ?? m.name) &&
        !(binding === "humanoid" && m.transparent && m.alpha === 0),
    )
    .reduce((n, m) => n + m.triangles * (m.doubleSided ? 2 : 1), 0);
  return { source: Math.round(source), target: Math.round(source * ratio) };
}

export {
  FACE_GREEN_MAX,
  FACE_YELLOW_MAX,
  faceBand,
  triangleBudget,
} from "../shared/triangle-budget.ts";
export type { FaceBand } from "../shared/triangle-budget.ts";
