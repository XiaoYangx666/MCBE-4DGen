import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { parseGeometryJSON } from './geometry-validator.ts';
import { renderGeometryPreview } from './geometry-preview.ts';
import type { PreviewOptions } from './geometry-preview.ts';
import { readSkinPack, validateSkinPackFiles } from './skin-pack.ts';

/** Resolves only the written output files: never re-imports the original source model. */
export async function previewOutput(input: string, options: PreviewOptions & { texture?: string } = {}) {
  if (extname(input).toLowerCase() === '.json') {
    if (!options.texture) throw new Error('Previewing geometry.json requires --texture <PNG path>');
    const parsed = parseGeometryJSON(await readFile(input, 'utf8'));
    return renderGeometryPreview(parsed.file, await readFile(options.texture), options);
  }
  if (options.texture) throw new Error('--texture is only supported with a geometry JSON input');
  const files = await readSkinPack(input);
  await validateSkinPackFiles(files);
  const skins = JSON.parse(new TextDecoder().decode(files['skins.json']!)).skins as { geometry: string; texture: string }[];
  const matches = options.identifier ? skins.filter((skin) => skin.geometry === options.identifier) : skins;
  if (matches.length !== 1) throw new Error('Select exactly one skin geometry with --geometry; shared-geometry skin variants are not supported');
  const skin = matches[0]!;
  const geometry = parseGeometryJSON(new TextDecoder().decode(files['geometry.json']!));
  return renderGeometryPreview(geometry.file, files[skin.texture]!, { ...options, identifier: skin.geometry });
}
