# Minecraft Bedrock 4D/5D Skin Converter

通用模型 → 优化 → Static 刚性绑定 → Bedrock 1.8.0 poly_mesh → mcpack。

当前已实现 **皮肤包生成 CLI 与第 5A 阶段的格式扩展**：OBJ/GLB/glTF/FBX/DAE/STL/PLY → Static poly_mesh → manifest.json、skins.json、geometry.json、skin0.png，并可生成 .mcpack。格式与交叉引用可独立校验；客户端穿戴能力仍需实机验证。

## 运行验证

统一使用 Bun 1.4.3 运行、安装依赖和测试。当前 Linux x64 测试通过，其它系统未验证。

```sh
bun install --frozen-lockfile
bun run check
bun test
bun run probe
```

CLI、样本脚本与自动化测试均通过 Bun 执行，不再重复运行 Node 验证。依赖中的 NodeIO 和 node: 标准库 API 由 Bun 兼容层提供。

## 阶段计划

| 阶段 | 交付 | 状态 |
| --- | --- | --- |
| 1 | strict TS、版本锁定、原生/WASM 依赖验证 | 完成 |
| 2 | OBJ/MTL/贴图、GLB、外部 glTF 导入及 inspect | 完成 |
| 3 | 网格清理、误差受限减面、模型变换、贴图和显式图集 | 完成 |
| 4A | Static 绑定、旧版 poly_mesh、独立几何校验 | 完成 |
| 4B | 完整 mcpack、convert/validate CLI | 本地类型检查与测试通过；待实机验证 |
| 5A | FBX/DAE/STL/PLY、完整转换回归、覆盖保护 | 完成 |
| 5B-1 | 实际导出文件四视图预览 | 完成 |
| 5B-2 | 复杂角色格式与真实客户端演示、完整使用文档 | 待实现 |

每个阶段完成验证后独立提交。Humanoid、Web UI、其它输入格式留待后续。

## 架构决定

保留 Importer → IntermediateModel → ModelOptimizer → BoneMapper → BedrockExporter → SkinPackBuilder 单向流水线。统一中间数据优先采用 glTF Transform Document，另存来源、单位/坐标元数据与警告；不复制整个 glTF 标准。Minecraft 逻辑仅进入绑定和导出阶段。

GLB/glTF 直接由 glTF Transform 读取以保留节点、材质和蒙皮。OBJ/FBX/DAE/STL/PLY 由 libassimp 转为 glTF，再统一进入 Document。Importer 维护外部资源映射，不假设 Assimp 的 GLB 已嵌入纹理。已验证嵌套变换、共享 Mesh、多材质 OBJ 与原始蒙皮权重；新增格式的验证范围见 [第 5A 阶段](docs/stage-5-formats.md)。

依赖证据和已知限制见 [docs/dependencies.md](docs/dependencies.md)。

## inspect 用法

```sh
bun run src/cli.ts inspect model.obj
bun run src/cli.ts inspect model.glb --json
bun run src/cli.ts inspect model.gltf
bun run src/cli.ts inspect model.obj --backend wasm
```

输出顶点/三角面/Mesh/材质/贴图统计、节点层级、局部变换、骨骼、初始姿态世界边界及警告。普通文本便于查看，`--json` 包含完整报告；错误返回非零退出码，stdout 不输出成功报告。

`vertices` 为每个 Primitive 的顶点数之和，`triangles` 为全部 Mesh 定义的面数；`instanceTriangles` 计入选中场景内重复实例。未烘焙变换，不计算动画、平滑蒙皮或 Morph 形变后的边界。Assimp 输入的原始单位和轴元数据未保留，报告为 unspecified，并提醒检查方向。

## 免费模型复现

```sh
bun run scripts/fetch-sample.ts Avocado
bun run scripts/check-sample.ts Avocado
bun run scripts/fetch-sample.ts ToyCar
bun run scripts/check-sample.ts ToyCar
bun run src/cli.ts inspect .cache/samples/ToyCar.glb
```

下载脚本固定上游修订并检查 SHA256。模型只下载到忽略的缓存目录，不作为默认发行内容。[样本来源、许可证及实测数据](docs/stage-2.md)。

## 当前限制

- OBJ 多边形由 Assimp 三角化，glTF/GLB 的三角带/扇会规范化为索引三角形。不支持线/点。
- 外部资源限制为模型文件所在目录及其子目录，拒绝网络 URI、越界路径和越界符号链接。共享上级贴图目录需要先整理到模型目录下。
- PNG/JPEG 等由 Sharp 可解码的图片可检查；KTX2/Basis/Draco 尚未接入解码依赖，会明确失败。已注册 Meshopt 解码器。
- 未识别的可选 glTF 扩展记录警告，必需但无法读取的扩展报错。复杂材质当前保存在中间模型，报告列出将来导出时需要降级的效果。
- 已实现完整皮肤包文件与 convert/validate CLI；第三方加载器与 Minecraft 客户端兼容性仍未经实测。

网格优化 API 与真实模型证据见 [docs/stage-3-mesh.md](docs/stage-3-mesh.md)。

贴图优化、显式图集、复现命令与限制见 [docs/stage-3-textures.md](docs/stage-3-textures.md)。

模型变换、初始蒙皮/Morph 冻结及指定高度见 [docs/stage-3-preparation.md](docs/stage-3-preparation.md)。

```sh
bun run scripts/prepare-sample.ts ToyCar 32
```

Static 绑定、旧版几何格式、真实皮肤参考及导出证据见 [docs/stage-4-geometry.md](docs/stage-4-geometry.md)。

```sh
bun run sample:export ToyCar
bun run sample:export Avocado
```

## 一键生成皮肤包（第 4B 阶段）

```sh
bun install --frozen-lockfile
bun run src/cli.ts convert model.glb --out ./my-skin --name "My Skin"
bun run src/cli.ts validate ./my-skin
bun run src/cli.ts validate ./my-skin.mcpack
```

输出目录包含且仅包含 `manifest.json`、`skins.json`、`geometry.json`、`skin0.png`；默认还在目录旁生成 `my-skin.mcpack`。使用 `--no-mcpack` 可仅保留四个文件。`--ratio 0.5` 可以选择减面（默认保留原面数）；`--height 32` 设置模型高度，`--max-texture 256` 设置单图边长上限，`--atlas 512` 可指定图集大小。

当前支持单模型 Static 绑定到 body，不处理动态肢体跟随。输出路径已经包含文件时拒绝覆盖，防止覆盖已有资源。详见 [第 4B 阶段：皮肤包导出](docs/stage-4-pack.md)。

FBX、DAE、STL、PLY 可使用同样的命令，例如 `bun run convert model.fbx --out ./my-fbx-skin`。`--backend native|wasm` 适用于所有 Assimp 输入。已有同名 `.mcpack` 时也拒绝覆盖；`--no-mcpack` 仅写目录并保留该归档。转换报告区分原始面数、优化后正面数、补充反面数、最终面数，以及几何、贴图和归档字节数。

PMX/PMD、VRM、Blend 暂未开放；不能将 Assimp 的底层格式列表视为本项目已验证支持。PLY 顶点色仍会明确拒绝，STL 无 UV 时生成纯色图集。


## 检查实际导出外观

```sh
bun run preview ./my-skin --out ./my-skin-preview.png
bun run preview ./my-skin.mcpack --out ./archive-preview.png
bun run preview ./my-skin/geometry.json --texture ./my-skin/skin0.png --out ./geometry-preview.png
```

读取实际写出的几何和 PNG，生成 +Z、-Z、+X、斜视四视图。默认开启背面剔除和简单光照；`--unlit` 查看原始贴图色，`--no-cull` 排查面朝向，`--size 512` 调整单视图尺寸。已有输出文件拒绝覆盖。多几何可用 `--geometry geometry.skin0` 选择。

这是离线诊断图，不是 Minecraft 渲染器。支持当前 Static 导出和无初始旋转的骨骼；相交透明面使用近似排序，客户端显示与穿戴仍需实测。实现和校准证据见 [导出结果预览](docs/stage-5-preview.md)。
