/**
 * 导入管线共用的资源路径规范化：统一分隔符、去掉 ./ 与前导斜杠。
 * 大小写语义因调用点而异，因此 lowerCase 需要显式开启。
 */
export function normalizePath(value: string, options?: { lowerCase?: boolean }): string {
  const path = value.replaceAll('\\', '/').replace(/^\.\//, '').replace(/^\/+/, '');
  return options?.lowerCase ? path.toLowerCase() : path;
}
