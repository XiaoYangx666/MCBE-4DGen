import { describe, expect, it } from 'vitest';
import { humanoidAliases } from '../src/humanoid-roles.ts';

/**
 * 桌面 autoProfile 的历史别名集合：只含 MMD 名与规范角色名。
 * 共享表统一存小写，桌面端比较时也会 toLowerCase()。
 */
const DESKTOP_ALIASES: Record<string, readonly string[]> = {
  hips: ['腰', '下半身', 'hips'],
  head: ['頭', '头', 'head'],
  neck: ['首', 'neck'],
  leftUpperArm: ['左腕', '左臂', 'leftupperarm'],
  rightUpperArm: ['右腕', '右臂', 'rightupperarm'],
  leftHand: ['左手首', '左手腕', 'lefthand'],
  rightHand: ['右手首', '右手腕', 'righthand'],
  leftUpperLeg: ['左足d', '左足', 'leftupperleg'],
  rightUpperLeg: ['右足d', '右足', 'rightupperleg'],
};

/** 网页端全量顺序：匹配按顺序取第一个唯一命中，重排会改变结果。 */
const WEB_ALIASES: Record<string, readonly string[]> = {
  hips: ['腰', '下半身', 'hips', 'pelvis', 'jbipchips'],
  head: ['頭', '头', 'head', 'jbipchead'],
  neck: ['首', 'neck', 'jbipcneck'],
  leftUpperArm: [
    '左腕', '左臂', 'leftupperarm', 'leftarm', 'mixamorigleftarm',
    'upperarml', 'larm', 'lupperarm', 'jbiplupperarm',
  ],
  rightUpperArm: [
    '右腕', '右臂', 'rightupperarm', 'rightarm', 'mixamorigrightarm',
    'upperarmr', 'rarm', 'rupperarm', 'jbiprupperarm',
  ],
  leftHand: ['左手首', '左手腕', 'lefthand', 'mixamoriglefthand', 'handl', 'lhand', 'jbiplhand'],
  rightHand: ['右手首', '右手腕', 'righthand', 'mixamorigrighthand', 'handr', 'rhand', 'jbiprhand'],
  leftUpperLeg: [
    '左足d', '左足', '左太もも', 'leftupperleg', 'leftupleg',
    'mixamorigleftupleg', 'thighl', 'lupperleg', 'jbiplupperleg',
  ],
  rightUpperLeg: [
    '右足d', '右足', '右太もも', 'rightupperleg', 'rightupleg',
    'mixamorigrightupleg', 'thighr', 'rupperleg', 'jbiprupperleg',
  ],
};

describe('shared humanoid role aliases', () => {
  it('reproduces the desktop MMD/generic subset exactly', () => {
    for (const [role, names] of Object.entries(DESKTOP_ALIASES))
      expect(humanoidAliases(role, ['mmd', 'generic'])).toEqual([...names]);
  });

  it('keeps the browser full list, including its match order', () => {
    for (const [role, names] of Object.entries(WEB_ALIASES))
      expect(humanoidAliases(role)).toEqual([...names]);
    expect(humanoidAliases('leftUpperArm')).toContain('mixamorigleftarm');
    expect(humanoidAliases('hips')).toContain('jbipchips');
    expect(humanoidAliases('leftUpperLeg')).toContain('左足d');
  });

  it('returns no aliases for unknown roles', () => {
    expect(humanoidAliases('spine')).toEqual([]);
    expect(humanoidAliases('spine', ['mmd'])).toEqual([]);
  });
});
