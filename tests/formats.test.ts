import { test } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { createAssimp } from 'libassimp';
import { importModel } from '../src/importer.ts';
import { inspectModel } from '../src/inspect.ts';
import { validateSkinPackPath } from '../src/skin-pack.ts';

/** Independent authored geometry; no third-party model redistribution. */
async function tetrahedron(): Promise<Uint8Array> {
  const doc = new Document(), buffer = doc.createBuffer();
  const positions = doc.createAccessor().setType('VEC3').setBuffer(buffer)
    .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]));
  const indices = doc.createAccessor().setType('SCALAR').setBuffer(buffer)
    .setArray(new Uint16Array([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]));
  const p = doc.createPrimitive().setAttribute('POSITION', positions).setIndices(indices);
  const node = doc.createNode('tetrahedron').setMesh(doc.createMesh().addPrimitive(p));
  doc.getRoot().setDefaultScene(doc.createScene().addChild(node));
  return new NodeIO().writeBinary(doc);
}

for (const format of ['fbx', 'dae', 'stl', 'ply'] as const) {
  test(`${format}: native/WASM import and complete CLI conversion`, async () => {
    const dir = await mkdtemp(join(tmpdir(), '4d-format-'));
    const assimp = await createAssimp({ backend: 'native' });
    try {
      const result = await assimp.convert({ name: 'tetra.glb', bytes: await tetrahedron() }, { to: format });
      for (const file of result.files) {
        const path = join(dir, file.name);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, file.bytes);
      }
      const entry = result.files.find((file) => file.name.endsWith('.' + format));
      assert.ok(entry, 'export fixture was not generated');
      const path = join(dir, entry.name);
      for (const backend of ['native', 'wasm'] as const) {
        const model = await importModel(path, { backend });
        assert.equal(model.source.format, format);
        assert.equal(model.source.backend, backend);
        assert.equal(model.source.importer, 'libassimp');
        assert.equal(model.source.units, 'unspecified');
        const report = await inspectModel(model);
        assert.equal(report.counts.triangles, 4);
        assert.ok(model.warnings.some((warning) => warning.includes('source units')));
      }
      const out = join(dir, 'pack');
      const run = spawnSync(process.execPath, ['src/cli.ts', 'convert', path, '--out', out, '--atlas', '32'], { encoding: 'utf8' });
      assert.equal(run.status, 0, run.stderr);
      const report = JSON.parse(run.stdout);
      assert.equal(report.sourceTriangles, 4);
      assert.equal(report.triangles, format === 'ply' ? 8 : 4);
      assert.equal((await validateSkinPackPath(out)).skins, 1);
      assert.equal((await validateSkinPackPath(out + '.zip')).skins, 1);
    } finally {
      assimp.dispose();
      await rm(dir, { recursive: true, force: true });
    }
  });
}

test('STL ASCII and PLY ASCII load without relying on Assimp-generated fixtures', async () => {
  const dir = await mkdtemp(join(tmpdir(), '4d-ascii-'));
  try {
    const fixtures = {
      stl: 'solid triangle\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid triangle\n',
      ply: 'ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nelement face 1\nproperty list uchar int vertex_indices\nend_header\n0 0 0\n1 0 0\n0 1 0\n3 0 1 2\n',
    };
    for (const [format, content] of Object.entries(fixtures)) {
      const path = join(dir, 'triangle.' + format.toUpperCase());
      await writeFile(path, content);
      for (const backend of ['native', 'wasm'] as const) {
        assert.equal((await inspectModel(await importModel(path, { backend }))).counts.triangles, 1);
      }
    }
    const unsupported = join(dir, 'not.pmd');
    await writeFile(unsupported, 'not a model');
    await assert.rejects(importModel(unsupported), /Unsupported input format/);
    const invalid = join(dir, 'invalid.fbx');
    await writeFile(invalid, 'not an FBX');
    await assert.rejects(importModel(invalid));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('DAE resolves external texture, preserves node transforms and rejects missing sidecars', async () => {
  const dir = await mkdtemp(join(tmpdir(), '4d-dae-texture-'));
  try {
    const { png } = await import('./fixtures.ts');
    await mkdir(join(dir, 'textures'));
    await writeFile(join(dir, 'textures', 'color.png'), await png());
    const path = join(dir, 'model.dae');
    await writeFile(path, `<?xml version="1.0" encoding="utf-8"?>
<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">
<asset><created>2026-01-01T00:00:00</created><modified>2026-01-01T00:00:00</modified><unit name="meter" meter="1"/><up_axis>Y_UP</up_axis></asset>
<library_images><image id="color"><init_from>textures/color.png</init_from></image></library_images>
<library_effects><effect id="effect"><profile_COMMON>
<newparam sid="surface"><surface type="2D"><init_from>color</init_from></surface></newparam>
<newparam sid="sampler"><sampler2D><source>surface</source></sampler2D></newparam>
<technique sid="common"><lambert><diffuse><texture texture="sampler" texcoord="UVMap"/></diffuse></lambert></technique>
</profile_COMMON></effect></library_effects>
<library_materials><material id="material"><instance_effect url="#effect"/></material></library_materials>
<library_geometries><geometry id="triangle"><mesh>
<source id="positions"><float_array id="positions-array" count="9">0 0 0 1 0 0 0 1 0</float_array><technique_common><accessor source="#positions-array" count="3" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source>
<source id="uvs"><float_array id="uvs-array" count="6">0 0 1 0 0 1</float_array><technique_common><accessor source="#uvs-array" count="3" stride="2"><param name="S" type="float"/><param name="T" type="float"/></accessor></technique_common></source>
<vertices id="vertices"><input semantic="POSITION" source="#positions"/></vertices>
<triangles count="1" material="mat"><input semantic="VERTEX" source="#vertices" offset="0"/><input semantic="TEXCOORD" source="#uvs" offset="1" set="0"/><p>0 0 1 1 2 2</p></triangles>
</mesh></geometry></library_geometries>
<library_visual_scenes><visual_scene id="scene"><node id="parent"><translate>3 4 5</translate><scale>2 3 4</scale><node id="child"><instance_geometry url="#triangle"><bind_material><technique_common><instance_material symbol="mat" target="#material"><bind_vertex_input semantic="UVMap" input_semantic="TEXCOORD" input_set="0"/></instance_material></technique_common></bind_material></instance_geometry></node></node></visual_scene></library_visual_scenes>
<scene><instance_visual_scene url="#scene"/></scene></COLLADA>`);
    for (const backend of ['native', 'wasm'] as const) {
      const report = await inspectModel(await importModel(path, { backend }));
      assert.equal(report.counts.textures, 1);
      assert.equal(report.textures[0]!.hasAlpha, true);
      assert.deepEqual(report.bounds?.min, [3, 4, 5]);
      assert.deepEqual(report.bounds?.max, [5, 7, 5]);
    }
    const run = spawnSync(process.execPath, ['src/cli.ts', 'convert', path, '--out', join(dir, 'pack'), '--atlas', '32'], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.equal((await validateSkinPackPath(join(dir, 'pack.zip'))).skins, 1);
    await rm(join(dir, 'textures', 'color.png'));
    for (const backend of ['native', 'wasm'] as const) await assert.rejects(importModel(path, { backend }), /Missing DAE resources|ENOENT/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('FBX embedded texture and alpha survive native and WASM import and CLI output', async () => {
  const dir = await mkdtemp(join(tmpdir(), '4d-fbx-texture-'));
  const assimp = await createAssimp({ backend: 'native' });
  try {
    const { documentFixture } = await import('./fixtures.ts');
    const result = await assimp.convert({ name: 'model.glb', bytes: await new NodeIO().writeBinary(await documentFixture()) }, { to: 'fbx' });
    for (const file of result.files) await writeFile(join(dir, file.name), file.bytes);
    const path = join(dir, result.files.find((f) => f.name.endsWith('.fbx'))!.name);
    for (const backend of ['native', 'wasm'] as const) {
      const report = await inspectModel(await importModel(path, { backend }));
      assert.equal(report.counts.instanceTriangles, 2);
      assert.equal(report.counts.textures, 1);
      assert.equal(report.textures[0]!.hasAlpha, true);
      assert.equal(report.textures[0]!.width, 8);
      assert.equal(report.textures[0]!.height, 4);
      assert.equal(report.materials[0]!.alphaMode, 'BLEND');
      assert.equal(report.materials[0]!.baseColor[3], 0.5);
    }
    const out = join(dir, 'pack');
    const run = spawnSync(process.execPath, ['src/cli.ts', 'convert', path, '--out', out, '--atlas', '32'], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(JSON.parse(run.stdout).sourceTriangles, 2);
    assert.equal((await validateSkinPackPath(out + '.zip')).skins, 1);
  } finally {
    assimp.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});
