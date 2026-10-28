# 纹理工作室 v1：真实模型验证与交付

> 分支 `feat/texture-studio-v1`，基于 `origin/research/texture-allocation-v3`
> 未合并 main/v2/v3，未发布 Release，未自动部署，未触碰 `E:\4DGen-release`。

## 1. 本轮提交

| 阶段 | 提交 | 内容 |
|---|---|---|
| 1 | `53540be` | 多部件删除按对象身份解析；共享矩形统计按材质分摊；平面材质单像素归属；删除资源清理 |
| 2 | `46cc840` | 材质 `m:{name}#{occurrence}` 与部件 id 贯穿桌面/网页；旧配置迁移与结构指纹；预算模式逐物料统计 |
| 3 | `6691c09` | 共享纹理工作室面板、部件勾选/预览、相对清晰度、新旧模式、图集诊断、图集预览重做 |
| 4 | 本次提交 | 真实模型端到端脚本、截图、数据与验证报告 |

## 2. 修复的真实缺陷

1. **同一 Mesh 连续删除多个 Primitive 会删错**
   `filterParts()` 先按原索引逐个删除，前面的 Primitive 移除后后面的索引整体前移。
   复现：4 个 Primitive 保留 `p0.1,p0.3`，实际留下的是 `p0.1,p0.2`。
   现在先按 Primitive 对象身份收集全部目标，再统一移除，并补充了首/中/尾、多 Mesh、
   全部删除、共享 Mesh、重复筛选、保留 UV/材质/顶点不变的测试。

2. **删除后的资源生命周期**
   空 Mesh 只在其最后一个 Node 引用消失后释放；删除实例 Node 时把子节点交还父级；
   只回收没有 Primitive/动画/骨骼父级的孤立 Accessor，避免破坏共享资源。
   `removedPrimitives/removedMeshes/removedNodes` 现在按真实释放计数。

3. **共享矩形的统计重复归属**
   图集总量按唯一矩形计算，但逐材质 `rectPixels`、`actualArea`、`targetArea` 曾把
   同一共享矩形的完整内容各自记一遍。现在按 UV 面积分摊并做整数余数分配：
   `Σ rectPixels == contentPixels`。另增 `sharedPixels`、`uniquePixels`、
   `unusedContentPixels`、`sharedContentPixels`、`overlapPixels`，明确区分
   “图集唯一占用”“材质实际采样”“跨材质共享”“矩形内未采样”。

4. **平面材质的统计**
   纯色材质没有重映射 UV，过去可能按原始 UV 记账。现在每个平面材质固定计入
   1 个可采样 texel，不再溢出到别的矩形。

5. **减面后的部件元数据失效**
   `reduceBatches()` 简化后仍保留旧的逐三角形 `sourceParts` 数组，长度与新三角面
   不一致。现在减面会显式丢弃无法可靠映射的部件元数据；部件筛选在减面前完成，
   不会再把旧索引应用到新网格。

6. **同名材质被按名称误删**
   桌面 session、转换路由、旧版纹理报告和 UI 全部改按材质 key。旧版报告也补了
   `key` 与共享矩形的 `materialKeys`；同名材质不再合并统计或被一起排除。

7. **网页端同名材质与排除列表错位**
   网页批次 key 由运行时 `material.uuid` 改为稳定 key；排除材质的名称/键数组
   逐条对齐，不再因为 `Set(name)` 去重造成第二项取错键。

## 3. 材质与部件标识如何统一

- 材质：`m:{name}#{occurrence}`。同名材质按文档顺序得到 `#1/#2`，UI 显示
  `name #2` 只作标签，设置永远写 key。
- 部件：沿用文档 Primitive id（`p{node}.{primitive}`），Mesh 被多个 Node 实例化时
  退化为 Node 实例 id（`n{nodeIndex}`）；网页端为 `w{meshIndex}.{groupIndex}`。
- 材质与部件是多对多：每个部件记录自己的 `materialKey`；每个材质记录
  `partIds`。删除部件不会删除材质对象；删除材质只按 key 移除对应 Primitive。
- 旧配置：`excluded` / `materialWeights` 里的旧名称只在“当前模型没有同名歧义”
  时迁移；未知项丢弃并提示。保存时记录结构指纹，重新关联到不同文件时清空选择，
  不会把另一个模型的材质/部件状态静默套用。
- Web 端每次重新导入都会重置材质勾选、权重、部件选择；旧模型状态不会继承。

## 4. 新 UI 操作流程

### 4.1 网页版

1. 导入模型后，左侧「纹理与部件」先显示模式开关：**旧版算法** / **纹理预算**。
2. 预算模式再选 **密度** 或 **细节保留**；两种目标的说明不同：
   密度按表面积，细节保留按原始 UV 细节。
3. 「模型部件」按真实 Mesh / Primitive 分组：可单勾、全选、反选、只看某个部件；
   共享材质的部件显示 `共享 ×N`。取消勾选即从导出中删除该几何；勾选
   “预览隐藏已删除部件”可立即看保留结果。
4. 「材质与清晰度」列出材质与保留部件数；点材质后出现 0.1×–4× 相对清晰度滑块
   和 0.5/1/1.5/2 快捷值。转换后显示实际像素、与上次的增减、是否触底。
5. 结果页显示输出预览、转换报告、材质像素；「查看贴图分区」打开图集诊断：
   选中材质高亮区域、虚线共享矩形、未采样像素、折叠的详细统计。

### 4.2 桌面工作台

工作台左栏使用同一套组件与 CSS：模式、目标、部件、材质清晰度、图集弹窗。
桌面转换请求新增 `includedParts`、`textureMode`、`textureTarget`、`atlasSharing`；
服务端按部件对象和材质 key 过滤后再绑定/减面/贴图。

### 4.3 截图

| 状态 | 图片 |
|---|---|
| 网页版旧版默认 | `images/01-studio-legacy.png` |
| 预算模式 + 材质选择 | `images/02-studio-budget-quality.png` |
| 清晰度调整面板 | `images/02b-quality-tuner.png` |
| 实际转换结果 | `images/03-studio-result.png` |
| 图集诊断 | `images/04-atlas-diagnostics.png` |
| 切回旧版后的过期提示 | `images/05-studio-legacy-after-budget.png` |
| 桌面工作台 | `images/06-desktop-workbench.png` |
| 桌面预算模式 | `images/07-desktop-budget.png` |
| 导出图集（kati，预算） | `images/kati-budget-export-atlas.png` |

## 5. 旧界面与新界面的主要区别

| 旧界面 | 新界面 |
|---|---|
| 只有材质勾选和抽象“像素权重” | 旧版/预算模式分离；预算模式用相对密度/细节保留 |
| 无法通过 UI 删除部件 | 按模型结构列出部件，支持单删、全选、反选、只看 |
| 看不到调整后的实际像素 | 转换后逐材质显示 px、与上次差值、触底提示 |
| 图集检查只有矩形和名称 | 高亮选中材质、共享矩形、未采样区域、折叠详细统计 |
| 无法在预览中看到部件删除效果 | 网页版按 Primitive/Material group 隐藏被删部件并支持只看 |
| 同名材质会互相影响 | 同名材质独立 key、独立设置 |

## 6. 真实模型验证

脚本：`npm run test:texture-studio`（`scripts/checks/texture-studio-e2e.ts`）。
数据：`data/e2e.json`。

模型：kati（151 部件 / 18 材质 / 12 个共享材质组）、shino（17 / 17）、
furina（27 / 27）。kati 模型来自 `.cache/diag/kati/model.glb`，shino/furina 来自
`video/remotion/public/models/`。

### 6.1 共享材质部件删除（kati 真实几何）

| 项目 | 结果 |
|---|---|
| 共享材质 | `m:Up_Skin#1` |
| 删除部件 | `卡提希娅_mesh#47`，4,490 面 |
| 保留的共享部件 | `卡提希娅_mesh#45`，材质对象与 UV 逐值不变 |
| 部件数 | 151 → 150 |
| 内容像素 | 11,590 → 11,613（+0.2%，其余材质获得重新分配） |
| 唯一 UV 采样 | 7,048 → 7,053 |
| 被删材质是否消失 | 否，仍存在且被其他部件引用 |

> 删除后总 content 不必然下降：固定 128² 下剩余 UV 岛会被重新放大。
> 能确认的是目标几何消失、保留部件不变、材质仍被引用、部件统计减一。

### 6.2 同名材质（真实几何改名）

| 模型 | key A / B | 删 B 后剩余 Primitive | 结果 |
|---|---|---|---|
| kati | `m:Duplicate#1` / `m:Duplicate#2` | 150 | A 的几何全部保留，B 被移除 |
| shino | 同上 | 16 | 同上，B 所在空 Mesh 被释放 |
| furina | 同上 | 26 | 同上，B 所在空 Mesh 被释放 |

### 6.3 权重/清晰度实际分配

| 模型 | 目标材质 1× → 4×（atlas texels） | 另一材质 1× → 4× | 结论 |
|---|---|---|---|
| kati | `m:Face_#1` 592 → 1,959 | `m:Eye_#1` 45.8 → 24.4 | 目标增加，其他减少 |
| shino | `m:Face#1` 1,318 → 3,843 | `m:Eyelash#1` 61.7 → 43.0 | 同上 |
| furina | `m:颜#1` 1,414 → 3,950 | `m:睫#1` 45.2 → 32.8 | 同上 |

三模型逐材质 `rectPixels` 之和都等于 `contentPixels`（脚本断言通过）。

### 6.4 旧版 / 预算密度 / 预算细节保留

| 模型 | 模式 | content | 唯一 UV | allocated |
|---|---|---|---|---|
| kati | legacy | 70.6% | 31.3% | 96.5% |
| kati | density | 70.9% | 42.9% | 96.2% |
| kati | retention | 70.7% | 43.0% | 96.4% |
| shino | legacy | 83.8% | 60.2% | 92.5% |
| shino | density | 81.7% | 57.0% | 93.5% |
| shino | retention | 84.3% | 58.7% | 97.2% |
| furina | legacy | 81.9% | 55.6% | 88.5% |
| furina | density | 77.2% | 40.1% | 96.7% |
| furina | retention | 78.3% | 34.8% | 97.3% |

结论与 v3 一致：预算模式在 kati 上明显提高唯一 UV 覆盖，在 shino/furina 上
content/UV 有升有降；**不能只凭某些材质更清晰就判定整体画质更好**。旧版仍是默认。

### 6.5 实际导出

kati：`optimizeModel`（高度 32、减面 20%、预算细节保留）→ `bindStatic`
→ `exportBedrockGeometry` → `buildSkinPack`：

- 5.2–6.6 秒，151,550 输出三角面，128×128 PNG 34,485 bytes。
- 包内 7 个文件：`manifest.json`、`geometry.json`、`skins.json`、`skin0.png`、
  `texts/en_US.lang`、`texts/languages.json`、`texts/zh_CN.lang`。
- 所有 UV 在 [0,1]，几何校验通过（脚本内断言）。

## 7. 性能

| 项目 | 数值 |
|---|---|
| 预算规划（三模型） | 0.6–1.1 s |
| 安全共享（未命中） | 0.5–1.0 s |
| kati 完整导出 | 约 5.2–6.6 s |
| 全量测试 | 374 tests / 75 files（见最终提交） |

网页端在一个转换未完成时再次点击“重新转换”会以 run token 忽略旧结果；
拖动清晰度滑块只标记结果过期，不会自动触发转换。

## 8. 仍未解决的问题与已知限制

1. **桌面工作台没有部件级 3D 高亮/隐藏**。网页版已按组隐藏和“只看”；桌面预览
   仍主要按材质显隐。部件列表、删除和导出是正确的，但桌面预览反馈弱于网页。
2. **预算模式默认画质仍未全面超过 legacy**（与 v3 一致）。本轮不切换默认，
   继续保持旧版默认、新预算模式手动开启。
3. **安全共享很少命中**：真实模型要求同贴图 + 同采样器 + 逐三角形 UV 逐位相同；
   kati 有共享材质但 UV 不同，因此共享统计为 0。不是错误，而是安全设计的代价。
4. **减面后逐部件 atlas 统计缺失**：减面改变三角形后无法可靠保持部件映射，
   已显式丢弃旧元数据，避免给出错误数字；部件保留/筛选本身在减面前完成。
5. **平面材质 alpha 采样统计**仍按 1 texel 记账，未对纯色透明材质做额外 alpha 语义。
6. **桌面/网页的 label 策略**：服务端提供 `label`，网页批次使用 `materialLabels`；
   两处实现不同但都以 key 为真源，后续可抽到 `src/selection.ts` 共享。
7. **UI 原型尚未在更多模型上做视觉回归**（本轮 3 个模型 + kati 导出；未覆盖 10 个
   以上真实模型和双端截图对比）。

## 9. 是否可以合并 main

**不建议现在合并、也不建议切换默认。**

可以进入下一轮“候选合并评审”，但需要先完成：

1. 桌面部件级预览高亮/隐藏；
2. 至少再覆盖 5–10 个真实模型（含大量同名材质、实例化 Mesh、透明材质）；
3. 对 legacy 与预算模式做同视角视觉回归，而不只看像素/覆盖率；
4. 把预算模式的共享矩形命中率和 floor 比例纳入 UI 诊断；
5. 统一剩余的名称显示 helper，清理临时研究脚本。

本轮的价值是：底层删除和统计已经可重复、可验证；材质/部件身份稳定；用户第一次
可以在同一界面里删除部件、调整相对清晰度并看到实际分配与取舍。它还不是默认算法
的替代品。

## 10. 复现

```bash
npm run check
npm test
npm run test:texture-studio
# UI 截图（需要 dev server 和 webapp/public 下的模型）
node scripts/checks/capture-studio-cdp.mjs
node scripts/checks/capture-desktop-cdp.mjs
```

## 11. 阶段五：架构与产品体验收敛

本轮没有为了“减少代码量”合并不同职责，而是确认了以下边界：

- **数据语义**：`src/selection.ts` 是材质/部件长期身份与旧配置迁移的唯一入口；
  `materialKeyMap`（桌面）与 `stableMaterialKeyMap`（网页）只负责把当前文档/
  场景映射为同一 key 形状。UI 不保存名称或运行时 UUID。
- **职责划分**：`atlas-core` 只做规划/装箱/重映射/统计；`atlas-desktop.ts` 与
  `webapp/engine/atlas.ts` 只做平台适配（像素、画布、glTF）；UI 只读报告。
  预算模式统计不再由适配器各自计算。
- **共享 UI**：`web/shared/TextureStudio.tsx`、`MaterialList.tsx`、
  `AtlasInspector.tsx` 同时服务桌面和网页；两端的差异只在 host 适配数据，
  不再复制滑块、勾选和图集交互。
- **状态稳定性**：转换完成/失败/被新任务取代分别处理；拖动滑块只标记过期，
  不自动触发转换；部件/材质未知配置被丢弃或重置，不静默套用。
- **保留实验状态**：稀疏岛自动拆分没有接入 UI；安全共享继续 opt-in；
  legacy 默认不变。预算模式只在用户主动切换后出现。

后续可收敛但仍保留的部分：

- 桌面 `MaterialPanel` 与网页 `ModelStudio` 的 host 适配器仍有少量重复的
  “parts/materials → StudioPart/StudioMaterial”映射，数据源不同，暂不强行合并；
- `webapp/engine/part-visibility.ts` 是预览专用，不参与导出几何；
- 桌面部件预览尚未接入 Viewer 的 group 级隐藏，这是下一轮产品化前置条件。

