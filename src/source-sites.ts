/**
 * Curated model-source directory shared by the web UI and the local icon
 * proxy. Keep this list ordered by usefulness: the UI shows lower ranks first.
 */

export type SourceCategoryKey =
  | 'general'
  | 'anime'
  | 'game'
  | 'lowpoly'
  | 'architecture'
  | 'community';

export interface SourceCategory {
  key: SourceCategoryKey;
  label: string;
  hint: string;
}

export interface SourceSite {
  id: string;
  name: string;
  url: string;
  /** Hostname used for the local favicon proxy and card caption. */
  domain: string;
  categories: SourceCategoryKey[];
  rank: number;
  rating?: number;
  pricing: string;
  formats: string[];
  region: '国内' | '日本' | '国际';
  summary: string;
  tags: string[];
}

export const SOURCE_CATEGORIES: SourceCategory[] = [
  {
    key: 'general',
    label: '综合模型',
    hint: '人物、动物、建筑、载具和扫描资产',
  },
  {
    key: 'anime',
    label: '动漫 / MMD / VRM',
    hint: '二次元角色、MMD、VRChat 与虚拟形象',
  },
  {
    key: 'game',
    label: '游戏资产',
    hint: '游戏角色、怪物、武器、道具和提取模型',
  },
  {
    key: 'lowpoly',
    label: '低模 / 轻量',
    hint: '适合控制转换体积和面数的模型',
  },
  {
    key: 'architecture',
    label: '建筑 / 工业 / 产品',
    hint: '建筑、家具、机械、载具和商品模型',
  },
  {
    key: 'community',
    label: '社区 / 配布',
    hint: '创作者社区、MMD 配布和素材论坛',
  },
];

export const SOURCE_SITES: SourceSite[] = [
  {
    id: 'aplaybox',
    name: '模之屋',
    url: 'https://www.aplaybox.com/',
    domain: 'aplaybox.com',
    categories: ['anime', 'game', 'general'],
    rank: 1,
    rating: 9.5,
    pricing: '大量免费',
    formats: ['PMX', 'FBX', 'VRM', 'Blend'],
    region: '国内',
    summary:
      '国内常用模型社区，游戏角色、场景、道具和官方配布资源集中，中文检索友好。',
    tags: ['首页优先', '游戏角色', 'MMD', '国内资源'],
  },
  {
    id: 'sketchfab',
    name: 'Sketchfab',
    url: 'https://sketchfab.com/',
    domain: 'sketchfab.com',
    categories: ['general', 'game', 'lowpoly', 'anime'],
    rank: 2,
    rating: 10,
    pricing: '免费 + 付费',
    formats: ['GLB', 'glTF', 'FBX', 'OBJ'],
    region: '国际',
    summary:
      '全球综合模型社区，人物、动物、建筑、游戏资产和扫描模型齐全，可下载资源常提供 GLB/glTF。',
    tags: ['综合', '扫描模型', 'GLB', '转换测试'],
  },
  {
    id: 'booth',
    name: 'BOOTH',
    url: 'https://booth.pm/en/browse/3D%20Models',
    domain: 'booth.pm',
    categories: ['anime', 'community'],
    rank: 3,
    rating: 9,
    pricing: '免费 + 付费',
    formats: ['FBX', 'VRM', 'UnityPackage', 'PMX'],
    region: '日本',
    summary:
      'Pixiv 旗下创作者商城，二次元人物、VRChat 形象、服装和道具质量高，免费与付费并存。',
    tags: ['二次元', 'VRChat', '服装', '创作者'],
  },
  {
    id: 'bowlroll',
    name: 'BowlRoll',
    url: 'https://bowlroll.net/',
    domain: 'bowlroll.net',
    categories: ['anime', 'community'],
    rank: 4,
    rating: 8,
    pricing: '以免费为主',
    formats: ['PMX', 'PMD', 'ZIP'],
    region: '日本',
    summary:
      '日本 MMD 圈经典配布站，PMX/PMD 模型、动作和场景多；部分资源需要作者说明中的密码。',
    tags: ['MMD', '配布', 'PMX', '密码提示'],
  },
  {
    id: 'vroid-hub',
    name: 'VRoid Hub',
    url: 'https://hub.vroid.com/',
    domain: 'hub.vroid.com',
    categories: ['anime'],
    rank: 5,
    rating: 7.5,
    pricing: '部分免费',
    formats: ['VRM'],
    region: '日本',
    summary:
      'VRoid 角色社区，以 VRM 为主；能否下载取决于作者设置，适合找动漫风虚拟角色。',
    tags: ['VRM', '虚拟角色', '作者授权'],
  },
  {
    id: 'cgtrader',
    name: 'CGTrader',
    url: 'https://www.cgtrader.com/',
    domain: 'cgtrader.com',
    categories: ['general', 'game', 'architecture'],
    rank: 6,
    rating: 9.5,
    pricing: '免费 + 付费',
    formats: ['FBX', 'OBJ', 'MAX', 'Blend', 'glTF'],
    region: '国际',
    summary:
      '专业模型市场，人物、机械、载具、建筑和游戏资产丰富，免费专区也有不少可用资源。',
    tags: ['专业模型', '机械', '载具', '免费专区'],
  },
  {
    id: 'nico-3d',
    name: 'ニコニ立体',
    url: 'https://3d.nicovideo.jp/',
    domain: '3d.nicovideo.jp',
    categories: ['anime', 'community'],
    rank: 7,
    rating: 8,
    pricing: '大量免费',
    formats: ['PMX', 'VRM', 'FBX'],
    region: '日本',
    summary:
      '日本 3D 分享社区，MMD、VRM 和原创模型都有，部分作品提供源文件下载。',
    tags: ['MMD', 'VRM', '原创模型'],
  },
  {
    id: 'poly-pizza',
    name: 'Poly Pizza',
    url: 'https://poly.pizza/',
    domain: 'poly.pizza',
    categories: ['lowpoly', 'game'],
    rank: 8,
    rating: 9,
    pricing: '大量免费',
    formats: ['OBJ', 'FBX', 'glTF'],
    region: '国际',
    summary:
      '大量低多边形模型，适合控制转换后的体积和面数，也适合做轻量化测试。',
    tags: ['低模', '轻量', '工具测试', '免费'],
  },
  {
    id: 'fab',
    name: 'Fab',
    url: 'https://www.fab.com/',
    domain: 'fab.com',
    categories: ['game', 'general'],
    rank: 9,
    rating: 8.5,
    pricing: '免费 + 付费',
    formats: ['FBX', 'OBJ', 'Blend', 'glTF'],
    region: '国际',
    summary:
      'Epic 旗下综合素材商城，游戏角色、怪物、武器、环境和成套资产质量高。',
    tags: ['游戏资产', '成套素材', 'Epic'],
  },
  {
    id: 'models-resource',
    name: 'The Models Resource',
    url: 'https://www.models-resource.com/',
    domain: 'models-resource.com',
    categories: ['game'],
    rank: 10,
    rating: 8.5,
    pricing: '免费',
    formats: ['FBX', 'OBJ', 'DAE'],
    region: '国际',
    summary:
      '专门整理游戏内 3D 模型，经典角色、道具和场景多，适合做游戏二创和格式测试。',
    tags: ['游戏提取', '经典角色', '免费'],
  },
  {
    id: 'free3d',
    name: 'Free3D',
    url: 'https://free3d.com/',
    domain: 'free3d.com',
    categories: ['general', 'architecture', 'lowpoly'],
    rank: 11,
    pricing: '大量免费',
    formats: ['OBJ', 'FBX', '3DS', 'MAX', 'Blend'],
    region: '国际',
    summary:
      '综合模型下载站，机械、家具、人物、载具题材广，免费资源较多。',
    tags: ['综合', '家具', '机械', '免费'],
  },
  {
    id: 'vrcmods',
    name: 'VRCMods',
    url: 'https://vrcmods.com/',
    domain: 'vrcmods.com',
    categories: ['anime', 'game'],
    rank: 12,
    pricing: '免费',
    formats: ['FBX', 'UnityPackage', 'VRM'],
    region: '国际',
    summary:
      '免费 VRChat 角色、道具、服装和 Unity/FBX 资源，适合找虚拟形象和二次元角色。',
    tags: ['VRChat', '虚拟形象', '免费'],
  },
  {
    id: 'open3dlab',
    name: 'Open3DLab',
    url: 'https://open3dlab.com/',
    domain: 'open3dlab.com',
    categories: ['community', 'game'],
    rank: 13,
    pricing: '免费',
    formats: ['FBX', 'Blend', 'OBJ'],
    region: '国际',
    summary:
      '社区共享的 Blender、FBX、OBJ 资源，适合 machinima、动画和二次创作。',
    tags: ['社区', 'Blender', '免费'],
  },
  {
    id: 'aigei',
    name: '爱给网 MMD 区',
    url: 'https://www.aigei.com/3d/mmd',
    domain: 'aigei.com',
    categories: ['anime', 'game', 'general'],
    rank: 14,
    pricing: '免费为主',
    formats: ['PMX', 'FBX', 'Blend', 'MAX'],
    region: '国内',
    summary:
      '中文素材站，MMD 模型、动作、场景和服装资源集中，适合补充国内配布资源。',
    tags: ['MMD', '国内资源', '动作场景'],
  },
  {
    id: 'deviantart',
    name: 'DeviantArt',
    url: 'https://www.deviantart.com/',
    domain: 'deviantart.com',
    categories: ['community', 'anime'],
    rank: 15,
    pricing: '免费为主',
    formats: ['PMX', 'FBX', 'Blend', 'XPS'],
    region: '国际',
    summary:
      '海外 MMD/3D 二创社区，模型改造、配布和角色资源多；下载方式看作者说明。',
    tags: ['海外社区', 'MMD', '二创'],
  },
  {
    id: 'patreon',
    name: 'Patreon',
    url: 'https://www.patreon.com/',
    domain: 'patreon.com',
    categories: ['community', 'anime'],
    rank: 16,
    pricing: '付费订阅',
    formats: ['FBX', 'Blend', 'VRM', 'UnityPackage'],
    region: '国际',
    summary:
      '创作者订阅平台，许多模型作者在这里发布独占或提前资源，需要按作者订阅。',
    tags: ['订阅', '创作者', '独占资源'],
  },
  {
    id: 'turbosquid',
    name: 'TurboSquid',
    url: 'https://www.turbosquid.com/',
    domain: 'turbosquid.com',
    categories: ['general', 'architecture'],
    rank: 17,
    pricing: '免费 + 付费',
    formats: ['FBX', 'OBJ', 'MAX', 'C4D'],
    region: '国际',
    summary:
      '老牌综合模型商城，写实人物、载具、工业和电影级资产多，部分资源免费。',
    tags: ['写实', '工业', '电影级'],
  },
  {
    id: 'blend-swap',
    name: 'Blend Swap',
    url: 'https://blendswap.com/',
    domain: 'blendswap.com',
    categories: ['general', 'community'],
    rank: 18,
    pricing: '免费为主',
    formats: ['Blend'],
    region: '国际',
    summary:
      'Blender 社区模型交换站，人物、道具和场景以免费分享为主。',
    tags: ['Blender', '社区', '免费'],
  },
  {
    id: 'blendkit',
    name: 'Blendkit',
    url: 'https://www.blendkit.com/',
    domain: 'blendkit.com',
    categories: ['general', 'architecture'],
    rank: 19,
    pricing: '免费 + 付费',
    formats: ['Blend'],
    region: '国际',
    summary:
      'Blender 内置资产库（原 BlenderKit），模型、材质和场景多，免费与付费计划并存。',
    tags: ['Blender', '资产库', '材质'],
  },
  {
    id: '3d-warehouse',
    name: '3D Warehouse',
    url: 'https://3dwarehouse.sketchup.com/',
    domain: '3dwarehouse.sketchup.com',
    categories: ['architecture', 'general'],
    rank: 20,
    pricing: '大量免费',
    formats: ['SKP', 'DAE', 'KMZ'],
    region: '国际',
    summary:
      'SketchUp 官方模型库，建筑、家具、产品和交通工具资源丰富。',
    tags: ['建筑', '家具', 'SketchUp'],
  },
];

/** Hostnames accepted by the local favicon proxy. */
export const SOURCE_DOMAINS = new Set(
  SOURCE_SITES.map((site) => site.domain.toLowerCase()),
);
