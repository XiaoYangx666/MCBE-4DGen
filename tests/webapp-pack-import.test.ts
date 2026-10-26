import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import sharp from 'sharp';
import type { BedrockGeometryFile } from '../src/bedrock-types.ts';
import { buildImageSkinGeometry } from '../src/image-skin-geometry.ts';
import { buildSkinPackCollection, type SkinPackCollectionSkin } from '../src/skin-pack-files.ts';
import { importSkinPackZip } from '../webapp/lib/pack-import.ts';
import { zipSkinPackBlob } from '../src/skin-pack-zip.ts';
import { firstGeometryIdentifier } from '../web/shared/poly-mesh-preview.ts';

const png = await sharp({
  create: { width: 128, height: 128, channels: 4, background: { r: 100, g: 120, b: 160, alpha: 1 } },
}).png().toBuffer();

function skin(name: string, width: number): SkinPackCollectionSkin {
  return {
    name,
    png,
    geometry: buildImageSkinGeometry({ width, height: 32, u0: 0, v0: 0, u1: 1, v1: 1 }),
  };
}

async function zipPack(folder?: string) {
  const collection = buildSkinPackCollection({
    packName: 'Shared Pack',
    headerId: '33333333-3333-4333-8333-333333333333',
    moduleId: '44444444-4444-4444-8444-444444444444',
    skins: [skin('Skin A', 24), skin('Skin B', 32)],
  });
  const zip = new JSZip();
  const root = folder ? zip.folder(folder)! : zip;
  for (const [name, bytes] of Object.entries(collection.files)) root.file(name, bytes);
  return new Uint8Array(await zip.generateAsync({ type: 'uint8array' }));
}

describe('webapp skin pack import', () => {
  it('imports a folder-wrapped two-skin pack and restores localized names', async () => {
    const bytes = await zipPack('4DGen-33333333');
    const imported = await importSkinPackZip(new File([bytes], 'shared.zip', { type: 'application/zip' }));
    expect(imported.name).toBe('Shared Pack');
    expect(imported.headerId).toBe('33333333-3333-4333-8333-333333333333');
    expect(imported.moduleId).toBe('44444444-4444-4444-8444-444444444444');
    expect(imported.skins.map((item) => item.name)).toEqual(['Skin A', 'Skin B']);
    expect(imported.skins.map((item) => item.source)).toEqual(['import', 'import']);
    expect(imported.skins[0]!.triangles).toBe(4);
    expect(imported.skipped).toEqual([]);
  });

  it('imports a flat zip and rejects archives without a manifest', async () => {
    const imported = await importSkinPackZip(new File([await zipPack()], 'flat.zip'));
    expect(imported.skins).toHaveLength(2);

    const zip = new JSZip();
    zip.file('readme.txt', 'not a pack');
    const bad = new Uint8Array(await zip.generateAsync({ type: 'uint8array' }));
    await expect(importSkinPackZip(new File([bad], 'bad.zip'))).rejects.toThrow(/manifest/);
  });

  it('previews imported packs whose geometry identifier is not geometry.skin0', () => {
    const source = buildImageSkinGeometry({ width: 32, height: 32, u0: 0, v0: 0, u1: 1, v1: 1 });
    const renamed = {
      format_version: '1.8.0',
      'geometry.imported_model': source['geometry.skin0'],
    } as unknown as BedrockGeometryFile;
    expect(firstGeometryIdentifier(renamed)).toBe('geometry.imported_model');
    expect(() => firstGeometryIdentifier({ format_version: '1.8.0' })).toThrow(/poly_mesh/);
  });

  it('exports a flat ZIP with every pack file at the root', async () => {
    const collection = buildSkinPackCollection({
      packName: 'Shared Pack',
      headerId: '33333333-3333-4333-8333-333333333333',
      moduleId: '44444444-4444-4444-8444-444444444444',
      skins: [skin('Skin A', 24)],
    });
    const blob = await zipSkinPackBlob(collection.files);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const files = Object.keys(zip.files).filter((name) => !zip.files[name]?.dir).sort();
    expect(files).toEqual(Object.keys(collection.files).sort());
    expect(files).toContain('manifest.json');
    expect(files).toContain('texts/en_US.lang');
    expect(files.every((name) => !name.includes('/') || name.startsWith('texts/'))).toBe(true);
  });
});
