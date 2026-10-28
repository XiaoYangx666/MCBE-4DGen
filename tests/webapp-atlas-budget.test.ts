/**
 * Verifies that the browser planner's opt-in budget path is the shared core:
 * same rectangles, same chart ids, same triangles as calling `planAtlasBudget`
 * directly on the neutral inputs.
 */
import { describe, expect, it } from 'vitest';
import { planAtlas, type AtlasInput } from '../webapp/engine/atlas.ts';
import type { TextureSource } from '../webapp/engine/types.ts';
import { planAtlasBudget } from '../src/atlas-core/plan.ts';
import type { ChartInput } from '../src/atlas-core/types.ts';
import { fixtures } from '../scripts/research/atlas/fixtures.ts';
import type { ChartInput as ResearchInput } from '../scripts/research/atlas/types.ts';

const toAtlasInput = (input: ResearchInput): AtlasInput => ({
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

const toCoreInput = (input: ResearchInput): ChartInput => ({
  id: input.id,
  material: input.id,
  materialKey: input.id,
  texture: input.texture
    ? { width: input.texture.width, height: input.texture.height, key: input.texture.key }
    : null,
  color: input.color,
  opacity: input.opacity,
  alphaMode: input.alphaMode,
  alphaCutoff: input.alphaCutoff,
  wrap: input.wrap,
  bounds: input.bounds,
  uvs: input.uvs,
  triangleAreas: input.triangleAreas,
  area: input.area,
});

describe('browser budget planner', () => {
  for (const fixture of fixtures()) {
    it(`matches the shared core for ${fixture.name}`, () => {
      const inputs = fixture.inputs.map(toAtlasInput);
      const web = planAtlas(inputs, 128, 1, { budget: 'texel-retention' });
      const core = planAtlasBudget(fixture.inputs.map(toCoreInput), {
        size: 128,
        pad: 1,
        target: 'retention',
        coverageAware: false,
        sharing: 'none',
        merge: 'production',
      });
      const webRects = web.charts
        .map((chart) => ({
          id: chart.key,
          rect: `${chart.rect.x},${chart.rect.y},${chart.rect.width},${chart.rect.height}`,
          triangles: [...chart.triangles].sort((a, b) => a - b).join(','),
        }))
        .sort((a, b) => a.id.localeCompare(b.id));
      const coreRects = core.plan.charts
        .map((chart) => ({
          id: chart.chartId,
          rect: `${chart.rect.x},${chart.rect.y},${chart.rect.width},${chart.rect.height}`,
          triangles: (chart.triangles ?? [])
            .flatMap((group) => group.triangles)
            .sort((a, b) => a - b)
            .join(','),
        }))
        .sort((a, b) => a.id.localeCompare(b.id));
      expect(webRects).toEqual(coreRects);
      expect(web.scale).toBeCloseTo(core.plan.scale, 12);
    });
  }

  it('honours per-input weights', () => {
    const fixture = fixtures().find((entry) => entry.name === 'shared-texture')!;
    const inputs = fixture.inputs.map(toAtlasInput);
    const base = planAtlas(inputs, 128, 1, { budget: 'texel-retention' });
    const boosted = planAtlas(inputs, 128, 1, {
      budget: 'texel-retention',
      weights: { face: 4 },
    });
    const area = (layout: typeof base, key: string) => {
      const chart = layout.charts.find((entry) => entry.inputKey === key)!;
      return (chart.rect.width - chart.rect.pad * 2) * (chart.rect.height - chart.rect.pad * 2);
    };
    // Both materials have similar source demand, so a 4x weight moves the
    // share from 1/2 to 4/5. Rounding, aspect variants and the minimum chart
    // size keep the measured ratio below the ideal 4x.
    expect(area(boosted, 'face') / area(base, 'face')).toBeGreaterThan(1.25);
    expect(area(boosted, 'face') / area(boosted, 'body')).toBeGreaterThan(2.5);
  });

  it('attaches the shared report and keeps stable material keys', () => {
    const fixture = fixtures().find((entry) => entry.name === 'shared-texture')!;
    const base = toAtlasInput(fixture.inputs[0]!);
    const inputs = [
      {
        ...base,
        materialName: 'Body',
        materialKey: 'm:Body#1',
        partIndex: new Uint16Array(Math.floor((base.uvs?.length ?? 0) / 6)).fill(0),
        parts: [{ id: 'body:p0', name: 'Body part' }],
      },
      {
        ...base,
        key: 'copy',
        materialName: 'Copy',
        materialKey: 'm:Copy#1',
        partIndex: new Uint16Array(Math.floor((base.uvs?.length ?? 0) / 6)).fill(0),
        parts: [{ id: 'copy:p0', name: 'Copy part' }],
      },
    ];
    const layout = planAtlas(inputs, 128, 1, {
      budget: 'texel-retention',
      sharing: 'safe',
    });
    expect(layout.budget).toBeDefined();
    const report = layout.budget!.report!;
    expect(report.materials.map((material) => material.materialKey).sort()).toEqual([
      'm:Body#1',
      'm:Copy#1',
    ]);
    const attributed = report.materials.reduce((sum, material) => sum + material.rectPixels, 0);
    expect(attributed).toBe(report.contentPixels);
    expect(report.parts.length).toBe(2);
    expect(report.sharedContentPixels).toBeGreaterThan(0);
    expect(report.overlapPixels).toBe(report.uvPixels);
  });
});
