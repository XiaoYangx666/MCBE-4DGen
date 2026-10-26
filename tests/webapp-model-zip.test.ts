import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { expandModelArchives, isModelArchive, isModelAsset } from '../webapp/lib/model-zip.ts';

async function zipFile(entries: Record<string, string | Uint8Array>, name = 'model.zip') {
  const zip = new JSZip();
  for (const [path, value] of Object.entries(entries)) zip.file(path, value);
  const bytes = new Uint8Array(await zip.generateAsync({ type: 'uint8array' }));
  return new File([bytes], name, { type: 'application/zip' });
}

describe('webapp model ZIP import', () => {
  it('unpacks models and sidecars while keeping archive-relative paths', async () => {
    const archive = await zipFile({
      'character/model.gltf': '{"asset":{"version":"2.0"}}',
      'character/textures/body.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      'character/model.bin': new Uint8Array([1, 2, 3]),
      'character/notes.txt': 'ignored',
      '__MACOSX/character/._model.gltf': new Uint8Array([0]),
      '.DS_Store': new Uint8Array([0]),
    });

    const expanded = await expandModelArchives([archive]);
    expect(expanded.files.map((file) => file.name).sort())
      .toEqual(['body.png', 'model.bin', 'model.gltf']);
    const gltf = expanded.files.find((file) => file.name === 'model.gltf')!;
    expect(gltf.webkitRelativePath).toBe('character/model.gltf');
    expect(gltf.type).toBe('model/gltf+json');
    expect(expanded.warnings.join()).toMatch(/跳过 1 个/);
  });

  it('passes plain model files through untouched', async () => {
    const plain = new File([new Uint8Array([1])], 'hero.glb');
    const expanded = await expandModelArchives([plain]);
    expect(expanded.files).toEqual([plain]);
    expect(expanded.warnings).toEqual([]);
  });

  it('rejects archives without model assets and detects zip names', async () => {
    const archive = await zipFile({ 'readme.md': 'no model here' }, 'assets.zip');
    await expect(expandModelArchives([archive])).rejects.toThrow(/没有找到模型/);
    expect(isModelArchive(new File([], 'a.ZIP'))).toBe(true);
    expect(isModelArchive(new File([], 'a.glb'))).toBe(false);
    expect(isModelAsset('textures/a.PNG')).toBe(true);
    expect(isModelAsset('a.psd')).toBe(false);
  });

  it('points skin pack archives at the skin pack page', async () => {
    const archive = await zipFile({
      'pack/manifest.json': '{}',
      'pack/skins.json': '{"skins":[]}',
      'pack/skin0.png': new Uint8Array([1]),
    }, 'pack.zip');
    await expect(expandModelArchives([archive])).rejects.toThrow(/皮肤包/);
  });
});
