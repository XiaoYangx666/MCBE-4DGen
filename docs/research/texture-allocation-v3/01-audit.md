# 第一阶段：v2 成果独立核对与剩余问题

> 分支 `research/texture-allocation-v3`（基于 `origin/research/texture-allocation-v2@d5d6e5b`）
> 本阶段只做审查、复现与必要修复；不重构。

## 0. 结论摘要

上一轮的**算法结论与集成结果基本成立**，但独立审查发现了一个真实的共享正确性缺陷，
并确认了三处尚未完成的能力缺口：

| 类别 | 结论 |
|---|---|
| 已确认缺陷（本轮修复） | 安全共享只比较「贴图 + 包围盒 + 参数」，不比较盒内实际 UV 映射，可能把两个采样不同像素的图表重叠到同一矩形 |
| 已确认缺陷（v2 已修，本轮补回归测试） | 逐顶点重映射时若同一顶点被多个三角形访问，二次读取已改写的 UV 会把顶点推出 `[0,1]`（furina 曾出现 7 712 个） |
| 已确认缺口 | 预算模式桌面报告缺少逐材质像素/覆盖率统计（`report.materials` 为空） |
| 已确认缺口 | 没有部件（Primitive/Mesh/Node）级标识；筛选只能按材质，删除共享材质的部件会误删 |
| 已确认缺口 | 现有测试主要比较规划矩形，端到端输出只有两个真实模型的手工脚本 |
| 设计取舍（保留） | legacy 仍按「贴图 + 采样参数」跨材质分组；预算模式不做跨材质合并 |

## 1. 审查方法

- 直接阅读 v2 分支代码，而不是依赖上一轮总结。
- 用新增的 `scripts/research/atlas/audit-model.ts` 检查真实模型的
  Node/Mesh/Primitive/Material 结构与共享关系。
- 用新增的单测复现共享误判与顶点重复映射。
- 重跑 `npm run check`、`npm test`（339 个测试）确认没有回归。

## 2. 逐项核对

### 2.1 是否仍存在不同材质意外共享分配预算？

- **预算路径（`src/atlas-core/plan.ts`）**：不会。每个 `ChartInput` 是独立材质批次，
  `analyse()` 只在自己的输入内分岛；`groupSlots()` 只在显式
  `sharing:'safe'` 时合并，且合并后仍按成员各自的 UV 映射。
- **legacy 路径**：仍会。`textureCharts()` 的分组键是
  `贴图哈希 + factor + alpha + wrap`，不含材质身份；随后
  `mergeUvCharts()` 还会在 UV 盒相接/重叠时合并。这是 legacy 的设计，
  默认行为本轮不改变。
- **结论**：预算路径独立；legacy 的合并不是缺陷而是既有取舍，继续保留并在文档中说明。

### 2.2 稳定材质标识是否贯穿？

- 核心 `ChartInput.materialKey` 存在，但规划结果的 `PlannedChart.materials` 只有
  **显示名**；同名材质在统计和报告里会合并。
- 桌面适配器 `materialKey = m{index}:{name}`，索引依赖文档顺序；同名材质可区分，
  但文档重排后会变化。
- 网页端 `SourceBatch.key = material.uuid`，权重/筛选都用它；uuid 在重新导入后变化，
  **不能作为跨会话的稳定标识**。
- legacy 桌面权重按**名称**（`materialWeights[name]`），同名材质共享权重。

**本轮修复（部分）**：`PlannedChart.materialKeys` 已加入，核心规划输出稳定 key；
统计与权重仍需在第四阶段统一（见下）。

### 2.3 共享区域是否严格保证采样兼容？

**这是一个真实缺陷，已复现并修复。**

v2 的共享键是：

```
textureKey | bounds.toFixed(6) | flat/tex | color | opacity | alphaMode | cutoff | wrap
```

它只保证「同一张贴图、同一个包围盒、同一组采样参数」。但图集矩形的内容
是**用第一个成员的 UV 映射渲染一次**的；如果第二个成员在同一个包围盒内
使用了不同的三角形/UV 布局（例如对角线翻转、左右半交换、镜像），
它会按自己的 `map` 采样同一批像素，**颜色错误**。

复现（`tests/atlas-sharing.test.ts`）：两个 0..1 四边形，同一贴图，
一个对角线为 `(0,0)-(1,1)`，另一个为 `(1,0)-(0,1)`。旧键会把它们合并，
新实现不会。

修复：

- 共享键改用**全精度** bounds（`Number.toString`）与三角形数量；
- 分组后按**逐三角形 UV 的逐位相等**再分等价类（`sameUv`，无 epsilon）；
- 只有 UV 逐位相同、贴图相同、采样器相同、需求相同才共用矩形。

代价：共享触发更少（真实模型本来就没有可共享的重复材质），但正确性从
「近似安全」变成「可证明安全」。

### 2.4 多三角面共享顶点是否会产生映射冲突？

**会，v2 曾在真实模型上出现，已修复；本轮补了回归测试。**

桌面适配器按顶点写 UV。最初实现读取 `copy.uvs[vertex]` 并就地写回；
一个顶点被同一图表内多个三角形访问时，第二次会读到已经映射过的值，
再映射一次，产生 `[0,1]` 之外的 UV。`furina-source` 上有 7 712 / 25 598 个。

修复：始终从 `copy.original`（原始 UV 副本）计算，写入 `copy.uvs`。
本轮新增四边形（4 顶点 / 2 三角形，共享 2 个顶点）的回归测试。

- 跨图表共享顶点：正常 glTF 中一个顶点只有一个 UV，因此属于唯一 UV 连通分量；
  不会出现「同一顶点被两个图表写入」。桌面端的检查脚本显示两端 0 越界。
- 若将来允许**稀疏岛切分**，同一顶点可能被分到两个图表，必须复制顶点
  （第三阶段处理）。

### 2.5 几何准备/减面/材质合并是否丢失来源关系？

- `prepare-model.ts` 为**每个 Node 实例创建一个新 Mesh**，复制 primitive 的
  `extras`，但**不复制 Node 的 extras**；Node 名称保留。
- `mesh-optimizer` / `rigid-mesh-reducer` 按 primitive 处理，保留 primitive extras。
- webapp `extract.ts` 按 `material.uuid` 聚合三角形，三角面只保留
  humanoid `PART_CODE`（骨骼部位），**没有 Mesh/Primitive 来源**。
- 图集阶段（桌面）按材质分组；（网页）按材质批次。

结论：**部件身份在导入后即丢失**。真实模型里 6 个 GLB 恰好是
1 Node = 1 Mesh = 1 Primitive = 1 Material，所以问题被掩盖；PMX 是
1 Node = 1 Mesh = 19～46 Primitive，不同部件共享一个 Mesh，但材质各不相同。
真正的「多部件共享同一材质」需要构造（第二阶段）。

### 2.6 预算模式缺失的统计

Confirmed：`src/atlas-desktop.ts` 的 `report.materials = []`，
`sampledUtilization` / `uvPixels` 为 `undefined`，纹理检查器无法显示
逐材质实际像素。研究端 `metrics.ts` 已有完整实现，第四阶段移植到适配层。

### 2.7 现有测试是否验证最终转换结果？

- `tests/atlas-budget.test.ts`：验证 PNG 尺寸、UV 范围、权重响应、
  legacy 输出未变；**不验证像素颜色**。
- `tests/webapp-atlas-budget.test.ts`：验证与核心矩形一致；不验证渲染。
- `tests/webapp-atlas-port.test.ts`：验证 legacy 规划器未漂移。
- 端到端像素/UV 正确性目前只靠 `check-integration.ts` 手工跑两个真实模型。

结论：需要把「最终输出」纳入自动测试（第五阶段），至少覆盖
共享顶点、重复材质名、部件删除、repeat/mirror。

## 3. 真实模型的部件结构

`node scripts/research/atlas/audit-model.ts <models>`（原始输出：
`data/stage1-model-structure.json`）：

| 模型 | Node | Mesh | Primitive | Material | 重名材质 | 跨 Mesh 共享材质 |
|---|---|---|---|---|---|---|
| shino-source | 17 | 17 | 17 | 17 | 0 | 0 |
| mingyin-source | 14 | 14 | 14 | 14 | 0 | 0 |
| girl-source | 26 | 26 | 26 | 26 | 0 | 0 |
| nana-source | 15 | 15 | 15 | 15 | 0 | 0 |
| lumine-source | 20 | 20 | 20 | 20 | 0 | 0 |
| furina-source | 27 | 27 | 27 | 27 | 0 | 0 |
| 早雾1.0.pmx | 1 | 1 | 19 | 19 | 0 | 0 |
| 鸣潮_菲比1.085.pmx | 1 | 1 | 46 | 46 | 0 | 0 |

含义：

1. 这 6 个 GLB 的「材质 = 部件」，所以上一轮按材质筛选没有暴露出问题；
2. PMX 的真实部件单位是 **Primitive**，不是 Node（一个 Mesh 内有 19～46 个）；
3. 「两个部件共享同一材质」在本语料中不存在，必须用真实几何构造：
   复制 primitive/node 并保留同一材质，才能验证解耦。

## 4. 本阶段改动

| 文件 | 改动 |
|---|---|
| `src/atlas-core/plan.ts` | 共享判定改为「贴图 + 采样器 + 全精度包围盒 + 逐三角形 UV 逐位相等 + 需求相等」 |
| `src/atlas-core/types.ts` | `PlannedChart.materialKeys`（稳定身份，显示名可重复） |
| `tests/atlas-sharing.test.ts` | 新增：共享误判复现、正确共享、重名材质区分 |
| `tests/atlas-budget.test.ts` | 新增：共享顶点重映射回归测试 |
| `scripts/research/atlas/audit-model.ts` | 新增：模型部件/材质结构诊断 |

验证：`npm run check` 通过；`npm test` 全部通过（见提交记录）。

## 5. 留待后续阶段

| 问题 | 阶段 |
|---|---|
| Primitive 级部件标识、独立删除、UV 需求回收 | 第二阶段 |
| 稀疏 UV 岛切分与重映射 | 第三阶段 |
| 逐材质实际像素/密度/浪费统计、稳定材质 id 统一、两端分析收敛 | 第四阶段 |
| 正/侧/背/局部渲染回归、逐模型数据、退化案例 | 第五阶段 |

## 6. 对第二阶段的输入

1. 部件单位应当是 **Primitive**（PMX 证据），并保留 Node/Mesh 作为分组信息。
2. 部件筛选必须发生在**几何层面**（删除三角形/primitive），而不是只在材质层面跳过。
3. 删除后，材质批次必须重新计算 `uvs / bounds / triangleAreas / area`，
   否则预算仍按旧需求分配。
4. 共享材质的两个部件删除其一时，另一个的 UV 与采样必须逐像素不变；
   需要端到端测试而不只是矩形比较。
