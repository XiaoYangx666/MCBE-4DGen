# 第 2 阶段：统一导入与 inspect

> 运行方式已统一为 Bun；下文 Node 验证结果为该阶段的历史记录。
验证日期：2026-10-18（北京时间）。Node 24.19.0 / Bun 1.4.3，Linux x64。

## 实现范围

| 文件 | 职责 |
| --- | --- |
| src/model.ts | IntermediateModel：glTF Transform Document + 来源/单位/坐标/警告 |
| src/resources.ts | 本地资源读取与边界检查、Assimp 输出内存映射、NodeIO 适配 |
| src/importer.ts | OBJ→Assimp→GLB；GLB/glTF 直接读取；扩展和 Meshopt 解码注册 |
| src/validate-model.ts | 导入几何、索引、属性、变换和蒙皮基础完整性检查 |
| src/inspect.ts | 定义数/实例数、材质、图片、层级、骨骼及世界边界报告 |
| src/cli.ts | inspect、文本/JSON、严格参数及错误退出码 |

导入不会烘焙局部变换，不会去除蒙皮或焊接不同 Mesh；原始数据留给后续 Optimizer 和 BoneMapper。OBJ 的规范化依赖 Assimp，未自行实现 OBJ/MTL 解析器。图像完整性在 inspect 中通过 Sharp 解码检查。

## 测试证据

- `bun run check`：通过。
- `bun test`：14 项测试通过（含此前的两个依赖后端测试）。
- `node --test tests/importer.test.ts`：12 项测试通过。
- 覆盖多个 OBJ 对象与材质、MTL/外部 PNG、glTF 外部 buffer/image、RGBA、百分号编码路径、共享 Mesh、嵌套旋转/非均匀缩放、无索引三角形、OBJ 四边形三角化。
- 骨骼 GLB 断言原始 JOINTS/WEIGHTS 和逆绑定矩阵数量保持；不把它描述成已完成 Static 绑定或 Humanoid 支持。
- 缺失 MTL/贴图/buffer、损坏图片、非有限顶点、越界索引、非三角形及未知必需扩展均失败；CLI 失败退出码为 1，stdout 无伪成功报告。
- 本阶段的模型夹具由项目自行生成。真实样本另行下载和验证，不进入默认离线测试。

## 免费真实模型

两个模型都来自 Khronos glTF-Sample-Assets，固定修订 `edc7c9e67c639d230715049ee31f9a96a6babbbe`。许可证依据各模型自己的 README，非仓库代码许可证。

| 模型 | 作者/贡献者 | 模型许可证 | 顶点 | 三角面 | Mesh | 材质 | 贴图 |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| Avocado | Microsoft (2017) | CC0-1.0 | 406 | 682 | 1 | 1 | 3 × 2048² |
| ToyCar | Guido Odendahl、Eric Chadwick (2020) | CC0-1.0 | 77,429 | 108,936 | 3 | 3 | 8 张，512²/1024² |

- [Avocado 模型与许可说明](https://github.com/KhronosGroup/glTF-Sample-Assets/blob/edc7c9e67c639d230715049ee31f9a96a6babbbe/Models/Avocado/README.md)
- [ToyCar 模型与许可说明](https://github.com/KhronosGroup/glTF-Sample-Assets/blob/edc7c9e67c639d230715049ee31f9a96a6babbbe/Models/ToyCar/README.md)
- [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/)

| 模型 | 文件字节数 | SHA256 |
| --- | ---: | --- |
| Avocado | 8,110,040 | ccc9c3ce56423720b09399c2351537207cd5a65f859f9e6e2f30922762f3abd4 |
| ToyCar | 5,422,412 | 01a60862de55cd4b9f3acfab0b0def86451800f9c42467fcd61052c16cb9838c |

两者已通过实际 CLI 导入检查与样本统计断言。Avocado 的 Node/Bun JSON 报告完全一致。Avocado 是曲面基线模型；ToyCar 是后续减面的高面数测试候选，当前没有减面，更没有生成 mcpack。

材质报告会列出 Avocado 的 normal/metallic-roughness、ToyCar 的 clearcoat/transmission/sheen 等效果。保留基础色外观将是首期导出目标，不承诺保留完整 PBR 外观。

## 下一阶段

先网格清理与受误差限制的真实减面，再做 Sharp 缩放和显式图集。重点用 ToyCar 验证最终三角面数量确实下降，并在严格误差导致无法达到目标时报告。图集的 UV 与透明度必须通过独立夹具检查后，才进入骨骼绑定与 poly_mesh 导出。
