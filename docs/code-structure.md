# 代码结构

本页说明各目录的职责与依赖方向，便于在不破坏转换流水线的前提下继续扩展。历史阶段记录已移除，当前行为以本目录文档和源码为准。

## 入口

| 入口 | 作用 |
| --- | --- |
| `src/cli.ts` | `inspect`、`convert`、`validate`、`preview` 命令行 |
| `src/pack-cli.ts` | 皮肤包库与游戏目录的启用、备份、恢复 |
| `server/start.ts` | 本地网页/桌面后台的启动、Web 构建、HTTP 服务 |
| `webapp/` | 纯浏览器的静态网页版，无 Node 后台；图片皮肤与模型转换 |
| `scripts/` | 按职责分组的检查、工作流、桌面打包、样本与诊断工具；稳定入口见 `scripts/README.md` |
| `desktop/` | Electron 主进程、预加载脚本与桌面冒烟测试 |

## 转换核心（`src/`）

单向流水线：

```text
Importer -> IntermediateModel -> Optimizer -> BoneMapper -> BedrockExporter -> SkinPackBuilder
```

- `importer.ts`、`avatar-import.ts`、`tga.ts`、`pmx-metadata.ts`：读取 GLB/glTF、Assimp 格式与 PMX/VRM 元数据。
- `prepare-model.ts`、`optimizer.ts`、`mesh-optimizer.ts`、`rigid-mesh-reducer.ts`：变换、姿势冻结、减面。
- `texture-optimizer.ts`、`texture-charts.ts`、`image-template.ts`、`image-skin-geometry.ts`：图集、UV 连通分岛、图片模板与两端共用的平面皮肤几何。
- `bone-mapper.ts`、`humanoid.ts`、`humanoid-binding.ts`、`auto-profile.ts`：Static 与六部位人形绑定；`humanoid-binding.ts` 提供两端共用的角色映射、玩家骨架、轴心拟合与三角面归属规则。
- `bedrock-exporter.ts`、`bedrock-types.ts`、`geometry-validator.ts`、`poly-mesh-writer.ts`：Bedrock 1.8.0 poly_mesh 导出与校验。`poly-mesh-writer.ts` 提供两端共用的顶点去重、X 镜像与可见包围盒计算。
- `skin-pack.ts`、`skin-pack-files.ts`、`skin-pack-zip.ts`、`pack-cli.ts`、`import-skin-pack.ts`：ZIP、皮肤包校验、不可变库与可恢复部署。`skin-pack-files.ts` 只依赖 Web 标准 API，桌面版与网页版共用皮肤包构建器、PNG 签名/尺寸与 UUID 校验；`skin-pack-zip.ts` 共用平铺 ZIP 的写入与压缩策略。
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
- `workbench/`：`Viewer`、`SettingsPanel`、`ModelPartsPanel`、`TexturePanel`、`AtlasPanel`、`OutputPanels`、`use-workbench.ts`、`estimate.ts`、`types.ts`、`part-visibility.ts`、`camera-state.ts`、`pose-preview.ts` 及预览渲染工具。工作台会话状态由 `useWorkbench` 持有，供工作台和模型库共同使用。
- `library/`：模型库的 `ModelListPane`、`ImportModelDialog`、`RenameModelDialog`、`RelinkModelDialog`、`DeleteModelDialog` 与 `model-types.ts`。
- `packs/`：`PackSidebar`、`PackHeader`、`SkinList`、`SkinDetail`、`PackDialogs`、`GameSkinsPanel`、`PersonaRecipePanel`、`PackPreview`、`SaveSkinDialog`、`GameStatusBadge`，以及 `use-pack-page.ts`、`pack-types.ts`、`pack-state.ts`、`pack-menu.ts`、`pack-ui.ts`、`game-skins-types.ts`。`PackPage` 只负责视图，数据加载和操作由 `usePackPage` 统一管理。
- `ui/`：`AppBar`、`WebNav`、`AboutDialog`、`ContextMenu`、`InlineName`、`Modal`、`SelectableRow` 等跨页面组件。
- `shared/`：与纯浏览器网页版共用的展示层，只依赖 Web 标准 API 与 React：`build-log.ts`（构建号与更新日志数据）、`Changelog.tsx`（构建号按钮与更新日志弹窗）、`Icons.tsx`（两端共用的矢量图标）、`ViewLightingButton.tsx`（工作台与皮肤包预览共用的光影开关）、`WorkspaceTabs.tsx`（模型 / 纹理 / 导出工作区标签）、`Dialog.tsx` / `useDialogDismiss.ts`（弹窗外壳与 Esc/背景点击）、`palettes.ts`（配色元数据）、`appearance.ts`（主题/配色写入文档并广播 `appearancechange`）、`SourceDirectory.tsx`（模型站点目录）、`PoseControls.tsx`（Y 轴旋转与手臂外展/下放控件）、`MaterialBrowser.tsx`（材质搜索、筛选、清晰度滑杆与数值输入）、`MaterialList.tsx`（材质行、缩略图、勾选、像素权重、只看）、`PartBrowser.tsx`（部件行与保留开关）、`AtlasInspector.tsx`（图集放大、区域与材质列表）、`MaterialCoverage.tsx`（逐材质像素覆盖）、`ConversionSummary.tsx`（转换报告摘要）、`RatioField.tsx` / `triangle-budget.ts`（保留面数比例与面数区间）、`ModelCandidateList.tsx`（多模型 ZIP 选择）、`poly-mesh-preview.ts`（导出的 poly_mesh → three.js 网格、纹理与统一取景 preset）、`preview-viewport.ts`（renderer / scene / camera / OrbitControls / 渲染循环 / 光照与正面指示的共享外壳）、`preview-lighting.ts`（预览环境光、三点光与软阴影）、`preview-orientation.ts`（前向箭头与标签）、`preview-material.ts`（预览材质裁切与深度规则）、`demand-render.ts`（按需渲染合并）、`viewport-appearance.ts`（主题背景与网格着色）、`format.ts`（字节与文件名工具）、`file-save.ts`（浏览器下载与 ZIP 文件名）、`clipboard.ts`（复制回退）。这里不放 API、IndexedDB 或服务端数据模型。
- `lib/`：`api.ts`、`appearance.ts`、`navigation.ts`、`use-hash-route.ts` 等基础设施。
- `styles/`：`style.css`、`workflow.css`、`theme.css`、`shared.css`。

页面组件持有交互状态；跨页面共享的纯逻辑放到 `packs/`、`workbench/` 或 `lib/`，避免从页面文件反向导入类型或组件。

## 纯浏览器网页版（`webapp/`）

网页版是独立的 Vite + React 静态应用，构建产物在 `webapp/dist/`，不需要 `server/`。

- `engine/import-model.ts`：GLTF/OBJ/FBX/DAE/STL/PLY 加载与多文件资源映射。
- `engine/humanoid.ts`：VRM 0.x / 1.0 人形元数据与常见 MMD / Mixamo 骨骼识别、六部位归属和世界轴心。
- `engine/extract.ts`：世界变换、材质分组、UV 归一化、按源权重划分六部位与包围数据。
- `engine/atlas.ts`：128 × 128 图集规划、绘制、UV 重映射。
- `engine/bedrock.ts`：静态整体绑定或六部位玩家骨架、镜像与 `poly_mesh` 导出。
- `engine/convert.ts`：图集 → 几何 → 皮肤包 → ZIP 流程。
- `engine/image-skin.ts`：图片平面皮肤。
- `engine/model-zip.ts`、`engine/pmx.ts`、`engine/textures.ts`、`engine/resources.ts`、`engine/pose.ts`、`engine/reduce.ts`、`engine/model-job.ts`、`engine/types.ts`：模型 ZIP、PMX→GLB、TGA→PNG、资源映射、手臂姿势、按材质/部位减面、导入/转换编排与转换数据类型。
- `engine/frame.ts`、`engine/canvas.ts`、`engine/names.ts`、`engine/geometry-math.ts`、`engine/vrm-materials.ts`、`engine/preview-materials.ts`、`engine/progress.ts`：帧让步、Canvas PNG 编码、皮肤名称校验、几何辅助、VRM 材质转换、预览材质规则与导入/转换阶段进度。
- `lib/output-preview.ts`：共享 poly_mesh 预览的薄封装，自动识别皮肤包里的几何标识。
- `lib/pack-types.ts`、`lib/pack-store.ts`、`lib/pack-context.tsx`：单包数据结构、IndexedDB 持久化与 React 状态。
- `lib/pack-import.ts`：读取 legacy poly_mesh 皮肤包 ZIP 并转换成单包里的皮肤。
- `lib/download.ts`、`lib/theme.ts`、`lib/links.ts`、`lib/use-compact-viewport.ts`、`lib/material-visibility.ts`：保存/分享、主题、外链、紧凑视口和预览材质显隐等应用基础设施。
- `components/`：图片模式、模型模式、`ModelSourcesPage`（获取模型独立页）、`SettingsStudio`（主题、配色与本地数据）、`AboutStudio`（构建号、更新日志与许可）、`ConversionReport`（转换结果摘要）、单包管理、`SkinPreview`（皮肤卡片的三维预览弹窗）、视口、拖放与下载。
- 共享 `src/skin-pack-files.ts`、`src/skin-pack-zip.ts`、`src/poly-mesh-writer.ts`、`src/geometry-validator.ts`、`src/image-skin-geometry.ts`、`src/tga.ts` 与 `src/pmx-metadata.ts`；不导入 `sharp`、`node:fs` 或 `libassimp`。
- 共享展示层 `web/shared/`：配色元数据与主题写入（`palettes`、`appearance`）、模型站点目录、`formatBytes` / `safeFilename` / ZIP 文件名与浏览器下载（`format`、`file-save`）、弹窗 Esc/背景点击行为、姿势控件（`PoseControls`）、材质列表与像素覆盖（`MaterialList`、`MaterialCoverage`）、转换报告摘要（`ConversionSummary`）、保留面数比例（`RatioField`），以及预览外壳（`preview-viewport`、`poly-mesh-preview`、`preview-lighting`、`preview-orientation`、`demand-render`、`viewport-appearance`）。`webapp/lib/theme.ts` 保留主题持久化并再导出共享写入逻辑。
- 样式复用 `web/styles/theme.css` 的明暗主题变量与 `web/styles/shared.css` 的站点目录、姿势控件和材质行样式，页面布局遵循本地工作台的顶栏、三栏卡片与紧凑表单。

`engine/` 只放不依赖界面的浏览器转换管线，不导入 React、`components/`、`pack-context`、IndexedDB、主题或下载；`lib/` 负责单包状态与应用基础设施；`components/` 只负责界面。`tests/architecture.test.ts` 会检查这条边界。

## 验证

```powershell
npm run check
npm run check:web
npm run check:webapp
npm run test:workflow
npm run test:studio
npm run test:desktop
```

完整测试现在由 Vitest 在 Node 下运行：`npm run test`。日常快速回归可用 `test:workflow` 与 `test:studio`。
