import { lstat, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, parse as parsePath, resolve } from 'node:path';
import { importModel, INPUT_FORMATS } from './importer.ts';
import { formatInspection, inspectModel } from './inspect.ts';
import { optimizeModel } from './optimizer.ts';
import { previewOutput } from './preview.ts';
import type { PreviewOptions } from './geometry-preview.ts';
import { bindStatic } from './bone-mapper.ts';
import { exportBedrockGeometry } from './bedrock-exporter.ts';
import { buildSkinPack, validateSkinPackFiles, validateSkinPackPath, zipSkinPack } from './skin-pack.ts';
import { exportHumanoid } from './humanoid.ts';
import type { HumanoidProfile } from './humanoid.ts';

const help = [
  'Minecraft Bedrock 4D/5D Skin Converter',
  '',
  'Usage:',
  '  bun run src/cli.ts inspect <model> [--json] [--backend auto|native|wasm]',
  '  bun run src/cli.ts convert <model> [options]',
  '  bun run src/cli.ts validate <directory|file.mcpack>',
  '  bun run src/cli.ts preview <directory|file.mcpack|geometry.json> [--out file.png]',
  '    [--texture atlas.png] [--geometry geometry.id] [--size 64..1024] [--no-cull] [--unlit]',
  '',
  'Convert options:',
  '  --out <directory>    Output folder (default: ./<model-name>-skin-pack)',
  '  --name <name>        Pack name (default: Custom Skin Pack)',
  '  --height <number>    Final model height (default: 32)',
  '  --binding <mode>     static (default) or humanoid (VRM rigid player limbs)',
  '  --humanoid-profile <json>  Per-avatar shoulderOutset and armSpreadDegrees',
  '  --ratio <0..1>       Optional triangle reduction target (default: original)',
  '  --max-texture <int>  Maximum source texture edge (default: 256)',
  '  --atlas <int>        Fixed atlas edge (default: automatic)',
  '  --backend <name>     Assimp importer: auto, native, wasm (except GLB/glTF)',
  '  --no-mcpack         Write unpacked files only (default: also create .mcpack)',
  '',
  'Output: manifest.json, skins.json, geometry.json, skin0.png, texts/, and optionally .mcpack.',
  'Input formats: ' + INPUT_FORMATS.join(', '),
  'Default static binding attaches the whole model to body; --binding humanoid uses VRM player limbs.',
].join('\n');

function positive(value: string | undefined, label: string, integer = false): number {
  const n = Number(value);
  if (value === undefined || !Number.isFinite(n) || n <= 0 || (integer && !Number.isSafeInteger(n))) {
    throw new Error(label + ' must be a positive ' + (integer ? 'integer' : 'number'));
  }
  return n;
}
function backend(value: string | undefined): 'auto' | 'native' | 'wasm' {
  if (value !== 'auto' && value !== 'native' && value !== 'wasm') {
    throw new Error('Invalid --backend: expected auto, native or wasm');
  }
  return value;
}
async function main() {
  const args = process.argv.slice(2);
  const command = args.shift();
  if (command === undefined || command === '--help' || command === '-h') {
    console.log(help);
    return;
  }
  const input = args.shift();
  if (!input || input.startsWith('--')) throw new Error(command + ' requires an input path');
  if (command === 'inspect') {
    let json = false, importer: 'auto' | 'native' | 'wasm' = 'auto';
    while (args.length) {
      const option = args.shift();
      if (option === '--json') json = true;
      else if (option === '--backend') importer = backend(args.shift());
      else throw new Error('Unknown inspect argument: ' + option);
    }
    const report = await inspectModel(await importModel(input, { backend: importer }));
    console.log(json ? JSON.stringify(report, null, 2) : formatInspection(report));
    return;
  }
  if (command === 'preview') {
    let out = resolve(parsePath(basename(input)).name + '-preview.png');
    const options: PreviewOptions & { texture?: string } = {};
    while (args.length) {
      const flag = args.shift()!;
      if (flag === '--no-cull') options.cullBackfaces = false;
      else if (flag === '--unlit') options.unlit = true;
      else if (['--out', '--texture', '--geometry', '--size'].includes(flag)) {
        const value = args.shift();
        if (!value || value.startsWith('--')) throw new Error('Missing value for ' + flag);
        if (flag === '--out') out = resolve(value);
        else if (flag === '--texture') options.texture = value;
        else if (flag === '--geometry') options.identifier = value;
        else options.size = positive(value, flag, true);
      } else throw new Error('Unknown preview argument: ' + flag);
    }
    const result = await previewOutput(input, options);
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, result.png, { flag: 'wx' });
    const { png, ...report } = result;
    console.log(JSON.stringify({ output: out, ...report }, null, 2));
    return;
  }
  if (command === 'validate') {
    if (args.length) throw new Error('validate expects exactly one directory or .mcpack');
    const result = await validateSkinPackPath(input);
    console.log(JSON.stringify({ valid: true, ...result }, null, 2));
    return;
  }
  if (command !== 'convert') throw new Error('Unknown command: ' + command + '\n' + help);
  let out: string | undefined, packName = 'Custom Skin Pack', height = 32;
  let ratio: number | undefined, textureSize = 256, atlas: number | undefined;
  let importer: 'auto' | 'native' | 'wasm' = 'auto', mcpack = true;
  let binding: 'static' | 'humanoid' = 'static';
  let profilePath: string | undefined;
  const requireValue = (flag: string): string => {
    const next = args.shift();
    if (next === undefined || next.startsWith('--')) throw new Error('Missing value for ' + flag);
    return next;
  };
  while (args.length) {
    const flag = args.shift()!;
    if (flag === '--out') out = requireValue(flag);
    else if (flag === '--name') packName = requireValue(flag);
    else if (flag === '--height') height = positive(requireValue(flag), flag);
    else if (flag === '--humanoid-profile') profilePath = requireValue(flag);
    else if (flag === '--binding') {
      const value = requireValue(flag);
      if (value !== 'static' && value !== 'humanoid') throw new Error('--binding must be static or humanoid');
      binding = value;
    }
    else if (flag === '--ratio') {
      ratio = positive(requireValue(flag), flag);
      if (ratio > 1) throw new Error('--ratio must not exceed 1');
    }
    else if (flag === '--max-texture') textureSize = positive(requireValue(flag), flag, true);
    else if (flag === '--atlas') atlas = positive(requireValue(flag), flag, true);
    else if (flag === '--backend') importer = backend(requireValue(flag));
    else if (flag === '--no-mcpack') mcpack = false;
    else throw new Error('Unknown convert argument: ' + flag);
  }
  const outputDir = resolve(out ?? (parsePath(basename(input)).name + '-skin-pack'));
  const archivePath = outputDir + '.mcpack';
  if (mcpack) {
    try {
      await lstat(archivePath);
      throw new Error('Output archive already exists: ' + archivePath + '. Choose another --out path.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  try {
    const entries = await readdir(outputDir);
    if (entries.length) throw new Error('Output directory is not empty: ' + outputDir + '. Choose another --out path.');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const options = {
    prepare: { height, center: 'ground' as const },
    mesh: ratio === undefined ? { preset: 'original' as const } : { ratio, maxError: 0.001 },
    texture: { maxTextureSize: textureSize, ...(atlas !== undefined ? { atlasSize: atlas } : { compactSize: 128, padding: 1 }) },
  };
  const model = await importModel(input, { backend: importer });
  if (binding === 'humanoid' && ratio !== undefined) throw new Error('Humanoid binding currently preserves original triangles; omit --ratio');
  let profile: HumanoidProfile | undefined;
  if (profilePath) {
    if (binding !== 'humanoid') throw new Error('--humanoid-profile requires --binding humanoid');
    const value: unknown = JSON.parse(await readFile(profilePath, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some((key) => !['shoulderOutset', 'armSpreadDegrees', 'materialRules', 'boneMap', 'rotationYDegrees'].includes(key))) throw new Error('Invalid humanoid profile fields');
    profile = value as HumanoidProfile;
  }
  const humanoid = binding === 'humanoid' ? await exportHumanoid(model, { height, textureSize, ...(profile ? { profile } : {}), ...(atlas ? { atlas } : {}) }) : null;
  const optimized = humanoid ? null : await optimizeModel(model, options);
  const exported = humanoid ?? await exportBedrockGeometry(bindStatic(optimized!.model), { identifier: 'geometry.skin0', skinTextureSize: 128 });
  const files = buildSkinPack({ geometry: exported.file, png: exported.png, packName, identifier: 'geometry.skin0' });
  await validateSkinPackFiles(files);
  const zip = mcpack ? await zipSkinPack(files) : null;
  await mkdir(outputDir, { recursive: true });
  for (const [name, bytes] of Object.entries(files)) {
    const path = resolve(outputDir, name); await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes, { flag: 'wx' });
  }
  const result = await validateSkinPackPath(outputDir);
  if (zip) {
    await writeFile(archivePath, zip, { flag: 'wx' });
    await validateSkinPackPath(archivePath);
  }
  console.log(JSON.stringify({
    outputDir,
    ...(zip ? { mcpack: archivePath } : {}),
    ...result,
    binding,
    ...(humanoid ? { humanoid: humanoid.binding } : {}),
    sourceTriangles: optimized?.report.mesh.before ?? exported.report.sourceTriangles,
    optimizedTriangles: exported.report.sourceTriangles,
    addedBackfaces: exported.report.addedBackfaces,
    triangles: exported.report.triangles,
    geometryBytes: files['geometry.json']!.byteLength,
    textureBytes: files['skin0.png']!.byteLength,
    ...(zip ? { archiveBytes: zip.byteLength } : {}),
    warnings: exported.report.warnings,
  }, null, 2));
}

try { await main(); }
catch (error) {
  console.error('Error: ' + (error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
}

