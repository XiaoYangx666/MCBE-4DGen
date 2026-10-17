import { realpath } from 'node:fs/promises';
import { basename, dirname, extname } from 'node:path';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { createAssimp } from 'libassimp';
import { MeshoptDecoder } from 'meshoptimizer';
import type { IntermediateModel } from './model.ts';
import { ModelIO, ModelResources } from './resources.ts';
import { validateModel } from './validate-model.ts';

export interface ImportOptions { backend?: 'auto' | 'native' | 'wasm' }

export async function importModel(input: string, options: ImportOptions = {}): Promise<IntermediateModel> {
  const extension = extname(input).toLowerCase();
  if (!['.obj', '.glb', '.gltf'].includes(extension)) throw new Error(`Unsupported input format: ${extension || '(none)'}`);
  const path = await realpath(input);
  const format = extension.slice(1) as 'obj' | 'glb' | 'gltf';
  const resources = new ModelResources(dirname(path));
  const warnings: string[] = [];
  const warn = (message: string) => { if (!warnings.includes(message)) warnings.push(message); };
  await MeshoptDecoder.ready;
  const io = new ModelIO(resources).registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
    .setStrictResources(true).setLogger({ debug() {}, info() {}, warn, error: warn });
  let entry = path;
  let backend: 'native' | 'wasm' | undefined;
  if (format === 'obj') {
    const assimp = await createAssimp({ backend: options.backend ?? 'auto', onLog: (log) => {
      if (log.level !== 'info') warn(log.message);
    } });
    try {
      backend = assimp.backend;
      const missing = new Set<string>();
      const result = await assimp.convert({ name: basename(path), bytes: await resources.read(path) }, {
        to: 'glb',
        resolve: async (name) => {
          try { return await resources.read(name); }
          catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
            missing.add(name);
            return undefined;
          }
        },
      });
      if (missing.size) throw new Error(`Missing OBJ resources: ${[...missing].join(', ')}`);
      // Every returned file participates in the same virtual resource directory.
      for (const file of result.files) resources.virtual.set(resources.path(file.name), file.bytes);
      const glb = result.files.find((file) => file.name.toLowerCase().endsWith('.glb'));
      if (!glb) throw new Error('Assimp did not produce a GLB');
      entry = resources.path(glb.name);
      warn('OBJ units and source coordinate convention are unspecified; coordinates are preserved without guessing.');
    } finally { assimp.dispose(); }
  }
  const json = await io.readAsJSON(entry);
  // NodeIO warns for unknown optional extensions; retain their exact names even if unused.
  const supported = new Set(ALL_EXTENSIONS.map((extension) => extension.EXTENSION_NAME));
  for (const extension of json.json.extensionsUsed ?? []) {
    if (!supported.has(extension)) warn(`Unsupported glTF extension: ${extension}`);
  }
  const document = await io.readJSON(json);
  const model: IntermediateModel = {
    document,
    source: {
      path, format, units: format === 'obj' ? 'unspecified' : 'meters',
      coordinates: format === 'obj' ? 'unspecified' : 'right-handed-y-up',
      importer: format === 'obj' ? 'libassimp' : 'gltf-transform',
      ...(backend ? { backend } : {}),
    }, warnings,
  };
  validateModel(model);
  if (document.getRoot().listSkins().length) warn('Skin joints and original weights are preserved; bounds use node transforms, not evaluated skin deformation.');
  if (document.getRoot().listAnimations().length) warn('Animation data is preserved; inspect uses the initial node pose.');
  if (document.getRoot().listMeshes().some((mesh) => mesh.listPrimitives().some((p) => p.listTargets().length))) {
    warn('Morph targets are preserved; bounds use base positions without morph deformation.');
  }
  return model;
}
