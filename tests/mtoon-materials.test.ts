import { describe, expect, it } from 'vitest';
import { hasExplicitBaseColor, mapMtoonMaterial } from '../src/mtoon-materials.ts';
import { srgbToLinear } from '../src/texture-pixels.ts';

const strict = { textureCount: 3, strict: true } as const;
const lenient = { textureCount: 3, strict: false } as const;

describe('shared VRM MToon mapping', () => {
  it('ignores materials that are not VRM/MToon', () => {
    expect(mapMtoonMaterial({ shader: 'VRM/UnlitTexture' }, strict).isMtoon).toBe(false);
    expect(mapMtoonMaterial(null, strict).isMtoon).toBe(false);
  });

  it('maps base color, main texture, blend mode and culling', () => {
    const mapping = mapMtoonMaterial({
      shader: 'VRM/MToon',
      vectorProperties: { _Color: [0.5, 0.6, 0.7, 1] },
      floatProperties: { _BlendMode: 1, _Cutoff: 0.4, _CullMode: 0 },
      textureProperties: { _MainTex: 2 },
    }, strict);
    expect(mapping.isMtoon).toBe(true);
    expect(mapping.errors).toEqual([]);
    expect(mapping.patch.baseColorTexture).toBe(2);
    expect(mapping.patch.alphaMode).toBe('MASK');
    expect(mapping.patch.alphaCutoff).toBe(0.4);
    expect(mapping.patch.doubleSided).toBe(true);
    // _Color 是 sRGB，写进 glTF 前必须转成线性。
    const color = mapping.patch.baseColorFactor!;
    expect(color[0]).toBeCloseTo(srgbToLinear(0.5), 6);
    expect(color[1]).toBeCloseTo(srgbToLinear(0.6), 6);
    expect(color[2]).toBeCloseTo(srgbToLinear(0.7), 6);
    expect(color[3]).toBe(1);
  });

  it('treats a non-default glTF base color as authoritative', () => {
    expect(hasExplicitBaseColor(undefined)).toBe(false);
    expect(hasExplicitBaseColor([1, 1, 1, 1])).toBe(false);
    expect(hasExplicitBaseColor([0.01, 0.02, 0.04, 1])).toBe(true);
  });

  it('clears the base-color texture when MToon has none', () => {
    const mapping = mapMtoonMaterial({
      shader: 'VRM/MToon',
      textureProperties: { _MainTex: -1 },
    }, strict);
    expect(mapping.patch.baseColorTexture).toBeNull();
  });

  it('maps transparent blend modes and single-sided culling', () => {
    const mapping = mapMtoonMaterial({
      shader: 'VRM/MToon',
      floatProperties: { _BlendMode: 2, _CullMode: 2 },
    }, strict);
    expect(mapping.patch.alphaMode).toBe('BLEND');
    expect(mapping.patch.doubleSided).toBe(false);
  });

  it('reports the same first error the Node importer throws', () => {
    const transform = mapMtoonMaterial({
      shader: 'VRM/MToon',
      vectorProperties: { _MainTex: [0, 0, 2, 2] },
    }, strict);
    expect(transform.errors[0]).toMatch(/Nonidentity VRM 0 MToon texture transform/);

    const cull = mapMtoonMaterial({
      shader: 'VRM/MToon',
      floatProperties: { _CullMode: 1 },
    }, strict);
    expect(cull.errors[0]).toMatch(/front-face culling/);

    const blend = mapMtoonMaterial({
      shader: 'VRM/MToon',
      floatProperties: { _BlendMode: 7 },
    }, strict);
    expect(blend.errors[0]).toMatch(/blend mode/);
  });

  it('skips invalid values in lenient mode instead of failing the model', () => {
    const mapping = mapMtoonMaterial({
      shader: 'VRM/MToon',
      vectorProperties: { _Color: [2, 0, 0, 1], _MainTex: [0, 0, 2, 2] },
      floatProperties: { _BlendMode: 7, _CullMode: 1 },
      textureProperties: { _MainTex: 9 },
    }, lenient);
    expect(mapping.errors).toEqual([]);
    expect(mapping.patch).toEqual({});
  });
});
