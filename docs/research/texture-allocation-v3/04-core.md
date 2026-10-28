# 第四阶段：共享核心完善与有限集成

> 代码：`src/atlas-core/remap.ts`、`src/atlas-core/report.ts`、`src/atlas-desktop.ts`、`src/api-types.ts`
> 默认行为不变；legacy 仍然是默认路径。

## 1. 预算模式的真实统计

新增平台无关的 `summarizePlan()`，从「规划 + 重映射后的 UV」计算统计，
不需要像素访问，因此桌面端与网页端可以给出同一套数字。

| 字段 | 定义 | 避免的错误 |
|---|---|---|
| `contentPixels` | 去 gutter 矩形之和（**共享矩形只算一次**） | 共享岛重复计数 |
| `allocatedPixels` | 含 gutter 矩形之和（去重） | 同上 |
| `gutterPixels` | allocated − content | 把 gutter 当有效空间 |
| `emptyPixels` | 图集面积 − allocated | 把装箱空隙当已用 |
| `uvPixels` | 三角面实际覆盖的像素 | 把矩形当采样 |
| `chartCoverage` | uvPixels / contentPixels | content 利用率虚高 |
| `materials[].uvPixels` | 该材质三角面覆盖的像素（共享像素对每个材质各计一次） | 只看全局 |
| `materials[].rectPixels` | 按 UV 面积分摊的内容矩形像素 | 共享矩形全算给一个材质 |
| `materials[].wastePixels` | rectPixels − uvPixels | 矩形空白 |
| `materials[].atlasTexels` | `Σ|图集 UV 三角面积| × 128²`（精确） | 像素栅格误差 |
| `materials[].sourceTexels` | `Σ|源 UV 三角面积| × 源分辨率²` | 只看世界面积 |
| `materials[].texelDensity` | atlasTexels / 世界面积 | 无 |
| `materials[].sourceRatio` | atlasTexels / sourceTexels | 无 |
| `materials[].floorCharts` | 被 `minEdge` 限制的岛数 | 把 floor 当成权重结果 |
| `materials[].targetArea` | 预算请求的连续面积 | 只报整数结果 |
| `materials[].actualArea` | 实际分到的内容面积 | 无法看偏差 |
| `parts[]` | 每部件的三角面数与 atlasTexels | 删除前后无法量化回收 |
| `shared` | 共享岛数与节省像素 | 共享收益不可见 |

`atlasTexels` 对共享像素按材质分别累计（每个材质确实采样这些像素），
而图集总量 `content/allocated/uvPixels` 按唯一矩形计算，两者语义分开。

### 实测（shino，预算模式，128²）

```
uvUtilization 58.74%   contentUtilization 84.27%   allocatedUtilization 97.24%
uvPixels 9 624         contentPixels 13 806        allocatedPixels 15 932
gutterPixels 2 126     emptyPixels 452             chartCoverage 69.7%
materials 17           parts 17                     keys m:Face#1 …
floorCharts 20
```

与上一轮研究端的数字一致（58.7% / 84.3% / 97.2% / 452），
说明适配层没有改变规划语义。

## 2. 修复的边界问题

1. **安全共享**（第一阶段）：改为逐三角形 UV 逐位相等，
   不再仅凭贴图 + 包围盒 + 参数近似。
2. **材质标识**：桌面适配器改用 `m:{name}#{occurrence}`，
   与 `src/parts.ts` 的 `materialKey` 一致；同名材质可区分，
   并在 `report.materials[].key` / `regions[].materialKey` 中暴露。
3. **顶点重映射**：始终从原始 UV 副本计算，避免重复访问时二次映射；
   新增四边形回归测试，真实模型 0 越界。
4. **共享矩形统计**：`summarizePlan` 按唯一矩形汇总，
   材质级按 UV 面积分摊，避免重复计数。

## 3. 两端收敛

```
src/atlas-core/
  types.ts    中性输入/计划
  budget.ts   预算求解（density / retention / legacy）
  pack.ts     MaxRects
  plan.ts     岛分析、共享决策、预算、装箱（splitSparse 可选）
  remap.ts    UV→图集映射
  report.ts   统计
  sample.ts   面积采样（桌面适配器使用）
```

- 桌面端（`src/atlas-desktop.ts`）：glTF → 中性输入；sharp 解码；核心规划；
  面积采样绘制；`summarizePlan` 统计。
- 网页端（`webapp/engine/atlas.ts`）：`AtlasInput` → 中性输入；
  核心规划；canvas 绘制与自己的 `measureAtlasUsage`。
- 研究工具（`scripts/research/atlas/*`）复用同一核心与 remap/report，
  不再有第二套规划实现。

平台差异只剩：图像解码、重采样实现、PNG 编码、UI 测量入口。
没有新增持久状态或缓存；预算只依赖当前输入与选项。

## 4. 兼容性

- `optimizeTextures` 默认仍走 legacy compact；只有显式 `atlasBudget` 才进入新路径。
- `planAtlas` 只有在传入 `{ budget }` 时才委派核心。
- `TextureReport` / `TextureMaterialUsage` 只新增可选字段，旧消费者不受影响。
- `npm run check` 与全量 `npm test` 通过（见提交记录）。
- 未开发 UI、未改交互、未发布。

## 5. 仍是缺口

1. **不透明像素统计**：`summarizePlan` 只算三角面覆盖（`uvPixels`）。
   “alpha>0 的实际采样像素”需要像素访问，预算模式下仍为 `undefined`。
   这对桌面检查器是一个可见的空缺，但不会误报。
2. **网页端报告未完全对齐**：网页 `textureReport` 仍使用自己的
   `measureAtlasUsage`；数字定义一致，但未复用 `summarizePlan` 的字段。
3. **权重仍按材质名传入桌面 API**（`materialWeights`），
   核心支持 `materialKey`；API 层统一留待 UI 阶段。
4. **part 级统计只覆盖预算模式**：legacy 会克隆/合并 primitive，
   几何身份不保留，无法可靠归属。

## 6. 结论

- 统计、标识、共享与重映射问题已经收敛到共享核心；
- 预算模式现在能给出逐材质、逐部件的可验证数字；
- 由于第三阶段的拆分实验失败，本轮**没有**集成稀疏切分；
- 集成范围仍是「可选模式」，legacy 默认不变。
