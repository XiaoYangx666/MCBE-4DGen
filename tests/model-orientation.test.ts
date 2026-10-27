import { describe, expect, it } from 'vitest';
import {
  defaultRotationYDegrees,
  MMD_DEFAULT_ROTATION_Y,
} from '../src/model-orientation.ts';

describe('shared model orientation', () => {
  it('turns MMD sources 180 degrees', () => {
    expect(MMD_DEFAULT_ROTATION_Y).toBe(180);
    expect(defaultRotationYDegrees(['腰', '左腕', '左手首'])).toBe(180);
  });

  it('keeps other rigs upright', () => {
    expect(defaultRotationYDegrees(['J_Bip_L_UpperArm', 'Hips'])).toBe(0);
    expect(defaultRotationYDegrees([])).toBe(0);
  });

  it('requires the exact MMD bone name', () => {
    expect(defaultRotationYDegrees(['左腕D', '左腕_2', 'leftUpperArm'])).toBe(0);
  });
});
