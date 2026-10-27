import { describe, expect, it } from 'vitest';
import {
  defaultModelCandidate,
  listModelCandidates,
  modelFileName,
  modelFormatOf,
} from '../src/model-candidates.ts';

describe('shared model candidates', () => {
  it('maps extensions to loader families', () => {
    expect(modelFormatOf('角色.GLB')).toBe('glb');
    expect(modelFormatOf('avatar.vrm')).toBe('glb');
    expect(modelFormatOf('models/body.gltf')).toBe('gltf');
    expect(modelFormatOf('body.pmx')).toBe('pmx');
    expect(modelFormatOf('body.pmd')).toBe('pmd');
    expect(modelFormatOf('body.png')).toBeNull();
    expect(modelFormatOf('no-extension')).toBeNull();
    expect(modelFormatOf('.glb')).toBeNull();
  });

  it('extracts the file name from an archive-relative path', () => {
    expect(modelFileName('models/char/body.glb')).toBe('body.glb');
    expect(modelFileName('models\\char\\body.glb')).toBe('body.glb');
    expect(modelFileName('body.glb')).toBe('body.glb');
  });

  it('ranks candidates by loader preference, then by path', () => {
    const candidates = listModelCandidates([
      { path: 'b.obj', bytes: 10 },
      { path: 'a.glb', bytes: 20 },
      { path: 'z.glb', bytes: 30 },
      { path: 'textures/skin.png' },
      { path: 'readme.txt' },
      { path: 'model.pmx', bytes: 40 },
    ]);
    expect(candidates.map((candidate) => candidate.path))
      .toEqual(['a.glb', 'z.glb', 'b.obj', 'model.pmx']);
    expect(candidates[0]?.bytes).toBe(20);
    expect(candidates[3]?.format).toBe('pmx');
  });

  it('prefers a character over obvious props when picking a default', () => {
    const candidates = listModelCandidates([
      { path: 'character.glb' },
      { path: 'weapon_sword.glb' },
    ]);
    expect(defaultModelCandidate(candidates)?.path).toBe('character.glb');

    const propsOnly = listModelCandidates([
      { path: 'weapon_sword.glb' },
      { path: '闭眼.glb' },
    ]);
    // Nothing looks like a character: fall back to the first ranked candidate.
    expect(defaultModelCandidate(propsOnly)?.path).toBe(propsOnly[0]?.path);
  });

  it('skips formats the caller cannot load', () => {
    const candidates = listModelCandidates([
      { path: 'body.pmd' },
      { path: 'body.glb' },
    ]);
    expect(defaultModelCandidate(candidates, ['pmd'])?.path).toBe('body.glb');
    expect(defaultModelCandidate(listModelCandidates([{ path: 'body.pmd' }]), ['pmd'])?.path)
      .toBe('body.pmd');
  });

  it('returns nothing for an empty archive', () => {
    expect(listModelCandidates([])).toEqual([]);
    expect(defaultModelCandidate([])).toBeUndefined();
  });
});
