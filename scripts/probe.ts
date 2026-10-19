import assert from 'node:assert/strict';
import { createAssimp } from 'libassimp';
import { NodeIO } from '@gltf-transform/core';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import JSZip from 'jszip';

// Authored test data, no third-party model redistribution.
const obj = new TextEncoder().encode('o triangle\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n');
for (const backend of ['native', 'wasm'] as const) {
  const assimp = await createAssimp({ backend });
  try {
    const result = await assimp.convert({ name: 'probe.obj', bytes: obj }, { to: 'glb' });
    const file = result.files.find((file) => file.name.endsWith('.glb'));
    assert(file, 'Assimp must emit a GLB');
    const document = await new NodeIO().readBinary(file.bytes);
    const primitives = document.getRoot().listMeshes().flatMap((mesh) => mesh.listPrimitives());
    assert.equal(primitives.length, 1);
    assert.equal(primitives[0]?.getAttribute('POSITION')?.getCount(), 3);
    assert.equal(primitives[0]?.getIndices()?.getCount(), 3);
    console.log(JSON.stringify({ backend, vertices: 3, triangles: 1, glbBytes: file.bytes.length }));
  } finally {
    assimp.dispose();
  }
}
await MeshoptSimplifier.ready;
assert.equal(typeof MeshoptSimplifier.simplify, 'function');
const png = await sharp({ create: { width: 4, height: 2, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.5 } } }).resize(2, 1, { kernel: 'nearest' }).png().toBuffer();
const metadata = await sharp(png).metadata();
assert.equal(metadata.width, 2);
assert.equal(metadata.hasAlpha, true);
const zip = new JSZip().file('probe.png', png);
const bytes = await zip.generateAsync({ type: 'uint8array' });
const reopened = await JSZip.loadAsync(bytes);
assert.equal((await reopened.file('probe.png')?.async('uint8array'))?.length, png.length);
console.log(JSON.stringify({ meshoptimizer: 'ready', sharp: 'resize+alpha OK', jszip: 'roundtrip OK', runtime: `Node ${process.version}` }));
