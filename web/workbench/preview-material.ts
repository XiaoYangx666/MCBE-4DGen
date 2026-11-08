import type * as THREE from "three";
import { preparePreviewMaterial } from "../shared/preview-material.ts";

export { preparePreviewMaterial } from "../shared/preview-material.ts";

/**
 * Source GLBs need the workbench cutout policy so alpha-textured clothing
 * stays crisp. Exported poly_mesh materials are already configured with the
 * exported alpha semantics (`transparent` + `alphaTest: 0.01`); applying the
 * source policy again turns a 50%-alpha part such as 目影 into an opaque
 * alpha-tested cutout.
 */
export function prepareSourcePreviewMaterials(
  materials: readonly THREE.Material[],
  source: boolean,
): void {
  if (!source) return;
  for (const material of materials) preparePreviewMaterial(material);
}
