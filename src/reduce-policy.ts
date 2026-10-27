/**
 * meshoptimizer 减面策略，由 Node 刚性减面和浏览器按材质减面共用。
 *
 * 只共享「权重、简化选项、参数是否合法」这类会悄悄漂移的策略；顶点数据的
 * 组织方式两端不同（glTF accessor vs 三角面汤），目标面数的取整历史上也
 * 不同（Node 用 floor，浏览器用 round），都留在各自调用点。
 */

/** POSITION / NORMAL / UV0 的属性权重；UV 缺失时调用方把后两维清零。 */
export const REDUCE_ATTRIBUTE_WEIGHTS = [0.25, 0.25, 0.25, 1, 1] as const;

/** 允许边界收缩的简化选项，与桌面工作台的默认行为一致。 */
export const REDUCE_SIMPLIFY_OPTIONS = ['Permissive'] as const;

export const isValidReduceRatio = (ratio: number): boolean =>
  Number.isFinite(ratio) && ratio > 0 && ratio <= 1;

export const isValidReduceMaxError = (maxError: number): boolean =>
  Number.isFinite(maxError) && maxError >= 0;
