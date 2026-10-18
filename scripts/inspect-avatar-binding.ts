import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { importModel } from '../src/importer.ts';

const model = await importModel(process.argv[2] ?? '.cache/anime/sample.vrm');
const output = resolve(process.argv[3] ?? 'outputs/source-binding.json');
const report = { source: model.source, meshes: [] as unknown[], joints: [] as unknown[] };
for (const node of model.document.getRoot().listNodes()) {
  if (node.getExtras()._vrmHumanBone || /skirt|suso|sode/i.test(node.getName())) report.joints.push({
    name: node.getName(), role: node.getExtras()._vrmHumanBone, parent: node.getParentNode()?.getName(),
    position: node.getWorldTranslation(),
  });
  const mesh = node.getMesh(); if (!mesh) continue;
  const joints = node.getSkin()?.listJoints() ?? [];
  const primitives = mesh.listPrimitives().map((p, index) => {
    const totals = new Map<string, number>();
    const positions = p.getAttribute('POSITION')!;
    const sets = p.listSemantics().filter((s) => /^JOINTS_\d+$/.test(s));
    const referenced = new Set(p.getIndices()?.getArray() ?? Array.from({ length: positions.getCount() }, (_, i) => i));
    for (const i of referenced) for (const semantic of sets) {
      const js: number[] = [], ws: number[] = [];
      p.getAttribute(semantic)!.getElement(i, js);
      p.getAttribute(semantic.replace('JOINTS_', 'WEIGHTS_'))!.getElement(i, ws);
      for (let j = 0; j < js.length; j++) if (ws[j]! > 0) {
        const name = joints[js[j]!]!.getName(); totals.set(name, (totals.get(name) ?? 0) + ws[j]!);
      }
    }
    return { index, material: p.getMaterial()?.getName(), vertices: referenced.size,
      triangles: (p.getIndices()?.getCount() ?? positions.getCount()) / 3,
      influences: [...totals].sort((a, b) => b[1] - a[1]).map(([joint, total]) => ({ joint, total: Math.round(total * 100) / 100 })) };
  });
  report.meshes.push({ node: node.getName(), mesh: mesh.getName(), primitives });
}
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2), { flag: 'wx' });
console.log('Saved ' + output);
