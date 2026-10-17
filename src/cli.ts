import { importModel } from './importer.ts';
import { formatInspection, inspectModel } from './inspect.ts';

const help = `Usage: bun run src/cli.ts inspect <model.obj|model.glb|model.gltf> [--json] [--backend auto|native|wasm]

inspect reads model geometry, materials, textures, hierarchy and skin data.
--backend selects the OBJ Assimp backend. GLB/glTF are read directly.
convert and validate are planned for later milestones and are not implemented yet.`;

try {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') console.log(help);
  else {
    if (args.shift() !== 'inspect') throw new Error('Only inspect is available in this milestone. Use --help.');
    const input = args.shift();
    if (!input || input.startsWith('--')) throw new Error('inspect requires a model path');
    let json = false;
    let backend: 'auto' | 'native' | 'wasm' = 'auto';
    while (args.length) {
      const option = args.shift();
      if (option === '--json') json = true;
      else if (option === '--backend') {
        const value = args.shift();
        if (value !== 'auto' && value !== 'native' && value !== 'wasm') throw new Error('Invalid --backend: expected auto, native or wasm');
        backend = value;
      } else throw new Error(`Unknown argument: ${option}`);
    }
    const report = await inspectModel(await importModel(input, { backend }));
    console.log(json ? JSON.stringify(report, null, 2) : formatInspection(report));
  }
} catch (error) {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
