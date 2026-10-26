/** Validate the user-visible skin name before conversion. */
export function validateName(name: string) {
  if (!name.trim()) throw new Error('皮肤名称不能为空');
  if (name.trim().length > 128) throw new Error('皮肤名称不能超过 128 个字符');
}
