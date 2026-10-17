import { test } from 'bun:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { Document, NodeIO } from '@gltf-transform/core';
import { KHRTextureTransform } from '@gltf-transform/extensions';
import { optimizeTextures } from '../src/texture-optimizer.ts';
import { documentFixture } from './fixtures.ts';
import type { IntermediateModel } from '../src/model.ts';

const model = (document: Document): IntermediateModel => ({ document,
  source: { path: 'generated', format: 'gltf', units: 'meters', coordinates: 'right-handed-y-up', importer: 'gltf-transform' }, warnings: [] });

async function fixture() {
  const doc = await documentFixture();
  const mesh = doc.getRoot().listMeshes()[0]!;
  const first = mesh.listPrimitives()[0]!;
  const second = first.clone().setMaterial(doc.createMaterial('red').setBaseColorFactor([1, 0, 0, 1]).setMetallicFactor(0));
  mesh.addPrimitive(second);
  return model(doc);
}

function rgbaAt(data: Uint8Array, size: number, x: number, y: number) {
  return Array.from(data.subarray((y * size + x) * 4, (y * size + x) * 4 + 4));
}

test('atlas packs distinct materials, remaps UV and keeps source/alpha intact', async () => {
  const input = await fixture();
  const original = input.document.getRoot().listMeshes()[0]!.listPrimitives()[0]!.getAttribute('TEXCOORD_0')!;
  const { model: output, png, report } = await optimizeTextures(input, { atlasSize: 32, maxTextureSize: 8, filter: 'nearest' });
  assert.equal(output.document.getRoot().listTextures().length, 1);
  assert.equal(input.document.getRoot().listTextures()[0]!.getName(), 'rgba');
  assert.deepEqual(Array.from(original.getArray()!), [0, 0, 1, 0, 0, 1]);
  const pixels = await sharp(png).raw().toBuffer();
  const primitives = output.document.getRoot().listMeshes()[0]!.listPrimitives();
  for (const [i, p] of primitives.entries()) {
    const region = report.regions[i]!;
    const uv: number[] = []; p.getAttribute('TEXCOORD_0')!.getElement(0, uv);
    const color = rgbaAt(pixels, 32, region.x, region.y);
    if (i === 0) {
      assert.deepEqual(color, [40, 160, 80, 64]); // Original alpha ~128 × material alpha 0.5.
      assert.equal(uv[0], region.x / 32);
      assert.equal(uv[1], region.y / 32);
    } else assert.deepEqual(color, [255, 0, 0, 255]);
    assert.equal(p.getMaterial()!.getBaseColorTextureInfo()!.getTexCoord(), 0);
    assert.deepEqual(p.getMaterial()!.getBaseColorFactor(), [1, 1, 1, 1]);
  }
  const a = report.regions[0]!, b = report.regions[1]!;
  assert.ok(a.x + a.width + 2 <= b.x - 2 || b.x + b.width + 2 <= a.x - 2 || a.y + a.height + 2 <= b.y - 2 || b.y + b.height + 2 <= a.y - 2);
  const glb = await new NodeIO().writeBinary(output.document);
  const reread = await new NodeIO().readBinary(glb);
  assert.equal(reread.getRoot().listTextures().length, 1);
});

test('resize preserves aspect ratio and transparent channel for nearest/lanczos', async () => {
  for (const filter of ['nearest', 'lanczos3'] as const) {
    const result = await optimizeTextures(model(await documentFixture()), { maxTextureSize: 4, filter });
    assert.deepEqual(result.report.regions[0]!.resized, { width: 4, height: 2 });
    const meta = await sharp(result.png).metadata();
    assert.equal(meta.hasAlpha, true);
  }
});

test('Original retains image resolution; explicit insufficient atlas refuses data loss', async () => {
  assert.deepEqual((await optimizeTextures(await fixture())).report.regions[0]!.resized, { width: 8, height: 4 });
  await assert.rejects(optimizeTextures(await fixture(), { atlasSize: 8 }), /capacity exceeded.*Increase atlasSize/);
  for (const options of [{ atlasSize: 0 }, { maxTextureSize: 1.5 }, { padding: 0 }]) await assert.rejects(optimizeTextures(await fixture(), options));
});

test('base-color factor is applied in linear RGB and alpha modes obey glTF', async () => {
  const input = model(await documentFixture());
  const material = input.document.getRoot().listMaterials()[0]!;
  material.setBaseColorTexture(null).setBaseColorFactor([0.5, 0.5, 0.5, 0.2]).setAlphaMode('OPAQUE');
  const opaque = await optimizeTextures(input);
  const r = opaque.report.regions[0]!, size = opaque.report.atlas.width;
  const data = await sharp(opaque.png).raw().toBuffer();
  assert.deepEqual(rgbaAt(data, size, r.x, r.y), [188, 188, 188, 255]);
  material.setAlphaMode('MASK').setAlphaCutoff(0.5);
  const mask = await optimizeTextures(input);
  const mr = mask.report.regions[0]!;
  assert.equal(rgbaAt(await sharp(mask.png).raw().toBuffer(), mask.report.atlas.width, mr.x, mr.y)[3], 0);
});

test('texture transform, alternate UV set and repeated span are baked without modulo seams', async () => {
  const input = model(await documentFixture());
  const doc = input.document, p = doc.getRoot().listMeshes()[0]!.listPrimitives()[0]!;
  p.setAttribute('TEXCOORD_1', p.getAttribute('TEXCOORD_0')!.clone());
  const ext = doc.createExtension(KHRTextureTransform);
  p.getMaterial()!.getBaseColorTextureInfo()!.setExtension('KHR_texture_transform', ext.createTransform().setScale([2, 1]).setOffset([-1, 0]).setTexCoord(1));
  const result = await optimizeTextures(input, { atlasSize: 32 });
  assert.deepEqual(result.report.regions[0]!.tiles, [2, 1]);
  const values = Array.from(result.model.document.getRoot().listMeshes()[0]!.listPrimitives()[0]!.getAttribute('TEXCOORD_0')!.getArray()!);
  assert.equal(values[2]! - values[0]!, 16 / 32);
  assert.equal(result.model.document.getRoot().listMaterials()[0]!.getBaseColorTextureInfo()!.getExtension('KHR_texture_transform'), null);
  p.getMaterial()!.getBaseColorTextureInfo()!.getExtension<import('@gltf-transform/extensions').Transform>('KHR_texture_transform')!
    .setRotation(Math.PI / 2).setOffset([0, -1]);
  const rotated = await optimizeTextures(input, { atlasSize: 32 });
  assert.deepEqual(rotated.report.regions[0]!.tiles, [1, 2]);
});

test('gutters use repeat/mirror/clamp sampler behavior and prevent adjacent material bleed', async () => {
  const input = model(await documentFixture());
  const material = input.document.getRoot().listMaterials()[0]!;
  const image = await sharp(Buffer.from([255, 0, 0, 255, 0, 0, 255, 255]), { raw: { width: 2, height: 1, channels: 4 } }).png().toBuffer();
  material.getBaseColorTexture()!.setImage(Uint8Array.from(image));
  material.setBaseColorFactor([1, 1, 1, 1]).setAlphaMode('OPAQUE');
  for (const wrap of [10497, 33648, 33071] as const) {
    material.getBaseColorTextureInfo()!.setWrapS(wrap);
    const result = await optimizeTextures(input, { atlasSize: 16, filter: 'nearest' });
    const r = result.report.regions[0]!, bytes = await sharp(result.png).raw().toBuffer();
    assert.deepEqual(rgbaAt(bytes, 16, r.x - 1, r.y), wrap === 10497 ? [0, 0, 255, 255] : [255, 0, 0, 255]);
    assert.deepEqual(rgbaAt(bytes, 16, r.x + 2, r.y), wrap === 10497 ? [255, 0, 0, 255] : [0, 0, 255, 255]);
  }
});

test('missing UV, unsupported vertex colors and excessive repeat ranges fail explicitly', async () => {
  const input = model(await documentFixture()), doc = input.document;
  const p = doc.getRoot().listMeshes()[0]!.listPrimitives()[0]!;
  const uv = p.getAttribute('TEXCOORD_0')!;
  p.setAttribute('TEXCOORD_0', null);
  await assert.rejects(optimizeTextures(input), /missing TEXCOORD/);
  p.setAttribute('TEXCOORD_0', uv);
  uv.setArray(new Float32Array([0, 0, 100, 0, 0, 1]));
  await assert.rejects(optimizeTextures(input), /exceeds 16 tiles/);
  p.setAttribute('COLOR_0', doc.createAccessor().setType('VEC3').setArray(new Float32Array(9)).setBuffer(doc.getRoot().listBuffers()[0]!));
  await assert.rejects(optimizeTextures(input), /COLOR_0/);
});
