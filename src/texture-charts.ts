import type { Document, Material, Primitive } from "@gltf-transform/core";
import { compactPrimitive } from "@gltf-transform/functions";
import { createHash } from "node:crypto";
import { buildUvCharts } from "./texture-chart-math.ts";

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
    // Shared chart math keeps the browser atlas on the same island rules as
    // the desktop baker. Only the flat UV/triangle bookkeeping lives here.
    const uvs: number[] = [];
    const materials: string[] = [];
    const triangles: { p: Primitive; ids: number[] }[] = [];
    for (const p of primitives) {
      const uv = p.getAttribute("TEXCOORD_0");
      if (!uv) throw new Error("Textured primitive is missing TEXCOORD_0");
      const indices =
        p.getIndices()?.getArray() ??
        Uint32Array.from({ length: uv.getCount() }, (_, i) => i);
      const name = p.getMaterial()?.getName() ?? "(default)";
      for (let i = 0; i < indices.length; i += 3) {
        const ids = [indices[i]!, indices[i + 1]!, indices[i + 2]!];
        for (const id of ids) {
          const t: number[] = [];
          uv.getElement(id, t);
          uvs.push(t[0]!, t[1]!);
        }
        materials.push(name);
        triangles.push({ p, ids });
      }
    }
    const charts = buildUvCharts(uvs, { materials });
    const partitions: Map<Primitive, number[]>[] = charts.map((chart) => {
      const partition = new Map<Primitive, number[]>();
      for (const triangle of chart.triangles) {
        const entry = triangles[triangle]!;
        const indices = partition.get(entry.p) ?? [];
        indices.push(...entry.ids);
        partition.set(entry.p, indices);
      }
      return partition;
    });
    for (const partition of partitions) {
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
