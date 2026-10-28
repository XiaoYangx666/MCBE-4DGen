# 第二阶段：模型部件与材质解耦

> 分支 `research/texture-allocation-v3`
> 代码：`src/parts.ts`、`webapp/engine/parts.ts`、`prepare-model.ts`、`webapp/engine/extract.ts`
> 数据：`data/stage2-parts.md`

## 1. 抽象边界：什么是一个「部件」

真实语料的结构（第一阶段 `audit-model.ts`）：

- 6 个 GLB：`Node = Mesh = Primitive = Material`，1:1:1:1；
- PMX：`1 Node = 1 Mesh = 19～46 Primitive`，每个 primitive 一个材质。

因此：

| 情况 | 部件单位 | 原因 |
|---|---|---|
| Mesh 只被一个 Node 使用 | **Primitive** | PMX 的真实粒度；同一材质可被多个 primitive 引用 |
| Mesh 被多个 Node 实例化 | **Node 实例** | 无法只从共享 Mesh 中删除一个实例的 primitive；删除实例才安全 |

部件标识写在 `extras._fourdgenPart = {id, name, materialKey}` 上：

- `p{nodeIndex}.{primitiveIndex}`：普通 primitive；
- `n{nodeIndex}`：实例化 Node。

`prepare-model.ts` 在生成 snapshot 时**显式写入**这些 id，因此它们经过
「每 Node 一个 Mesh」的重建、减面（保留 primitive）后仍然稳定。
`assignParts()` 只补写缺失的 id，不覆盖已有 id。

## 2. 数据关系

```
Document
 ├─ Node (mesh instance)      extras._fourdgenPart { id, name }
 │   └─ Mesh
 │       └─ Primitive         extras._fourdgenPart { id, name, materialKey }
 │           └─ Material ──── 可被多个 Primitive 共享
 └─ triangle ── UV / 世界面积 / 部件（由所属 Primitive 决定）
```

- **材质身份**：`materialKey = m:{name}#{occurrence}`，区分同名材质；
- **部件身份**：与材质无关，一个材质可对应多个部件；
- **三角面归属**：由 primitive 决定，不做逐面语义识别；
- **UV 需求**：按部件内三角面重新计算，不继承被删除部件的需求。

需要区分的四种情况：

1. 部件从未被用户保留 → 需求不应计入；
2. 删除的部件与保留部件共享材质 → 材质本身不能删；
3. 删除的部件与保留部件共享**源纹理区域** → 像素必须保留；
4. 删除的部件独占某个 UV 区域 → 该区域可以不再分配预算。

本实现按「三角面 → 部件 → 材质 → 源纹理区域」逐层计算，
因此 1/2/4 自然成立；第 3 种情况由「保留部件的 UV 仍然存在」保证，
删除不会修改任何材质或纹理对象。

## 3. 桌面端 API

```ts
import { assignParts, filterParts, partDemands, partsByMaterial } from './src/parts.ts';

const parts = assignParts(document);              // 读取/补写稳定 id
const report = filterParts(document, keepIds);    // 只删除未保留的几何
const demands = partDemands(document);            // 每部件世界面积/UV 面积
```

- `filterParts` 只移除 primitive（或实例化 Node），**不 dispose 材质**；
- 剩余 primitive 的 UV、法线、材质引用保持不变；
- `partDemands` 用于报告「删除前后回收的独占纹理需求」。

## 4. 网页端 API

`extractModel` 现在为每个三角形记录 `sourceParts`（部件索引）和
`sourcePartTable`（id/name），部件 = `mesh 实例 × material group`。

```ts
extractModel(scene) → batches[].sourceParts / sourcePartTable
filterBatchParts(batch, keepPartIds) // 丢弃三角面并重算 area/uvBounds
convertExtractedModel(extracted, { includedParts }) // 在减面之前过滤
```

- 材质批次（`batch.key = material.uuid`）不变，因此权重仍按材质生效；
- 部件过滤只改三角面集合，不新增几何状态；
- `extractedParts(extracted)` 返回可展示的部件列表（材质名 + 三角面数）。

## 5. 真实模型实验

语料中没有天然的「共享材质多部件」，因此用真实几何构造两种场景：

- `instance`：复制最大部件的 Node（同一 Mesh、同一材质、同一 UV）；
- `uv-region`：复制最大部件的 Mesh，共享材质，但 UV 平移到另一象限。

流程：`importModel → 构造 → prepareStaticModel → assignParts →` 预算图集
（含附件）`→ filterParts →` 预算图集（不含附件），并对保留部件做
「源纹理采样 vs 图集采样」的端到端误差比较。

结果（`data/stage2-parts.md`）：

| 模型 | 场景 | 三角面 | content | 保留部件误差 | 其他材质 texels |
|---|---|---|---|---|---|
| shino | instance | 69 036 → 55 966 | 84.3% → 84.3% | 0.0585 → 0.0585 | 8 901 → 11 353（+27.6%） |
| shino | uv-region | 69 036 → 55 966 | 84.3% → 84.3% | 0.0583 → 0.0585 | 10 766 → 11 353（+5.5%） |
| nana | instance | 74 426 → 61 443 | 79.6% → 79.6% | 0.0444 → 0.0444 | 9 795 → 11 422（+16.6%） |
| nana | uv-region | 74 426 → 61 443 | 79.6% → 79.6% | 0.0458 → 0.0444 | 11 130 → 11 422（+2.6%） |
| furina | instance | 41 828 → 31 186 | 78.3% → 78.3% | 0.0778 → 0.0778 | 9 481 → 11 153（+17.6%） |
| furina | uv-region | 41 828 → 31 186 | 78.3% → 78.3% | 0.0778 → 0.0778 | 10 740 → 11 153（+3.8%） |

解读：

1. **几何删除是正确的**：三角面数精确减少附件部分，保留部件数量与材质不变。
2. **保留部件的采样没有退化**：端到端误差在 4 位小数内不变（最大变化 +0.0002）。
3. **回收的预算确实转移了**：其他材质的 atlas texels 增加 2.6%～27.6%。
   提升幅度取决于附件与被保留部件是否共享 UV：
   - `instance` 让一个材质的面积翻倍，删除后释放的需求大；
   - `uv-region` 只增加一个不同 UV 区域的附件，释放的需求较小。
4. **content 不变是预期的**：预算始终把图集填满，删除改变的是
   **材质之间的分配**，不是总 content。因此不能用 content 衡量删除收益，
   必须看「其他材质的 texels / 密度」。
5. **图集尺寸与材质数量不变时，整数矩形可能吞掉少量回收**：
   即使总量释放，单个参考材质的整数矩形可能因取整而不变；
   本实验用「其他材质 texels 合计」衡量，避免这种误判。

## 6. 测试

- `tests/parts.test.ts`：
  - 同一材质的两个 primitive 获得不同部件 id；
  - 删除一个 primitive 后另一个仍在、材质引用不变、UV 不变；
  - 删除一个实例化 Node 不影响另一个实例；
  - 部件 id 经过 `prepareStaticModel` 后保持稳定；
  - `partDemands` 逐部件面积正确。
- `tests/webapp-parts.test.ts`：
  - 共享材质的两个 Mesh 生成两个部件；
  - `filterBatchParts` 只保留目标三角面并重算 area/uvBounds；
  - 全部排除时返回 null，未改变原批次。
- 全量 `npm test` 通过（见提交记录）。

## 7. 已知边界

1. **实例化 Mesh**：部件是 Node 级，删除会移除整个实例，不能只删其中一个
   primitive。这是由 glTF 的共享结构决定的；若要 primitive 级，必须在导入时
   展开实例（会产生几何副本，当前不做）。
2. **网页端 `batch.key` 仍是 `material.uuid`**：部件列表稳定，但材质权重键
   仍依赖会话；稳定材质 id 的替换放在第四阶段。
3. **没有 UI**：`includedParts` 是程序接口；未接入组件。
4. **未自动删除遮挡面**：部件删除完全由调用者决定。

## 8. 对第三阶段的输入

- 稀疏岛切分后，一个 primitive 的顶点可能属于多个图表；桌面端按顶点写 UV
  会冲突，需要顶点复制或三角面展开。网页端本来就是三角面汤，成本更低。
- 因此第三阶段先在三角面层面实现与测量，再评估桌面端复制顶点的成本。
