import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import sharp from 'sharp';
import type { BedrockGeometryFile, V3 } from '../src/bedrock-types.ts';
import { renderGeometryPreview } from '../src/geometry-preview.ts';
import { previewOutput } from '../src/preview.ts';
import { buildSkinPack, zipSkinPack } from '../src/skin-pack.ts';

// Clockwise Bedrock quad, independent position/normal/UV streams, V is bottom-origin.
function fixture(): BedrockGeometryFile {
  return { format_version: '1.8.0', 'geometry.skin0': { texturewidth: 2, textureheight: 2, bones: [{
    name: 'body', pivot: [90, 80, 70], poly_mesh: {
      normalized_uvs: true, positions: [[-1, -1, 0], [-1, 1, 0], [1, 1, 0], [1, -1, 0]],
      normals: [[0, 0, 1]], uvs: [[0, 0], [0, 1], [1, 1], [1, 0]],
      polys: [[[0, 0, 0], [1, 0, 1], [2, 0, 2], [3, 0, 3]]],
    },
  }] } };
}
async function texture(colors = [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255]) {
  return sharp(Buffer.from(colors), { raw: { width: 2, height: 2, channels: 4 } }).png().toBuffer();
}
async function raw(file: BedrockGeometryFile, png: Uint8Array, options = {}) {
  const result = await renderGeometryPreview(file, png, { size: 64, unlit: true, ...options });
  const pixels = await sharp(result.png).raw().toBuffer();
  return { result, at: (x: number, y: number) => [...pixels.subarray((y * 128 + x) * 4, (y * 128 + x) * 4 + 4)] };
}

test('preview reads independent UV streams with correct PNG orientation and ignores rest pivot displacement', async () => {
  const { result, at } = await raw(fixture(), await texture());
  assert.equal(result.width, 128);
  assert.equal(result.height, 176);
  assert.equal(result.triangles, 2);
  assert.deepEqual(at(24, 48), [255, 0, 0, 255]); // top-left
  assert.deepEqual(at(40, 48), [0, 255, 0, 255]);
  assert.deepEqual(at(24, 64), [0, 0, 255, 255]);
  assert.deepEqual(at(40, 64), [255, 255, 0, 255]);
  assert.notDeepEqual(at(88, 48), [0, 255, 0, 255]); // back face culled
  const twoSided = await raw(fixture(), await texture(), { cullBackfaces: false });
  assert.deepEqual(twoSided.at(88, 48), [0, 255, 0, 255]); // -Z reverses X
});

test('opaque depth and half-alpha blending use written texture, without double blending a shared quad edge', async () => {
  const file = fixture(), pm = file['geometry.skin0']!.bones[0]!.poly_mesh!;
  // Foreground samples top-left red at 50% alpha, background samples bottom-left blue opaque.
  pm.positions.push(...pm.positions.map(([x, y, z]) => [x, y, z - 0.2] as V3));
  pm.uvs = [[0.1, 0.9], [0.1, 0.1]];
  pm.polys = [
    [[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]],
    [[4, 0, 1], [5, 0, 1], [6, 0, 1], [7, 0, 1]],
  ];
  const png = await texture([255, 0, 0, 128, 0, 0, 0, 0, 0, 0, 255, 255, 0, 0, 0, 0]);
  const image = await raw(file, png);
  assert.deepEqual(image.at(31, 56), [128, 0, 127, 255]); // shared diagonal
  assert.deepEqual(image.at(29, 56), [128, 0, 127, 255]);
  pm.positions = pm.positions.map(([x, y, z]) => [x, y, -z]); // opaque blue now in front
  assert.deepEqual((await raw(file, png)).at(31, 56), [0, 0, 255, 255]);
});

test('preview supports pixel UVs and rejects mismatched texture, unknown geometry and unsupported rest rotations', async () => {
  const file = fixture(), pm = file['geometry.skin0']!.bones[0]!.poly_mesh!;
  pm.normalized_uvs = false;
  pm.uvs = pm.uvs.map(([u, v]) => [u * 2, v * 2]);
  assert.deepEqual((await raw(file, await texture())).at(24, 48), [255, 0, 0, 255]);
  await assert.rejects(renderGeometryPreview(file, await texture(), { size: 0 }), /size/);
  await assert.rejects(renderGeometryPreview(file, await texture(), { identifier: 'geometry.absent' }), /not found/);
  file['geometry.skin0']!.texturewidth = 4;
  await assert.rejects(renderGeometryPreview(file, await texture()), /dimensions/);
  file['geometry.skin0']!.texturewidth = 2;
  file['geometry.skin0']!.bones[0]!.rotation = [0, 90, 0];
  await assert.rejects(renderGeometryPreview(file, await texture()), /rest rotations/);
});

test('preview CLI reads JSON/PNG, directory and mcpack without original source, and refuses overwrite', async () => {
  const dir = await mkdtemp(join(tmpdir(), '4d-preview-'));
  try {
    const file = fixture(), png = await texture();
    const files = buildSkinPack({ geometry: file, png, identifier: 'geometry.skin0' });
    for (const [name, bytes] of Object.entries(files)) {
      await mkdir(dirname(join(dir, name)), { recursive: true });
      await writeFile(join(dir, name), bytes);
    }
    // Archive must be outside the unpacked directory, which rejects extraneous files.
    const archiveDir = await mkdtemp(join(tmpdir(), '4d-preview-archive-'));
    try {
      const archive = join(archiveDir, 'model.mcpack');
      await writeFile(archive, await zipSkinPack(files));
      const unpacked = await previewOutput(dir, { size: 64, unlit: true });
      assert.deepEqual((await previewOutput(archive, { size: 64, unlit: true })).png, unpacked.png);
      const out = join(archiveDir, 'preview.png');
      const run = (extra: string[]) => spawnSync(process.execPath, ['src/cli.ts', 'preview', join(dir, 'geometry.json'), ...extra], { encoding: 'utf8' });
      const args = ['--texture', join(dir, 'skin0.png'), '--out', out, '--size', '64', '--unlit'];
      const success = run(args);
      assert.equal(success.status, 0, success.stderr);
      assert.equal(JSON.parse(success.stdout).triangles, 2);
      assert.deepEqual(await readFile(out), unpacked.png);
      assert.equal(run(args).status, 1);
      const missingTexture = run(['--out', join(archiveDir, 'missing.png')]);
      assert.equal(missingTexture.status, 1);
      assert.match(missingTexture.stderr, /requires --texture/);
    } finally { await rm(archiveDir, { recursive: true, force: true }); }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
