import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mapMtoonMaterial, hasExplicitBaseColor } from '../../src/mtoon-materials.ts';

export interface VrmMtoonResult {
  /** 成功套用映射的材质数量。 */
  applied: number;
  /** 扩展里声明了、但场景中找不到对应对象的材质数量。 */
  unmatched: number;
}

type ColorMaterial = THREE.Material & {
  color?: THREE.Color;
  map?: THREE.Texture | null;
};

/**
 * 把 VRM 0.x 的 MToon 材质属性套到已加载的 three.js 材质上。
 *
 * 映射规则来自共享的 `mapMtoonMaterial`，这里只做适配：浏览器端取宽松模式，
 * 非法字段跳过而不是拒绝整个模型——部分正确也好过完全加载失败。
 */
export async function applyVrmMtoonMaterials(gltf: GLTF): Promise<VrmMtoonResult> {
  const json = gltf.parser.json as {
    extensions?: Record<string, unknown>;
    textures?: unknown[];
  };
  const vrm0 = json.extensions?.VRM as { materialProperties?: unknown[] } | undefined;
  const properties = vrm0?.materialProperties;
  if (!Array.isArray(properties) || !properties.length) return { applied: 0, unmatched: 0 };

  // GLTFLoader 的 associations 把 three 材质映射回 glTF 材质索引，比遍历场景更可靠。
  const byIndex = new Map<number, THREE.Material>();
  for (const [object, reference] of gltf.parser.associations) {
    if (typeof reference.materials !== 'number') continue;
    const material = object as THREE.Material;
    if ((material as { isMaterial?: boolean }).isMaterial)
      byIndex.set(reference.materials, material);
  }

  const textureCount = json.textures?.length ?? 0;
  let applied = 0;
  let unmatched = 0;
  for (const [index, entry] of properties.entries()) {
    const mapping = mapMtoonMaterial(entry, { textureCount, strict: false });
    if (!mapping.isMtoon) continue;
    const material = byIndex.get(index) as ColorMaterial | undefined;
    if (!material) {
      unmatched++;
      continue;
    }
    const { patch } = mapping;
    if (patch.baseColorFactor && material.color) {
      const current = [material.color.r, material.color.g, material.color.b];
      // 核心字段已经是颜色管理后的线性值，只有它是默认白时才用 MToon 颜色。
      if (!hasExplicitBaseColor(current)) {
        const [red, green, blue] = patch.baseColorFactor;
        material.color.setRGB(red, green, blue, THREE.LinearSRGBColorSpace);
      }
    }
    if (patch.baseColorTexture === null) material.map = null;
    else if (patch.baseColorTexture !== undefined) {
      try {
        const texture = await gltf.parser.getDependency('texture', patch.baseColorTexture) as THREE.Texture;
        texture.colorSpace = THREE.SRGBColorSpace;
        material.map = texture;
      } catch {
        // 贴图解析失败时保留 glTF 原有的基础色贴图。
      }
    }
    if (patch.alphaMode) {
      material.transparent = patch.alphaMode === 'BLEND';
      material.alphaTest = patch.alphaMode === 'MASK' ? patch.alphaCutoff ?? 0.5 : 0;
      material.depthWrite = patch.alphaMode !== 'BLEND';
    }
    if (patch.doubleSided !== undefined)
      material.side = patch.doubleSided ? THREE.DoubleSide : THREE.FrontSide;
    material.needsUpdate = true;
    applied++;
  }
  return { applied, unmatched };
}
