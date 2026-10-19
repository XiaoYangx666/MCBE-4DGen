# 代码结构

本页说明各目录的职责与依赖方向，便于在不破坏转换流水线的前提下继续扩展。阶段实现细节仍以 `docs/stages/` 为准。

## 入口

| 入口 | 作用 |
| --- | --- |
| `src/cli.ts` | `inspect`、`convert`、`validate`、`preview` 命令行 |
| `src/pack-cli.ts` | 皮肤包库与游戏目录的启用、备份、恢复 |
| `server/start.ts` | 本地网页/桌面后台的启动、Web 构建、HTTP 服务 |
| `scripts/` | 样本、诊断、打包和冒烟测试；不是稳定接口 |
| `desktop/` | Electron 主进程、预加载脚本与桌面冒烟测试 |

## 转换核心（`src/`）

单向流水线：

```text
Importer -> IntermediateModel -> Optimizer -> BoneMapper -> BedrockExporter -> SkinPackBuilder
```

- `importer.ts`、`avatar-import.ts`、`tga.ts`、`pmx-metadata.ts`：读取 GLB/glTF、Assimp 格式与 PMX/VRM 元数据。
- `prepare-model.ts`、`optimizer.ts`、`mesh-optimizer.ts`、`rigid-mesh-reducer.ts`：变换、姿势冻结、减面。
- `texture-optimizer.ts`、`texture-charts.ts`、`image-template.ts`：图集、UV 连通分岛与图片模板。
- `bone-mapper.ts`、`humanoid.ts`、`auto-profile.ts`：Static 与六部位人形绑定。
- `bedrock-exporter.ts`、`bedrock-types.ts`、`geometry-validator.ts`：Bedrock 1.8.0 poly_mesh 导出与校验。
- `skin-pack.ts`、`pack-manager.ts`、`import-skin-pack.ts`：ZIP、皮肤包校验、不可变库与可恢复部署。
- `workspace-storage.ts`：统一数据目录、旧缓存迁移与路径边界检查。

核心模块不依赖 HTTP、React 或 Electron；新增格式或算法应尽量留在此层。

## 本地服务（`server/`）

`server/start.ts` 只负责启动顺序：

```text
环境检查 -> initializeStorage -> 构建 Web -> Studio.initialize -> HTTP serve
```

HTTP 监听通过 `server/serve.ts` 的 `node:http` 适配层提供，因此服务端既可以用 Bun 启动，也可以直接用 Node 24+ 启动：

```powershell
bun run dev
node server/start.ts
bun run test:node
```

桌面版后台使用 Electron 自带 Node 运行，打包产物不再包含 Bun；Bun 仅作为依赖安装与构建时的包管理器。

- `studio.ts`：长期状态与领域操作，包括模型会话、转换任务、准备状态缓存、预览缓存、皮肤包管理器和数据目录切换。
- `serve.ts`：基于 `node:http` 的 Fetch 风格 HTTP 适配层，兼容 Bun 与 Node。
- `fs.ts`：跨运行时的文件存在性、读取、流式响应与 MIME 类型。
- `router.ts`：请求分发与 404/错误边界。
- `http.ts`：JSON 响应、稳定缓存键、上传路径校验、`busy` 串行化和同源/桌面令牌检查。
- `routes/`：按领域拆分的 HTTP 映射；未命中的路由返回 `null`。
  - `settings.ts`：数据目录、游戏目录、占用统计。
  - `models.ts`：模型库、打开/重新定位、示例与预览。
  - `uploads.ts`：ZIP/文件夹上传与包内模型选择。
  - `convert.ts`：转换任务与结果资源。
  - `packs.ts`：皮肤包库、预设槽位、导入导出和部署操作。
  - `templates.ts`：图片皮肤模板。
  - `static.ts`：构建后的前端静态文件。
- `model-library.ts`：模型库条目的增删改查与编辑配置校验。
- `model-files.ts`：模型扩展名与递归扫描。
- `source-archive.ts`：ZIP 解包、源模型及贴图归档。
- `storage-usage.ts`：数据目录占用统计。

路由层只做参数解析和 HTTP 状态映射；可复用的领域逻辑放到 `Studio` 或 `src/`，避免在路由中复制转换流程。

## 前端（`web/`）

- `main.tsx`、`App.tsx`：挂载、工作台状态与页面切换。
- `navigation.ts`、`use-hash-route.ts`、`WebNav.tsx`、`AppBar.tsx`：哈希路由、页面标题和网页/桌面导航。
- `LibraryPage.tsx`、`PackPage.tsx`、`TemplatesPage.tsx`、`SettingsPage.tsx`：主要页面。
- `AboutDialog.tsx`：版本、运行环境与数据目录弹窗，可由设置页或桌面菜单打开。
- `PackPreview.tsx`、`pack-types.ts`：皮肤包预览与共享类型。
- `Viewer.tsx`、`MaterialPanel.tsx`、`SettingsPanel.tsx`、`OutputPanels.tsx`、`SaveSkinDialog.tsx`、`WorkflowStrip.tsx`：工作台组件。
- `appearance.ts`、`theme.css`、`style.css`、`workflow.css`：主题、配色与布局。
- `api.ts`：统一的同源 JSON 请求。

页面组件持有交互状态；跨页面共享的纯逻辑放到独立模块，避免从页面文件反向导入类型或组件。

## 验证

```powershell
bun run check
bun run check:web
bun run test:workflow
bun run test:studio
bun run test:desktop
```

完整测试现在由 Vitest 在 Node 下运行：`bun run test`。日常快速回归可用 `test:workflow` 与 `test:studio`。
