import { describe, expect, it } from 'vitest';
import {
  normalizeSelection,
  selectionFingerprint,
  type MaterialIdentity,
  type PartIdentity,
} from '../src/selection.ts';

const materials: MaterialIdentity[] = [
  { key: 'm:Body#1', name: 'Body', triangles: 12 },
  { key: 'm:Body#2', name: 'Body', triangles: 3 },
  { key: 'm:Face#1', name: 'Face', triangles: 5 },
];
const parts: PartIdentity[] = [
  { id: 'p0.0', name: 'body#0' },
  { id: 'p0.1', name: 'body#1' },
  { id: 'p0.2', name: 'face' },
];

describe('selection identity', () => {
  it('keeps duplicate material names distinct by key', () => {
    const selection = normalizeSelection(materials, parts, {
      excluded: ['m:Body#2'],
      materialWeights: { 'm:Body#1': 2, 'm:Body#2': 0.5 },
      includedParts: ['p0.0', 'p0.2'],
    });
    expect(selection.excluded).toEqual(['m:Body#2']);
    expect(selection.materialWeights).toEqual({ 'm:Body#1': 2, 'm:Body#2': 0.5 });
    expect(selection.includedParts).toEqual(['p0.0', 'p0.2']);
    expect(selection.unmatched).toEqual([]);
  });

  it('migrates unique legacy names but never guesses an ambiguous one', () => {
    const selection = normalizeSelection(materials, parts, {
      excluded: ['Face'],
      materialWeights: { Face: 3, Body: 4 },
    });
    expect(selection.excluded).toEqual(['m:Face#1']);
    expect(selection.materialWeights).toEqual({ 'm:Face#1': 3 });
    expect(selection.migrated).toEqual([{ from: 'Face', to: 'm:Face#1' }]);
    expect(selection.unmatched).toContain('Body');
  });

  it('drops unknown keys and clamps out-of-range weights', () => {
    const selection = normalizeSelection(materials, parts, {
      excluded: ['m:Gone#1'],
      materialWeights: { 'm:Body#1': -4, 'm:Body#2': 99 },
    });
    expect(selection.excluded).toEqual([]);
    expect(selection.materialWeights).toEqual({ 'm:Body#1': 0, 'm:Body#2': 20 });
    expect(selection.unmatched).toContain('m:Gone#1');
  });

  it('resets materially when the saved structure fingerprint differs', () => {
    const selection = normalizeSelection(materials, parts, {
      fingerprint: 'v1:deadbeef:9',
      excluded: ['m:Body#1'],
      materialWeights: { 'm:Body#1': 4 },
      includedParts: ['p0.0'],
    });
    expect(selection.structureChanged).toBe(true);
    expect(selection.excluded).toEqual([]);
    expect(selection.materialWeights).toEqual({});
    expect(selection.includedParts).toBeNull();
  });

  it('produces the same fingerprint for the same structure regardless of order', () => {
    expect(selectionFingerprint(materials, parts)).toBe(
      selectionFingerprint([...materials].reverse(), [...parts].reverse()),
    );
    expect(selectionFingerprint(materials, parts)).not.toBe(
      selectionFingerprint(materials.slice(0, 2), parts),
    );
  });
});
