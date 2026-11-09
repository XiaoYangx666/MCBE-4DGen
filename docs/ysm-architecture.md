# YSM 导入架构

本文说明 YSM（Yes Steve Model）导入为什么和普通模型转换流程不同，以及这些差异被限制在哪些边界内。核心原则是：

> YSM 只增加一个导入适配层；生成 `IntermediateModel` 之后，仍然走同一套准备、减面、纹理、绑定和导出流程。

## 总流程

```text
普通模型
  importModel
    -> IntermediateModel
    -> prepareStaticModel / optimizeMesh
    -> optimizeTextures
    -> bindStatic / exportHumanoid
    -> exportBedrockGeometry
    -> skin pack

YSM 文件夹
  importModel(ysm.json)
    -> parseYsmManifest
    -> parseYsmGeometry
    -> hiddenYsmBones
    -> buildYsmImportPlan
         -> buildYsmScene（纯数据场景树）
         -> 贴图选择与结构化诊断
    -> Node / Three.js 薄适配器实例化
    -> IntermediateModel（携带 source hints）
    -> 之后与普通模型完全相同
```

`src/importer.ts` 只负责识别 `ysm.json` 并转交 YSM 导入器。转换管线本身不判断来源格式。

## 模块边界

| 模块 | 职责 | 是否允许环境依赖 |
| --- | --- | --- |
| `src/ysm-model.ts` | 解析 manifest / Bedrock 几何、隐藏骨骼、骨骼世界变换、六部位映射、纯数据 `YsmScene`、结构化诊断 | 纯 TypeScript，无 Node / Three.js / DOM |
| `src/ysm-import.ts` | 读取文件、解码 TGA / PNG、把 `YsmScene` 实例化为 glTF-transform Document | Node |
| `webapp/engine/ysm.ts` | 读取浏览器 File、把同一个 `YsmScene` 实例化为 Three.js 对象 | 浏览器 |
| `src/texture-policy.ts` | 解析来源纹理建议与用户显式设置 | 纯 TypeScript |
| `src/reduce-policy.ts` | 解析默认保留比例与旧设置迁移 | 纯 TypeScript |
| `src/part-groups.ts` | 按骨骼分支生成 YSM 部件分组 | 纯 TypeScript |
| `src/texture-optimizer.ts` | Node 图集重建、UV 岛拆分、源像素面积打包 | Node + sharp |
| `webapp/engine/atlas.ts` | 浏览器图集规划、UV 岛拆分、源像素面积打包 | 浏览器 Canvas |
| `webapp/engine/convert.ts` | 浏览器端转换入口和 128 纹理兼容限制 | 浏览器 |

## 模型携带的提示

YSM 的差异通过 `IntermediateModel.source` 传递，而不是在 CLI、服务端或 UI 里判断格式。

### 纹理提示

```ts
source.textureHint = {
  preserve: true,
  maxSize: 128,
  repack: "islands",
};
```

含义：

- 单张源贴图优先保留原始 UV。
- 最终皮肤纹理不能超过 128×128。
- 如果源图超过 128，按 UV 岛拆分并在源像素密度下重新打包，而不是整张缩放。

用户显式选择仍优先：

- CLI `--atlas`：强制走普通图集
- CLI `--max-texture`：显式尺寸覆盖默认 hint
- 服务端 / 网页端没有额外的强制图集入口

### 减面提示

```ts
source.reductionHint = {
  retainBelowTriangles: 10_000,
};
```

含义：

- YSM 源模型小于 10,000 面时，初始保留比例默认 100%。
- 用户保存过的非 20% 比例仍然优先。
- 旧库条目自动保存的通用 20% 默认会被视为“未设置”，以便新规则生效。
- 非 YSM 模型没有这个 hint，仍使用通用默认 20%。

## 结构化诊断

共享层只产生 `YsmDiagnostic`，不产生用户文案。

```ts
type YsmDiagnostic =
  | { code: "missing-parent"; name: string; parent: string }
  | { code: "cyclic-bone"; name: string }
  | { code: "duplicate-bone"; name: string }
  | { code: "duplicate-bone-conflict"; name: string }
  | { code: "hidden-bones"; names: string[] }
  | { code: "missing-role"; role: YsmHumanoidRole }
  | { code: "pbr-textures-ignored" }
  | ...
```

- Node：`src/ysm-import.ts` 输出英文 warning。
- 网页：`webapp/engine/ysm.ts` 输出中文 warning。

这样共享层不依赖语言，两个运行端可以独立调整展示文案。

## 场景描述层

`buildYsmScene()` 返回完整的运行时中立场景树：

```ts
interface YsmSceneNode {
  name: string;
  translation: V3;
  role?: YsmHumanoidRole;
  part?: HumanoidPart;
  bone?: string;
  mesh?: YsmMeshPart;
  children: YsmSceneNode[];
}
```

共享层负责：

- `__ysm_*` role 节点
- hand role 挂到 upper-arm role
- 原始骨骼父子层级
- 每根骨骼的相对 pivot
- mesh 节点的 `-pivot` 偏移
- `_humanoidRole` / `_playerPart` 标记
- 六部位完整性判断

Node 和网页适配器只做递归实例化，不再重复计算层级。

## 骨骼图修复

`boneWorlds()` 在计算世界变换前先修复骨骼图：

- 重名骨骼按第一次出现的名称合并。
- 重名但 pivot / rotation / parent 不同的骨骼产生 `duplicate-bone-conflict`；每个重复 occurrence 的 cube 仍使用自己的源变换，避免几何被静默放到错误位置。
- 缺失父节点降为根，并产生 `missing-parent`。
- 循环父子关系按字典序确定性地断开一条边，并产生 `cyclic-bone`。
- `buildYsmScene()` 只使用修复后的有效父关系建树。

这样所有可见骨骼都能从 roots 到达，且场景树和有效父链都不会有环。

## 部件分组

YSM 模型的次级子树（例如 `FOX`、`Hair`、`Tail`、`clothe`）会映射到玩家六部位，但部件列表仍需要可读分组。

`src/part-groups.ts` 的规则：

1. 从 mesh 向上找最近的骨架关节。
2. 取关节下方最外层的非关节分支作为分组名。
3. 去掉 YSM 的 `M` / `F` 辅助前缀。

例如：

- `FOX -> AllBody2 -> ...` 归为 `FOX`
- `Head -> Hair -> BaseHair` 归为 `Hair`
- `UpBody -> MTail -> Tail2` 归为 `Tail`

分组只影响部件筛选 UI，不改变导出的六根玩家骨骼。

## 纹理重建

### 源图 ≤ 128

直接保留源 PNG 和 UV，不重排。

### 源图 > 128

1. 按 UV 连通性拆成 UV 岛。
2. 按源像素面积分配矩形。
3. 以源像素密度为目标，用统一缩放装入 128×128。
4. 重映射 UV。
5. 导出前由 `exportBedrockGeometry` 再做 128 上限兜底。

不做的操作：

- 不旋转 UV 岛。
- 不允许 UV 岛重叠。
- 不对连续大岛做固定方块二次切分（实测会增加间隙，反而降低主贴图分辨率）。

因此 128 图中仍会看到透明区域；这些主要来自：

- UV 岛之间的装箱间隙
- 模型本身的透明裁剪区域
- 矩形 UV 岛外围的 padding

它们的比例通常仍明显低于源图的空白比例。

## 缓存

服务端模型缓存和预览缓存共用一个版本 key：

```text
server/studio.ts -> previewCacheKey(...):v10
```

只要导入器、source hints、场景结构或预览内容发生不兼容变化，就必须提升这个版本。否则旧缓存会继续提供旧的 `textureHint` / 几何，导致“代码已改但输出没变”。

## 已知限制

- 加密 `.ysm` 不支持。
- 不导入手臂模型。
- 不评估动画、控制器、locator 和 Molang。
- 输出仍是六部位玩家骨骼，额外 YSM 子骨骼不单独输出。
- 部件分组是 UI 能力，不是把次级模型拆成独立皮肤包。
- 128×128 是客户端硬限制；超过 128 的有效细节必然要缩放。

## 验证命令

```powershell
npm run check
npm run check:web
npm run check:webapp
npm run test:workflow
npm run test:node
npm run test:studio
npx vitest run
```

新增 YSM 行为时，至少补充：

- 共享 `YsmScene` / diagnostics 单测
- Node 与网页场景图一致性测试
- 保留纹理 / UV 岛重排测试
- 128 输出尺寸测试
- 普通 GLB / OBJ 回归测试
