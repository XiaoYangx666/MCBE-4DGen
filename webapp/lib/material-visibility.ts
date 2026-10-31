import type * as THREE from 'three';
import { stableMaterialKeyMap } from '../engine/extract';

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
  const keys = stableMaterialKeyMap(root);
  const keyOf = (material: THREE.Material) =>
    keys.get(material.uuid) ?? material.uuid;
  const solo = soloKey && included.has(soloKey) ? soloKey : null;
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (!material) continue;
      const kept = included.has(keyOf(material)) || included.has(material.uuid);
      material.visible = solo
        ? keyOf(material) === solo || material.uuid === solo
        : (originals.get(material) ?? true) && kept;
    }
  });
}
