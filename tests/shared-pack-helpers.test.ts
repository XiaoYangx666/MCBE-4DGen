import { describe, expect, it } from 'vitest';
import { zipFileName } from '../web/shared/file-save.ts';
import { isPng, isUuid, pngDimensions } from '../src/skin-pack-files.ts';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set(PNG_SIGNATURE, 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(12, 0x49484452); // "IHDR"
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

describe('shared skin pack helpers', () => {
  it('derives a safe flat ZIP name for both shells', () => {
    expect(zipFileName('我的 4D 皮肤包')).toBe('我的 4D 皮肤包.zip');
    expect(zipFileName('a/b:c')).toBe('a-b-c.zip');
    expect(zipFileName('   ')).toBe('4d-skin.zip');
    expect(zipFileName('', 'game-skin-pack')).toBe('game-skin-pack.zip');
  });

  it('recognizes the PNG signature and reads IHDR dimensions', () => {
    const bytes = pngHeader(128, 64);
    expect(isPng(bytes)).toBe(true);
    expect(pngDimensions(bytes)).toEqual({ width: 128, height: 64 });
    expect(isPng(bytes.subarray(0, 23))).toBe(false);
    expect(pngDimensions(bytes.subarray(0, 23))).toBeNull();
  });

  it('accepts only canonical UUID strings', () => {
    expect(isUuid('33333333-3333-4333-8333-333333333333')).toBe(true);
    expect(isUuid('33333333-3333-4333-8333')).toBe(false);
    expect(isUuid(undefined)).toBe(false);
  });
});
