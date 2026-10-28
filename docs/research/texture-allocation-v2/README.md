# 纹理图集与材质分配研究（research/texture-allocation-v2）

本目录记录一轮**独立的、可复现的**纹理分配实验，不改动产品行为、不合并 main、不发布。

- 分支：`research/texture-allocation-v2`
- 基准图集尺寸：128×128（固定，与产品 compact 模式一致）
- 结论以实测数据为准；未达到预期时保留负面结果。

## 目录

| 路径 | 内容 |
|---|---|
| `01-audit.md` | 第一阶段：现有纹理链路审查、数据流、问题定位、基准结果 |
| `02-model.md` | 第二阶段：分配模型研究与候选方案设计 |
| `03-experiments.md` | 第三阶段：候选实现与 A/B 实验数据 |
| `04-report.md` | 第四阶段：综合评估、架构建议、是否可替换 |
| `05-integration.md` | 第五阶段：有限集成验证（仅在确有优势时） |
| `data/` | 脚本自动生成的表格与机器可读摘要（随提交更新） |

## 实验代码

`scripts/research/atlas/` 是平台无关的实验工具链：

| 文件 | 作用 |
|---|---|
| `types.ts` | 中性输入/规划类型（材质批次、UV、纹理、图集计划） |
| `fixtures.ts` | 11 个确定性合成场景（共享贴图、UV 重叠、稀疏岛、部件删除等） |
| `real.ts` | 真实模型加载器（glTF/VRM → 中性输入，记录 SHA-256） |
| `baseline-web.ts` | 生产 `planAtlas` 的逐行移植（测试保证不漂移） |
| `baseline-desktop.ts` | 生产 desktop compact 分配器的逐行移植 |
| `desktop-production.ts` | 直接调用**未修改的** `optimizeTextures` 并分析其输出 |
| `sample.ts` / `render.ts` / `remap.ts` | 确定性 CPU 采样、图集绘制、UV 重映射 |
| `metrics.ts` | 覆盖率、纹理密度、原生采样比、采样误差 |
| `run-stage1.ts` | 基准运行器（输出 JSON/CSV/PNG 到 `.cache/research/`） |
| `run-stage3.ts` | A/B 实验运行器（方案、权重扫描、部件删除、正确性、性能） |
| `run-views.ts` | 固定视角参考/候选/差异三栏图 |
| `check-integration.ts` | 桌面端预算路径的有限集成校验 |
| `check-deletion.ts` | 删除某材质后逐材质误差核对 |
| `summarize.ts` / `summarize-stage3.ts` | 把运行结果转成 `data/` 下的 markdown 与摘要 JSON |

## 复现

```bash
# 合成场景 + 真实模型（自动发现本机样本）
node scripts/research/atlas/run-stage1.ts

# 只跑合成场景
node scripts/research/atlas/run-stage1.ts --fixtures

# 指定真实样本（分号分隔）
ATLAS_SAMPLES="video/remotion/public/models/shino-source.glb;outputs/demo-model/Sendagaya_Shino.vrm" \
  node scripts/research/atlas/run-stage1.ts --real

# 生成提交用的表格
node scripts/research/atlas/summarize.ts

# 第三阶段 A/B 实验与固定视角对照
node scripts/research/atlas/run-stage3.ts --fixtures
node scripts/research/atlas/run-views.ts

# 桌面端预算路径的有限集成校验
node scripts/research/atlas/check-integration.ts video/remotion/public/models/shino-source.glb

# 校验移植版本与生产规划器一致
npx vitest run tests/webapp-atlas-port.test.ts
```

输出（gitignore）：

- `.cache/research/stage1/report.json`：完整测量结果（含每个岛的矩形）
- `.cache/research/stage1/materials.csv`：逐材质明细
- `.cache/research/stage1/*.png`：图集与诊断图

## 真实样本来源

本机真实模型来自仓库工作区（未纳入 git，因为 PMX/VRM 素材的再分发许可不明确）：

- `video/remotion/public/models/*-source.glb`（PMX 转换，作者自用素材）
- `outputs/demo-model/Sendagaya_Shino.vrm`（VRM 示例）

每个模型在报告中记录绝对路径与 SHA-256。**没有这些素材的机器无法复现真实模型数字**，只能复现合成场景；报告会明确区分两者。

## 指标约定

| 指标 | 定义 |
|---|---|
| `content` | 图集矩形去掉 gutter 后的面积占比 |
| `allocated` | 含 gutter 的矩形面积占比 |
| `UV 覆盖` | 被三角面实际覆盖的像素占比 |
| `矩形内 UV 占比` | `uvPixels / contentPixels`，即矩形里真正被采样的比例 |
| 材质重叠 | 同一像素被 ≥2 个材质采样的比例（共享区域） |
| `atlasTexels` | `Σ |UV 三角形面积| × 128²`，精确的纹理像素需求 |
| `sourceTexels` | `Σ |源 UV 面积| × 源分辨率²`，原生纹理细节量 |
| 采样比 | `atlasTexels / sourceTexels`，>1 为超采样，<1 为真实细节损失 |
| 误差 | 三角面内重心采样点：源纹理双线性采样（经 factor/alpha 烘焙）与图集双线性采样的线性 RGB 平均绝对差 |
| 边缘误差 | 距边 2% 的采样点误差，用于发现 gutter/串色 |
