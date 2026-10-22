import * as THREE from "three";

/** Alpha-textured clothing needs depth-tested cutouts, not whole-mesh blending. */
export function preparePreviewMaterial(material: THREE.Material) {
  if (material.transparent && material.opacity >= 1) {
    material.transparent = false;
    material.alphaTest = Math.max(material.alphaTest, 0.5);
    material.depthWrite = true;
  } else if (material.transparent) {
    material.depthWrite = false;
  }
  material.needsUpdate = true;
  return material;
}
