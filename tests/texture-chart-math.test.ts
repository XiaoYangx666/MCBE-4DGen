import { describe, expect, it } from 'vitest';
import {
  MAX_TILE_SPAN,
  buildUvCharts,
  mergeUvCharts,
  normalizeWrapMode,
  sampleWrappedRgba,
  splitUvIslands,
  unwrapChartBounds,
  wrapIndex,
} from '../src/texture-chart-math.ts';

const triangle = (...values: number[]) => values;

describe('shared texture chart math', () => {
  it('splits disconnected UV triangles into islands', () => {
    const uvs = new Float32Array([
      ...triangle(0, 0, 0.1, 0, 0, 0.1),
      ...triangle(0.8, 0.8, 0.9, 0.8, 0.8, 0.9),
    ]);
    const charts = splitUvIslands(uvs);
    expect(charts).toHaveLength(2);
    expect(charts[0]!.triangles).toEqual([0]);
    expect(charts[1]!.triangles).toEqual([1]);
  });

  it('joins triangles that share a UV corner', () => {
    const uvs = new Float32Array([
      ...triangle(0, 0, 1, 0, 0, 1),
      ...triangle(1, 0, 1, 1, 0, 1),
    ]);
    const charts = splitUvIslands(uvs);
    expect(charts).toHaveLength(1);
    expect(charts[0]!.triangles).toEqual([0, 1]);
    expect(charts[0]!.minU).toBe(0);
    expect(charts[0]!.maxU).toBe(1);
  });

  it('matches UV corners with an epsilon instead of exact floats', () => {
    const uvs = new Float32Array([
      ...triangle(0, 0, 1, 0, 0, 1),
      ...triangle(1 + 1e-9, 1e-9, 1, 1, 0, 1),
    ]);
    expect(splitUvIslands(uvs)).toHaveLength(1);
  });

  it('merges nearby same-material charts when the box barely grows', () => {
    const uvs = new Float32Array([
      ...triangle(0, 0, 0.1, 0, 0, 0.1),
      ...triangle(0.101, 0, 0.201, 0, 0.101, 0.1),
    ]);
    expect(splitUvIslands(uvs)).toHaveLength(2);
    const merged = mergeUvCharts(splitUvIslands(uvs));
    expect(merged).toHaveLength(1);
    expect(merged[0]!.triangles).toEqual([0, 1]);
  });

  it('does not merge distant charts', () => {
    const uvs = new Float32Array([
      ...triangle(0, 0, 0.1, 0, 0, 0.1),
      ...triangle(0.8, 0.8, 0.9, 0.8, 0.8, 0.9),
    ]);
    expect(mergeUvCharts(splitUvIslands(uvs))).toHaveLength(2);
  });

  it('only merges different materials when their UV areas already overlap', () => {
    const uvs = new Float32Array([
      ...triangle(0, 0, 0.1, 0, 0, 0.1),
      ...triangle(0.11, 0, 0.21, 0, 0.11, 0.1),
    ]);
    const charts = splitUvIslands(uvs);
    expect(mergeUvCharts(charts, {})).toHaveLength(1);
    const different = [
      { ...charts[0]!, materials: ['face'] },
      { ...charts[1]!, materials: ['lash'] },
    ];
    expect(mergeUvCharts(different)).toHaveLength(2);
  });

  it('keeps negative and out-of-range bounds instead of clamping', () => {
    const unwrapped = unwrapChartBounds(-0.25, -0.25, 0.25, 0.25);
    expect(unwrapped.bounds).toEqual([-0.25, -0.25, 0.25, 0.25]);
    expect(unwrapped.min).toEqual([-1, -1]);
    expect(unwrapped.tiles).toEqual([2, 2]);
    expect(unwrapped.exceedsTileSpan).toBe(false);

    const seam = unwrapChartBounds(-2, 0, 0.5, 1);
    expect(seam.min).toEqual([-2, 0]);
    expect(seam.span).toEqual([3, 1]);
  });

  it('caps the tile span at 16', () => {
    const wide = unwrapChartBounds(0, 0, 17, 1);
    expect(wide.span[0]).toBe(17);
    expect(wide.tiles[0]).toBe(MAX_TILE_SPAN);
    expect(wide.exceedsTileSpan).toBe(true);
  });

  it('normalizes glTF and three.js wrap codes', () => {
    expect(normalizeWrapMode(10497)).toBe('repeat');
    expect(normalizeWrapMode(1000)).toBe('repeat');
    expect(normalizeWrapMode(33071)).toBe('clamp');
    expect(normalizeWrapMode(1001)).toBe('clamp');
    expect(normalizeWrapMode(33648)).toBe('mirror');
    expect(normalizeWrapMode(1002)).toBe('mirror');
    expect(normalizeWrapMode(undefined)).toBe('repeat');
  });

  it('wraps texel indices for repeat, clamp and mirror', () => {
    expect([-1, 0, 1, 2, 3].map((i) => wrapIndex(i, 2, 'repeat'))).toEqual([1, 0, 1, 0, 1]);
    expect([-1, 0, 1, 2, 3].map((i) => wrapIndex(i, 2, 'clamp'))).toEqual([0, 0, 1, 1, 1]);
    expect([-1, 0, 1, 2, 3, 4].map((i) => wrapIndex(i, 2, 'mirror'))).toEqual([0, 0, 1, 1, 0, 0]);
  });

  it('samples negative UVs with repeat, clamp and mirror', () => {
    // 2×2: top row green/red, bottom row blue/yellow.
    const pixels = new Uint8ClampedArray([
      0, 255, 0, 255, 255, 0, 0, 255,
      0, 0, 255, 255, 255, 255, 0, 255,
    ]);
    const out = [0, 0, 0, 0];
    // u=-0.25 → x=-1: repeat reads the right texel, clamp/mirror read the left one.
    sampleWrappedRgba(pixels, 2, 2, -0.25, 0.25, 'repeat', 'clamp', out);
    expect(out).toEqual([255, 0, 0, 255]);
    sampleWrappedRgba(pixels, 2, 2, -0.25, 0.25, 'clamp', 'clamp', out);
    expect(out).toEqual([0, 255, 0, 255]);
    sampleWrappedRgba(pixels, 2, 2, -0.25, 0.25, 'mirror', 'clamp', out);
    expect(out).toEqual([0, 255, 0, 255]);
    // u=1.75 → x=3: mirror flips back to the left texel, repeat/clamp use the right one.
    sampleWrappedRgba(pixels, 2, 2, 1.75, 0.25, 'mirror', 'clamp', out);
    expect(out).toEqual([0, 255, 0, 255]);
    sampleWrappedRgba(pixels, 2, 2, 1.75, 0.25, 'repeat', 'clamp', out);
    expect(out).toEqual([255, 0, 0, 255]);
    sampleWrappedRgba(pixels, 2, 2, 1.75, 0.25, 'clamp', 'clamp', out);
    expect(out).toEqual([255, 0, 0, 255]);
  });

  it('blends with premultiplied alpha so transparent texels do not bleed', () => {
    const pixels = new Uint8ClampedArray([
      0, 255, 0, 0, 255, 0, 0, 255,
    ]);
    const out = [0, 0, 0, 0];
    // x=0.5 between a transparent green texel and an opaque red one.
    sampleWrappedRgba(pixels, 2, 1, 0.5, 0.5, 'clamp', 'clamp', out);
    expect(out[0]).toBe(255);
    expect(out[1]).toBe(0);
    expect(out[3]).toBe(128);
  });

  it('buildUvCharts applies split and merge together', () => {
    const uvs = new Float32Array([
      ...triangle(0, 0, 0.1, 0, 0, 0.1),
      ...triangle(0.101, 0, 0.201, 0, 0.101, 0.1),
      ...triangle(0.8, 0.8, 0.9, 0.8, 0.8, 0.9),
    ]);
    const charts = buildUvCharts(uvs);
    expect(charts).toHaveLength(2);
    expect(charts[0]!.triangles).toEqual([0, 1]);
    expect(charts[1]!.triangles).toEqual([2]);
  });
});
