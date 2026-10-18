import type { JSONDocument } from '@gltf-transform/core';

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const finiteColor = (v: unknown): v is [number, number, number, number] =>
  Array.isArray(v) && v.length === 4 && v.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1);

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
  warn(`VRM ${version}: importing static initial pose only; humanoid animation, expressions, spring bones, constraints and first-person rules are not evaluated.`);
  if (vrm0 && Array.isArray(vrm.materialProperties)) {
    for (const [index, properties] of vrm.materialProperties.entries()) {
      if (!record(properties) || properties.shader !== 'VRM/MToon') continue;
      const material = root.materials?.[index];
      if (!material) throw new Error('VRM MToon material index is outside glTF materials');
      const vectors = record(properties.vectorProperties) ? properties.vectorProperties : {};
      const floats = record(properties.floatProperties) ? properties.floatProperties : {};
      const textures = record(properties.textureProperties) ? properties.textureProperties : {};
      const pbr = material.pbrMetallicRoughness ??= {};
      if (vectors._Color !== undefined) {
        if (!finiteColor(vectors._Color)) throw new Error('Invalid VRM MToon base color');
        pbr.baseColorFactor = [...vectors._Color];
      }
      if (textures._MainTex === -1) delete pbr.baseColorTexture;
      if (textures._MainTex !== undefined && textures._MainTex !== -1) {
        const texture = textures._MainTex;
        if (typeof texture !== 'number' || !Number.isSafeInteger(texture) || texture < 0 || !root.textures?.[texture]) throw new Error('Invalid VRM MToon main texture index');
        pbr.baseColorTexture = { index: texture };
      }
      if (vectors._MainTex !== undefined) {
        const transform = vectors._MainTex;
        if (!Array.isArray(transform) || transform.length !== 4 || !transform.every((n) => typeof n === 'number' && Number.isFinite(n))) throw new Error('Invalid VRM MToon texture transform');
        if (transform.some((n, i) => n !== [0, 0, 1, 1][i])) throw new Error('Nonidentity VRM 0 MToon texture transforms are not supported; bake them before conversion');
      }
      const blend = floats._BlendMode;
      if (blend !== undefined) {
        if (![0, 1, 2, 3].includes(blend as number)) throw new Error('Invalid VRM MToon blend mode');
        material.alphaMode = blend === 0 ? 'OPAQUE' : blend === 1 ? 'MASK' : 'BLEND';
        if (blend === 1) {
          const cutoff = floats._Cutoff ?? 0.5;
          if (typeof cutoff !== 'number' || !Number.isFinite(cutoff) || cutoff < 0 || cutoff > 1) throw new Error('Invalid VRM MToon cutoff');
          material.alphaCutoff = cutoff;
        }
      }
      const cull = floats._CullMode;
      if (cull === 1) throw new Error('VRM MToon front-face culling is not supported; fix material winding before conversion');
      if (cull !== undefined) {
        if (cull !== 0 && cull !== 2) throw new Error('Invalid VRM MToon cull mode');
        material.doubleSided = cull === 0;
      }
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
