import { describe, expect, it } from 'vitest';
import {
  fromServerTextureTarget,
  toServerTextureTarget,
} from '../web/shared/texture-target.ts';

describe('desktop texture target mapping', () => {
  it('maps UI labels to the API values the server validates', () => {
    expect(toServerTextureTarget('density')).toBe('texel-density');
    expect(toServerTextureTarget('retention')).toBe('texel-retention');
  });

  it('reads old and new saved values', () => {
    expect(fromServerTextureTarget('texel-density')).toBe('density');
    expect(fromServerTextureTarget('density')).toBe('density');
    expect(fromServerTextureTarget('texel-retention')).toBe('retention');
    expect(fromServerTextureTarget(undefined)).toBe('retention');
    expect(fromServerTextureTarget('legacy')).toBe('retention');
  });
});
