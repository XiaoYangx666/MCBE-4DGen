import { importModel } from '../../src/importer.ts';
import { writeFile } from 'node:fs/promises';

const model = await importModel(process.argv[2]!, { backend: 'wasm' });
const mappings: Record<string, string> = { '左腕': 'leftArm', '右腕': 'rightArm', '左肩': 'leftArm', '右肩': 'rightArm', '左足': 'leftLeg', '右足': 'rightLeg', '頭': 'head' };
const report = [];
for (const node of model.document.getRoot().listNodes()) {
  const mesh = node.getMesh(), skin = node.getSkin(); if (!mesh || !skin) continue;
  const parts = skin.listJoints().map((joint) => {
    for (let n: typeof joint | null = joint; n; n = n.getParentNode()) if (mappings[n.getName()]) return mappings[n.getName()]!;
    return 'body';
  });
  for (const p of mesh.listPrimitives()) {
    const name = p.getMaterial()!.getName(); if (!/服|衣|裙|裤|带/.test(name)) continue;
    const idx = p.getIndices()!.getArray()!, position = p.getAttribute('POSITION')!, js = p.getAttribute('JOINTS_0')!, ws = p.getAttribute('WEIGHTS_0')!;
    const parent = Array.from({ length: position.getCount() }, (_, i) => i), canonical = new Map<string, number>();
    const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]!]!; i = parent[i]!; } return i; };
    for (const i of new Set(idx)) {
      const v: number[] = [], j: number[] = [], w: number[] = []; position.getElement(i, v); js.getElement(i, j); ws.getElement(i, w);
      const key = [...v.map((n) => Math.round(n * 1e6)), ...j, ...w.map((n) => Math.round(n * 1e6))].join(',');
      if (canonical.has(key)) parent[find(i)] = find(canonical.get(key)!); else canonical.set(key, i);
    }
    for (let i = 0; i < idx.length; i += 3) { const root = find(idx[i]!); parent[find(idx[i + 1]!)] = root; parent[find(idx[i + 2]!)] = root; }
    const components = new Map<number, { triangles: number; weights: Record<string, number> }>();
    for (let i = 0; i < idx.length; i += 3) { const root = find(idx[i]!); if (!components.has(root)) components.set(root, { triangles: 0, weights: {} }); components.get(root)!.triangles++; }
    for (const i of new Set(idx)) {
      const c = components.get(find(i))!, j: number[] = [], w: number[] = []; js.getElement(i, j); ws.getElement(i, w);
      for (let k = 0; k < j.length; k++) { const part = parts[j[k]!]!; c.weights[part] = (c.weights[part] ?? 0) + w[k]!; }
    }
    const sorted = [...components.values()].sort((a, b) => b.triangles - a.triangles).map((c) => ({ triangles: c.triangles, weights: Object.fromEntries(Object.entries(c.weights).filter(([, w]) => w > 0.01).map(([k, w]) => [k, Math.round(w)])) }));
    report.push({ material: name, components: components.size, largest: sorted.slice(0, 12) });
  }
}
await writeFile(process.argv[3] ?? 'outputs/pmx-components.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
