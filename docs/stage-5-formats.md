# 第 5A 阶段：新增格式与转换链路回归

在现有 Importer → Document → 优化 → Static 绑定 → poly_mesh → 皮肤包的流水线上新增 FBX、DAE、STL、PLY。没有增加 Minecraft 专用的导入器，没有引入新依赖，也没有改成 Cube。

## 支持与验证范围

| 输入 | 导入方式 | 本阶段证据 |
| --- | --- | --- |
| GLB/glTF | glTF Transform 直接读取 | 既有层级、蒙皮、贴图和资源回归 |
| OBJ | Assimp → GLB | 既有 MTL、多材质、外部贴图、native/WASM 回归 |
| FBX | Assimp → GLB | 自制四面体；嵌入 PNG、透明通道与材质 alpha；native/WASM；CLI 完整转换 |
| DAE | Assimp → GLB | 自制四面体；独立编写的 COLLADA，含外部 PNG、父子节点、位移与非均匀缩放；native/WASM；CLI 完整转换 |
| STL | Assimp → GLB | 二进制四面体与独立编写的 ASCII 三角形；native/WASM；CLI 完整转换 |
| PLY | Assimp → GLB | 二进制四面体与独立编写的 ASCII 三角形；native/WASM；CLI 完整转换 |

四面体由本项目编写，经 Assimp 导出对应格式后回读；这些夹具用于链路回归，不能证明所有厂商/版本的文件均兼容。ASCII STL、ASCII PLY 和带贴图的 DAE 直接编写，避免测试完全依赖同一导入导出库的往返。

Assimp 输入不承诺保留原格式单位/轴元数据，source 中以 unspecified 标记并记录警告；导出的最终高度仍由 --height 决定。FBX 厂商变体、复杂角色蒙皮与源文件朝向需要后续真实模型验证。PLY 顶点色仍被纹理阶段明确拒绝；没有贴图的 STL/PLY 使用纯色图集。PMX/PMD、VRM、Blend 尚未开放，不能把底层 Assimp 的格式列表直接作为本项目能力。

## 用法

```sh
bun run convert model.fbx --out ./fbx-pack
bun run convert model.dae --out ./dae-pack --backend wasm
bun run convert model.stl --out ./stl-pack --height 32
bun run convert model.ply --out ./ply-pack
bun run validate ./fbx-pack.mcpack
```

--backend 对所有 Assimp 格式生效；GLB/glTF 仍直接读取。--ratio 是受误差和拓扑约束的目标，可能达不到，警告会报告实际面数。PLY 的四面体在 Assimp 中带双面材质，因此四个正面最终导出八个三角形，不能把正面数当作最终面数。

## 转换输出与保护

- 报告增加 sourceTriangles（冻结姿态/展开实例后、网格清理前）、optimizedTriangles（优化后的正面）、addedBackfaces、triangles（最终面数）和 geometryBytes/textureBytes/archiveBytes。字节数来自实际写出的缓冲区，不是估算。
- 目标目录非空或同名 .mcpack 已存在时，提前拒绝；实际写入使用 wx，防止检查之后同名文件出现时被覆盖。--no-mcpack 不触碰已有归档。
- ZIP 校验拒绝 JSZip 自动规范化的原始路径，例如 ../manifest.json，不把它当成合法根文件。
- 修复上一阶段的 Set 推断导致的 TypeScript 错误，以及仍将 convert 视为未实现命令的旧 CLI 测试。

写出失败可能留下部分新文件；本阶段没有增加复杂的原子发布或恢复事务。

## 真实模型的完整 CLI 验证

使用既有缓存中的 CC0 样本，来源与许可证见 stage-2.md。目录和 mcpack 在 convert 写出后均由独立验证器回读，不将二进制加入仓库。

```sh
bun run convert .cache/samples/Avocado.glb --out .cache/stage5-avocado --atlas 512
bun run convert .cache/samples/ToyCar.glb --out .cache/stage5-toycar --ratio 0.1 --max-texture 128 --atlas 2048
```

| 模型 | 原始三角形 | 优化正面 | 补充反面 | 最终三角形 | geometry.json 字节 | mcpack 字节 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Avocado | 682 | 682 | 0 | 682 | 97990 | 145182 |
| ToyCar | 108936 | 34318 | 33472 | 67790 | 10268703 | 3173131 |

归档字节数可能因随机 UUID、ZIP 时间或压缩器而有少量变化。ToyCar 的 10% 减面目标因误差/拓扑/UV 约束未达到；本阶段未做体积预算或强制破坏性减面。

验证：Bun 1.4.3；bun run check 通过；bun test 共 58 项通过。上述结果证明文件转换与引用一致性，客户端显示/穿戴尚未实测。
