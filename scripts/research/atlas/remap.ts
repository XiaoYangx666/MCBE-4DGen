/**
 * UV remapping for a plan. Kept separate from rendering so metrics can measure
 * the exact mapping the renderer uses.
 */
import type { AtlasPlan, ChartInput } from './types.ts';

export const innerRect = (rect: { x: number; y: number; width: number; height: number; pad: number }) => ({
  x: rect.x + rect.pad,
  y: rect.y + rect.pad,
  width: Math.max(1, rect.width - rect.pad * 2),
  height: Math.max(1, rect.height - rect.pad * 2),
});

/** Map original per-triangle UVs into atlas UV space. */
export function remapPlan(
  inputs: readonly ChartInput[],
  plan: AtlasPlan,
): Map<string, Float32Array> {
  const atlasUvs = new Map<string, Float32Array>();
  for (const input of inputs)
    atlasUvs.set(input.id, input.uvs ? new Float32Array(input.uvs) : new Float32Array(0));
  const byId = new Map(inputs.map((input) => [input.id, input]));

  for (const chart of plan.charts) {
    const bounds = chart.bounds;
    if (!bounds) continue;
    const { u: mapU, v: mapV, spanU, spanV } = chart.map;
    const inner = innerRect(chart.rect);
    const mapCorner = (target: Float32Array, index: number) => {
      const u = spanU > 1e-9 ? (target[index]! - mapU) / spanU : 0.5;
      const v = spanV > 1e-9 ? (target[index + 1]! - mapV) / spanV : 0.5;
      target[index] = (inner.x + u * inner.width) / plan.size;
      target[index + 1] = (inner.y + v * inner.height) / plan.size;
    };
    const groups =
      chart.triangles ?? [
        {
          inputId: chart.inputId,
          triangles: Array.from(
            { length: Math.floor((byId.get(chart.inputId)?.uvs?.length ?? 0) / 6) },
            (_, index) => index,
          ),
        },
      ];
    for (const group of groups) {
      const target = atlasUvs.get(group.inputId);
      if (!target || !target.length) continue;
      for (const triangle of group.triangles) {
        for (let corner = 0; corner < 3; corner++) {
          const index = triangle * 6 + corner * 2;
          if (index + 1 >= target.length) continue;
          mapCorner(target, index);
        }
      }
    }
  }
  return atlasUvs;
}
