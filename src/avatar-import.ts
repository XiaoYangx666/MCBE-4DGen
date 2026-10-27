import type { JSONDocument } from '@gltf-transform/core';
import { mapMtoonMaterial, hasExplicitBaseColor } from './mtoon-materials.ts';
import { readVrmHumanBones } from './vrm-humanoid.ts';

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Explicit static fallback for VRM avatars. Never implies MToon, springs or humanoid animation support. */
export function prepareVRM(json: JSONDocument, warn: (message: string) => void) {
  const root = json.json;
  const extensions = root.extensions ?? {};
  const vrm0 = extensions.VRM, vrm1 = extensions.VRMC_vrm;
  if (record(vrm0) === record(vrm1) || (vrm0 !== undefined && !record(vrm0)) || (vrm1 !== undefined && !record(vrm1))) throw new Error('VRM requires exactly one VRM 0.x or VRMC_vrm 1.0 extension');
  const vrm = (vrm1 ?? vrm0) as Record<string, unknown>;
  const version = vrm.specVersion ?? (vrm0 ? '0.x' : undefined);
  if (typeof version !== 'string' || (vrm1 ? version !== '1.0' : !/^0\.(?:\d+|x)$/.test(version))) throw new Error('Unsupported VRM specVersion');
  const meta = record(vrm.meta) ? vrm.meta : {};
  // 宽松解析共用；specVersion 与扩展数量的严格校验仍在本函数上方。
  for (const value of readVrmHumanBones(vrm)) {
    const node = root.nodes?.[value.node];
    if (node) node.extras = { ...node.extras, _vrmHumanBone: value.bone };
  }
  warn(`VRM ${version}: importing static initial pose only; humanoid animation, expressions, spring bones, constraints and first-person rules are not evaluated.`);
  if (vrm0 && Array.isArray(vrm0.materialProperties)) {
    for (const [index, properties] of vrm0.materialProperties.entries()) {
      // 映射规则与浏览器端共用；Node 侧保持严格：任何无法表达的值都直接报错。
      const mapping = mapMtoonMaterial(properties, {
        textureCount: root.textures?.length ?? 0,
        strict: true,
      });
      if (!mapping.isMtoon) continue;
      const material = root.materials?.[index];
      if (!material) throw new Error('VRM MToon material index is outside glTF materials');
      if (mapping.errors.length) throw new Error(mapping.errors[0]!);
      const { patch } = mapping;
      const pbr = material.pbrMetallicRoughness ??= {};
      if (patch.baseColorFactor && !hasExplicitBaseColor(pbr.baseColorFactor))
        pbr.baseColorFactor = [...patch.baseColorFactor];
      if (patch.baseColorTexture === null) delete pbr.baseColorTexture;
      else if (patch.baseColorTexture !== undefined)
        pbr.baseColorTexture = { index: patch.baseColorTexture };
      if (patch.alphaMode) material.alphaMode = patch.alphaMode;
      if (patch.alphaCutoff !== undefined) material.alphaCutoff = patch.alphaCutoff;
      if (patch.doubleSided !== undefined) material.doubleSided = patch.doubleSided;
    }
  }
  warn('VRM MToon fallback preserves base color, main texture, alpha and supported culling only; toon lighting, outlines, rim/shade maps and UV animation are not reproduced.');
  // These extensions describe deliberately omitted avatar/runtime behavior or MToon fallback.
  // Unknown required extensions remain required and are still rejected by NodeIO.
  const fallback = new Set(['VRM', 'VRMC_vrm', 'VRMC_materials_mtoon', 'VRMC_springBone', 'VRMC_node_constraint']);
  if (root.extensionsRequired) root.extensionsRequired = root.extensionsRequired.filter((name) => !fallback.has(name));
  return { version, ...(typeof meta.name === 'string' ? { name: meta.name } : typeof meta.title === 'string' ? { name: meta.title } : {}),
    ...(typeof meta.author === 'string' ? { authors: [meta.author] } : Array.isArray(meta.authors) && meta.authors.every((s) => typeof s === 'string') ? { authors: meta.authors as string[] } : {}),
    ...(typeof meta.licenseUrl === 'string' ? { license: meta.licenseUrl } : typeof meta.licenseName === 'string' ? { license: meta.licenseName } : {}) };
}
