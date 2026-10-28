/**
 * One deterministic atlas renderer for every planner under test.
 *
 * The production desktop path delegates resampling to libvips and the web path
 * to canvas. Comparing planners with those two adapters would measure the
 * adapters, not the allocation policy. Both baselines and every candidate are
 * therefore drawn by this module (footprint-filtered source sampling, sRGB
 * output, base color and alpha baked exactly like `texture-pixels.ts`).
 */
import { resolveAlpha, sampleArea, toSrgbByte } from './sample.ts';
import { innerRect } from './remap.ts';
import type { AtlasPlan, ChartInput, RgbaImage } from './types.ts';

export interface RenderOptions {
  /** Draw only selected charts (used by diff / overlay diagnostics). */
  includeChart?: (chartId: string) => boolean;
}

const srgbToLinear01 = (value: number): number =>
  value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

export function renderPlan(
  inputs: readonly ChartInput[],
  plan: AtlasPlan,
  options: RenderOptions = {},
): RgbaImage {
  const { size } = plan;
  const data = new Uint8Array(size * size * 4);
  const byId = new Map(inputs.map((input) => [input.id, input]));

  for (const chart of plan.charts) {
    if (options.includeChart && !options.includeChart(chart.chartId)) continue;
    const input = byId.get(chart.inputId);
    const inner = innerRect(chart.rect);
    const pad = chart.rect.pad;
    const target = new Uint8Array(inner.width * inner.height * 4);

    if (!input || !chart.bounds || !input.texture) {
      const [red, green, blue] = input?.color ?? [1, 1, 1];
      const alpha = resolveAlpha(
        input?.opacity ?? 1,
        input?.alphaMode ?? 'OPAQUE',
        input?.alphaCutoff ?? 0.5,
      );
      const bytes = [
        toSrgbByte(clamp01(red)),
        toSrgbByte(clamp01(green)),
        toSrgbByte(clamp01(blue)),
        Math.round(alpha * 255),
      ];
      for (let i = 0; i < target.length; i += 4) {
        target[i] = bytes[0]!;
        target[i + 1] = bytes[1]!;
        target[i + 2] = bytes[2]!;
        target[i + 3] = bytes[3]!;
      }
    } else {
      const spanU = chart.map.spanU;
      const spanV = chart.map.spanV;
      const u0 = chart.map.u;
      const v0 = chart.map.v;
      const texture = input.texture;
      const tint: [number, number, number] = [
        srgbToLinear01(clamp01(input.color[0])),
        srgbToLinear01(clamp01(input.color[1])),
        srgbToLinear01(clamp01(input.color[2])),
      ];
      let offset = 0;
      for (let y = 0; y < inner.height; y++) {
        const sv0 = spanV > 1e-9 ? v0 + (y / inner.height) * spanV : v0;
        const sv1 = spanV > 1e-9 ? v0 + ((y + 1) / inner.height) * spanV : v0 + 1e-9;
        for (let x = 0; x < inner.width; x++) {
          const su0 = spanU > 1e-9 ? u0 + (x / inner.width) * spanU : u0;
          const su1 = spanU > 1e-9 ? u0 + ((x + 1) / inner.width) * spanU : u0 + 1e-9;
          const sample = sampleArea(
            texture,
            su0,
            sv0,
            su1,
            sv1,
            input.wrap[0],
            input.wrap[1],
          );
          target[offset] = toSrgbByte(srgbToLinear01(sample[0] / 255) * tint[0]);
          target[offset + 1] = toSrgbByte(srgbToLinear01(sample[1] / 255) * tint[1]);
          target[offset + 2] = toSrgbByte(srgbToLinear01(sample[2] / 255) * tint[2]);
          target[offset + 3] = Math.round(
            resolveAlpha(
              (sample[3] / 255) * input.opacity,
              input.alphaMode,
              input.alphaCutoff,
            ) * 255,
          );
          offset += 4;
        }
      }
    }

    // Copy content and replicate its border into the gutter so linear
    // filtering cannot read a neighbouring chart.
    for (let y = -pad; y < inner.height + pad; y++)
      for (let x = -pad; x < inner.width + pad; x++) {
        const sx = Math.min(inner.width - 1, Math.max(0, x));
        const sy = Math.min(inner.height - 1, Math.max(0, y));
        const src = (sy * inner.width + sx) * 4;
        const dx = inner.x + x;
        const dy = inner.y + y;
        if (dx < 0 || dy < 0 || dx >= size || dy >= size) continue;
        const dst = (dy * size + dx) * 4;
        data[dst] = target[src]!;
        data[dst + 1] = target[src + 1]!;
        data[dst + 2] = target[src + 2]!;
        data[dst + 3] = target[src + 3]!;
      }
  }
  return { width: size, height: size, data, key: `atlas-${size}` };
}
