import { realpath } from 'node:fs/promises';
import { basename, dirname, extname } from 'node:path';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { convertPrimitiveToTriangles } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';
import type { IntermediateModel } from './model.ts';
import { ModelIO, ModelResources } from './resources.ts';
import { readPMXMaterials } from './pmx-metadata.ts';
import { PMX_MATERIAL_MISMATCH, planPmxMaterials } from './pmx-materials.ts';
import { prepareVRM } from './avatar-import.ts';
import { validateModel } from './validate-model.ts';
import { decodeTGA } from './tga.ts';
import { ASSIMP_IMPORT_POST_PROCESS } from './assimp-import.ts';
import sharp from 'sharp';
import type { Document } from '@gltf-transform/core';

/** Assimp passes TGA textures through verbatim; browsers and the exporter need PNG. */
async function normalizeTgaTextures(document: Document, warn: (message: string) => void) {
  const converted: string[] = [];
  for (const texture of document.getRoot().listTextures()) {
    const image = texture.getImage();
    if (!image?.byteLength) continue;
    const mime = (texture.getMimeType() ?? '').toLowerCase();
    const uri = texture.getURI() ?? '';
    if (!mime.includes('tga') && !uri.toLowerCase().endsWith('.tga')) continue;
    try {
      const decoded = decodeTGA(image);
      const png = await sharp(decoded.data, {
        raw: { width: decoded.width, height: decoded.height, channels: 4 },
      }).png().toBuffer();
      texture.setImage(new Uint8Array(png)).setMimeType('image/png');
      if (uri) texture.setURI(uri.replace(/\.tga$/i, '.png'));
      converted.push(uri || '(embedded)');
    } catch (error) {
      warn(`TGA texture ${uri || '(embedded)'} could not be converted: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (converted.length)
    warn(`Converted ${converted.length} TGA texture(s) to PNG for preview and export: ${converted.join(', ')}`);
}

export interface ImportOptions {
  backend?: 'auto' | 'native' | 'wasm';
  /** Coarse progress callback for long imports; labels are user-facing. */
  onStage?: (stage: string) => void;
}

/**
 * Only formats covered by import and full conversion tests are advertised.
 */
export const INPUT_FORMATS = ['obj', 'glb', 'gltf', 'fbx', 'dae', 'stl', 'ply', 'pmx', 'vrm'] as const;

export async function importModel(input: string, options: ImportOptions = {}): Promise<IntermediateModel> {
  const extension = extname(input).toLowerCase();
  if (['.unitypackage', '.asset', '.prefab', '.bundle'].includes(extension)) throw new Error('Unity project/package assets are not standalone models. Export FBX or VRM with textures first.');
  if (extension === '.pmd') throw new Error('Unsupported input format: PMD. Export as PMX 2.0/2.1 first.');
  if (!INPUT_FORMATS.some((format) => extension === '.' + format)) throw new Error(`Unsupported input format: ${extension || '(none)'}. Supported: ${INPUT_FORMATS.join(', ')}`);
  const path = await realpath(input);
  const format = extension.slice(1) as IntermediateModel['source']['format'];
  const direct = format === 'glb' || format === 'gltf' || format === 'vrm';
  const resources = new ModelResources(dirname(path));
  const warnings: string[] = [];
  const warn = (message: string) => { if (!warnings.includes(message)) warnings.push(message); };
  await MeshoptDecoder.ready;
  const io = new ModelIO(resources).registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
    .setStrictResources(true).setLogger({ debug() {}, info() {}, warn, error: warn });
  const pmx = format === 'pmx' ? readPMXMaterials(await resources.read(path)) : undefined;
  let entry = path;
  let backend: 'native' | 'wasm' | undefined;
  options.onStage?.('正在转换模型格式…');
  if (!direct) {
    // Direct glTF/VRM inputs must not load the optional native Assimp addon.
    const { createAssimp } = await import('libassimp');
    const assimp = await createAssimp({ backend: options.backend ?? 'auto', onLog: (log) => {
      if (log.level !== 'info') warn(log.message);
    } });
    try {
      backend = assimp.backend;
      const missing = new Set<string>();
      const result = await assimp.convert({ name: basename(path), bytes: await resources.read(path) }, {
        to: 'glb',
        postProcess: ASSIMP_IMPORT_POST_PROCESS,
        resolve: async (name) => {
          try { return await resources.read(name); }
          catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
            missing.add(name);
            return undefined;
          }
        },
      });
      if (missing.size) throw new Error(`Missing ${format.toUpperCase()} resources: ${[...missing].join(', ')}`);
      // Every returned file participates in the same virtual resource directory.
      for (const file of result.files) resources.virtual.set(resources.path(file.name), file.bytes);
      const glb = result.files.find((file) => file.name.toLowerCase().endsWith('.glb'));
      if (!glb) throw new Error('Assimp did not produce a GLB');
      entry = resources.path(glb.name);
      warn(`${format.toUpperCase()} is normalized through Assimp; source units and axis metadata are not retained. Inspect orientation before use.`);
    } finally { assimp.dispose(); }
  }
  const json = await io.readAsJSON(entry);
  const avatar = format === 'vrm' || json.json.extensions?.VRM || json.json.extensions?.VRMC_vrm ? prepareVRM(json, warn) : undefined;
  if (pmx) {
    // PMX extra UVs are four-component auxiliary data. Assimp emits them as
    // TEXCOORD_n, which is illegal glTF and unused by this base-color pipeline.
    for (const mesh of json.json.meshes ?? []) for (const primitive of mesh.primitives) {
      for (const semantic of Object.keys(primitive.attributes)) if (/^TEXCOORD_[1-9]\d*$/.test(semantic) &&
        json.json.accessors?.[primitive.attributes[semantic]!]!.type !== 'VEC2') {
        const material = json.json.materials?.[primitive.material ?? -1];
        if (material?.pbrMetallicRoughness?.baseColorTexture?.texCoord === Number(semantic.slice(9))) throw new Error('PMX base color references unsupported auxiliary UV');
        delete primitive.attributes[semantic];
        warn('PMX four-component auxiliary UV channels are omitted; only renderable base-color UVs are retained.');
      }
    }
    if (json.json.materials?.length !== pmx.materials.length) throw new Error(PMX_MATERIAL_MISMATCH);
    const plan = planPmxMaterials(pmx.materials, json.json.materials.length);
    if (!plan) throw new Error(PMX_MATERIAL_MISMATCH);
    plan.forEach((material, index) => {
      const target = json.json.materials![index]!;
      target.doubleSided = material.doubleSided;
      target.name = material.name;
      target.alphaMode = material.alphaMode;
      const pbr = target.pbrMetallicRoughness ??= {};
      pbr.baseColorFactor = [...(pbr.baseColorFactor ?? [1, 1, 1, 1])];
      pbr.baseColorFactor[3] = material.alpha;
    });
  }
  if (format === 'pmx') warn('PMX static fallback: Assimp may omit morphs, physics, IK, toon/sphere maps, outlines and shadow draw flags; SDEF/QDEF are reduced to linear weights. No MMD animation fidelity is promised.');
  // NodeIO warns for unknown optional extensions; retain their exact names even if unused.
  const supported = new Set(ALL_EXTENSIONS.map((extension) => extension.EXTENSION_NAME));
  for (const extension of json.json.extensionsUsed ?? []) {
    if (!supported.has(extension)) warn(`Unsupported glTF extension: ${extension}`);
  }
  const document = await io.readJSON(json);
  options.onStage?.('正在处理材质与贴图…');
  await normalizeTgaTextures(document, warn);
  for (const mesh of document.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    if (p.getMode() === 5 || p.getMode() === 6) {
      convertPrimitiveToTriangles(p);
      warn('Triangle strip/fan topology was normalized to indexed triangles.');
    }
  }
  const model: IntermediateModel = {
    document,
    source: {
      path, format, units: direct ? 'meters' : 'unspecified',
      coordinates: direct ? 'right-handed-y-up' : 'unspecified',
      importer: direct ? 'gltf-transform' : 'libassimp',
      ...(backend ? { backend } : {}),
      ...(avatar ? { avatar } : {}),
    }, warnings,
  };
  options.onStage?.('正在校验模型…');
  validateModel(model);
  if (document.getRoot().listSkins().length) warn('Skin joints and original weights are preserved; bounds use node transforms, not evaluated skin deformation.');
  if (document.getRoot().listAnimations().length) warn('Animation data is preserved; inspect uses the initial node pose.');
  if (document.getRoot().listMeshes().some((mesh) => mesh.listPrimitives().some((p) => p.listTargets().length))) {
    warn('Morph targets are preserved; bounds use base positions without morph deformation.');
  }
  return model;
}
