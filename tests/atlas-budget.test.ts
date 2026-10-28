import { test } from 'vitest';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import type { Document } from '@gltf-transform/core';
import { optimizeTextures } from '../src/texture-optimizer.ts';
import { documentFixture } from './fixtures.ts';
import type { IntermediateModel } from '../src/model.ts';

const model = (document: Document): IntermediateModel => ({
  document,
  source: {
    path: 'generated',
    format: 'gltf',
    units: 'meters',
    coordinates: 'right-handed-y-up',
    importer: 'gltf-transform',
  },
  warnings: [],
});

async function twoMaterials() {
  const doc = await documentFixture();
  const mesh = doc.getRoot().listMeshes()[0]!;
  const first = mesh.listPrimitives()[0]!;
  const second = first
    .clone()
    .setMaterial(
      doc
        .createMaterial('blue')
        .setBaseColorTexture(first.getMaterial()!.getBaseColorTexture()!.clone())
        .setMetallicFactor(0),
    );
  mesh.addPrimitive(second);
  return model(doc);
}

test('desktop budget path writes a valid 128 atlas and keeps UVs in range', async () => {
  const result = await optimizeTextures(await twoMaterials(), {
    compactSize: 128,
    padding: 1,
    atlasBudget: 'texel-retention',
  });
  const metadata = await sharp(Buffer.from(result.png)).metadata();
  assert.equal(metadata.width, 128);
  assert.equal(metadata.height, 128);
  const root = result.model.document.getRoot();
  assert.equal(root.listTextures().length, 1);
  let vertices = 0;
  for (const mesh of root.listMeshes())
    for (const primitive of mesh.listPrimitives()) {
      const uv = primitive.getAttribute('TEXCOORD_0')!;
      const value: number[] = [];
      for (let i = 0; i < uv.getCount(); i++) {
        uv.getElement(i, value);
        vertices++;
        assert.ok((value[0] ?? 0) >= -1e-6 && (value[0] ?? 0) <= 1 + 1e-6);
        assert.ok((value[1] ?? 0) >= -1e-6 && (value[1] ?? 0) <= 1 + 1e-6);
      }
    }
  assert.equal(vertices, 6);
  assert.ok(result.report.atlas.contentUtilization > 0.2);
  assert.ok(result.report.atlas.allocatedUtilization <= 1);
  assert.equal(result.report.allocation, 'texel-retention');
});

test('desktop budget path responds to per-material weights', async () => {
  const base = await optimizeTextures(await twoMaterials(), {
    compactSize: 128,
    padding: 1,
    atlasBudget: 'texel-retention',
  });
  const boosted = await optimizeTextures(await twoMaterials(), {
    compactSize: 128,
    padding: 1,
    atlasBudget: 'texel-retention',
    materialWeights: { green: 4 },
  });
  const area = (result: typeof base, material: string) => {
    const region = result.report.regions.find((entry) =>
      entry.materials.includes(material),
    )!;
    return region.width * region.height;
  };
  assert.ok(area(boosted, 'green') > area(base, 'green'));
  assert.ok(area(boosted, 'green') / area(boosted, 'blue') > 2);
});

test('legacy compact output is unchanged when atlasBudget is absent', async () => {
  const result = await optimizeTextures(await twoMaterials(), {
    compactSize: 128,
    padding: 1,
    allocation: 'surface-area',
  });
  assert.equal(result.report.allocation, 'surface-area');
  assert.ok(typeof result.report.atlas.sampledUtilization === 'number');
});
