import { Document, type Node } from '@gltf-transform/core';
import { realpath } from 'node:fs/promises';
import { basename, dirname, extname } from 'node:path';
import sharp from 'sharp';
import type { IntermediateModel } from './model.ts';
import { ModelResources } from './resources.ts';
import { decodeTGA } from './tga.ts';
import { validateModel } from './validate-model.ts';
import {
  buildYsmImportPlan,
  parseYsmGeometry,
  parseYsmManifest,
  type YsmDiagnostic,
  type YsmSceneNode,
} from './ysm-model.ts';

export interface YsmImportOptions {
  /** Coarse progress callback for long imports; labels are user-facing. */
  onStage?: (stage: string) => void;
}

async function readTexture(bytes: Uint8Array, path: string): Promise<{ image: Uint8Array<ArrayBuffer>; hasAlpha: boolean }> {
  if (extname(path).toLowerCase() === '.tga') {
    const decoded = decodeTGA(bytes);
    const png = await sharp(decoded.data, {
      raw: { width: decoded.width, height: decoded.height, channels: 4 },
    }).png().toBuffer();
    return { image: new Uint8Array(png), hasAlpha: true };
  }
  let metadata;
  try {
    metadata = await sharp(bytes).metadata();
  } catch {
    throw new Error(`YSM texture could not be decoded: ${path}`);
  }
  if (metadata.format === 'png') return { image: new Uint8Array(bytes), hasAlpha: !!metadata.hasAlpha };
  // YSM ships PNG in practice; convert anything else sharp understands so the
  // rest of the pipeline always sees one PNG atlas source.
  const png = await sharp(bytes).png().toBuffer();
  const converted = await sharp(png).metadata();
  return { image: new Uint8Array(png), hasAlpha: !!converted.hasAlpha };
}

/** English wording for shared YSM diagnostics; the webapp has its own formatter. */
function ysmWarning(diagnostic: YsmDiagnostic): string {
  switch (diagnostic.code) {
    case 'cube-not-object':
      return `Ignored cube ${diagnostic.cube}: not an object.`;
    case 'cube-without-uv':
      return `Ignored cube ${diagnostic.cube}: no supported UV data.`;
    case 'face-uv-rotation-ignored':
      return 'YSM per-face UV rotation is not supported and was ignored.';
    case 'multiple-geometries':
      return `YSM model contains ${diagnostic.count} geometries; only the first was imported.`;
    case 'bone-not-object':
      return `Ignored bone ${diagnostic.bone}: not an object.`;
    case 'bone-without-name':
      return `Ignored bone ${diagnostic.bone}: missing a name.`;
    case 'duplicate-bone':
      return `Duplicate YSM bone name "${diagnostic.name}" was merged by name.`;
    case 'duplicate-bone-conflict':
      return `Duplicate YSM bone "${diagnostic.name}" has a different pivot/rotation/parent; its cubes keep their own source transform, but they share the first bone's hierarchy.`;
    case 'cyclic-bone':
      return `Cyclic YSM bone hierarchy at "${diagnostic.name}"; the cycle was treated as unparented.`;
    case 'missing-parent':
      return `YSM bone "${diagnostic.name}" references missing parent "${diagnostic.parent}"; it was treated as unparented.`;
    case 'hidden-bones':
      return `Excluded ${diagnostic.names.length} YSM bone(s) hidden by default animations: ${diagnostic.names.join(', ')}.`;
    case 'missing-role':
      return `YSM six-part binding is missing the ${diagnostic.role} bone.`;
    case 'hand-fallback':
      return `YSM ${diagnostic.side} arm has no hand bone; using "${diagnostic.name}" as the hand pivot.`;
    case 'incomplete-rig':
      return 'YSM model does not expose a complete head/body/arms/legs rig; six-part binding is unavailable.';
    case 'humanoid-mapped':
      return 'YSM skeleton was mapped to the six player parts (head, body, arms, legs); tail, hair and other secondary bones stay attached to the nearest part.';
    case 'missing-part-geometry':
      return `YSM model has no geometry for ${diagnostic.parts.join(', ')}; static whole-body binding will be used.`;
    case 'static-binding':
      return 'YSM model does not expose a complete head/body/arms/legs rig; static whole-body binding will be used.';
    case 'pbr-textures-ignored':
      return 'YSM PBR normal/specular maps are ignored; only the base-color texture is imported.';
    case 'default-texture-missing':
      return `YSM default texture "${diagnostic.wanted}" was not found; using "${diagnostic.used}" instead.`;
    case 'multiple-textures':
      return `YSM model has ${diagnostic.count} textures; only the default texture "${diagnostic.used}" was imported.`;
    case 'arm-model-ignored':
      return 'YSM arm model is ignored; only the player body is imported.';
    case 'animations-not-evaluated':
      return 'YSM animations, animation controllers, locators and Molang expressions are not evaluated; the static model pose is used.';
    case 'imported-texture':
      return `YSM model "${diagnostic.model}" was imported with the default texture "${diagnostic.texture}".`;
  }
}

function instantiateYsmNode(doc: Document, scene: ReturnType<Document['createScene']>, descriptor: YsmSceneNode, material: ReturnType<Document['createMaterial']>, buffer: ReturnType<Document['createBuffer']>, parent?: Node): void {
  const node = doc.createNode(descriptor.name).setTranslation(descriptor.translation);
  const extras = {
    ...(descriptor.role ? { _humanoidRole: descriptor.role } : {}),
    ...(descriptor.part ? { _playerPart: descriptor.part } : {}),
  };
  if (Object.keys(extras).length) node.setExtras(extras);
  if (descriptor.mesh) {
    const mesh = descriptor.mesh;
    const primitive = doc.createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(mesh.positions as Float32Array<ArrayBuffer>).setBuffer(buffer))
      .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(mesh.normals as Float32Array<ArrayBuffer>).setBuffer(buffer))
      .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(mesh.uvs as Float32Array<ArrayBuffer>).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(mesh.indices as Uint32Array<ArrayBuffer>).setBuffer(buffer))
      .setMaterial(material);
    node.setMesh(doc.createMesh(descriptor.name).addPrimitive(primitive));
  }
  if (parent) parent.addChild(node);
  else scene.addChild(node);
  for (const child of descriptor.children)
    instantiateYsmNode(doc, scene, child, material, buffer, node);
}

/**
 * Import the folder-format body of a Yes Steve Model model. `input` is the
 * `ysm.json` file; its containing directory is the model root. Animations,
 * controllers, the arm model and runtime Molang expressions are not evaluated.
 */
export async function importYsmModel(input: string, options: YsmImportOptions = {}): Promise<IntermediateModel> {
  const path = await realpath(input);
  const root = dirname(path);
  const resources = new ModelResources(root);
  const warnings: string[] = [];
  const warn = (message: string) => { if (!warnings.includes(message)) warnings.push(message); };
  const warnDiagnostics = (diagnostics: readonly YsmDiagnostic[]) => {
    for (const diagnostic of diagnostics) warn(ysmWarning(diagnostic));
  };
  options.onStage?.('正在读取 YSM 模型清单…');
  const manifest = parseYsmManifest(JSON.parse(new TextDecoder().decode(await resources.read(basename(path)))));
  options.onStage?.('正在解析 YSM 几何…');
  const parsed = parseYsmGeometry(JSON.parse(new TextDecoder().decode(await resources.read(manifest.mainModel))));
  let animation: unknown;
  if (manifest.mainAnimation) {
    try {
      animation = JSON.parse(new TextDecoder().decode(await resources.read(manifest.mainAnimation)));
    } catch (error) {
      warn(`YSM animation file "${manifest.mainAnimation}" could not be read; hidden GUI/overlay bones were not excluded: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const plan = buildYsmImportPlan(manifest, parsed.geometry, animation);
  warnDiagnostics([...parsed.diagnostics, ...plan.diagnostics]);
  const modelName = manifest.name ?? basename(root);
  warnDiagnostics([{ code: 'imported-texture', model: modelName, texture: plan.textureName }]);
  options.onStage?.('正在读取 YSM 贴图…');
  const image = await readTexture(await resources.read(plan.texture.uv), plan.texture.uv);

  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene('YSM');
  const textureAsset = doc.createTexture(basename(plan.texture.uv)).setImage(image.image).setMimeType('image/png');
  const material = doc.createMaterial('YSM')
    .setBaseColorTexture(textureAsset)
    .setMetallicFactor(0)
    .setRoughnessFactor(1)
    .setDoubleSided(true)
    .setAlphaMode(image.hasAlpha ? 'MASK' : 'OPAQUE')
    .setAlphaCutoff(0.5);
  for (const descriptor of plan.scene.roots)
    instantiateYsmNode(doc, scene, descriptor, material, buffer);
  doc.getRoot().setDefaultScene(scene);
  const model: IntermediateModel = {
    document: doc,
    source: {
      path,
      format: 'ysm',
      units: 'meters',
      coordinates: 'right-handed-y-up',
      importer: 'ysm',
      textureHint: plan.textureHint,
      reductionHint: plan.reductionHint,
    },
    warnings,
  };
  options.onStage?.('正在校验 YSM 模型…');
  validateModel(model);
  return model;
}
