import { test, expect } from 'vitest';
import { createAssimp } from 'libassimp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

for (const backend of ['native', 'wasm'] as const) {
  test(`${backend}: OBJ + async MTL/PNG resources preserve material, UV and alpha`, async () => {
    const assimp = await createAssimp({ backend });
    try {
      expect(assimp.backend).toBe(backend);
      const png = await sharp({ create: { width: 2, height: 2, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 0.5 } } }).png().toBuffer();
      const resources = new Map<string, Uint8Array>([
        ['material.mtl', new TextEncoder().encode('newmtl painted\nKd 1 1 1\nmap_Kd color.png\n')],
        ['color.png', png],
      ]);
      const requested: string[] = [];
      const result = await assimp.convert({ name: 'probe.obj', bytes: new TextEncoder().encode('mtllib material.mtl\no triangle\nv 0 0 0\nv 1 0 0\nv 0 1 0\nvt 0 0\nvt 1 0\nvt 0 1\nusemtl painted\nf 1/1 2/2 3/3\n') }, {
        to: 'glb', resolve: async (name) => { requested.push(name); return resources.get(name); },
      });
      const output = result.files.find((file) => file.name.endsWith('.glb'));
      expect(output).toBeDefined();
      if (!output) throw new Error('Missing GLB');
      // Assimp preserves external image URIs even in GLB; NodeIO must resolve sidecars.
      const dir = await mkdtemp(join(tmpdir(), 'skin-probe-'));
      let doc;
      try {
        await writeFile(join(dir, 'probe.glb'), output.bytes);
        await writeFile(join(dir, 'color.png'), png);
        doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(join(dir, 'probe.glb'));
      } finally { await rm(dir, { recursive: true, force: true }); }
      const primitive = doc.getRoot().listMeshes()[0]?.listPrimitives()[0];
      expect(primitive?.getAttribute('TEXCOORD_0')?.getCount()).toBe(3);
      const image = primitive?.getMaterial()?.getBaseColorTexture()?.getImage();
      expect(image).toBeDefined();
      if (!image) throw new Error('Texture lost during conversion');
      expect((await sharp(image).metadata()).hasAlpha).toBe(true);
      expect(requested).toContain('material.mtl');
      // Texture bytes are resolved by NodeIO, not Assimp's MTL reader.
      await expect(assimp.convert({ name: 'broken.obj', bytes: new Uint8Array() }, { to: 'glb' })).rejects.toThrow();
    } finally { assimp.dispose(); }
  });
}
