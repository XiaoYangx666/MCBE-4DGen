import * as THREE from 'three';

interface PartEntry {
  mesh: THREE.Mesh;
  group: number;
  multi: boolean;
}

interface SavedMesh {
  mesh: THREE.Mesh;
  groups: { start: number; count: number; materialIndex: number }[];
  visible: boolean;
}

/**
 * Best-effort part visibility for the source preview.
 *
 * Extraction walks visible meshes and material groups in scene order; the same
 * walk builds a part-id -> { mesh, group } table here. Hiding a part then edits
 * only that mesh's draw groups, so shared materials and other groups survive.
 * `restore()` must run before an extraction that feeds conversion.
 */
export function createPartPreview(scene: THREE.Object3D) {
  const saved = new Map<string, SavedMesh>();
  const entries = new Map<string, PartEntry>();
  let meshIndex = 0;
  scene.traverseVisible((object) => {
    const mesh = object as THREE.Mesh;
    if (!(mesh as unknown as { isMesh?: boolean }).isMesh || !mesh.geometry) return;
    const geometry = mesh.geometry as THREE.BufferGeometry;
    const index = geometry.getIndex();
    const count = index ? index.count : geometry.getAttribute('position')?.count ?? 0;
    const groups =
      Array.isArray(mesh.material) && geometry.groups.length
        ? [...geometry.groups]
        : [{ start: 0, count, materialIndex: 0 as number }];
    saved.set(mesh.uuid, {
      mesh,
      groups: groups.map((group) => ({
        start: group.start,
        count: group.count,
        materialIndex: group.materialIndex ?? 0,
      })),
      visible: mesh.visible,
    });
    groups.forEach((_, groupIndex) => {
      entries.set(`w${meshIndex}.${groupIndex}`, {
        mesh,
        group: groupIndex,
        multi: groups.length > 1,
      });
    });
    meshIndex++;
  });

  const restore = () => {
    for (const state of saved.values()) {
      const geometry = state.mesh.geometry as THREE.BufferGeometry;
      geometry.clearGroups();
      for (const group of state.groups) geometry.addGroup(group.start, group.count, group.materialIndex);
      state.mesh.visible = state.visible;
    }
  };

  const apply = (visible: ReadonlySet<string> | null, selected: string | null) => {
    restore();
    const keep = (id: string) => selected ? id === selected : !visible || visible.has(id);
    const byMesh = new Map<string, Set<number>>();
    for (const [id, entry] of entries) {
      if (!keep(id)) continue;
      const set = byMesh.get(entry.mesh.uuid) ?? new Set<number>();
      set.add(entry.group);
      byMesh.set(entry.mesh.uuid, set);
    }
    for (const state of saved.values()) {
      const kept = byMesh.get(state.mesh.uuid);
      if (!kept || kept.size === 0) {
        state.mesh.visible = false;
        continue;
      }
      if (kept.size === state.groups.length) continue;
      const geometry = state.mesh.geometry as THREE.BufferGeometry;
      geometry.clearGroups();
      for (const [groupIndex, group] of state.groups.entries())
        if (kept.has(groupIndex)) geometry.addGroup(group.start, group.count, group.materialIndex);
    }
  };

  return {
    apply,
    restore,
    /** Part ids that actually own a draw group. */
    partIds: () => [...entries.keys()],
  };
}
