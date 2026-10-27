/**
 * PMX material policy shared by the Node importer and the browser pipeline.
 *
 * Assimp drops the PMX double-sided draw flag and flattens diffuse alpha, so
 * both pipelines restore the source material table after conversion. Only the
 * application step differs: the Node side rewrites glTF JSON, the browser side
 * updates three.js materials.
 */

export interface PmxMaterialSource {
  name: string;
  /** PMX diffuse alpha, 0..1. */
  alpha: number;
  /** PMX draw flag bit 0. */
  doubleSided: boolean;
}

export interface PmxMaterialPlan {
  name: string;
  alpha: number;
  doubleSided: boolean;
  /** PMX has no glTF OPAQUE/MASK switch, so converted materials stay blended. */
  alphaMode: 'BLEND';
}

export const PMX_MATERIAL_MISMATCH =
  'PMX 材质数量与转换结果不一致，无法还原材质名、透明度与双面标记。';

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/**
 * Map the PMX material table onto converted materials by index.
 * Returns null when the counts differ, so each pipeline can decide whether a
 * mismatch is fatal (Node import) or a warning (browser import).
 */
export function planPmxMaterials(
  materials: readonly PmxMaterialSource[],
  convertedCount: number,
): PmxMaterialPlan[] | null {
  if (materials.length !== convertedCount) return null;
  return materials.map((material) => ({
    name: material.name,
    alpha: clamp01(material.alpha),
    doubleSided: !!material.doubleSided,
    alphaMode: 'BLEND' as const,
  }));
}
