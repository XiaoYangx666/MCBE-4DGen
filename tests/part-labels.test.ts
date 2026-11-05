import { describe, expect, it } from 'vitest';
import {
  partDisplayNames,
  partGroupNames,
  readablePartName,
} from '../web/shared/part-labels.ts';

describe('part labels', () => {
  it('keeps meaningful mesh names', () => {
    expect(
      partDisplayNames([
        { name: 'body', mesh: 'body', material: '皮肤' },
        { name: 'hair', mesh: 'hair', material: '头发' },
      ]),
    ).toEqual(['body', 'hair']);
  });

  it('falls back to numbered labels for engine placeholders', () => {
    expect(readablePartName(['mesh0'], 2)).toBe('部件 3');
    expect(
      partDisplayNames([
        { name: 'mesh0', mesh: 'mesh0', material: '材质 1' },
        { name: 'mesh1', mesh: 'mesh1', material: '材质 1' },
      ]),
    ).toEqual(['部件 1', '部件 2']);
  });

  it('uses material names for generated mesh splits', () => {
    const parts = ['舌_1', '舌_2', '舌_3'].map((mesh, index) => ({
      name: mesh,
      mesh,
      material: ['舌', '舌根', '口腔'][index]!,
    }));
    expect(partDisplayNames(parts)).toEqual(['舌', '舌根', '口腔']);
    expect(partGroupNames(parts)).toEqual(['舌', '舌', '舌']);
  });

  it('uses material names when one mesh owns several parts', () => {
    const parts = [
      { name: 'body#0', mesh: 'body', material: '皮肤' },
      { name: 'body#1', mesh: 'body', material: '衣服' },
    ];
    expect(partDisplayNames(parts)).toEqual(['皮肤', '衣服']);
    expect(partGroupNames(parts)).toEqual(['body', 'body']);
  });

  it('disambiguates repeated display names', () => {
    expect(
      partDisplayNames([
        { name: '舌_1', mesh: '舌_1', material: '舌' },
        { name: '舌_2', mesh: '舌_2', material: '舌' },
      ]),
    ).toEqual(['舌 #1', '舌 #2']);
  });
});
