import { test } from 'vitest';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import type { BedrockGeometryFile } from '../src/bedrock-types.ts';
import { buildImageSkinGeometry } from '../src/image-skin-geometry.ts';
import {
  buildSkinPackCollection,
  type SkinPackCollectionSkin,
} from '../src/skin-pack-files.ts';
import { validateSkinPackFiles } from '../src/skin-pack.ts';

const png = await sharp({
  create: { width: 128, height: 128, channels: 4, background: { r: 30, g: 60, b: 120, alpha: 1 } },
}).png().toBuffer();

function skin(name: string, width: number, key = 'geometry.skin0'): SkinPackCollectionSkin {
  const file = buildImageSkinGeometry({ width, height: 32, u0: 0, v0: 0, u1: 1, v1: 1 });
  const wrapper = { format_version: '1.8.0' } as BedrockGeometryFile;
  wrapper[key as `geometry.${string}`] = file['geometry.skin0']!;
  return { name, png, geometry: wrapper };
}

test('builds a multi-skin pack with stable identity and independent geometry/texture names', async () => {
  const result = buildSkinPackCollection({
    packName: 'My Collection',
    headerId: '11111111-1111-4111-8111-111111111111',
    moduleId: '22222222-2222-4222-8222-222222222222',
    skins: [skin('Skin A', 24), skin('Skin B', 32, 'geometry.custom')],
  });
  assert.equal(result.headerId, '11111111-1111-4111-8111-111111111111');
  assert.equal(result.skins.length, 2);
  assert.deepEqual(result.skins.map((item) => item.identifier), ['geometry.skin0', 'geometry.skin1']);
  assert.deepEqual(result.skins.map((item) => item.texture), ['skin0.png', 'skin1.png']);

  const manifest = JSON.parse(new TextDecoder().decode(result.files['manifest.json']!)) as {
    header: { name: string; uuid: string }; modules: { uuid: string }[];
  };
  assert.equal(manifest.header.name, 'My Collection');
  assert.equal(manifest.header.uuid, result.headerId);
  assert.equal(manifest.modules[0]!.uuid, result.moduleId);

  const skins = JSON.parse(new TextDecoder().decode(result.files['skins.json']!)) as {
    skins: { localization_name: string; geometry: string; texture: string }[];
  };
  assert.equal(skins.skins.length, 2);
  assert.equal(skins.skins[0]!.geometry, 'geometry.skin0');
  assert.equal(skins.skins[1]!.geometry, 'geometry.skin1');
  assert.equal(skins.skins[1]!.texture, 'skin1.png');

  const geometry = JSON.parse(new TextDecoder().decode(result.files['geometry.json']!)) as Record<string, unknown>;
  assert.deepEqual(Object.keys(geometry).sort(), ['format_version', 'geometry.skin0', 'geometry.skin1']);

  const english = new TextDecoder().decode(result.files['texts/en_US.lang']!);
  assert.match(english, /skinpack\.FourDGen_11111111111141118111111111111111=My Collection/);
  assert.match(english, /skin\.FourDGen_11111111111141118111111111111111\.skin1=Skin B/);

  const validated = await validateSkinPackFiles(result.files);
  assert.equal(validated.skins, 2);
  assert.deepEqual(validated.geometries.sort(), ['geometry.skin0', 'geometry.skin1']);
});

test('rejects empty packs, invalid names, missing PNG and multi-geometry skins', () => {
  assert.throws(() => buildSkinPackCollection({ skins: [] }), /at least one skin/);
  assert.throws(() => buildSkinPackCollection({ packName: ' ', skins: [skin('A', 32)] }), /Pack name/);
  assert.throws(() => buildSkinPackCollection({ skins: [{ ...skin('A', 32), png: Uint8Array.of(1) }] }), /PNG/);
  const file = buildImageSkinGeometry({ width: 24, height: 32, u0: 0, v0: 0, u1: 1, v1: 1 });
  assert.throws(() => buildSkinPackCollection({
    skins: [{ name: 'A', png, geometry: { ...file, 'geometry.extra': file['geometry.skin0']! } }],
  }), /exactly one geometry/);
});
