import * as THREE from 'three';
import type { PartSummary } from '../../src/api-types.ts';

export interface PartMeshState {
  mesh: THREE.Mesh;
  /** Original draw groups, restored whenever all groups are kept. */
  groups: { start: number; count: number; materialIndex: number }[];
  /** Part for each draw group, when the mesh participates in part filtering. */
  partByGroup: Map<number, PartSummary>;
}

/**
 * Build a best-effort mapping from desktop part ids to the preview scene.
 *
 * Parts use the document's scene traversal order (`nodeIndex`), which is also
 * what `prepareStaticModel` uses. The preview GLB keeps the same node/primitive
 * structure, so mesh ordinals and group indices line up. Meshes without part
 * metadata are left untouched.
 */
export function collectPartMeshes(
  scene: THREE.Object3D,
  parts: readonly PartSummary[],
): PartMeshState[] {
  const byNode = new Map<string, PartSummary[]>();
  for (const part of parts) {
    const list = byNode.get(part.node) ?? [];
    list.push(part);
    byNode.set(part.node, list);
  }
  const states: PartMeshState[] = [];
  const visited = new Set<THREE.Object3D>();

  const addMesh = (
    mesh: THREE.Mesh,
    nodeParts: readonly PartSummary[],
    childIndex: number,
  ) => {
    if (!nodeParts.length) return;
    const geometry = mesh.geometry as THREE.BufferGeometry;
    const index = geometry.getIndex();
    const count = index ? index.count : geometry.getAttribute('position')?.count ?? 0;
    const groups =
      Array.isArray(mesh.material) && geometry.groups.length
        ? geometry.groups.map((group) => ({
            start: group.start,
            count: group.count,
            materialIndex: group.materialIndex ?? 0,
          }))
        : [{ start: 0, count, materialIndex: 0 }];
    const partByGroup = new Map<number, PartSummary>();
    const instance = nodeParts.find((part) => part.instancePart);
    groups.forEach((_, groupIndex) => {
      const part =
        instance ??
        nodeParts.find(
          (entry) =>
            !entry.instancePart &&
            entry.primitive === (groups.length > 1 ? groupIndex : childIndex),
        ) ??
        nodeParts[0];
      if (part) partByGroup.set(groupIndex, part);
    });
    if (!partByGroup.size) return;
    states.push({ mesh, groups, partByGroup });
  };

  scene.traverseVisible((object) => {
    if (visited.has(object)) return;
    const sourceName =
      object.userData.sourceName ??
      object.parent?.userData.sourceName ??
      object.name;
    const nodeParts = byNode.get(sourceName) ?? [];
    if (!nodeParts.length) return;

    // GLTFLoader represents a multi-primitive mesh as a Group with one child
    // Mesh per primitive. Same-named node ownership then maps by child order.
    const childMeshes = object.children.filter(
      (child): child is THREE.Mesh =>
        (child as THREE.Mesh).isMesh && !visited.has(child),
    );
    if (!(object instanceof THREE.Mesh) && childMeshes.length) {
      childMeshes.forEach((child, index) => {
        visited.add(child);
        addMesh(child, nodeParts, index);
      });
      return;
    }
    if (object instanceof THREE.Mesh) {
      visited.add(object);
      addMesh(object, nodeParts, 0);
    }
  });
  return states;
}

/**
 * Filter one mesh's draw groups. Returns false when every part is hidden.
 * Unknown groups without part metadata stay visible.
 */
export function applyPartMeshState(
  state: PartMeshState,
  keep: (partId: string) => boolean,
): boolean {
  const kept = state.groups.filter((_, groupIndex) => {
    const part = state.partByGroup.get(groupIndex);
    return !part || keep(part.id);
  });
  const geometry = state.mesh.geometry as THREE.BufferGeometry;
  if (kept.length === state.groups.length) {
    geometry.clearGroups();
    for (const group of state.groups)
      geometry.addGroup(group.start, group.count, group.materialIndex);
    return true;
  }
  geometry.clearGroups();
  for (const group of kept)
    geometry.addGroup(group.start, group.count, group.materialIndex);
  return kept.length > 0;
}
