# 依赖验证记录

验证日期：2026-10-18（北京时间）。版本来自实际 npm registry 查询与安装的 package.json，bun.lock 锁定依赖。环境：Linux x64、Node 24.19.0、Bun 1.4.3。尚未验证 Windows/macOS。

| 依赖 | 精确版本 | 声明许可证 | 当前验证 |
| --- | --- | --- | --- |
| libassimp | 0.3.0 | Apache-2.0 | Node/Bun 原生与 WASM OBJ→GLB |
| @gltf-transform/core | 4.5.1 | MIT | GLB 读回、外部 PNG 读取 |
| @gltf-transform/functions | 4.5.1 | MIT | 已安装；简化/焊接行为留待阶段 3 |
| @gltf-transform/extensions | 4.5.1 | MIT | 注册扩展并读取 Assimp 材质 |
| meshoptimizer | 1.3.0 | MIT | WASM 初始化、simplify API 存在；实际减面留待阶段 3 |
| sharp | 0.35.5 | Apache-2.0 | PNG 生成/缩放、透明通道读取 |
| gl-matrix | 3.4.4 | MIT | 第 3C 阶段新增：骨骼矩阵、法线逆转置和模型变换；Bun 实测 |
| jszip | 3.10.2 | MIT OR GPL-3.0-or-later | 使用 MIT 选项；ZIP 写入/读回 |
| typescript | 7.0.2 | Apache-2.0 | strict tsc --noEmit 通过 |
| @types/bun | 1.4.3 | MIT | 测试类型检查通过 |

## 实际 API 与选择

libassimp 的 createAssimp({backend:'native'|'wasm'}) 支持显式后端，实例 backend 可断言，使用后必须 dispose()。convert({name,bytes},{to:'glb',resolve}) 支持异步资源 resolver。不是根据宣传假设 Bun 兼容：两个后端已各自实际转换成功。

三角形探针由本项目编写，无第三方素材权利问题。脚本读回 3 个顶点、1 个三角形。自动化测试额外提供 OBJ + MTL + RGBA PNG，验证 UV、材质贴图与透明通道未丢失，并确认空输入被拒绝。

### 外部纹理实测发现

Assimp OBJ→GLB 保留了外部 color.png 引用。直接 NodeIO.readBinary() 会报 Cannot resolve external images with binaryToJSON()。测试保留外部 PNG 后使用 NodeIO.read() 成功。不能将 GLB 扩展名视为纹理已打包的证明；实际 Importer 需维护 sidecar 映射，限制路径并报告缺失资源。不要擅自实现 OBJ 解析器。

Assimp 还生成 KHR_materials_specular/volume/ior 等扩展。注册 ALL_EXTENSIONS 后这些扩展可读取；FB_ngon_encoding 未识别，当前三角形探针可读取，但不能由此推断多边形/复杂材质已完整支持。必须在导入报告中追踪未支持效果。

libassimp 已同时满足原生和 WASM 基础测试，当前无理由切换 assimpjs。若后续真实模型出现不可修复差异，再按相同夹具评估备选，不自行开发通用格式解析器。

## 许可证范围

根包许可证不是全部依赖的许可证。libassimp 自带 NOTICE 明确列出 Assimp BSD-3-Clause、tinyusdz MIT、web-ifc MPL-2.0、CDT MPL-2.0，以及其它原生内嵌组件。发布二进制或 WASM 前必须携带适用许可证/NOTICE，并核对 MPL 源码提供等义务；本阶段只锁定上游包，不重新分发其二进制。Sharp 原生分发也需保留其随附第三方许可。完整发布许可清单留作交付门槛，不能声称已完成全部传递依赖合规审计。

参考 MBSM 的 GPL-3.0 代码仅研究格式行为，不复制实现。当前尚未读取其转换脚本，也未检查用户皮肤压缩包；这些属于导出阶段的先决验证，未标记完成。

## 后续样本计划

第 2 阶段已选择并实际验证 Khronos glTF-Sample-Assets 的 CC0 Avocado 与 ToyCar；逐个读取模型自己的许可说明，并记录 URL、修订号、哈希与贡献者。详见 [stage-2.md](stage-2.md)。尚未实现最终端到端转换，不把导入检查当作 mcpack 演示。

第 3C 阶段起统一使用 Bun，不继续重复 Node 验证。gl-matrix 版本由 bun add --exact 解析并锁定，其安装包 package.json 及许可证文件已核对；未自行实现通用矩阵运算库。
