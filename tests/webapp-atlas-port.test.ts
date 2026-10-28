/**
 * Guards the research port of the browser planner against drift from the real
 * implementation. This file is excluded from the Node tsconfig (webapp engine
 * files use DOM types) and runs under vitest's Node environment.
 */
import { describe, expect, it } from 'vitest';
import { planAtlas, type AtlasInput } from '../webapp/engine/atlas.ts';
import type { TextureSource } from '../webapp/engine/types.ts';
import { planBaselineWeb } from '../scripts/research/atlas/baseline-web.ts';
import { fixtures } from '../scripts/research/atlas/fixtures.ts';
import type { ChartInput } from '../scripts/research/atlas/types.ts';

const toAtlasInput = (input: ChartInput): AtlasInput => ({
  key: input.id,
  texture: input.texture
    ? ({
        image: {} as CanvasImageSource,
        width: input.texture.width,
        height: input.texture.height,
        key: input.texture.key,
        wrapS: input.wrap[0] === 'clamp' ? 33071 : input.wrap[0] === 'mirror' ? 33648 : 10497,
        wrapT: input.wrap[1] === 'clamp' ? 33071 : input.wrap[1] === 'mirror' ? 33648 : 10497,
      } satisfies TextureSource)
    : null,
  uvBounds: input.bounds,
  uvs: input.uvs,
  triangleAreas: input.triangleAreas,
  color: input.color,
  opacity: input.opacity,
  alphaMode: input.alphaMode,
  alphaCutoff: input.alphaCutoff,
  area: input.area,
});

describe('research port of planAtlas', () => {
  for (const fixture of fixtures()) {
    it(`matches the production rectangles for ${fixture.name}`, () => {
      const real = planAtlas(fixture.inputs.map(toAtlasInput), 128, 1);
      const port = planBaselineWeb(fixture.inputs, 128, 1);
      const realRects = real.charts
        .map((chart) => ({
          key: chart.key,
          rect: `${chart.rect.x},${chart.rect.y},${chart.rect.width},${chart.rect.height}`,
          triangles: [...chart.triangles].sort((a, b) => a - b).join(','),
        }))
        .sort((a, b) => a.key.localeCompare(b.key));
      const portRects = port.charts
        .map((chart) => ({
          key: chart.chartId,
          rect: `${chart.rect.x},${chart.rect.y},${chart.rect.width},${chart.rect.height}`,
          triangles: (chart.triangles ?? [])
            .flatMap((group) => group.triangles)
            .sort((a, b) => a - b)
            .join(','),
        }))
        .sort((a, b) => a.key.localeCompare(b.key));
      expect(portRects).toEqual(realRects);
      expect(port.scale).toBeCloseTo(real.scale, 12);
    });
  }
});
