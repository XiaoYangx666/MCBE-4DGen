import type { Vec3 } from './types.ts';

/**
 * 抽取与导出共用的三角面几何：退化判断必须使用同一份算术和阈值，
 * 否则两端会对同一批三角面给出不同的跳过数量。
 */

/** 叉积长度低于 1e-9 视为退化三角面。 */
export function isDegenerateTriangle(a: Vec3, b: Vec3, c: Vec3): boolean {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const x = uy * vz - uz * vy;
  const y = uz * vx - ux * vz;
  const z = ux * vy - uy * vx;
  return Math.hypot(x, y, z) < 1e-9;
}
