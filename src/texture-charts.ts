import type { Document, Material, Primitive } from "@gltf-transform/core";
import { compactPrimitive } from "@gltf-transform/functions";
import { createHash } from "node:crypto";

/** Split disconnected UV islands without changing positions, normals, rigid ownership or triangles. */
export function textureCharts(doc: Document): [Material | null, Primitive[]][] {
  const root = doc.getRoot();
  const groups = new Map<string, Primitive[]>();
  const textureKeys = new Map(
    root.listTextures().map((t) => [
      t,
      createHash("sha256")
        .update(t.getImage() ?? new Uint8Array())
        .digest("hex"),
    ]),
  );
  for (const mesh of root.listMeshes())
    for (const p of mesh.listPrimitives()) {
      const m = p.getMaterial(),
        info = m?.getBaseColorTextureInfo();
      // Transformed/non-UV0 samplers use the existing general path, without island splitting.
      const special = info?.listExtensions().length || info?.getTexCoord();
      const key = special
        ? "material:" + root.listMaterials().indexOf(m!)
        : JSON.stringify([
            textureKeys.get(m?.getBaseColorTexture()!),
            m?.getBaseColorFactor(),
            m?.getAlphaMode(),
            m?.getAlphaCutoff(),
            info?.getWrapS(),
            info?.getWrapT(),
          ]);
      const group = groups.get(key) ?? [];
      group.push(p);
      groups.set(key, group);
    }
  const result: [Material | null, Primitive[]][] = [];
  for (const primitives of groups.values()) {
    const material = primitives[0]!.getMaterial(),
      info = material?.getBaseColorTextureInfo();
    if (
      !material?.getBaseColorTexture() ||
      info?.listExtensions().length ||
      info?.getTexCoord()
    ) {
      result.push([material, primitives]);
      continue;
    }
    const parent: number[] = [],
      bounds: number[][] = [],
      owner = new Map<string, number>();
    const triangles: { p: Primitive; ids: number[]; group: number }[] = [];
    const find = (n: number): number => {
      while (parent[n] !== n) {
        parent[n] = parent[parent[n]!]!;
        n = parent[n]!;
      }
      return n;
    };
    const union = (a: number, b: number) => {
      a = find(a);
      b = find(b);
      if (a !== b) parent[b] = a;
    };
    for (const p of primitives) {
      const uv = p.getAttribute("TEXCOORD_0");
      if (!uv) throw new Error("Textured primitive is missing TEXCOORD_0");
      const indices =
        p.getIndices()?.getArray() ??
        Uint32Array.from({ length: uv.getCount() }, (_, i) => i);
      for (let i = 0; i < indices.length; i += 3) {
        const group = parent.length;
        parent.push(group);
        bounds.push([Infinity, Infinity, -Infinity, -Infinity]);
        const ids = [indices[i]!, indices[i + 1]!, indices[i + 2]!];
        for (const id of ids) {
          const t: number[] = [];
          uv.getElement(id, t);
          const key = t.join(",");
          const old = owner.get(key);
          if (old !== undefined) union(group, old);
          else owner.set(key, group);
          bounds[group]![0] = Math.min(bounds[group]![0]!, t[0]!);
          bounds[group]![1] = Math.min(bounds[group]![1]!, t[1]!);
          bounds[group]![2] = Math.max(bounds[group]![2]!, t[0]!);
          bounds[group]![3] = Math.max(bounds[group]![3]!, t[1]!);
        }
        triangles.push({ p, ids, group });
      }
    }
    const boxes = new Map<number, number[]>();
    for (let i = 0; i < bounds.length; i++) {
      const id = find(i),
        b = bounds[i]!,
        a = boxes.get(id) ?? [Infinity, Infinity, -Infinity, -Infinity];
      a[0] = Math.min(a[0]!, b[0]!);
      a[1] = Math.min(a[1]!, b[1]!);
      a[2] = Math.max(a[2]!, b[2]!);
      a[3] = Math.max(a[3]!, b[3]!);
      boxes.set(id, a);
    }
    // Merge only when the combined rectangle adds <=10% unused area. Mere
    // bounding-box intersection previously chained sparse garment islands into
    // a whole-texture crop; keeping every tiny island also wastes many gutters.
    const area = (b: number[]) =>
      Math.max(0, b[2]! - b[0]!) * Math.max(0, b[3]! - b[1]!);
    const entries = [...boxes.keys()].sort(
      (a, b) => area(boxes.get(a)!) - area(boxes.get(b)!),
    );
    for (let pass = 0; pass < 4; pass++) {
      let changed = false;
      for (let i = 0; i < entries.length; i++)
        for (let j = 0; j < i; j++) {
          const a = find(entries[i]!),
            b = find(entries[j]!);
          if (a === b) continue;
          const x = boxes.get(a)!,
            y = boxes.get(b)!;
          const joined = [
            Math.min(x[0]!, y[0]!),
            Math.min(x[1]!, y[1]!),
            Math.max(x[2]!, y[2]!),
            Math.max(x[3]!, y[3]!),
          ];
          const overlap =
            Math.max(0, Math.min(x[2]!, y[2]!) - Math.max(x[0]!, y[0]!)) *
            Math.max(0, Math.min(x[3]!, y[3]!) - Math.max(x[1]!, y[1]!));
          if (area(joined) <= 1.1 * (area(x) + area(y) - overlap) + 1e-12) {
            union(a, b);
            boxes.set(find(a), joined);
            changed = true;
          }
        }
      if (!changed) break;
    }
    const partitions = new Map<number, Map<Primitive, number[]>>();
    for (const t of triangles) {
      const key = find(t.group),
        group = partitions.get(key) ?? new Map<Primitive, number[]>();
      const indices = group.get(t.p) ?? [];
      indices.push(...t.ids);
      group.set(t.p, indices);
      partitions.set(key, group);
    }
    for (const partition of partitions.values()) {
      const parts: Primitive[] = [];
      for (const [p, indices] of partition) {
        const copy = p
          .clone()
          .setIndices(
            doc
              .createAccessor()
              .setType("SCALAR")
              .setArray(Uint32Array.from(indices))
              .setBuffer(root.listBuffers()[0]!),
          );
        compactPrimitive(copy);
        for (const mesh of root.listMeshes())
          if (mesh.listPrimitives().includes(p)) mesh.addPrimitive(copy);
        parts.push(copy);
      }
      result.push([material, parts]);
    }
    for (const p of primitives) {
      for (const mesh of root.listMeshes()) mesh.removePrimitive(p);
      p.dispose();
    }
  }
  return result;
}
