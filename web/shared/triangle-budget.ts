// Final output triangles, including backfaces. The UI uses three simple bands:
// under 20k is lightweight, 20k–50k is acceptable, above 50k is high.
export const FACE_GREEN_MAX = 20000;
export const FACE_YELLOW_MAX = 50000;

export type FaceBand = "green" | "yellow" | "red";

export function faceBand(target: number): FaceBand {
  if (target > FACE_YELLOW_MAX) return "red";
  if (target >= FACE_GREEN_MAX) return "yellow";
  return "green";
}

export function triangleBudget(target: number) {
  return {
    level: faceBand(target),
    greenMax: FACE_GREEN_MAX,
    yellowMax: FACE_YELLOW_MAX,
  } as const;
}
