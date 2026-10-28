# 纹理处理系统 v3：总结

> 分支 `research/texture-allocation-v3`（基于 `origin/research/texture-allocation-v2@d5d6e5b`）
> 基线 `main@9ce2923`。未合并、未发布、未部署。

## 本轮提交

| 阶段 | 提交 | 内容 |
|---|---|---|
| 1 | `5ce2a59` | v2 独立审查；共享误判修复；共享顶点回归测试；模型结构诊断 |
| 2 | `0b6bf2e` | Primitive/实例级部件标识；独立删除；网页/桌面过滤；真实模型实验 |
| 3 | `9cf0a3c` | 稀疏岛拆分实验（合成 + 真实模型）；负结果 |
| 4 | `68b16b7` | 共享统计、材质身份、remap/report 收敛；预算模式报告补齐 |
| 5 | 本次提交 | 多视角回归、逐模型数据、最终评估与交付 |

## 核心结论

1. **部件与材质解耦已完成并验证**：部件单位是 Primitive（PMX 证据），
   实例化 Mesh 时退化为 Node 实例；id 经过 prepare/减面稳定。
   删除共享材质的部件只删除目标几何，材质与其他部件不受影响。
2. **删除确实回收预算**：保留部件误差不变（4 位小数），
   其他材质获得 2.6%～27.6% 的 atlas texels。
3. **共享正确性修复**：只有「同贴图 + 同采样器 + 逐三角形 UV 逐位相同 +
   需求相同」才共用矩形；修复了同包围盒不同内部映射的错误共享。
4. **统计补齐**：预算模式现在有逐材质/逐部件的有效像素、密度、
   矩形空白、gutter、floor、目标/实际面积与共享节省，共享矩形不重复计数。
5. **稀疏岛自动拆分失败**：合成条带收益明显（覆盖 3.8%→11.9%，误差 −12%），
   真实模型上岛数 +30%～160%、content −3～−14pt、覆盖 −3～−5pt、
   误差 +0～5%、复制 343～935 顶点。**默认关闭，不集成。**
6. **默认画质仍未超越 legacy**：三视角平均误差在 shino/nana 上
   web 最好，furina 上 desktop 最好；retention 的价值在细节材质与可控制性。

## 集成状态

| 能力 | 状态 |
|---|---|
| 共享核心（分析/预算/共享/装箱/重映射/统计） | 已集成，opt-in |
| 桌面预算模式 + 逐材质/部件统计 | 已集成 |
| 网页预算规划（`planAtlas` options） | 已集成，opt-in |
| 部件筛选（桌面 / 网页） | 已集成（程序接口，无 UI） |
| 稀疏岛拆分 | 实验原型，默认关闭 |
| Legacy 默认 | 不变 |

## 是否进入 UI 阶段

可以进入 **UI 原型**，不建议直接切换默认：

1. 先统一材质 id（`m:{name}#{occ}`），权重不再依赖 uuid/名称；
2. UI 只暴露部件勾选、纹理密度倍数、预算目标、floor 提示；
3. 用更多真实模型验证用户能理解「相对倍数 + 固定预算」；
4. 补 alpha>0 的采样统计与网页同口径报告；
5. 再评估默认切换。

## 阅读顺序

1. `01-audit.md` — v2 核对、共享缺陷、模型结构
2. `02-parts.md` — 部件抽象、API、真实模型删除实验
3. `03-sparse.md` — 拆分实验与失败原因
4. `04-core.md` — 统计、身份、两端收敛
5. `05-regression.md` — 多视角回归、逐模型数据、交付答案
6. `data/`、`images/` — 表格与渲染对照

## 复现

```bash
node scripts/research/atlas/run-parts.ts
node scripts/research/atlas/run-sparse.ts
node scripts/research/atlas/run-views-v3.ts
node scripts/research/atlas/check-integration.ts video/remotion/public/models/shino-source.glb
npm run check && npm test
```
