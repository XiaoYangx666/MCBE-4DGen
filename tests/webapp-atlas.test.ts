import { describe, expect, it } from 'vitest';
import { planAtlas, remapUvs, type AtlasInput } from '../webapp/engine/atlas.ts';
import type { TextureSource } from '../webapp/engine/types.ts';

const texture: TextureSource = {
  image: {} as CanvasImageSource,
  width: 512,
  height: 512,
  key: 'tex',
};

function input(key: string, area: number, bounds: [number, number, number, number] | null = [0, 0, 1, 1]): AtlasInput {
  return { key, texture, uvBounds: bounds, color: [1, 1, 1], opacity: 1, area };
}

describe('webapp atlas planner', () => {
  it('packs multiple materials without overlap', () => {
    const layout = planAtlas([input('a', 10), input('b', 5), input('c', 2), input('d', 1)], 128, 1);
    expect(layout.rects.size).toBe(4);
    const rects = [...layout.rects.values()];
    for (const rect of rects) {
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(128);
      expect(rect.y + rect.height).toBeLessThanOrEqual(128);
    }
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i]!, b = rects[j]!;
        const overlap = a.x < b.x + b.width && b.x < a.x + a.width &&
          a.y < b.y + b.height && b.y < a.y + a.height;
        expect(overlap).toBe(false);
      }
    }
  });

  it('uses the whole atlas for a single source', () => {
    const layout = planAtlas([input('only', 1)], 128, 1);
    const rect = layout.rects.get('only')!;
    expect(rect.width).toBeGreaterThan(100);
    expect(rect.height).toBeGreaterThan(100);
  });

  it('fits many materials with the grid fallback', () => {
    const many = Array.from({ length: 140 }, (_, index) => input(`m${index}`, 1));
    const layout = planAtlas(many, 128, 1);
    expect(layout.rects.size).toBe(140);
    for (const rect of layout.rects.values()) {
      expect(rect.x + rect.width).toBeLessThanOrEqual(128);
      expect(rect.y + rect.height).toBeLessThanOrEqual(128);
    }
  });

  it('remaps UV bounds into the rect interior', () => {
    const bounds: [number, number, number, number] = [0.25, 0.25, 0.75, 0.75];
    const rect = { x: 10, y: 20, width: 40, height: 30, pad: 1 };
    const uvs = new Float32Array([0.25, 0.25, 0.75, 0.25, 0.75, 0.75]);
    remapUvs(uvs, bounds, rect, 128);
    expect(uvs[0]).toBeCloseTo(11 / 128);
    expect(uvs[1]).toBeCloseTo(21 / 128);
    expect(uvs[2]).toBeCloseTo(49 / 128);
    expect(uvs[3]).toBeCloseTo(21 / 128);
    expect(uvs[5]).toBeCloseTo(49 / 128);
  });

  it('collapses untextured UVs to the rect center', () => {
    const rect = { x: 10, y: 20, width: 40, height: 30, pad: 1 };
    const uvs = new Float32Array([0, 0, 1, 0, 1, 1]);
    remapUvs(uvs, null, rect, 128);
    for (let i = 0; i < uvs.length; i += 2) {
      expect(uvs[i]).toBeCloseTo((11 + 19) / 128);
      expect(uvs[i + 1]).toBeCloseTo((21 + 14) / 128);
    }
  });
});
