# 第 4A 阶段：Static 绑定与真实 poly_mesh 导出

本阶段交付 BoneMapper、BedrockExporter 和独立几何校验器。仍未交付完整 mcpack、convert/validate CLI；格式检查通过不等于第三方加载器兼容，更不等于最新原版客户端可穿戴。

## 格式证据

只读检查用户提供的两份 ZIP，不重新分发其模型、纹理或提取结果：

| 样本 | 几何版本 | 模型数 | poly_mesh 骨骼数 | 多边形数 | 重复末顶点的三角形数 | 越界索引 |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 样本 A.zip | 1.8.0 | 108 | 542 | 493840 | 477504 | 0 |
| 样本 B.zip | 1.10.0，旧式对象布局 | 132 | 13 | 156 | 156 | 0 |

复杂样本的 geometry.json 在根对象结束前存在尾逗号。研究脚本仅在明确传入 `--allow-final-comma` 时于内存中移除该处逗号；不修改原文件。正式导出验证器始终严格 JSON.parse，不修复非法输入。第二份样本不是 1.8.0，不能直接作为目标版本验证结果。

参考资料：

- [Microsoft 1.8.0 几何 schema](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/schemasreference/schemas/minecraftschema_geometry_1.8.0?view=minecraft-bedrock-stable)。
- [MBSM 固定修订](https://github.com/Darktubbie/MBSM/tree/d148bf5698445eb532274b8a64ff99aee29a3c02)：研究 `obj-a-skin-bedrock.js` 和 `renderer5d.js` 的格式行为。GPL-3.0，仅参考，不复制代码。

只读复现：`bun run scripts/inspect-reference.ts <zip路径>`；复杂样本需附加诊断选项 `--allow-final-comma`。

## 独立实现约定

- 每个角独立保存 `[positionIndex, normalIndex, uvIndex]`，三个流分别精确去重，不将普通三角形索引直接写入 polys。
- 官方 schema 允许三角形或四边形；导出兼容配置统一写成 `[a,b,c,c]`。
- 从中间模型右手坐标转换：位置、法线、Pivot 镜像 X，保留正面角顺序；UV 从图片/glTF 的顶部原点转换为 `(u,1-v)`，`normalized_uvs: true`。
- positions 使用模型坐标，不减去 Pivot。Pivot 是旋转中心；修改 Pivot 不应移动静态几何。此行为有真实人物骨骼位置数据和参考渲染器佐证。
- 不生成 Cube；生成 texturewidth、textureheight、骨骼 parent/pivot、几何标识符和可见边界。

`bindStatic()` 接受已经冻结初始姿态、展开实例和烘焙变换的模型。默认绑定 body，可选 root/head/左右臂/左右腿，支持 position 和 Pivot 覆盖。参数采用中间模型坐标，导出时统一转换。保留标准玩家骨骼层级，但整个模型刚性挂在一个骨骼上，不承诺肢体动作适配。

导出要求输入已生成单一 PNG 图集、UV0 和已烘焙基础色。残留蒙皮、动画、Morph、节点变换、未处理材质或未引用 Mesh 会明确失败，避免悄悄丢数据。

双面材质默认显式增加反向面，并反转法线。`doubleSided: 'front-only'` 可保留单面并给出外观损失警告。报告区分减面结果与最终导出面数。

## 真实模型结果

```sh
bun run sample:fetch ToyCar
bun run sample:export ToyCar
bun run sample:fetch Avocado
bun run sample:export Avocado
```

脚本输出 `.cache/samples/<名称>.geometry.json`、`<名称>.skin.png` 和 `<名称>-geometry-report.json`。样本来源及 CC0 许可见 stage-2.md；二进制不进入默认发行。

| 模型 | 原始三角形 | 减面后正面 | 补充反面 | 最终三角形 | 几何 JSON 字节 |
| --- | ---: | ---: | ---: | ---: | ---: |
| ToyCar | 108936 | 54466 | 53220 | 107686 | 15992809 |
| Avocado | 682 | 674 | 0 | 674 | 97126 |

ToyCar 的双面材质导致最终面数明显增加，不能把 54466 宣称为最终 poly_mesh 面数。Avocado 在几何误差约束下未达到 50% 目标，保留更多面并警告。

两者均按高度 32、落地居中处理。贴图源单图最大 256，图集容量 2048；ToyCar 的重复 UV 区域需要展开，不能把图集容量与单图缩放混为一谈。

脚本重新读取实际写出的 JSON 和 PNG，校验尺寸、骨骼及索引，再逐角核对所有正反面的位置、法线和 UV 与优化后模型一致（容差 1e-6）。这验证数据转换，尚不代替加载器或客户端实测。

## 校验与测试

`validateGeometry()` 独立检查严格 JSON 结构、标识符、有限数值、非零法线、三个索引流边界、多边形退化、骨骼重名/缺失父骨骼/循环、图集 UV 范围及实际 PNG 尺寸。真四边形的两半均检查；`decodeGeometryTriangles()` 独立回读三角形和四边形。

该校验器针对本项目生成的索引 poly_mesh 配置，不是所有历史皮肤格式的通用校验器；明确拒绝 Cube 和未索引的 tri_list/quad_list。

`bun run check` 通过；`bun test` 共 46 项通过。新增 9 项覆盖独立索引、坐标与 UV、Pivot、双面材质、非法导出状态、三角形/四边形回读、错误 JSON/索引/层级及退化数据。校准夹具由本项目独立编写，不包含第三方网格。

下一阶段实现 manifest/skins/语言文件、完整 mcpack 和包级引用校验，并将已有流水线接入 convert/validate CLI。
