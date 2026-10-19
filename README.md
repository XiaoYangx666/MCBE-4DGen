# 4DGen：模型绑定与皮肤包管理

通用模型 → 优化 → 静态/人形绑定 → Bedrock 1.8.0 poly_mesh → ZIP → 可恢复的皮肤包管理。

日常使用从 **[完整工作流程](docs/workflow.md)** 开始，覆盖可配置目标路径、目录/ZIP 导入、多包启停、备份恢复、原始权重与衣物归属、模型独立姿势调校，以及客户端验收。PMX 实际转换与明确骨骼映射见 [样本 A与样本 B记录](docs/pmx-model-tests.md)。全部文档见 **[docs/README.md](docs/README.md)**，脚本清单见 **[scripts/README.md](scripts/README.md)**。

```powershell
bun run packs status
bun run workflow workflows/shino.example.json
# 看过预览后启用；第一次使用先按文档配置目标路径
bun run packs enable custom shino-release
```

本地环境已将最终测试版本登记为 `<sample-id>` 和 `<sample-id>`，原始空包备份已接入新管理器。默认 workflow 不部署；添加 `--deploy` 才写游戏目录。配置与管理状态不提交到 Git。

已实现模型导入、静态/VRM 人形绑定、带本地化的 ZIP、预览、配置化工作流和可恢复的包管理。Shino 的显示、穿戴、衣物归属及姿势已由用户在 Windows 客户端迭代验证；其它模型仍需单独验收。

## 统一数据目录与皮肤模板

模型、贴图、模板图片、配置和皮肤包统一保存在 `4dgen-data/`。顶部“数据目录”支持设置存储位置并在重启后复制迁移。新导入的模型与贴图会归档，皮肤包收藏无需先配置游戏。新增图片模板，可直接把任意可解码图片制作成双面平面 4D 皮肤。详见 [数据目录与图片模板](docs/storage-and-templates.md)。

## 本地网页工作台

运行 `bun run dev`，打开 http://127.0.0.1:4173 。React + Vite 页面和转换接口由一个 Node 进程提供，支持三维预览、材质筛选、姿势与减面调整，并可把结果保存到本地环境皮肤包库、启停与恢复。详见 [本地网页说明](docs/local-web.md)。

## 桌面版

```powershell
bun run desktop          # Electron 开发版
bun run desktop:package  # Windows 便携版，默认输出 release/4DGen-win32-x64
bun run desktop:package --out C:\path\to\4DGen-portable  # 输出到普通目录
bun run test:desktop     # 桌面冒烟检查
```

桌面版复用同一套页面和后台服务，使用 Electron 自带 Node 运行，不要求另装 Bun 或 Node.js。当前 Windows 便携版约 372 MB，ZIP 约 154 MB。若仓库目录被宿主标记为 Low 完整性，请用 `--out` 把便携版输出到普通目录，否则 exe 启动后无法写用户数据。打包目录、数据位置和验证说明见 [桌面版使用与打包](docs/desktop.md)。

## 运行验证

运行时统一使用 Node 24+；Bun 仅用于安装依赖和锁定版本。Windows 可运行 `bun run test:workflow` 检查本流程，完整测试用 `bun run test`（Vitest，24 个文件 / 125 项）。工作台与桌面版另有 `bun run test:studio`、`bun run test:desktop`。

```sh
bun install --frozen-lockfile
bun run check
bun run test
bun run probe
```

CLI、样本脚本与自动化测试均通过 Node 执行；Bun 只负责安装依赖、构建和锁定版本。

## 阶段计划

| 阶段 | 交付 | 状态 |
| --- | --- | --- |
| 1 | strict TS、版本锁定、原生/WASM 依赖验证 | 完成 |
| 2 | OBJ/MTL/贴图、GLB、外部 glTF 导入及 inspect | 完成 |
| 3 | 网格清理、误差受限减面、模型变换、贴图和显式图集 | 完成 |
| 4A | Static 绑定、旧版 poly_mesh、独立几何校验 | 完成 |
| 4B | 完整 ZIP、convert/validate CLI | 文件校验通过；Windows 示例已实测 |
| 5A | FBX/DAE/STL/PLY、完整转换回归、覆盖保护 | 完成 |
| 5B-1 | 实际导出文件四视图预览 | 完成 |
| 6A | PMX、VRM 静态角色导入与真实样本验证 | 完成 |
| 人形与管理 | VRM 六部分绑定、源衣物规则、Shino 客户端调校、可恢复包管理 | 已实现；见工作流程 |
| 工作台与桌面 | 模型库、皮肤模板、统一数据目录、Node 服务、Electron 外壳与便携版打包 | 完成；便携版冒烟通过 |
| 后续 | 平滑关节、布料物理、更多角色与动作验收 | 待实现 |

每个阶段完成验证后独立提交。

## 架构决定

保留 Importer → IntermediateModel → ModelOptimizer → BoneMapper → BedrockExporter → SkinPackBuilder 单向流水线。统一中间数据优先采用 glTF Transform Document，另存来源、单位/坐标元数据与警告；不复制整个 glTF 标准。Minecraft 逻辑仅进入绑定和导出阶段。目录与模块职责见 [代码结构](docs/code-structure.md)。

GLB/glTF 直接由 glTF Transform 读取以保留节点、材质和蒙皮。OBJ/FBX/DAE/STL/PLY 由 libassimp 转为 glTF，再统一进入 Document。Importer 维护外部资源映射，不假设 Assimp 的 GLB 已嵌入纹理。已验证嵌套变换、共享 Mesh、多材质 OBJ 与原始蒙皮权重；新增格式的验证范围见 [第 5A 阶段](docs/stages/stage-5-formats.md)。

依赖证据和已知限制见 [docs/dependencies.md](docs/dependencies.md)。

## inspect 用法

```sh
node src/cli.ts inspect model.obj
node src/cli.ts inspect model.glb --json
node src/cli.ts inspect model.gltf
node src/cli.ts inspect model.obj --backend wasm
```

输出顶点/三角面/Mesh/材质/贴图统计、节点层级、局部变换、骨骼、初始姿态世界边界及警告。普通文本便于查看，`--json` 包含完整报告；错误返回非零退出码，stdout 不输出成功报告。

`vertices` 为每个 Primitive 的顶点数之和，`triangles` 为全部 Mesh 定义的面数；`instanceTriangles` 计入选中场景内重复实例。未烘焙变换，不计算动画、平滑蒙皮或 Morph 形变后的边界。Assimp 输入的原始单位和轴元数据未保留，报告为 unspecified，并提醒检查方向。

## 免费模型复现

```sh
node scripts/samples/fetch-sample.ts Avocado
node scripts/samples/check-sample.ts Avocado
node scripts/samples/fetch-sample.ts ToyCar
node scripts/samples/check-sample.ts ToyCar
node src/cli.ts inspect .cache/samples/ToyCar.glb
```

下载脚本固定上游修订并检查 SHA256。模型只下载到忽略的缓存目录，不作为默认发行内容。[样本来源、许可证及实测数据](docs/stages/stage-2.md)。

## 当前限制

- OBJ 多边形由 Assimp 三角化，glTF/GLB 的三角带/扇会规范化为索引三角形。不支持线/点。
- 外部资源限制为模型文件所在目录及其子目录，拒绝网络 URI、越界路径和越界符号链接。共享上级贴图目录需要先整理到模型目录下。
- PNG/JPEG 等由 Sharp 可解码的图片可检查；KTX2/Basis/Draco 尚未接入解码依赖，会明确失败。已注册 Meshopt 解码器。
- 未识别的可选 glTF 扩展记录警告，必需但无法读取的扩展报错。复杂材质当前保存在中间模型，报告列出将来导出时需要降级的效果。
- Windows 示例客户端结果见工作流程；第三方加载器及其它模型、设备仍需独立验证。

网格优化 API 与真实模型证据见 [docs/stages/stage-3-mesh.md](docs/stages/stage-3-mesh.md)。

贴图优化、显式图集、复现命令与限制见 [docs/stages/stage-3-textures.md](docs/stages/stage-3-textures.md)。

模型变换、初始蒙皮/Morph 冻结及指定高度见 [docs/stages/stage-3-preparation.md](docs/stages/stage-3-preparation.md)。

```sh
node scripts/samples/prepare-sample.ts ToyCar 32
```

Static 绑定、旧版几何格式、真实皮肤参考及导出证据见 [docs/stages/stage-4-geometry.md](docs/stages/stage-4-geometry.md)。

```sh
bun run sample:export ToyCar
bun run sample:export Avocado
```

## 一键生成皮肤包（第 4B 阶段）

```sh
bun install --frozen-lockfile
node src/cli.ts convert model.glb --out ./my-skin --name "My Skin"
node src/cli.ts validate ./my-skin
node src/cli.ts validate ./my-skin.zip
```

输出目录包含 `manifest.json`、`skins.json`、`geometry.json`、`skin0.png` 和 `texts/` 本地化文件；默认还在目录旁生成 `my-skin.zip`。使用 `--no-zip` 可仅输出目录。`--ratio 0.5` 可以选择减面（默认保留原面数）；`--height 32` 设置模型高度，`--max-texture 256` 设置单图边长上限，`--atlas 512` 可指定中间图集大小。

Windows 客户端实测：同一生成几何使用 128×128 贴图可显示，512/1024 贴图版本未正常显示。CLI 最终图集固定为 128×128，并同步几何贴图尺寸；上述参数控制中间图集，最终缩小会损失贴图细节。Shino 后续穿戴和动作调校结果见工作流程。

默认 Static 绑定到 body；VRM 可选 humanoid 人形模式。输出路径已经包含文件时拒绝覆盖，防止覆盖已有资源。初始导出实现记录见 [第 4B 阶段](docs/stages/stage-4-pack.md)。

FBX、DAE、STL、PLY 可使用同样的命令，例如 `node src/cli.ts convert model.fbx --out ./my-fbx-skin`。`--backend native|wasm` 适用于所有 Assimp 输入。已有同名 `.zip` 时也拒绝覆盖；`--no-zip` 仅写目录并保留该归档。转换报告区分原始面数、优化后正面数、补充反面数、最终面数，以及几何、贴图和归档字节数。

PMD、Blend 暂未开放；不能将 Assimp 的底层格式列表视为本项目已验证支持。PLY 顶点色仍会明确拒绝，STL 无 UV 时生成纯色图集。


## 检查实际导出外观

```sh
node src/cli.ts preview ./my-skin --out ./my-skin-preview.png
node src/cli.ts preview ./my-skin.zip --out ./archive-preview.png
node src/cli.ts preview ./my-skin/geometry.json --texture ./my-skin/skin0.png --out ./geometry-preview.png
```

读取实际写出的几何和 PNG，生成 +Z、-Z、+X、斜视四视图。默认开启背面剔除和简单光照；`--unlit` 查看原始贴图色，`--no-cull` 排查面朝向，`--size 512` 调整单视图尺寸。已有输出文件拒绝覆盖。多几何可用 `--geometry geometry.skin0` 选择。

这是离线诊断图，不是 Minecraft 渲染器。支持当前 Static 导出和无初始旋转的骨骼；相交透明面使用近似排序，客户端显示与穿戴仍需实测。实现和校准证据见 [导出结果预览](docs/stages/stage-5-preview.md)。

## 动漫角色 / Unity 来源模型

```sh
node src/cli.ts convert ./角色/模型.pmx --out ./mmd-pack
node src/cli.ts convert ./avatar.vrm --out ./vrm-pack
node src/cli.ts convert ./avatar.fbx --out ./fbx-pack
node src/cli.ts preview ./mmd-pack.zip --out ./mmd-preview.png --unlit
```

PMX 2.0/2.1 经 Assimp 导入，补回材质双面标记、原名和 diffuse alpha，保留 PNG 透明；中文目录和 Windows 风格贴图路径已测试。VRM 0.x/1.0 直接读取 glTF 数据，提供明确的 MToon 基础色/主贴图/透明降级，并在 inspect.source.avatar 中列出可读的作者与许可元数据。FBX 已有导入路径，本轮补测了带骨骼的 FBX。

默认 Static 转换仍冻结初始姿态并整体挂在 body：不会随 MC 四肢独立运动，不运行 MMD/Unity 动画、IK、物理或 VRM 表情。MToon 描边和复杂着色不能原样搬入皮肤包。PMD 请先转 PMX；.unitypackage、.prefab、.asset、AssetBundle 请先在来源工具导出 FBX/VRM 与贴图。

VRM 可显式使用 `--binding humanoid`：按 VRM humanoid 节点与原始权重将三角面划分到头、躯干、左右臂和左右腿，保留源关节枢轴，并将手臂转到下垂的玩家静止姿势。此模式保留原面数，不接受 `--ratio`。它是六部分刚性绑定，不是运行时平滑蒙皮；肩/胯边界可能出现接缝，不保留肘膝弯曲和头发物理。Shino 最终配置已有用户验收反馈，新模型仍需单独调校。

```sh
node src/cli.ts convert avatar.vrm --out ./avatar-humanoid --binding humanoid
```

不同体型可使用独立 JSON 调校肩部外移量和手臂外展角度，例如 Shino：`--humanoid-profile profiles/shino.json`。`shoulderOutset` 使用高度适配后的模型单位，`armSpreadDegrees` 为手臂相对竖直方向的外展角度。当前 Shino 配置为每侧外移 0.5、外展 6°；此配置不作为其他模型的默认值。改变目标高度后应重新检查间距。

人形静止姿势先修改源肩关节，再用原始混合权重计算皮肤、袖子和肩部的形变，之后冻结到目标骨骼。profile 的 `materialRules` 可按源材质设置 `body`（整件衣物归躯干）或 `arm-components`（按源索引拓扑连通部分及累计骨骼权重区分袖子，`minArmWeight` 指定阈值）。Shino 的 Bottoms 整体归躯干，Tops 的连通袖子归手臂；规则精确匹配源材质，拼错或未命中会报错。用 `node scripts/diagnostics/inspect-avatar-binding.ts avatar.vrm outputs/avatar-binding.json` 保存源归属检查报告。

可运行 `node scripts/samples/fetch-avatar-sample.ts GeneLight` 或 `Shino` 获取固定修订、SHA256 校验的角色样本；二进制只放缓存。具体兼容范围、来源/许可和验证数据见 [角色格式接入](docs/stages/stage-6-avatars.md)。

