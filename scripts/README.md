# 脚本目录

脚本按职责分组，共享代码放在 `lib/`，一次性调查与历史证据与稳定入口分开。日常操作优先使用 `package.json` 中的 npm script（`npm run <name>`），运行时为 Node 24+。

## 目录结构

```text
scripts/
  lib/           共享辅助代码
  checks/        冒烟检查与依赖探测
  desktop/       Electron 启动与便携版打包
  workflow/      可复现的转换工作流
  client/        Minecraft 客户端状态/部署工具
  samples/       CC0 样本复现链路
  diagnostics/   性能与一次性调查（bench/ 为可复用基准）
  experiments/   历史试验，仅作证据
```

## 稳定入口

| 命令 | 实现 | 用途 |
| --- | --- | --- |
| `npm run check` | `tsc --noEmit` | 全仓库（含 `scripts/`）类型检查。 |
| `npm run check:web` | `tsc -p tsconfig.web.json` | 网页与服务端类型检查。 |
| `npm run test:workflow` | `vitest run` | 转换主链路回归。 |
| `npm run probe` | `checks/probe.ts` | 依赖后端探测：Assimp native/WASM、meshoptimizer、sharp、JSZip。 |
| `npm run test:node` | `checks/check-node.ts` | 用 Node 直接启动服务端，验证独立于 Electron 的 Node 运行时与隔离数据目录。 |
| `npm run test:studio` | `checks/check-studio.ts` | 工作台存储、图片模板、转换与包管理的独立 HTTP 冒烟检查。 |
| `npm run test:desktop` | `checks/check-desktop.ts` | Electron 开发版/便携版冒烟检查；会启动 Electron。 |
| `node scripts/workflow/workflow.ts <workflow.json> [--deploy]` | `workflow/workflow.ts` | 读取 `workflows/*.json`，执行转换、校验、预览并入库；只有显式 `--deploy` 才写游戏目录。 |
| `npm run desktop` | `desktop/desktop.ts` | 启动 Electron 开发版。 |
| `npm run desktop:package` | `desktop/package-desktop.ts` | 构建 Windows 便携版；`--out` 或 `FOURDGEN_RELEASE_DIR` 可覆盖输出目录。 |
| `npm run binding:inspect` | `diagnostics/inspect-avatar-binding.ts` | 保存源模型骨骼/材质归属报告。 |
| `npm run binding:preview` | `diagnostics/preview-binding.ts` | 生成彩色归属图与示意摆臂摆腿预览。 |
| `npm run sample:fetch` / `sample:check` / `sample:prepare` / `sample:export` | `samples/*.ts` | CC0 样本下载、导入检查、准备与导出。 |

`checks/check-web.ts` 没有 npm script，在本地工作台已启动时直接运行：

```powershell
node scripts/checks/check-web.ts
```

它检查页面、跨源拒绝、上传、源预览、静态转换、皮肤包状态与目录穿越拒绝。

## lib/

`process.ts` 提供 `waitForExit()`，供检查、打包和工作流脚本等待子进程退出。新增跨脚本的纯辅助代码放这里，不要把具体业务逻辑移进 `scripts/`。

## checks/

- `check-node.ts`：Node 服务端与关键 HTTP 路由冒烟检查，使用临时数据目录。
- `check-web.ts`：对已启动的 `http://127.0.0.1:4173` 工作台做真实 HTTP 检查。
- `check-studio.ts`：独立启动服务端，覆盖存储、图片模板、转换、包管理与游戏写入保护。
- `check-desktop.ts`：启动 Electron，验证原生桥接、顶栏、纹理预览、转换/下载、认证与退出清理。
- `probe.ts`：只验证依赖能否在当前运行时工作，不写游戏数据。

## desktop/

- `desktop.ts`：开发版启动器，向 Electron 传入仓库根目录。
- `package-desktop.ts`：构建网页、安装生产依赖、裁剪运行时并调用 Electron Packager。
- `package-electron.mjs`：`package-desktop.ts` 的子进程实现细节，不单独作为入口。

## workflow/

- `workflow.ts`：配置文件驱动的转换/校验/预览/入库流程，拒绝覆盖已有产物。
- `reduce-avatar.ts`：PMX/GLB 人形减面并生成新版本目录；直接运行，参数见脚本内 usage。它同样拒绝覆盖已有输出。

## client/

- `client-test.py`：旧版客户端部署/恢复工具，写入脚本内固定路径的真实 `skin_packs`。仅用于历史复现，日常操作优先使用 `npm run packs` 的新管理器；`--sample` 指向 `outputs/<sample>` 中已生成的皮肤包。
- `skin-state.ts`：只读检查（`inspect`）以及快照/对比/恢复 Windows 客户端皮肤状态。快照写入忽略的 `.cache/skin-state/`；快照和恢复前会检查游戏是否运行。

## samples/

CC0 免费样本的复现链路：`fetch-sample.ts` 下载并校验 SHA256，`check-sample.ts` 导入检查，`prepare-sample.ts` 变换/定高，`optimize-sample.ts` 减面，`atlas-sample.ts` 图集，`export-sample.ts` 导出 Bedrock 几何，`preview-mesh.ts` 生成四视图诊断图。`sample.ts` 是样本清单模块，`avatar-samples.json` 是角色样本清单，`fetch-avatar-sample.ts` 下载角色样本。二进制只写入忽略的 `.cache/`。

## diagnostics/

一次性调查脚本，不是稳定接口：

- `inspect-reference.ts`：皮肤包几何对照。
- `inspect-pmx-components.ts`：PMX 材质/连通部分统计。
- `inspect-avatar-binding.ts`、`preview-binding.ts`：绑定归属检查与预览。

可复用的转换基准：

- `bench-convert.ts`：复现工作台冷启动链路（导入 → 人形导出 → 打包），逐阶段计时。`--model sample-b|sample-a`、`--runs N`、`--no-cache`。只读取缓存模型，不安装皮肤包。
- `fingerprint-convert.ts`：保存几何 JSON、`skin0.png`、骨骼枢轴、部位面数与包内确定性文件的 SHA256，用于证明性能改动没有改变输出。

### diagnostics/bench/

从 `outputs/` 收编的运行时/阶段基准。它们都需要显式输入路径，只读或只打印结果，不是日常入口：

- `bench-copy.ts <file>`：大 Buffer 复制成本。
- `bench-decode.ts <file>`：UTF-8 文本解码与查找成本。
- `bench-decode-textures.ts <dir>`：逐张 PNG/JPEG 解码为 RGBA。
- `bench-gltf.ts <model.glb>`：`NodeIO.read` 与 `readBinary` 对比。
- `bench-import.ts <model.glb>`：拆分 `importModel` 各步骤。
- `bench-micro.ts <image>`：fs、sharp 与 JS/JIT 微基准。
- `bench-profile-top.ts <profile.cpuprofile> [topN]`：按 self time 聚合 CPU profile。
- `bench-sharp-raw.ts`：大 raw RGBA 缓冲的重复 sharp 管线。
- `bench-stages.ts <model> [ratio]`：导入、减面、图集三阶段计时。

## experiments/

历史实验（客户端控制、早期元数据试验），保留作证据，不再作为日常入口。其中的脚本默认使用通用示例路径，可用 `SKIN_PACKS_ROOT` 覆盖，并保留旧备份时间戳。

## 本地忽略目录

以下目录被 Git 忽略，只放本地数据：

- `outputs/`：仅生成产物（转换结果、诊断输出）。基准/诊断源码在 `scripts/diagnostics/bench/`，不要放回 `outputs/`。
- `.cache/`：下载样本、构建缓存、桌面测试与客户端备份。
- `4dgen-data/`：统一数据目录（源模型、会话、生成结果等）。
- `release/`：便携版构建输出。
- `profile/`：本地浏览器/运行时配置。

`skin-manager.local.json` 与 `.skin-pack-manager/` 也被忽略，但后者是皮肤包管理器的持久备份，不是缓存，清理时不要删除。
