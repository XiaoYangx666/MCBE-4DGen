import type * as THREE from 'three';

/** Remember which materials were hidden by the source file itself. */
export function collectMaterialVisibility(root: THREE.Object3D): Map<THREE.Material, boolean> {
  const originals = new Map<THREE.Material, boolean>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (material && !originals.has(material)) originals.set(material, material.visible);
    }
  });
  return originals;
}

export function restoreMaterialVisibility(
  root: THREE.Object3D,
  originals: Map<THREE.Material, boolean>,
) {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (material) material.visible = originals.get(material) ?? true;
    }
  });
}

/**
 * Show only checked materials (or one soloed material) in the source preview.
 * Solo is ignored when its material is unchecked.
 */
export function applyMaterialVisibility(
  root: THREE.Object3D,
  soloKey: string | null,
  included: ReadonlySet<string>,
  originals: Map<THREE.Material, boolean>,
) {
  const solo = soloKey && included.has(soloKey) ? soloKey : null;
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (!material) continue;
      material.visible = solo
        ? material.uuid === solo
        : (originals.get(material) ?? true) && included.has(material.uuid);
    }
  });
}
