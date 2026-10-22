// Diagnostic only: NodeIO read path (fs stream) vs readBinary (parse only) per runtime.
// Usage: node scripts/diagnostics/bench/bench-gltf.ts <model.glb>
import { readFile } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const runtime = (process.versions as { bun?: string }).bun ? 'bun' : 'node';
const path = process.argv[2]!;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

const t0 = performance.now();
const doc = await io.read(path);
const t1 = performance.now();

const bytes = await readFile(path);
const t2 = performance.now();
const doc2 = await io.readBinary(new Uint8Array(bytes));
const t3 = performance.now();

let prims = 0, textures = 0;
for (const mesh of doc.getRoot().listMeshes()) prims += mesh.listPrimitives().length;
for (const tex of doc.getRoot().listTextures()) { textures++; tex.getImage(); }

console.log(JSON.stringify({
  runtime,
  ioReadMs: Math.round(t1 - t0),
  fsReadMs: Math.round(t2 - t1),
  readBinaryMs: Math.round(t3 - t2),
  prims, textures, sameDoc: doc2.getRoot().listMeshes().length === doc.getRoot().listMeshes().length,
}));
