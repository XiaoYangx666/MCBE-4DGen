/**
 * 源模型默认朝向，桌面工作台与网页工作台共用。
 *
 * MMD 系（PMX/PMD）角色按 +Z 建模，Bedrock 皮肤朝 −Z，所以 MMD 来源默认
 * 绕 Y 轴转 180°。只按骨骼名判断，避免对非 MMD 模型做无依据的翻转。
 */

export const MMD_DEFAULT_ROTATION_Y = 180;

/** 出现 MMD 的「左腕」骨骼时返回 180°，否则保持 0°。 */
export function defaultRotationYDegrees(nodeNames: Iterable<string>): number {
  for (const name of nodeNames) if (name === '左腕') return MMD_DEFAULT_ROTATION_Y;
  return 0;
}
