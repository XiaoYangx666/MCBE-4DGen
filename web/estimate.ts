export function estimateTriangles(
  materials: {
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
        !excluded.includes(m.name) &&
        !(binding === "humanoid" && m.transparent && m.alpha === 0),
    )
    .reduce((n, m) => n + m.triangles * (m.doubleSided ? 2 : 1), 0);
  return { source: Math.round(source), target: Math.round(source * ratio) };
}

// Final output triangles, including backfaces. See docs/pmx-model-tests.md
// (Rin lite: 35,122) and docs/windows-client-test.md (accepted Shino: 52,106).
// These samples establish references, not an engine or device limit.
export function triangleBudget(target: number) {
  return {
    recommendedMax: 35122,
    observedMax: 52106,
    warning: target > 52106 ? "above" : "none",
  } as const;
}
