import { describe, expect, it } from 'vitest';
import { readVrmHumanBones } from '../src/vrm-humanoid.ts';

describe('readVrmHumanBones', () => {
  it('reads VRM 0.x array bones', () => {
    const json = {
      extensions: {
        VRM: {
          humanoid: {
            humanBones: [
              { bone: 'hips', node: 0 },
              { bone: 'head', node: 1 },
            ],
          },
        },
      },
    };
    expect(readVrmHumanBones(json)).toEqual([
      { bone: 'hips', node: 0 },
      { bone: 'head', node: 1 },
    ]);
  });

  it('reads VRM 0.x object bones', () => {
    const json = {
      extensions: {
        VRM: {
          humanoid: {
            humanBones: {
              hips: { node: 3 },
              leftUpperArm: { node: 4 },
            },
          },
        },
      },
    };
    expect(readVrmHumanBones(json)).toEqual([
      { bone: 'hips', node: 3 },
      { bone: 'leftUpperArm', node: 4 },
    ]);
  });

  it('reads VRM 1.0 object bones', () => {
    const json = {
      extensions: {
        VRMC_vrm: {
          humanoid: {
            humanBones: {
              hips: { node: 0 },
              leftUpperLeg: { node: 7 },
            },
          },
        },
      },
    };
    expect(readVrmHumanBones(json)).toEqual([
      { bone: 'hips', node: 0 },
      { bone: 'leftUpperLeg', node: 7 },
    ]);
  });

  it('accepts a bare VRM extension object', () => {
    const extension = {
      humanoid: { humanBones: [{ bone: 'neck', node: 2 }] },
    };
    expect(readVrmHumanBones(extension)).toEqual([{ bone: 'neck', node: 2 }]);
  });

  it('returns an empty list for malformed input', () => {
    expect(readVrmHumanBones(null)).toEqual([]);
    expect(readVrmHumanBones({})).toEqual([]);
    expect(readVrmHumanBones({ extensions: [] })).toEqual([]);
    expect(readVrmHumanBones({ extensions: { VRM: { humanoid: { humanBones: 'hips' } } } })).toEqual([]);
    expect(readVrmHumanBones({
      extensions: {
        VRM: {
          humanoid: {
            humanBones: [
              { bone: 'hips' },
              { node: 1 },
              { bone: 7, node: 2 },
              null,
              'hips',
            ],
          },
        },
      },
    })).toEqual([]);
  });

  it('drops only the invalid entries of an object table', () => {
    const json = {
      extensions: {
        VRMC_vrm: {
          humanoid: {
            humanBones: {
              hips: { node: 0 },
              head: { node: 'one' },
              neck: null,
            },
          },
        },
      },
    };
    expect(readVrmHumanBones(json)).toEqual([{ bone: 'hips', node: 0 }]);
  });
});
