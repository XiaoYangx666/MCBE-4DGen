import { SKIN_NAME_MAX_LENGTH } from '../../src/skin-pack-files.ts';

/** Validate the user-visible skin name before conversion. */
export function validateName(name: string) {
  if (!name.trim()) throw new Error('皮肤名称不能为空');
  if (name.trim().length > SKIN_NAME_MAX_LENGTH) throw new Error(`皮肤名称不能超过 ${SKIN_NAME_MAX_LENGTH} 个字符`);
}
