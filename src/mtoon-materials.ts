/**
 * VRM 0.x MToon → glTF 基础材质映射，由 Node 导入器和浏览器加载器共用。
 *
 * MToon 把真实基础色、透明模式、剔除模式放在扩展属性里，glTF 核心字段经常
 * 停在默认值（白、OPAQUE、单面），所以两端都必须读扩展。Bedrock 皮肤只能
 * 表达「基础色 + 主贴图 + alpha + 双面」，其余一律丢弃。
 */

import { srgbToLinear } from './texture-pixels.ts';

export const MTOON_UNSUPPORTED_FEATURES = [
  'toon shading',
  'outline',
  'rim / shade maps',
  'UV animation',
] as const;

export interface MtoonMaterialPatch {
  baseColorFactor?: [number, number, number, number];
  /** 贴图索引；`null` 表示删除基础色贴图，`undefined` 表示保持原样。 */
  baseColorTexture?: number | null;
  alphaMode?: 'OPAQUE' | 'MASK' | 'BLEND';
  alphaCutoff?: number;
  doubleSided?: boolean;
}

export interface MtoonMapping {
  /** false 表示这条材质不是 VRM/MToon，调用方应跳过。 */
  isMtoon: boolean;
  patch: MtoonMaterialPatch;
  /**
   * 校验失败项，顺序与 Node 导入器历史上的抛错顺序一致。
   * 严格调用方取 `errors[0]` 抛出；宽松调用方忽略非法项、只应用合法项。
   */
  errors: string[];
}

export interface MtoonOptions {
  /** 文档里的贴图数量，用于索引校验。 */
  textureCount: number;
  /** true：非法值记入 errors；false：非法值直接跳过。 */
  strict: boolean;
}

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const finiteColor = (value: unknown): value is [number, number, number, number] =>
  Array.isArray(value) && value.length === 4 &&
  value.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1);

export function mapMtoonMaterial(properties: unknown, options: MtoonOptions): MtoonMapping {
  const patch: MtoonMaterialPatch = {};
  const errors: string[] = [];
  if (!record(properties) || properties.shader !== 'VRM/MToon')
    return { isMtoon: false, patch, errors };

  const vectors = record(properties.vectorProperties) ? properties.vectorProperties : {};
  const floats = record(properties.floatProperties) ? properties.floatProperties : {};
  const textures = record(properties.textureProperties) ? properties.textureProperties : {};
  const fail = (message: string) => {
    if (options.strict) errors.push(message);
  };

  if (vectors._Color !== undefined) {
    if (!finiteColor(vectors._Color)) {
      fail('Invalid VRM MToon base color');
    } else {
      // MToon 的 _Color 是 sRGB，glTF baseColorFactor 是线性值。
      // UniVRM 导出时会把同一个颜色写进核心字段并做 sRGB→线性转换。
      const [red, green, blue, alpha] = vectors._Color;
      patch.baseColorFactor = [
        srgbToLinear(red),
        srgbToLinear(green),
        srgbToLinear(blue),
        alpha,
      ];
    }
  }

  if (textures._MainTex === -1) patch.baseColorTexture = null;
  if (textures._MainTex !== undefined && textures._MainTex !== -1) {
    const texture = textures._MainTex;
    if (typeof texture !== 'number' || !Number.isSafeInteger(texture) ||
      texture < 0 || texture >= options.textureCount)
      fail('Invalid VRM MToon main texture index');
    else patch.baseColorTexture = texture;
  }

  // VRM 0.x 把 UV 变换放在 vectorProperties._MainTex 里；非单位变换无法烘焙进图集。
  if (vectors._MainTex !== undefined) {
    const transform = vectors._MainTex;
    if (!Array.isArray(transform) || transform.length !== 4 ||
      !transform.every((n) => typeof n === 'number' && Number.isFinite(n)))
      fail('Invalid VRM MToon texture transform');
    else if (transform.some((n, i) => n !== [0, 0, 1, 1][i]))
      fail('Nonidentity VRM 0 MToon texture transforms are not supported; bake them before conversion');
  }

  const blend = floats._BlendMode;
  if (blend !== undefined) {
    if (![0, 1, 2, 3].includes(blend as number)) {
      fail('Invalid VRM MToon blend mode');
    } else {
      patch.alphaMode = blend === 0 ? 'OPAQUE' : blend === 1 ? 'MASK' : 'BLEND';
      if (blend === 1) {
        const cutoff = floats._Cutoff ?? 0.5;
        if (typeof cutoff !== 'number' || !Number.isFinite(cutoff) || cutoff < 0 || cutoff > 1)
          fail('Invalid VRM MToon cutoff');
        else patch.alphaCutoff = cutoff;
      }
    }
  }

  const cull = floats._CullMode;
  if (cull === 1)
    fail('VRM MToon front-face culling is not supported; fix material winding before conversion');
  if (cull !== undefined) {
    if (cull !== 0 && cull !== 2) fail('Invalid VRM MToon cull mode');
    else patch.doubleSided = cull === 0;
  }

  return { isMtoon: true, patch, errors };
}

/**
 * glTF 核心的 baseColorFactor 已经是颜色管理后的线性值，非默认白时以它为准；
 * MToon 的 _Color 只在核心字段缺省（导出器没写）时作为回退。
 */
export function hasExplicitBaseColor(factor: readonly number[] | undefined): boolean {
  if (!factor || factor.length < 3) return false;
  return factor.slice(0, 3).some((value) => Math.abs(value - 1) > 1e-3);
}
