/**
 * Part identity for the texture pipeline.
 *
 * A "part" is the smallest unit a user can keep or drop without touching other
 * geometry. In this corpus that is either:
 *
 * - a **primitive** (PMX-derived models: one mesh, 19–46 primitives), or
 * - a **node instance** when the same mesh is instanced by several nodes,
 *   because a primitive cannot be removed from one instance only.
 *
 * Parts are stored in primitive/node `extras` so they survive `prepareModel`
 * (which copies primitive extras and rebuilds one mesh per node instance) and
 * mesh reduction (which keeps primitives). Nothing here decides which part
 * matters: the caller passes the keep set.
 */
import type { Document, Material, Mesh, Node, Primitive } from '@gltf-transform/core';

export const PART_EXTRA = '_fourdgenPart';

export interface PartExtra {
  id: string;
  name: string;
  materialKey?: string;
}

export interface PartInfo {
  id: string;
  name: string;
  /** Index into the document's mesh-instance nodes (nodes with a mesh). */
  nodeIndex: number;
  node: string;
  mesh: string;
  /** Primitive index, or -1 for a whole instanced node. */
  primitive: number;
  materialKey: string;
  materialName: string;
  triangles: number;
  vertices: number;
  /** True when the part represents an instanced node rather than one primitive. */
  instancePart: boolean;
}

export function readPartExtra(record: Record<string, unknown>): PartExtra | null {
  const value = record[PART_EXTRA];
  if (!value || typeof value !== 'object') return null;
  const part = value as Partial<PartExtra>;
  return typeof part.id === 'string' && typeof part.name === 'string'
    ? { id: part.id, name: part.name, ...(typeof part.materialKey === 'string' ? { materialKey: part.materialKey } : {}) }
    : null;
}

/** Stable material identity for one document; distinguishes duplicate names. */
export function materialKeyMap(document: Document): Map<Material, string> {
  const keys = new Map<Material, string>();
  const seen = new Map<string, number>();
  for (const material of document.getRoot().listMaterials()) {
    const name = material.getName() || '(default)';
    const index = (seen.get(name) ?? 0) + 1;
    seen.set(name, index);
    keys.set(material, `m:${name}#${index}`);
  }
  return keys;
}

const trianglesOf = (primitive: Primitive): number => {
  const indices = primitive.getIndices();
  if (indices) return Math.floor(indices.getCount() / 3);
  const position = primitive.getAttribute('POSITION');
  return position ? Math.floor(position.getCount() / 3) : 0;
};

const meshInstances = (document: Document): Map<Mesh, number> => {
  const counts = new Map<Mesh, number>();
  for (const node of document.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (mesh) counts.set(mesh, (counts.get(mesh) ?? 0) + 1);
  }
  return counts;
};

/** Detach a node from its Scene/Node parent without assuming a parent type. */
const detachNode = (node: Node) => {
  const parent = node.listParents().find(
    (candidate) =>
      typeof (candidate as unknown as { removeChild?: unknown }).removeChild ===
      'function',
  ) as unknown as { removeChild(child: Node): void } | undefined;
  parent?.removeChild(node);
};

/** Mesh-instance nodes in document order; `PartInfo.nodeIndex` indexes this. */
export function instanceNodes(document: Document): Node[] {
  return document.getRoot().listNodes().filter((node) => !!node.getMesh());
}

/**
 * Assign (or read back) deterministic part ids. Returns the parts in document
 * order. Calling it twice yields the same ids.
 */
export function assignParts(document: Document): PartInfo[] {
  const nodes = instanceNodes(document);
  const instances = meshInstances(document);
  const keys = materialKeyMap(document);
  const fallbackKey = 'm:(default)#0';
  const parts: PartInfo[] = [];

  nodes.forEach((node, nodeIndex) => {
    const mesh = node.getMesh()!;
    const nodeName = node.getName() || `node${nodeIndex}`;
    const instancePart = (instances.get(mesh) ?? 0) > 1;
    const primitives = mesh.listPrimitives();

    if (instancePart) {
      const existing = readPartExtra(node.getExtras());
      const id = existing?.id ?? `n${nodeIndex}`;
      node.setExtras({
        ...node.getExtras(),
        [PART_EXTRA]: { id, name: existing?.name ?? nodeName },
      });
      let triangles = 0;
      let vertices = 0;
      let materialKey = fallbackKey;
      let materialName = '(default)';
      for (const primitive of primitives) {
        triangles += trianglesOf(primitive);
        vertices += primitive.getAttribute('POSITION')?.getCount() ?? 0;
        const material = primitive.getMaterial();
        if (material) {
          materialKey = keys.get(material) ?? fallbackKey;
          materialName = material.getName() || materialName;
        }
      }
      parts.push({
        id,
        name: nodeName,
        nodeIndex,
        node: nodeName,
        mesh: mesh.getName() || '(mesh)',
        primitive: -1,
        materialKey,
        materialName,
        triangles,
        vertices,
        instancePart: true,
      });
      return;
    }

    primitives.forEach((primitive, primitiveIndex) => {
      const existing = readPartExtra(primitive.getExtras());
      const id = existing?.id ?? `p${nodeIndex}.${primitiveIndex}`;
      const derivedName =
        primitives.length > 1 ? `${nodeName}#${primitiveIndex}` : nodeName;
      const name = existing?.name ?? derivedName;
      const material = primitive.getMaterial();
      const materialKey = material ? (keys.get(material) ?? fallbackKey) : fallbackKey;
      primitive.setExtras({
        ...primitive.getExtras(),
        [PART_EXTRA]: {
          id,
          name,
          materialKey: existing?.materialKey ?? materialKey,
        },
      });
      parts.push({
        id,
        name,
        nodeIndex,
        node: nodeName,
        mesh: mesh.getName() || '(mesh)',
        primitive: primitiveIndex,
        materialKey,
        materialName: material?.getName() || '(default)',
        triangles: trianglesOf(primitive),
        vertices: primitive.getAttribute('POSITION')?.getCount() ?? 0,
        instancePart: false,
      });
    });
  });
  return parts;
}

export function listParts(document: Document): PartInfo[] {
  return assignParts(document);
}

export interface FilterReport {
  kept: PartInfo[];
  removed: PartInfo[];
  removedTriangles: number;
  removedMeshes: number;
  removedNodes: number;
}

/**
 * Remove every part not in `keep`. Shared materials are untouched: only the
 * geometry of the dropped part is disposed, so other parts using the same
 * material keep working.
 */
export function filterParts(
  document: Document,
  keep: ReadonlySet<string>,
): FilterReport {
  const parts = assignParts(document);
  const nodes = instanceNodes(document);
  const removed: PartInfo[] = [];
  let removedMeshes = 0;

  for (const part of parts) {
    if (keep.has(part.id)) continue;
    removed.push(part);
    const node = nodes[part.nodeIndex];
    if (!node) continue;
    if (part.instancePart) {
      detachNode(node);
      node.dispose();
      continue;
    }
    const mesh = node.getMesh();
    const primitive = mesh?.listPrimitives()[part.primitive];
    if (!primitive) continue;
    mesh!.removePrimitive(primitive);
    primitive.dispose();
    if (mesh && mesh.listPrimitives().length === 0) {
      detachNode(node);
      node.dispose();
      mesh.dispose();
      removedMeshes++;
    }
  }

  return {
    kept: parts.filter((part) => keep.has(part.id)),
    removed,
    removedTriangles: removed.reduce((sum, part) => sum + part.triangles, 0),
    removedMeshes,
    removedNodes: 0,
  };
}

/** Per-part world/UV demand, used to report reclaimed texture budget. */
export interface PartDemand {
  part: PartInfo;
  triangles: number;
  worldArea: number;
  uvArea: number;
}

export function partDemands(document: Document): PartDemand[] {
  const parts = assignParts(document);
  const nodes = instanceNodes(document);
  return parts.map((part) => {
    let worldArea = 0;
    let uvArea = 0;
    let triangles = 0;
    const node = nodes[part.nodeIndex];
    const mesh = node?.getMesh();
    if (!node || !mesh) return { part, triangles: 0, worldArea: 0, uvArea: 0 };
    const matrix = node.getWorldMatrix();
    mesh.listPrimitives().forEach((primitive, primitiveIndex) => {
      if (!part.instancePart && primitiveIndex !== part.primitive) return;
      const position = primitive.getAttribute('POSITION');
      if (!position) return;
      const indices =
        primitive.getIndices()?.getArray() ??
        Uint32Array.from({ length: position.getCount() }, (_, index) => index);
      const count = Math.floor(indices.length / 3);
      triangles += count;
      const world = new Float32Array(position.getCount() * 3);
      const value: number[] = [];
      for (let i = 0; i < position.getCount(); i++) {
        position.getElement(i, value);
        world[i * 3] = matrix[0]! * value[0]! + matrix[4]! * value[1]! + matrix[8]! * value[2]! + matrix[12]!;
        world[i * 3 + 1] = matrix[1]! * value[0]! + matrix[5]! * value[1]! + matrix[9]! * value[2]! + matrix[13]!;
        world[i * 3 + 2] = matrix[2]! * value[0]! + matrix[6]! * value[1]! + matrix[10]! * value[2]! + matrix[14]!;
        value.length = 0;
      }
      const uv = primitive.getAttribute('TEXCOORD_0');
      for (let t = 0; t < count; t++) {
        const a = indices[t * 3]! * 3;
        const b = indices[t * 3 + 1]! * 3;
        const c = indices[t * 3 + 2]! * 3;
        const ux = world[b]! - world[a]!;
        const uy = world[b + 1]! - world[a + 1]!;
        const uz = world[b + 2]! - world[a + 2]!;
        const vx = world[c]! - world[a]!;
        const vy = world[c + 1]! - world[a + 1]!;
        const vz = world[c + 2]! - world[a + 2]!;
        worldArea +=
          Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
        if (uv) {
          const p0: number[] = [];
          const p1: number[] = [];
          const p2: number[] = [];
          uv.getElement(indices[t * 3]!, p0);
          uv.getElement(indices[t * 3 + 1]!, p1);
          uv.getElement(indices[t * 3 + 2]!, p2);
          uvArea +=
            Math.abs(
              ((p1[0] ?? 0) - (p0[0] ?? 0)) * ((p2[1] ?? 0) - (p0[1] ?? 0)) -
                ((p1[1] ?? 0) - (p0[1] ?? 0)) * ((p2[0] ?? 0) - (p0[0] ?? 0)),
            ) / 2;
        }
      }
    });
    return { part, triangles, worldArea, uvArea };
  });
}

/** Parts grouped by material, to see which parts share one sampler. */
export function partsByMaterial(document: Document): Map<string, PartInfo[]> {
  const groups = new Map<string, PartInfo[]>();
  for (const part of assignParts(document)) {
    const list = groups.get(part.materialKey) ?? [];
    list.push(part);
    groups.set(part.materialKey, list);
  }
  return groups;
}
