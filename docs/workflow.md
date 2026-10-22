# 从模型到可恢复的 Minecraft 皮肤包

后续减少人工配置的设计见 [自动化计划](automation-roadmap.md)。该计划尚未接入主流程；本文描述当前可用功能。

本流程来自本次 Windows 客户端实测：128×128 图集可显示，Shino 可穿戴并跟随玩家骨骼；最终肩部每侧外移 0.5、手臂外展 6°，袖子按源连通网格绑定，裙子整体归躯干。测试已反馈此版基本可用。新包管理器的多包合并与恢复已做隔离文件测试，合并后在游戏中的显示仍需要实际验证。

## 环境与首次配置

运行时使用 Node 24+；Bun 仅用于安装依赖和锁定版本。普通转换和管理器均为 Node/TypeScript，不需要 Python；Python 脚本只作为旧收据的兼容恢复入口。

```powershell
bun install --frozen-lockfile
bun run packs init --root 'D:/Minecraft/Content/data/skin_packs'
bun run packs status
```

`init` 只写 `skin-manager.local.json`，不会修改游戏。已有配置时拒绝覆盖；换目标路径可以复制 `skin-manager.example.json` 到另一个配置文件，然后所有管理命令指定 `--config other-manager.json`。相对路径以配置文件所在目录为基准。

配置示例：

```json
{
  "version": 1,
  "skinPacksRoot": "D:/Minecraft/Content/data/skin_packs",
  "stateDir": ".skin-pack-manager",
  "slots": {
    "custom": { "manifestFormat": 2 },
    "persona": { "manifestFormat": 1 }
  }
}
```

`slots` 的键就是 root 下的目标子目录名；本次测试仅确认 `custom/persona` 会被加载。管理器仅操作指定 slot，目标目录必须事先存在。配置可用于其它测试根目录，不扫描或改写旁边的 `reference-a/reference-b`。

`.skin-pack-manager` 保存库、完整原始备份、历次变更快照与恢复状态，**不是可清理的缓存**。它和 `skin-manager.local.json` 已加入 Git 忽略；迁移机器或备份项目时要另外保存。每个游戏 root 使用独立 stateDir，管理器会拒绝混用。

## 一次跑完整流程

编辑 `workflows/shino.example.json`，或复制它作为新角色配置：

```powershell
bun run workflow workflows/shino.example.json
```

默认执行：读取模型 → 源骨骼姿势与衣物规则 → 转换 → 128 图集 → 皮肤包及 ZIP 校验 → 四视图预览 → 导入本地库。没有 `--deploy` 时不写游戏目录。

结果包括输出目录、同名 `.zip`、`-preview.png` 和 `-workflow.json`。报告记录源模型及 profile 的 SHA256、profile 内容、绑定分类、文件校验、库 ID，以及可选部署收据。输出或库 ID 已存在时拒绝覆盖；新版本换一个 output/libraryId。模型资源仍按原导入器的资源目录规则检查，模型单文件哈希不等于其全部外部贴图的哈希。

确认预览后关闭 Minecraft，再执行：

```powershell
bun run packs enable persona shino-release
```

或者首次运行就显式加入部署步骤：

```powershell
bun run workflow workflows/shino.example.json --deploy
```

配置中的 model/output/profile/managerConfig 均相对 workflow 文件解析。已有导入结果不必重跑整套，直接使用下面的管理命令。

## 手动分步操作

```powershell
# 静态模型：整件挂到 body
bun run convert model.glb --out outputs/model-v1 --name 'My Model'

# VRM 人形：按源 humanoid 标签和权重绑定
bun run binding:inspect avatar.vrm outputs/avatar-source-binding.json
bun run convert avatar.vrm --out outputs/avatar-v1 --name 'My Avatar' --binding humanoid --humanoid-profile profiles/my-avatar.json

# 检查写出的结果
bun run validate outputs/avatar-v1
bun run validate outputs/avatar-v1.zip
bun run preview outputs/avatar-v1 --out outputs/avatar-v1-preview.png --unlit
bun run binding:preview outputs/avatar-v1 outputs/avatar-v1-binding

# 也可以直接导入别人提供的包目录或 ZIP
bun run packs import avatar-v1 outputs/avatar-v1.zip
bun run packs enable persona avatar-v1
```

包的生成结果包含 manifest、skins、geometry、PNG 和 `texts/`。新导出会写独立 UUID、唯一的包级名称标识及中英文显示名，解决本次试验中的空标题问题。默认直接生成紧凑的 128×128 图集，可能损失细节；显式 `--atlas` 保留旧的中间图集布局路径，最后缩到 128。

### 紧凑图集

默认静态和人形转换均使用：按实际索引引用的 UV 连通岛分组 → 合并使用相同图像内容、颜色因子、透明模式和采样设置的区域 → 裁切源贴图中的 UV 范围 → 带 1 像素隔离边距排列到 128 图集 → 将剩余矩形空隙分配给邻近区域。图像按新区域尺寸完整重采样并同步重映射 UV，不裁掉图像边缘；几何位置、法线、三角面及骨骼归属不变。默认不修改源模型和源贴图。

裁切保留源图边界像素和采样边距；重复 UV、非 UV0 或纹理变换使用通用采样路径，保持重复/镜像/钳位语义。材质颜色因子、透明模式或采样设置不同的区域不能直接共用。不能通过填色宣称模型实际利用率提高。

`optimizeTextures` 的 `compactSize` 为可复用选项；不指定时保留原分辨率策略。人形报告 `humanoid.texture.atlas` 中 `contentUtilization` 是内容矩形面积比例，`allocatedUtilization` 包含隔离边距，`sampledUtilization` 是 UV 三角形覆盖的非透明像素中心比例。三者不同；前两者高不保证实际有效覆盖同样高。UV 岛内部未用区域和透明空洞仍可能存在，1 像素边距也不是浪费面积。

`--max-texture` 控制各源图的相对分辨率预算；紧凑模式直接从源裁切区重采样到最终区域，不先把整张源图压成小图再放大。显式 `--atlas` 可用于对比旧布局，不推荐用大图集再整体缩小来改善皮肤细节。

库导入会保留包内容并校验，不偷偷修复源文件。超过本次验证尺寸的贴图会在导入结果中标记警告，启用时拒绝并要求先处理；可通过本转换器重新输出 128 图集。

当前支持管理本工具导出的 legacy `1.8.0 poly_mesh` 包，以及 `geometry.humanoid.custom/customSlim` 的标准皮肤包；支持 manifest 1/2、PNG 与 `texts/*.lang`。不承诺任意第三方包的自定义动画、附件、其它几何版本或任意目录结构都能导入：不支持的格式会校验失败。

## 包管理与恢复

```powershell
bun run packs list
bun run packs status
bun run packs enable persona avatar-v1
bun run packs enable persona avatar-v2
bun run packs disable persona avatar-v1
bun run packs export avatar-v2 outputs/avatar-v2-export.zip
bun run packs archive avatar-v1
bun run packs backups persona
bun run packs restore persona
bun run packs restore persona <backup-id>
```

一个 slot 可以启用多个包。管理器重命名各包的几何 ID、贴图和皮肤条目，合并到该 slot 的清单，并保留来源显示名称；不会让两个包继续争用 `geometry.skin0`。同一 slot 的管理 UUID 保持稳定，更新递增版本。管理 UUID 从首次管理时建立，下一次部署会取代被迁移包的旧 UUID。

`disable` 移除指定包；移除最后一个包时恢复该 slot 的原始基线。`restore <slot>` 恢复原始基线，带 backup-id 则恢复对应快照；恢复本身也先备份当前状态。`archive` 只标记不再启用的库条目为归档，保留内容供导出和历史恢复；新版本使用新 ID。

每次部署先复制完整 slot 并校验 SHA256，再检查目标是否发生外部修改。写入后的文件再次校验；目录链接、路径越界、备份损坏、库内容被篡改或目标被外部改动都会拒绝覆盖。管理器不提供忽略冲突的 force 开关。

如果写入中断，状态会保留 pending 和可用备份：

```powershell
bun run packs status
bun run packs recover persona
```

recover 只接受属于旧备份或本次计划的文件内容，发现未知修改会拒绝覆盖。进程被强行终止时可能残留空目录 `operation.lock`；先确认没有运行中的管理命令，再手动移除这个空锁目录，然后 recover。不要直接删除库或备份。

## 本次已安装内容

当前本地环境配置已创建，库包含：

| Slot | 库 ID | 内容 |
| --- | --- | --- |
| custom | <sample-id> | 客户端已显示的 128 图集牛油果 |
| persona | <sample-id> | 测试观察基本可用的最终 Shino |

这次迁移只复制和登记文件，当前游戏目录字节未变。最初空包备份也已复制到 `.skin-pack-manager` 的 original 快照；无需再依赖某个写死时间戳的部署脚本。

```powershell
bun run packs restore persona  # 恢复会话开始时的空包
bun run packs enable persona <sample-id>  # 再启用已测试版本
```

其它现有安装可使用 `adopt <slot> <original-directory> [pack-id]` 接入。指定 pack-id 时，库包必须与当前 slot 文件完全一致；adopt 不写目标目录。如果没有提供原始目录，正常 enable 会把首次管理前的目标状态作为原始基线。

## 新模型如何调绑定

从 `profiles/humanoid.example.json` 开始，不要直接复制 Shino 材质名到其它角色。先运行 binding:inspect，查看原材质、网格、VRM humanoid 角色、关节父级，以及实际被索引引用的顶点权重统计。

```json
{
  "shoulderOutset": 0.5,
  "armSpreadDegrees": 6,
  "materialRules": [
    { "material": "原模型的裙子材质名", "mode": "body" },
    { "material": "原模型的上衣材质名", "mode": "arm-components", "minArmWeight": 0.35 }
  ]
}
```

`body` 将指定材质整件归躯干，避免裙骨因挂在腿下而被误归属。`arm-components` 按源索引连接关系识别连通部分，再累计源权重区分左右袖子和躯干；阈值是单侧臂权重占该连通部分总权重的比例，肩骨也计入同侧臂。不保证一件连续上衣一定能自动分出袖子，阈值与材质规则需要按源结构检查。`weighted-components` 用于同时包含衣服、手套、靴子的材质：高置信连通部分整体归属，混合部分退回逐面权重；`weldSeams=true` 可恢复位置与权重完全相同的展开三角形顶点连接。

改姿势时先修改源肩关节，再评价原始混合权重，之后冻结、归属、导出；比冻结后直接移动硬切片更能保留肩袖的静止连续性。输出仍是头、躯干、左右臂和左右腿六部分刚性骨骼，不还原平滑的运行时蒙皮、肘膝弯曲、头发或裙摆物理。humanoid 模式目前保留原面数，不接受 `--ratio`。VRM 0/1 使用显式人形元数据；PMX 等非 VRM 可通过 profile `boneMap` 按角色名精确指定源节点，缺失/重名会失败。`rotationYDegrees` 可对齐源模型正面。本次样本 A和样本 B的 PMX 已完成离线转换与测试部署，尚待客户端验收，见 pmx-model-tests.md；并不因此承诺任意 FBX 的绑定都能直接成功。

binding:preview 的彩色图是骨骼归属图，蓝色躯干、黄色头、红/橙色手臂、绿/紫色腿。摆臂摆腿图只是 ±35° 的离线示意，不是 Minecraft 动画回放。

## 验收与排障

按顺序确认：条目出现 → 模型/贴图出现 → 能穿戴 → 待机 → 走路 → 持物/挥手 → 转头 → 下蹲。每个模型单独调 profile；预览和文件校验不能替代客户端验收。

| 现象 | 优先检查 |
| --- | --- |
| 包标题出现但皮肤区域空白 | skins 引用、唯一包标识、本地化、贴图尺寸 |
| 灰色人形或无模型 | PNG 尺寸、几何尺寸与引用；本次 128 版本可用 |
| 角色僵在 T 姿势 | 是否误用 static，是否存在源 humanoid 角色 |
| 袖子被切开 | 源材质/连通部分，混合权重是否在改姿势前丢失 |
| 裙子跟单腿摆动 | 源裙骨挂在腿下，应使用衣物规则独立处理 |
| 双臂太张、肩太宽 | 肩外移量与外展角过大；从较小值开始 |
| 外部修改拒绝覆盖 | 先保存并检查自己的改动；不要直接篡改收据哈希 |

早期 Windows Bun 1.4.3 的原生 Assimp 测试曾发生模块加载崩溃；现在运行时为 Node 24+，PMX 使用 WASM 入口，GLB/VRM 直接导入不再预加载原生 Assimp。相关流程已验证，不把未跑通的原生格式或完整测试套件声称为通过。具体证据见 `windows-client-test.md`；实验脚本在 `scripts/experiments/`，不再作为日常操作入口。

当前验证：`bun run check`、`bun run check:web` 通过；完整回归使用 `bun run test`（29 个测试文件），日常快速回归用 `bun run test:workflow`。受限沙箱中 CLI 子进程或临时目录可能返回 EPERM，测试需要在允许启动子进程的正常终端运行。
