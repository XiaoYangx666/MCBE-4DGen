# 第五阶段：有限集成验证

> 分支 `research/texture-allocation-v2`
> 默认行为未改变；未开发 UI；未发布；未触碰 `E:\4DGen-release`。

## 1. 集成范围

只抽取并接入**平台无关核心**，不做产品化改造：

| 部分 | 变化 |
|---|---|
| `src/atlas-core/` | 新增：类型、预算求解、装箱、规划（约 700 行，纯 TS，无 DOM/Node/three/glTF） |
| 桌面端 | `TextureOptions` 新增可选 `atlasBudget`、`atlasSharing`、`atlasCoverageAware`；新增 `src/atlas-desktop.ts` 适配器；**只在设置 `atlasBudget` 时启用** |
| 网页端 | `planAtlas(inputs, size, pad, options?)` 新增可选 `budget` / `weights` / `sharing`；**不传 options 时走原路径** |
| 研究代码 | `scripts/research/atlas/*` 改为复用 `src/atlas-core`，避免两份实现漂移 |

新增测试：

- `tests/atlas-budget.test.ts`：桌面端预算路径的 PNG 尺寸、UV 范围、权重响应、
  以及「未设置 `atlasBudget` 时 legacy 输出不变」。
- `tests/webapp-atlas-budget.test.ts`：网页端预算路径与共享核心的矩形逐项一致
  （11 个场景 + 权重响应）。
- 原有 `tests/webapp-atlas-port.test.ts` 继续保证 legacy 规划器未漂移。

## 2. 验证结果

### 2.1 桌面端（真实生产函数 + 真实模型）

`node scripts/research/atlas/check-integration.ts <model>`

| 模型 | 规划+绘制 | PNG | 岛数 | 与研究报告矩形一致 | UV 越界 | content | allocated | 空像素 |
|---|---|---|---|---|---|---|---|---|
| shino-source | 512 ms | 128×128 / 34 KB | 43 | **43/43** | **0** | 84.3% | 97.2% | 452 |
| furina-source | 539 ms | 128×128 / 37 KB | 81 | **81/81** | **0** | 78.3% | 97.3% | 441 |

- 与第三阶段研究实现的矩形**逐项相同**，说明适配层没有改变规划语义。
- 第一阶段生产管线（legacy）在 shino 上为 518 ms、content 78.5%、UV 55.7%；
  预算路径为 512 ms、content 84.3%、UV 58.7%（第三阶段同口径测量）。
- 输出通过 `validateModel`，材质数量保持 17/27（不做跨材质合并）。

过程中发现并修复了一个真实缺陷：同一材质内共享顶点会被多个三角形重复映射，
若就地读取已改写的 UV 会二次映射并把顶点推出 `[0,1]`（furina 曾出现 7 712 个越界）。
改为始终从原始 UV 副本计算后，两端均为 0 越界。该问题在「逐三角面 UV」适配层中
很容易出现，已加入集成脚本作为回归检查。

### 2.2 网页端

`npx vitest run tests/webapp-atlas-budget.test.ts`（12 个测试）：

- 11 个合成场景：`planAtlas(..., {budget:'texel-retention'})` 与直接调用
  `planAtlasBudget` 的矩形、图表 id、三角形集合、scale **完全一致**；
- 权重测试：目标材质面积提升，且相对另一材质 > 2.5×（固定预算下低于理想 4×）。

### 2.3 回归

`npm test`：**67 个测试文件、336 个测试全部通过**（新增 3 个后为 339）。
`npm run check`（Node + webapp 两套 tsconfig）通过。
legacy compact 的 `sampledUtilization` 等字段与行为保持不变。

## 3. 成本与复杂度

| 项 | 观察 |
|---|---|
| 规划时间 | 与 legacy 同量级（shino 512 vs 518 ms，含绘制与编码） |
| 额外内存 | 每个纹理解码一次（按内容哈希缓存）；每个三角形一份 UV/面积数组（约 24 B/三角面） |
| 代码 | 核心 ~700 行 + 桌面适配 ~450 行；删除的 legacy 逻辑（crop/tile/跨材质合并）尚未移除 |
| 状态冗余 | 无新增持久状态；预算只依赖当前模型与选项 |
| 重复数据 | 与原实现相同：文档克隆一次；额外只有中性输入数组 |

## 4. 已知缺口（未在本次集成中解决）

1. `report.materials` 在预算模式下为空，`sampledUtilization` / `uvPixels` 未计算，
   纹理检查器会缺少逐材质像素统计。生产化时需要补上测量（研究端的 `metrics.ts`
   可以直接移植）。
2. `maxTextureSize` 在预算模式下被忽略（保持源分辨率参与预算）。
3. 权重按**材质名**传入（与 legacy 一致），重名材质会共享权重；
   核心本身支持 `materialKey`，后续 API 应改用稳定 id。
4. 没有 UI；权重只能通过代码/实验 API 设置。
5. 桌面端仍未接入「部件级」归属：批次仍按材质，删除部件需要上游提供 primitive 级过滤。
6. 预算模式没有实现 `source-area` 兼容开关，也没有保留 crop 的旧行为；
   两者是有意简化。

## 5. 结论

- 核心可以被两端共享，且**结果可复现、可对齐**（矩形逐项一致）。
- 集成是**加法**：默认路径没有改动，legacy 行为与测试完全保留。
- 由于第四阶段的结论（默认视觉质量没有优势），本轮**不把预算模式设为默认**，
  也不接入 UI。
- 若后续决定产品化，优先级应为：
  1. 补 `report.materials` 与覆盖率测量；
  2. UI 暴露「纹理密度倍数 + 预算目标 + floor 提示」；
  3. 用真实用户权重验证控制是否符合直觉；
  4. 在更多模型类别上复测后再考虑切换默认。
