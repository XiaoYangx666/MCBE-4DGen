# 代码结构

本页说明各目录的职责与依赖方向，便于在不破坏转换流水线的前提下继续扩展。阶段实现细节仍以 `docs/stages/` 为准。

## 入口

| 入口 | 作用 |
| --- | --- |
| `src/cli.ts` | `inspect`、`convert`、`validate`、`preview` 命令行 |
| `src/pack-cli.ts` | 皮肤包库与游戏目录的启用、备份、恢复 |
| `server/start.ts` | 本地网页/桌面后台的启动、Web 构建、HTTP 服务 |
| `scripts/` | 按职责分组的检查、工作流、桌面打包、样本与诊断工具；稳定入口见 `scripts/README.md` |
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
- `skin-pack.ts`、`pack-cli.ts`、`import-skin-pack.ts`：ZIP、皮肤包校验、不可变库与可恢复部署。
- `pack-manager.ts`：皮肤包库与游戏槽位的领域操作；文件树的安全遍历、写入、校验和统计放在 `pack-tree.ts`。
- `pack-tree.ts`：受管目录的读取/增量写入、SHA256 校验、几何 JSON 片段扫描与包体统计。
- `pack-types.ts`：服务端、管理器和前端共用的皮肤包领域类型。
- `api-types.ts`：模型库、工作台会话、转换结果与图集报告的前后端共享类型。
- `source-sites.ts`：模型来源网站目录、分类与热度顺序，同时作为本地图标代理的域名白名单。
- `workspace-storage.ts`：统一数据目录、旧缓存迁移与路径边界检查。

核心模块不依赖 HTTP、React 或 Electron；新增格式或算法应尽量留在此层。

## 本地服务（`server/`）

`server/start.ts` 只负责启动顺序：

```text
环境检查 -> initializeStorage -> 构建 Web -> Studio.initialize -> HTTP serve
```

HTTP 监听通过 `server/serve.ts` 的 `node:http` 适配层提供，因此服务端直接使用 Node 24+ 启动：

```powershell
npm run dev
node server/start.ts
npm run test:node
```

桌面版后台使用 Electron 自带 Node 运行，打包产物不再包含 Node 运行时；npm 仅作为依赖安装与构建工具。

- `studio.ts`：长期状态与领域操作，包括模型会话、转换任务、准备状态缓存、预览缓存、皮肤包管理器和数据目录切换。
- `serve.ts`：基于 `node:http` 的 Fetch 风格 HTTP 适配层，基于 Node。
- `fs.ts`：跨运行时的文件存在性、读取、流式响应与 MIME 类型。
- `router.ts`：组装路由表、请求分发与 404/错误边界。
- `route.ts`：声明式路由表（`route(method, path, handler)`、`:name` 参数）与匹配器。
- `http.ts`：JSON 响应、`HttpError` 显式状态、稳定缓存键、上传路径校验、`busy` 串行化和同源/桌面令牌检查。
- `routes/`：按领域拆分的路由表；每个文件导出 `xxxRoutes` 数组，由 `router.ts` 汇总。
  - `settings.ts`：数据目录、游戏目录、占用统计。
  - `models.ts`：模型库、打开/重新定位、示例与预览。
  - `uploads.ts`：ZIP/文件夹上传与包内模型选择。
  - `convert.ts`：转换任务与结果资源。
  - `packs/`：皮肤包与角色相关的路由，按域拆分。
    - `index.ts`：组合 persona / library / game 三个路由表。
    - `shared.ts`：自定义槽位的自动备份。
    - `persona.ts`：角色/预设图标、角色导出与备份。
    - `library.ts`：本地皮肤包库、预设槽位、导入导出、预览、安装与删除。
    - `game.ts`：游戏槽位的启用、停用、恢复、修复与已安装皮肤编辑；游戏目录守卫由 `gameRoute()` 逐条包装，不再维护路径集合。
  - `templates.ts`：图片皮肤模板。
  - `source-icons.ts`：模型网站 favicon 的本地代理与磁盘缓存；只接受 `source-sites.ts` 中的域名。
  - `static.ts`：构建后的前端静态文件。
- `model-library.ts`：模型库条目的增删改查与编辑配置校验。
- `model-files.ts`：模型扩展名与递归扫描。
- `source-archive.ts`：ZIP 解包、源模型及贴图归档。
- `storage-usage.ts`：数据目录占用统计。

路由层只做参数解析和 HTTP 状态映射；可复用的领域逻辑放到 `Studio` 或 `src/`，避免在路由中复制转换流程。

## 前端（`web/`）

- `main.tsx`、`App.tsx`：挂载与页面切换；`App.tsx` 只保留导航、全局弹窗和页面入口。
- `pages/`：`WorkbenchPage`、`LibraryPage`、`PackPage`、`TemplatesPage`、`SettingsPage`，以及页面内的 `ModelSources`。
- `workbench/`：`Viewer`、`MaterialPanel`、`SettingsPanel`、`OutputPanels`、`HoldOriginalButton`、`use-workbench.ts`、`estimate.ts`、`types.ts` 及预览渲染工具。工作台会话状态由 `useWorkbench` 持有，供工作台和模型库共同使用。
- `library/`：模型库的 `ModelListPane`、`ImportModelDialog`、`RenameModelDialog`、`RelinkModelDialog`、`DeleteModelDialog` 与 `model-types.ts`。
- `packs/`：`PackSidebar`、`PackHeader`、`SkinList`、`SkinDetail`、`PackDialogs`、`GameSkinsPanel`、`PersonaRecipePanel`、`PackPreview`、`SaveSkinDialog`、`GameStatusBadge`，以及 `use-pack-page.ts`、`pack-types.ts`、`pack-state.ts`、`pack-menu.ts`、`pack-ui.ts`、`game-skins-types.ts`。`PackPage` 只负责视图，数据加载和操作由 `usePackPage` 统一管理。
- `ui/`：`AppBar`、`WebNav`、`AboutDialog`、`ContextMenu`、`InlineName`、`Modal`、`SelectableRow` 等跨页面组件。
- `lib/`：`api.ts`、`appearance.ts`、`navigation.ts`、`use-hash-route.ts` 等基础设施。
- `styles/`：`style.css`、`workflow.css`、`theme.css`。

页面组件持有交互状态；跨页面共享的纯逻辑放到 `packs/`、`workbench/` 或 `lib/`，避免从页面文件反向导入类型或组件。

## 验证

```powershell
npm run check
npm run check:web
npm run test:workflow
npm run test:studio
npm run test:desktop
```

完整测试现在由 Vitest 在 Node 下运行：`npm run test`。日常快速回归可用 `test:workflow` 与 `test:studio`。
