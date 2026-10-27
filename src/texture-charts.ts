import type { Document, Material, Primitive } from "@gltf-transform/core";
import { compactPrimitive } from "@gltf-transform/functions";
import { createHash } from "node:crypto";

/** Split disconnected UV islands without changing positions, normals, rigid ownership or triangles. */
export function textureCharts(doc: Document): [Material | null, Primitive[]][] {
  // Adjacent charts save one gutter, but merging distant islands trades that
  // gutter for a much larger empty bounding box. Medium growth is allowed only
  // while the joined rectangle keeps most of the UV coverage the parts had.
  const MERGE_GROWTH = 0.2;
  const COVERAGE_RETENTION = 0.8;
  const COVERAGE_FLOOR = 0.05;
  const UV_EPSILON = 1e-6;
  const uvKey = (t: number[]) =>
    `${Math.round(t[0]! / UV_EPSILON)},${Math.round(t[1]! / UV_EPSILON)}`;
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
    const triangles: {
      p: Primitive;
      ids: number[];
      group: number;
      points: number[][];
    }[] = [];
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
        const points: number[][] = [];
        for (const id of ids) {
          const t: number[] = [];
          uv.getElement(id, t);
          points.push(t);
          bounds[group]![0] = Math.min(bounds[group]![0]!, t[0]!);
          bounds[group]![1] = Math.min(bounds[group]![1]!, t[1]!);
          bounds[group]![2] = Math.max(bounds[group]![2]!, t[0]!);
          bounds[group]![3] = Math.max(bounds[group]![3]!, t[1]!);
        }
        for (const t of points) {
          const key = uvKey(t);
          const old = owner.get(key);
          if (old !== undefined) union(group, old);
          else owner.set(key, group);
        }
        triangles.push({ p, ids, group, points });
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
    const area = (b: number[]) =>
      Math.max(0, b[2]! - b[0]!) * Math.max(0, b[3]! - b[1]!);
    // Estimate the part of each chart's bounding box that its triangles actually
    // cover. A bbox can be mostly empty because UV islands touch only at a point
    // or because a chart spans several sparse pieces; merging those would trade a
    // little gutter for a lot of dead atlas space.
    const coverageGrid = 32;
    const occupied = new Map<number, Uint8Array>();
    for (const id of boxes.keys())
      occupied.set(id, new Uint8Array(coverageGrid * coverageGrid));
    const edge2 = (p: number[], q: number[], x: number, y: number) =>
      (q[0]! - p[0]!) * (y - p[1]!) - (q[1]! - p[1]!) * (x - p[0]!);
    for (const t of triangles) {
      const id = find(t.group),
        b = boxes.get(id)!,
        mask = occupied.get(id)!;
      const width = b[2]! - b[0]!,
        height = b[3]! - b[1]!;
      if (width <= 0 || height <= 0) continue;
      const points = t.points.map((p) => [
        ((p[0]! - b[0]!) / width) * coverageGrid,
        ((p[1]! - b[1]!) / height) * coverageGrid,
      ]);
      const [a, c, d] = points as [number[], number[], number[]];
      if (Math.abs(edge2(a, c, d[0]!, d[1]!)) < 1e-12) continue;
      const x0 = Math.max(
          0,
          Math.floor(Math.min(a[0]!, c[0]!, d[0]!)),
        ),
        x1 = Math.min(
          coverageGrid - 1,
          Math.ceil(Math.max(a[0]!, c[0]!, d[0]!)),
        );
      const y0 = Math.max(
          0,
          Math.floor(Math.min(a[1]!, c[1]!, d[1]!)),
        ),
        y1 = Math.min(
          coverageGrid - 1,
          Math.ceil(Math.max(a[1]!, c[1]!, d[1]!)),
        );
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const e = [
            edge2(a, c, x + 0.5, y + 0.5),
            edge2(c, d, x + 0.5, y + 0.5),
            edge2(d, a, x + 0.5, y + 0.5),
          ];
          if (e.every((v) => v >= 0) || e.every((v) => v <= 0))
            mask[y * coverageGrid + x] = 1;
        }
    }
    const uniqueArea = new Map<number, number>();
    for (const [id, mask] of occupied) {
      let n = 0;
      for (const v of mask) n += v;
      uniqueArea.set(id, (n / mask.length) * area(boxes.get(id)!));
    }
    // Charts with different material sets may only merge when their UV areas
    // already overlap. Otherwise a small eyelash/trim island can enlarge a face
    // crop and dilute the face's texel budget even though total coverage rises.
    const chartMaterials = new Map<number, Set<string>>();
    for (const t of triangles) {
      const id = find(t.group);
      const set = chartMaterials.get(id) ?? new Set<string>();
      set.add(t.p.getMaterial()?.getName() ?? "(default)");
      chartMaterials.set(id, set);
    }
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
          const unionArea = area(x) + area(y) - overlap;
          const ua = uniqueArea.get(a) ?? 0,
            ub = uniqueArea.get(b) ?? 0;
          const separateCoverage =
              unionArea > 0 ? (ua + ub) / unionArea : 0,
            mergedCoverage = area(joined) > 0 ? (ua + ub) / area(joined) : 0;
          const materialsA = chartMaterials.get(a) ?? new Set<string>(),
            materialsB = chartMaterials.get(b) ?? new Set<string>();
          const sharesMaterial = [...materialsA].some((name) =>
            materialsB.has(name),
          );
          const overlapsUV =
            overlap >= 0.5 * Math.min(area(x), area(y)) ||
            area(joined) <= unionArea * 1.02;
          if (
            (sharesMaterial || overlapsUV) &&
            area(joined) <= (1 + MERGE_GROWTH) * unionArea + 1e-12 &&
            mergedCoverage >= COVERAGE_FLOOR &&
            mergedCoverage >= COVERAGE_RETENTION * separateCoverage
          ) {
            union(a, b);
            const root = find(a);
            boxes.set(root, joined);
            uniqueArea.set(root, ua + ub);
            chartMaterials.set(
              root,
              new Set([...materialsA, ...materialsB]),
            );
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
