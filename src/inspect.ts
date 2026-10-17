import { getBounds } from '@gltf-transform/core';
import type { Material, Texture } from '@gltf-transform/core';
import sharp from 'sharp';
import type { IntermediateModel } from './model.ts';

export async function inspectModel(model: IntermediateModel) {
  const root = model.document.getRoot();
  const nodes = root.listNodes();
  const meshes = root.listMeshes();
  const materials = root.listMaterials();
  const textures = root.listTextures();
  const skins = root.listSkins();
  const warnings = [...model.warnings];
  const warn = (message: string) => { if (!warnings.includes(message)) warnings.push(message); };
  const primitiveStats = (mesh: (typeof meshes)[number]) => mesh.listPrimitives().map((primitive) => ({
    vertices: primitive.getAttribute('POSITION')!.getCount(),
    triangles: (primitive.getIndices()?.getCount() ?? primitive.getAttribute('POSITION')!.getCount()) / 3,
    material: primitive.getMaterial() ? materials.indexOf(primitive.getMaterial()!) : null,
    attributes: primitive.listSemantics(),
    morphTargets: primitive.listTargets().length,
  }));
  const meshStats = meshes.map((mesh, id) => ({ id, name: mesh.getName(), primitives: primitiveStats(mesh) }));
  const allPrimitives = meshStats.flatMap((mesh) => mesh.primitives);
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  if (!root.getDefaultScene() && scene) warn('No default scene; using the first scene for instance counts and bounds.');
  if (root.listScenes().length > 1) warn('All mesh definitions are counted; bounds and instance counts use only the selected scene.');
  let instances = 0;
  let instanceTriangles = 0;
  scene?.traverse((node) => {
    const mesh = node.getMesh();
    if (mesh) {
      instances++;
      instanceTriangles += primitiveStats(mesh).reduce((n, p) => n + p.triangles, 0);
    }
  });
  const bounds = scene && instances ? getBounds(scene) : null;
  if (bounds && ![...bounds.min, ...bounds.max].every(Number.isFinite)) throw new Error('Invalid world-space bounds');
  if (!instances) warn('No mesh instances in the selected scene; bounds are unavailable.');
  const textureInfo = await Promise.all(textures.map(async (texture, id) => {
    const image = texture.getImage();
    if (!image?.byteLength) throw new Error(`Texture ${id} has no image bytes`);
    // Decode supported images so corrupted images cannot appear as successful inspection.
    const { info } = await sharp(image, { failOn: 'warning' }).raw().toBuffer({ resolveWithObject: true });
    return { id, name: texture.getName(), uri: texture.getURI(), mimeType: texture.getMimeType(),
      width: info.width, height: info.height, channels: info.channels, hasAlpha: info.channels === 4 || info.channels === 2,
      bytes: image.byteLength };
  }));
  const textureId = (texture: Texture | null) => texture ? textures.indexOf(texture) : null;
  const materialInfo = materials.map((material: Material, id) => {
    const unsupportedEffects: string[] = [];
    if (material.getNormalTexture()) unsupportedEffects.push('normal map');
    if (material.getMetallicRoughnessTexture()) unsupportedEffects.push('metallic/roughness map');
    if (material.getOcclusionTexture()) unsupportedEffects.push('occlusion map');
    if (material.getEmissiveTexture() || material.getEmissiveFactor().some((v) => v !== 0)) unsupportedEffects.push('emission');
    for (const extension of material.listExtensions()) unsupportedEffects.push(extension.extensionName);
    if (material.getMetallicFactor() !== 0 || material.getRoughnessFactor() !== 1) unsupportedEffects.push('PBR metallic/roughness factors');
    if (unsupportedEffects.length) warn(`Material ${id} effects require fallback in the future Bedrock exporter: ${unsupportedEffects.join(', ')}`);
    return { id, name: material.getName(), baseColor: material.getBaseColorFactor(),
      baseColorTexture: textureId(material.getBaseColorTexture()),
      texCoord: material.getBaseColorTextureInfo()?.getTexCoord() ?? null,
      alphaMode: material.getAlphaMode(), alphaCutoff: material.getAlphaCutoff(), doubleSided: material.getDoubleSided(),
      unsupportedEffects };
  });
  return {
    source: model.source,
    counts: {
      vertices: allPrimitives.reduce((n, p) => n + p.vertices, 0),
      triangles: allPrimitives.reduce((n, p) => n + p.triangles, 0),
      meshes: meshes.length, primitives: allPrimitives.length, materials: materials.length,
      textures: textures.length, nodes: nodes.length, skins: skins.length,
      joints: new Set(skins.flatMap((skin) => skin.listJoints())).size,
      animations: root.listAnimations().length, meshInstances: instances, instanceTriangles,
    },
    selectedScene: scene ? root.listScenes().indexOf(scene) : null,
    bounds: bounds ? { min: bounds.min, max: bounds.max,
      size: bounds.max.map((v, i) => v - bounds.min[i]!) } : null,
    meshes: meshStats, materials: materialInfo, textures: textureInfo,
    nodes: nodes.map((node, id) => ({ id, name: node.getName(),
      parent: node.getParentNode() ? nodes.indexOf(node.getParentNode()!) : null,
      mesh: node.getMesh() ? meshes.indexOf(node.getMesh()!) : null,
      skin: node.getSkin() ? skins.indexOf(node.getSkin()!) : null,
      translation: node.getTranslation(), rotation: node.getRotation(), scale: node.getScale(),
    })),
    skins: skins.map((skin, id) => ({ id, name: skin.getName(),
      joints: skin.listJoints().map((node) => ({ node: nodes.indexOf(node), name: node.getName() })),
      skeleton: skin.getSkeleton() ? nodes.indexOf(skin.getSkeleton()!) : null,
      inverseBindMatrices: skin.getInverseBindMatrices()?.getCount() ?? 0,
    })),
    warnings,
  };
}

export type InspectionReport = Awaited<ReturnType<typeof inspectModel>>;

export function formatInspection(report: InspectionReport): string {
  const c = report.counts;
  return [
    `Model: ${report.source.path} (${report.source.format})`,
    `Vertices: ${c.vertices} | Triangles: ${c.triangles} | Meshes: ${c.meshes} | Primitives: ${c.primitives}`,
    `Materials: ${c.materials} | Textures: ${c.textures} | Nodes: ${c.nodes}`,
    `Skins: ${c.skins} | Joints: ${c.joints} | Animations: ${c.animations}`,
    `Scene ${report.selectedScene ?? '(none)'}: ${c.meshInstances} mesh instances, ${c.instanceTriangles} triangles`,
    `Units: ${report.source.units} | Coordinates: ${report.source.coordinates}`,
    report.bounds ? `Bounds: [${report.bounds.min.join(', ')}] → [${report.bounds.max.join(', ')}]; size [${report.bounds.size.join(', ')}]` : 'Bounds: unavailable',
    ...report.materials.map((m) => `Material ${m.id}: ${m.name || '(unnamed)'}, base texture ${m.baseColorTexture ?? '(none)'}, alpha ${m.alphaMode}`),
    ...report.textures.map((t) => `Texture ${t.id}: ${t.name || t.uri || '(embedded)'} ${t.width}×${t.height}, alpha ${t.hasAlpha}, ${t.bytes} bytes`),
    ...report.skins.map((s) => `Skin ${s.id}: ${s.joints.map((j) => j.name || `node ${j.node}`).join(', ')}`),
    ...report.warnings.map((warning) => `Warning: ${warning}`),
  ].join('\n');
}
