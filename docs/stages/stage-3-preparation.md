# 第 3C 阶段：初始姿态与模型变换

当前统一使用 Bun 1.4.3。脚本、CLI 子进程和自动化测试均不启动 Node；历史阶段的 Node 验证记录保留作历史证据。

## 实现

`src/prepare-model.ts` 提供两个实际处理函数：

- `prepareStaticModel(input, options)`：选择场景，将节点实例、初始 Morph 和 Skin 姿态冻结为独立的刚性几何，再按选项变换。输入模型不修改，原骨骼和动画仍在输入 Document 中。
- `fitStaticModel(input, options)`：对已经烘焙的刚性模型进行最终尺寸/居中/旋转/平移。拒绝未准备或仍含节点变换的模型。

`optimizeModel(input, {prepare, mesh, texture})` 在传入 prepare 时按以下顺序执行：

1. 冻结选中场景的初始姿态并烘焙节点世界变换，展开共享 Mesh 实例。
2. 清理和减面，保留原骨骼影响边界的内部标记。
3. 应用用户尺寸参数。指定高度在减面后计算，避免减面删掉极值点后变矮。
4. 生成基础色图集。

未传 prepare 时保留此前只优化网格/贴图的行为，避免未经明确选择就冻结原始骨骼。

## 变换约定

| 参数 | 含义 |
| --- | --- |
| scale | 非零有限标量或 XYZ 向量，允许镜像 |
| rotation | XYZ 角度（度），按 X→Y→Z 作用于世界原点 |
| height | 最终 Y 高度，必须正数；零高度模型报错 |
| center: none | 不额外居中（默认） |
| center: ground | X/Z 中心归零，最低 Y 归零 |
| center: bounds | 三轴包围盒中心归零 |
| translation | 在最终定高和居中之后平移 |
| scene | 输入场景索引；默认使用 default scene，无默认时第一场景 |

顺序为 scale→rotation→height→center→translation。坐标写进真实顶点，输出节点使用单位变换。法线使用逆转置并归一化；镜像会反转三角形绕序。不在此阶段猜测 OBJ 原始轴向，也不转换为 Minecraft 坐标。height 是输出模型坐标单位，source 中记录的原始单位仅描述导入来源。

位置/法线最终存储为 Float32，存在普通浮点误差；不可表示或奇异矩阵明确报错，不承诺大坐标下的任意精度。

## Skin 与 Morph

- 冻结文件中初始节点姿态，不播放动画、不采样指定时间。
- Morph 优先使用 Node 的初始权重，否则 Mesh 的默认权重；位置/法线/切线增量在蒙皮前处理。
- 蒙皮世界矩阵为 `jointWorld × inverseBind`，不能再次乘 Mesh 世界矩阵。支持规范化整数权重和多组 JOINTS_n/WEIGHTS_n，非单位和会归一化并警告。
- 冻结后不再附带动画 Skin；使用内部 `_SOURCE_SKIN_REGION` 属性让后续焊接/减面继续保护原影响边界。它是通用姿态处理信息，不是 Minecraft 骨骼名称或绑定结果。
- 选中场景之外的模型、动画/相机不进入刚性快照。只要存在动画或姿态降级，会输出相应警告。
- 反射或奇异的混合蒙皮矩阵、无有效权重、尚未展开的 GPU instancing 明确拒绝，不能宣称所有绑定都可冻结。普通节点镜像已支持。

## 验证

2026-10-18，Linux x64 / Bun 1.4.3：strict 检查通过，全部 37 项测试通过。新增 9 项覆盖嵌套变换、独立实例、输入不可变、变换顺序、定高/居中、非均匀法线、镜像绕序、逆绑定、规范化/多组权重、Morph 覆盖、场景与动画语义和错误情况。原骨骼边界测试补充了冻结后继续减面的情况。

真实模型经静态准备→减面→定高→图集→GLB 写出→重新导入，检查高度、最低 Y、面数、图集及无 Skin。目标高度设为 32；ToyCar 读回高度约 31.9999994，误差约 0.0000006，最低 Y 约 0.0000006。

```sh
bun install --frozen-lockfile
bun run check
bun test
bun run scripts/samples/prepare-sample.ts ToyCar 32
bun run scripts/samples/prepare-sample.ts Avocado 32
```

样本脚本写出 `*-prepared.glb`、`*-prepared-atlas.png` 和 `*-prepared-report.json` 到忽略的缓存目录。CLI convert 尚未接入，此脚本用于当前阶段复现。

本阶段完成通用准备与模型变换，没有实现 Minecraft 玩家骨骼绑定、poly_mesh、mcpack 或客户端验证。下一阶段先研究真实皮肤几何样本，再实现 Static BoneMapper 与导出，不将刚性 GLB 当成最终皮肤包。
