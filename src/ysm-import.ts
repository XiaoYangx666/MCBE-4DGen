import { Document, type Node } from '@gltf-transform/core';
import { realpath } from 'node:fs/promises';
import { basename, dirname, extname } from 'node:path';
import sharp from 'sharp';
import { HUMANOID_PART_ROLES, HUMANOID_PARTS, type HumanoidPart } from './humanoid-binding.ts';
import type { IntermediateModel } from './model.ts';
import { ModelResources } from './resources.ts';
import { decodeTGA } from './tga.ts';
import { validateModel } from './validate-model.ts';
import {
  buildYsmBoneMeshes,
  buildYsmRig,
  hiddenYsmBones,
  parseYsmGeometry,
  parseYsmManifest,
  selectYsmTexture,
  ysmTextureName,
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
  options.onStage?.('正在读取 YSM 模型清单…');
  const manifest = parseYsmManifest(JSON.parse(new TextDecoder().decode(await resources.read(basename(path)))));
  options.onStage?.('正在解析 YSM 几何…');
  const parsed = parseYsmGeometry(JSON.parse(new TextDecoder().decode(await resources.read(manifest.mainModel))));
  parsed.warnings.forEach(warn);
  let hiddenBones: string[] = [];
  if (manifest.mainAnimation) {
    try {
      hiddenBones = hiddenYsmBones(JSON.parse(new TextDecoder().decode(await resources.read(manifest.mainAnimation))));
    } catch (error) {
      warn(`YSM animation file "${manifest.mainAnimation}" could not be read; hidden GUI/overlay bones were not excluded: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const boneSet = buildYsmBoneMeshes(parsed.geometry, { hiddenBones });
  boneSet.warnings.forEach(warn);
  const rig = buildYsmRig(parsed.geometry);
  rig.warnings.forEach(warn);
  const partGeometry = new Set<HumanoidPart>();
  for (const bone of boneSet.bones) if (bone.mesh) partGeometry.add(bone.part);
  const missingParts = HUMANOID_PARTS.filter((part) => !partGeometry.has(part));
  const humanoid = rig.complete && missingParts.length === 0;
  if (humanoid)
    warn('YSM skeleton was mapped to the six player parts (head, body, arms, legs); tail, hair and other secondary bones stay attached to the nearest part.');
  else if (rig.complete && missingParts.length)
    warn(`YSM model has no geometry for ${missingParts.join(', ')}; static whole-body binding will be used.`);
  else
    warn('YSM model does not expose a complete head/body/arms/legs rig; static whole-body binding will be used.');
  const texture = selectYsmTexture(manifest);
  const chosenName = ysmTextureName(texture.uv);
  if (texture.normal || texture.specular)
    warn('YSM PBR normal/specular maps are ignored; only the base-color texture is imported.');
  if (manifest.defaultTexture && chosenName.toLowerCase() !== manifest.defaultTexture.toLowerCase())
    warn(`YSM default texture "${manifest.defaultTexture}" was not found; using "${chosenName}" instead.`);
  if (manifest.textures.length > 1)
    warn(`YSM model has ${manifest.textures.length} textures; only the default texture "${chosenName}" was imported.`);
  options.onStage?.('正在读取 YSM 贴图…');
  const image = await readTexture(await resources.read(texture.uv), texture.uv);
  if (manifest.armModel) warn('YSM arm model is ignored; only the player body is imported.');
  warn('YSM animations, animation controllers, locators and Molang expressions are not evaluated; the static model pose is used.');
  warn(`YSM model "${manifest.name ?? basename(root)}" was imported with the default texture "${chosenName}".`);

  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene('YSM');
  const textureAsset = doc.createTexture(basename(texture.uv)).setImage(image.image).setMimeType('image/png');
  const material = doc.createMaterial('YSM')
    .setBaseColorTexture(textureAsset)
    .setMetallicFactor(0)
    .setRoughnessFactor(1)
    .setDoubleSided(true)
    .setAlphaMode(image.hasAlpha ? 'MASK' : 'OPAQUE')
    .setAlphaCutoff(0.5);
  const roleNodes = new Map<string, Node>();
  if (humanoid) {
    for (const [role, pivot] of Object.entries(rig.roles)) {
      if (!pivot) continue;
      const node = doc.createNode(`__ysm_${role}`)
        .setTranslation(pivot)
        .setExtras({ _humanoidRole: role });
      scene.addChild(node);
      roleNodes.set(role, node);
    }
    for (const side of ['left', 'right'] as const) {
      const armRole = `${side}UpperArm`;
      const handRole = `${side}Hand`;
      const arm = roleNodes.get(armRole)!;
      const hand = roleNodes.get(handRole)!;
      const armPivot = rig.roles[armRole as 'leftUpperArm' | 'rightUpperArm']!;
      const handPivot = rig.roles[handRole as 'leftHand' | 'rightHand']!;
      scene.removeChild(hand);
      hand.setTranslation([
        handPivot[0] - armPivot[0],
        handPivot[1] - armPivot[1],
        handPivot[2] - armPivot[2],
      ]);
      arm.addChild(hand);
    }
  }
  const nodes = new Map<string, Node>();
  const byName = new Map(boneSet.bones.map((bone) => [bone.name, bone]));
  for (const bone of boneSet.bones) {
    const node = doc.createNode(bone.name);
    node.setExtras({ _playerPart: bone.part });
    nodes.set(bone.name, node);
    if (!bone.mesh) continue;
    const mesh = bone.mesh;
    const primitive = doc.createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(mesh.positions as Float32Array<ArrayBuffer>).setBuffer(buffer))
      .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(mesh.normals as Float32Array<ArrayBuffer>).setBuffer(buffer))
      .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(mesh.uvs as Float32Array<ArrayBuffer>).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(mesh.indices as Uint32Array<ArrayBuffer>).setBuffer(buffer))
      .setMaterial(material);
    const meshNode = doc.createNode(bone.name)
      .setTranslation([-bone.pivot[0], -bone.pivot[1], -bone.pivot[2]])
      .setExtras({ _playerPart: bone.part })
      .setMesh(doc.createMesh(bone.name).addPrimitive(primitive));
    node.addChild(meshNode);
  }
  for (const bone of boneSet.bones) {
    const node = nodes.get(bone.name)!;
    const parent = bone.parent ? byName.get(bone.parent) : undefined;
    const role = humanoid ? HUMANOID_PART_ROLES[bone.part] : undefined;
    if (humanoid && role && (!parent || parent.part !== bone.part)) {
      const pivot = rig.roles[role]!;
      node.setTranslation([
        bone.pivot[0] - pivot[0],
        bone.pivot[1] - pivot[1],
        bone.pivot[2] - pivot[2],
      ]);
      roleNodes.get(role)!.addChild(node);
    } else if (parent) {
      node.setTranslation([
        bone.pivot[0] - parent.pivot[0],
        bone.pivot[1] - parent.pivot[1],
        bone.pivot[2] - parent.pivot[2],
      ]);
      nodes.get(parent.name)!.addChild(node);
    } else {
      node.setTranslation(bone.pivot);
      scene.addChild(node);
    }
  }
  doc.getRoot().setDefaultScene(scene);
  const model: IntermediateModel = {
    document: doc,
    source: {
      path,
      format: 'ysm',
      units: 'meters',
      coordinates: 'right-handed-y-up',
      importer: 'ysm',
    },
    warnings,
  };
  options.onStage?.('正在校验 YSM 模型…');
  validateModel(model);
  return model;
}
