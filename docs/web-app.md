# 网页版（纯浏览器）

`webapp/` 是一个独立的静态单页应用，用来在浏览器里直接生成 4D 皮肤。它不需要 Node 服务端。网页版包含一个浏览器本地的单包管理器，但不会写入游戏目录，也没有桌面版的模型库。

## 启动与构建

```powershell
npm run webapp:dev      # http://127.0.0.1:4174
npm run webapp:build    # 输出到 webapp/dist/
npm run webapp:preview  # 预览构建产物
npm run check:webapp    # 只检查网页版
```

开发服务器和预览服务器都监听 `0.0.0.0`，Vite 会同时打印一个 `Network` 地址。手机和电脑连同一个 Wi-Fi 后，直接打开这个地址即可，例如 `http://192.168.1.20:4174`。如果手机打不开，检查 Windows 防火墙是否允许 Node.js 的入站连接。

`webapp/dist/` 可以部署到任意静态托管（Cloudflare Workers、Pages、GitHub Pages、Netlify、对象存储等）。构建使用相对路径，放在子目录也能打开。网页版没有 API 请求，不需要配置后端。

## 部署到 Cloudflare

仓库默认使用 Cloudflare Workers 静态资源部署，配置在根目录 `wrangler.jsonc`：

- Worker 名称：`4dgen-web`（可以在 `wrangler.jsonc` 中修改）
- 静态目录：`webapp/dist`
- 未匹配路径回退到 `index.html`（SPA 模式）
- 没有 Worker 脚本，只有静态资源

首次手动部署：

```powershell
npx wrangler login
npm run webapp:deploy:dry   # 构建并检查打包内容，不上传
npm run webapp:deploy       # 构建并部署
```

部署完成后地址为 `https://4dgen-web.<你的 workers.dev 子域>.workers.dev`。自定义域名在 Cloudflare Dashboard 的 Workers → `4dgen-web` → Settings → Domains & Routes 添加。

自动部署使用 Cloudflare 自己的 **Workers Builds** GitHub 集成，不需要在 GitHub 仓库里保存 `CLOUDFLARE_API_TOKEN`：

1. 打开 Cloudflare Dashboard → Workers & Pages → `4dgen-web` → Settings → Builds
2. 选择 Connect，授权 Cloudflare Workers & Pages GitHub App
3. 选择仓库 `XiaoYangX666/MCBE-4DGen` 和分支 `main`
4. 构建配置：
   - Root directory：`/`
   - Build command：`npm run webapp:build`
   - Deploy command：`npx wrangler deploy`
   - Preview command：保持默认 `npx wrangler preview`（启用 PR 预览时使用）
5. 保存后推送到 `main` 即自动构建和部署

Workers Builds 会自动安装依赖，并在 Cloudflare 侧生成/复用自己的构建 Token。只有想用自定义权限的 Token 时才需要在 Workers Builds 设置里手动指定。

`.github/workflows/ci.yml` 继续只做类型检查、测试和网页版构建，不负责部署。手动部署仍然可以使用上面的 `npm run webapp:deploy`。

## 功能

界面复用桌面版的明暗主题与配色。首次打开跟随系统明暗，默认 graphite（中性灰）；顶栏的配色按钮可以切换中性灰 / 海盐蓝 / 暖砂 / 玫瑰灰 / 蓝紫五种配色，选择保存在当前浏览器。配色名称与说明来自 `web/shared/palettes.ts`，与桌面端设置页共用同一份元数据；两边仍各自负责 localStorage 与桌面桥接的持久化。

### 设置与关于

网页版有独立的「设置」和「关于」页面，桌面顶栏直接提供入口，手机端从侧边栏进入。

- **设置**：主题、配色和本地数据说明。主题与配色修改后立即生效，并保存在当前浏览器。
- **关于**：当前构建号、更新日志、GitHub 和许可证。

### 构建号与更新日志

关于页显示当前构建号，例如 `#11`，每次构建递增；更新日志从关于页打开，不占用顶栏。桌面工作台、桌面应用和网页版使用同一个 `web/shared/Changelog.tsx` 组件和 `web/shared/build-log.ts` 数据。当前没有正式版本号，日志按构建记录；正式发版时把覆盖的多个构建合并成一个版本条目即可。

### 图片皮肤

- 支持 PNG、JPEG、WebP、GIF、BMP、SVG、AVIF（取决于浏览器解码能力），单张最大 40 MB。
- 图片按比例放进 128 × 128 贴图，居中、保留透明背景。
- 平面高度默认 32，约为玩家身高；宽度按图片比例计算。
- 导出平铺的 `.zip`：`manifest.json`、`skins.json`、`geometry.json`、`skin0.png` 和语言文件都在压缩包根目录，没有顶层文件夹。

### 3D 模型

| 格式 | 加载方式 | 状态 |
| --- | --- | --- |
| GLB / glTF | `GLTFLoader` | 推荐，支持 Meshopt 压缩 |
| VRM 0.x / 1.0 | `GLTFLoader` | 读取基础网格，忽略 VRM 骨骼与表情扩展 |
| OBJ | `OBJLoader` + `MTLLoader` | 推荐同时选中 `.mtl` 和贴图 |
| FBX / DAE / STL / PLY | three.js 加载器 | 实验支持 |
| PMX 2.0 / 2.1 | libassimp WebAssembly → GLB | 支持静态转换；首次使用需加载约 12 MB WASM，PMD 不支持 |

转换流程：

1. 在浏览器里解析模型和贴图。
2. 读取 VRM 0.x / 1.0 人形骨骼元数据，或用常见 MMD / Mixamo / 英文骨骼名识别头、躯干、双臂和双腿。
3. 把每个材质的 UV 连通分岛，按表面积预算把每个岛拼进一张 128 × 128 图集；负数和跨接缝的 UV 按贴图环绕模式采样。
4. 应用世界变换、居中、落地、缩放到指定高度，并镜像到 Bedrock 坐标系。
5. 识别到完整人形骨骼时，按源权重把三角面分到 `body / head / leftArm / rightArm / leftLeg / rightLeg` 六个玩家骨骼；否则生成单骨骼 `body`。背面跟随源材质的双面设置。
6. 用共享的 `src/skin-pack-files.ts` 打包成平铺 `.zip`，皮肤文件直接位于压缩包顶层。

PMX 会先用 `libassimp` 的 WebAssembly 后端转换成 GLB，再走同一条 glTF 流程；`libassimp` 只在第一次导入 PMX 时按需下载（约 12 MB，gzip 后约 3 MB）。一个 ZIP 里有多个模型时会先让你选择要导入的那一个，没有选择时取体积最大的。PMX 只保留绑定姿势；常见 MMD 骨骼名可以识别为六部位，骨骼动画、表情、物理和 toon 材质不会进入输出。PMX 常用的 TGA 贴图会在浏览器里转成 PNG，并把超过 1024 px 的贴图缩到 1024 px 以内；BMP/PNG/JPEG 直接交给浏览器解码。

转 GLB 时使用与桌面导入器共享的 Assimp 后处理（`src/assimp-import.ts`），关闭默认的 `joinIdenticalVertices`：它只改变顶点复用方式，却会在 MMD 体量上耗时几分钟（11.9 MB / 11.6 万面的样本从约 70 秒降到约 0.8 秒，三角面、UV、法线、骨骼权重逐面比对一致）。网页版按三角面汤导出，不需要这一步；`triangulate`、`generateUvCoordinates` 和 `sortByPrimitiveType` 保留。

网页版图集与桌面工作台共用 `src/texture-chart-math.ts` 的分岛规则：按共享 UV 角点拆分连通岛，再用「包围盒增长 ≤ 20% 且保留 80% 覆盖」的启发式合并相邻岛。每个岛单独分配矩形（128 × 128、1 像素边距、面积需求按 `area^0.85` 压缩），小到眼睛高光这类岛也至少保留 3 × 3 内容像素，因此不会再把稀疏 UV 平均成一整块近乎不可见的糊图。UV 落在 0–1 之外时不再裁切，而是按源贴图的重复 / 钳制 / 镜像环绕模式采样。

### 转换设置

桌面端采用三栏布局：左侧是模型导入和材质筛选，中间是源模型 / 4D 输出预览与统计，右侧是基础设置、姿势与朝向和生成按钮。移动端把设置收进底部悬浮窗，材质作为独立 Tab。

导入模型后可以调整这些参数，改动后需要重新转换：

- **绑定方式**：识别到完整 VRM / 常见 MMD 人形骨骼时默认「六部位人形」，头、躯干、双臂、双腿会跟随玩家动作；也可以切回「静态整体」。没有完整骨骼时只能按静态整体导出，并会给出提示。
- **模型高度**：1–128，默认 32（约玩家身高）。
- **保留面数比例**：1%–100%，默认 20%，按材质分别减面。旁边会估算目标面数并标注轻量（< 2 万）/ 可接受（2–5 万）/ 偏高（> 5 万）。
- **高级减面 → 形状变化容限**：默认 0.03。调小优先保形，可能减不到目标；调大减得更多但更容易丢轮廓。
- **材质筛选**：逐项勾选要保留的材质，显示贴图缩略图、三角面数和贴图尺寸；PMX 会恢复原始材质名（颜、眉、体…），同名材质自动编号。取消勾选会立即从源模型预览中隐藏，转换时也只导出勾选的材质。点击材质名可以在源模型上只看该材质，再点一次或「显示全部」退出。右侧像素权重（0–20，默认 1）影响 128 图集的面积分配，0 表示最低预算但仍保留。
- **双面渲染**：跟随源材质 / 全部双面 / 全部单面。全部双面会让输出三角面翻倍。
- **Y 轴旋转**：−180°–180°，带 0°/90°/180°/−90° 预设。源模型会实时旋转，转换时按当前朝向导出；用「正面检查」确认朝向。
- **手臂下放**：−45°–90°，0° 保持源姿势，正值把手臂往下放，源模型实时更新。按骨骼名称自动识别左右上臂和手/肘（支持常见 MMD 日文名、VRM 和 Mixamo 命名）；转换时把当前姿势烘焙进静态网格。没有识别到骨骼的模型不显示可用滑杆。

减面使用 `meshoptimizer`，按材质边界分别处理；开启六部位绑定时还会按部位边界分开减面，避免三角面跨骨骼。法线和 UV 权重固定。网页版不提供骨骼动画播放，只导出刚性绑定的静态几何。

大模型导入和转换期间，预览区会覆盖一层阶段提示：读取文件 → 加载 PMX 转换引擎 / 转换 PMX → 准备贴图 → 解析模型 → 识别骨骼 → 提取网格 → 减面（按材质显示 `3/12`）→ 图集与覆盖率统计 → 导出几何 → 打包。有可数条目时会在阶段下面显示当前项或数量，设置栏按钮上方也会同步显示；这样长时间的单步处理不会再像一个卡死的界面。转换仍在主线程执行，每 40 ms 让出一次以便刷新阶段文字。

模型拖放区也接受 `.zip`：解压后会按文件类型筛选模型（GLB / glTF / VRM / PMX / PMD / FBX / OBJ / DAE / STL / PLY）和配套资源（`.bin`、`.mtl`、PNG / JPEG / WebP / GIF / BMP / AVIF / SVG / TGA / DDS 贴图），再交给同一套加载流程。外层多包一层文件夹、贴图放在子目录都能识别；`__MACOSX`、`.DS_Store` 等系统文件会被忽略。同一个 ZIP 里有多个模型且贴图重名时，贴图按所选模型所在目录优先匹配，不会串用另一个模型的贴图。限制为压缩包 256 MB、解压后 512 MB、最多 2000 个资源文件，超出会提示精简。ZIP 只用于导入模型，不是皮肤包导入；`.mcpack` / `.mcaddon` 需要先改名为 `.zip` 或解压后再选。

模型页拖放区下方的「获取模型」会打开常用模型站点目录，支持搜索和分类；网页版推荐下载 GLB / glTF / VRM / OBJ / PMX。目录本体是 `web/shared/SourceDirectory.tsx`，与桌面端「获取模型」弹窗共用；两端只注入自己的图标渲染与复制实现（桌面走 `/api/source-icon` 和桌面桥接，网页版用字母头像和 `navigator.clipboard`）。

### 三维预览

- **模型页**：导入后先显示源模型；转换完成后可切换「源模型 / 4D 输出」，后者直接用导出的几何和 128 贴图重建。
- **图片页**：生成后直接显示 3D 平面，不再单独展示或下载 128 × 128 贴图。
- **皮肤包页**：每张皮肤卡片右下角的「3D」按钮打开预览弹窗，可旋转、缩放查看实际导出的 `poly_mesh`；导入的皮肤包同样支持，不要求几何标识是 `geometry.skin0`。
- 预览默认关闭光照，直接按贴图原色显示；每次打开页面都会回到关闭状态，当前会话内的切换会保留。右上角「光照」按钮可切回立体明暗。
- 预览材质沿用桌面工作台的规则（`web/shared/preview-material.ts`）：不透明但使用透明混合的材质改为 alpha 裁切，半透明材质关闭深度写入。MMD 的眼睛高光、睫毛这类「不透明底色 + 透明贴图」的材质因此只显示高光本身，而不是盖住整只眼睛的半透明白色片。转换仍按源文件的 alpha 模式烘焙图集，不受预览调整影响。
- 导出的 `poly_mesh` 为 Bedrock 手性镜像了 X；输出预览和皮肤包 3D 预览会再镜像一次，保持与源模型相同的左右方向（与桌面工作台、皮肤包预览一致）。
- 预览左上角显示「正面检查：脸和胸前应朝向绿色箭头」，场景内有贴地的绿色前向箭头；右下角「正面检查」按钮可切到 −Z 视角。
- 预览只重建静态几何，不播放骨骼动画、表情或源模型姿势。three.js 和预览代码按需加载，不打开预览不会下载这部分资源。
- 导出 ZIP 的安装步骤不在生成页展示，后续会集中到一个统一的教程页面。

### 我的皮肤包（单包模式）

- 网页版只保留一个皮肤包。创建后，图片和模型结果都可以点「加入皮肤包」继续累积，不再每次生成一个独立包。
- 支持修改包名、修改皮肤名、移除皮肤、导入皮肤包、清空皮肤包。
- 包 UUID 会保存在 IndexedDB 里。重复导出会更新同一个包身份，而不是在游戏里生成一堆同名包。
- 主按钮导出平铺的 `.zip`：`manifest.json`、`skins.json`、`geometry.json`、贴图和 `texts/` 全部在压缩包根目录，没有任何顶层文件夹。解压后把里面的文件放进 `com.mojang/skin_packs/<包名>/`，或直接把 `.zip` 改名为 `.mcpack` 交给 Minecraft 导入。
- 桌面版和网页版的导入都兼容平铺 ZIP，也兼容带顶层文件夹的旧 ZIP 和 `.mcpack`。
- 导入支持 `.zip` / `.mcpack`，内容为 `format_version: 1.8.0` 的 legacy poly_mesh 皮肤包，包括本工具导出的包和同类 4D 包；内置人形皮肤和 cube 几何会跳过并在界面提示。
- 数据只存在当前浏览器。更换浏览器、无痕模式或清除站点数据后，皮肤包需要重新创建或导入。

安装路径：

- Windows：`%LOCALAPPDATA%\Packages\Microsoft.MinecraftUWP_8wekyb3d8bbwe\LocalState\games\com.mojang\skin_packs`
- Android：`Android/data/com.mojang.minecraftpe/files/games/com.mojang/skin_packs`
- iOS：文件 App → 我的 iPhone → Minecraft → games/com.mojang/skin_packs

## 移动端

- 宽度小于 860 px 时，顶部导航换成「菜单」按钮 + 当前页面标题；左侧抽屉只负责页面切换，设置和关于是独立页面。抽屉支持遮罩点击、Esc 关闭，关闭后焦点回到菜单按钮。
- 宽度小于 860 px 时，图片页和皮肤包页仍是单列滚动；**3D 模型页改成全屏预览 + 可收起的底部设置悬浮窗**：悬浮窗默认约占六成屏高，底部留下 4px 间隙；拖住顶部把手可以继续向上放大到接近全屏，向下拖过默认高度的一半左右会直接收起，拖回默认高度则吸附回六成屏高。收起后只留一条把手，预览会扩展到整屏。悬浮窗内分「基础 / 姿势 / 材质 / 结果」四栏，基础放皮肤名称、模型高度、保留面数比例和双面策略，姿势放 Y 轴旋转和手臂下放，材质放筛选、缩略图、像素权重和只看，结果放转换报告、材质像素覆盖、加入皮肤包和下载。转换完成后会自动切到「结果」栏。选文件/获取模型放在预览区：没有模型时在空状态里，导入后在预览左上角显示「更换模型 / 获取模型」，不再占用设置栏。转换按钮固定在悬浮窗底部。
- 模型页的悬浮窗和预览同时可见，取消勾选材质会立刻在预览里隐藏；不需要在设置和预览之间来回滚动。
- 输入框在移动端使用 16 px 字号，避免 iOS Safari 聚焦时自动放大；主要按钮和文件选择区的最小高度按触控目标调整。
- 生成或转换完成后，移动端会自动滚动到结果卡片，不需要手动往下找。
- 三维预览使用 `touch-action: none`，支持单指旋转、双指缩放/平移。
- 高 DPI 屏幕上 canvas 的 CSS 尺寸与绘制缓冲区分开处理，避免手机只显示左上角一块。
- 手机下载 `.zip` 时优先调用系统分享/保存面板（Web Share API），可存到“文件”或直接发送；不支持时回退为普通下载。Web Share 通常需要 HTTPS，局域网 HTTP 调试时可能只走下载回退。
- WebGL 不可用时，预览区会显示提示，但转换和 `.zip` 下载仍然可用。
- 建议 iOS 16.4+ / 最新 Android Chrome。手机内存有限，建议先处理 50 MB 以下、5 万面以内的模型；超大模型可能卡住页面。

## 复用边界

网页版没有复制一整套桌面转换代码，而是复用兼容层，保留各自擅长的运行环境。

已复用：

- `src/skin-pack-files.ts`：`manifest.json`、`skins.json`、语言文件与皮肤包身份，桌面版和网页版导出完全同源；同时提供 PNG 签名/尺寸与 UUID 校验。
- `src/skin-pack-zip.ts`：平铺皮肤包 ZIP 的写入与压缩策略，桌面版和网页版共用。
- `src/poly-mesh-writer.ts`：poly_mesh 的顶点去重流、X 镜像和可见包围盒；桌面导出与网页版导出共用这些基础逻辑，上游遍历仍各自保留。
- `src/geometry-validator.ts`、`src/bedrock-types.ts`：导出前后的 Bedrock 几何结构校验和类型。
- `src/image-skin-geometry.ts`：图片平面皮肤的几何由桌面 sharp 路径和浏览器 Canvas 路径共用。
- `src/source-sites.ts`：模型来源站点目录、分类与搜索数据。
- `web/styles/theme.css`：明暗主题、调色板与 CSS 变量。
- `web/styles/shared.css`：模型站点目录、姿势控件、材质行等共享控件的样式与响应式规则。
- `web/shared/palettes.ts`：配色 key、名称、说明与默认配色。
- `web/shared/SourceDirectory.tsx`：站点目录的搜索、分类、卡片与复制状态；图标和剪贴板通过 props 注入。
- `web/shared/PoseControls.tsx`：Y 轴旋转、手臂外展/下放控件；桌面工作台和网页版模型页共用，状态仍由各自页面持有。
- `web/shared/MaterialList.tsx`：材质行、缩略图/色块、勾选、像素权重和只看按钮；桌面材质面板和网页版材质栏共用。
- `web/shared/MaterialCoverage.tsx`：逐材质的图集像素覆盖行与选中行为；桌面转换报告和网页版模型结果共用。
- `web/shared/ConversionSummary.tsx`：转换报告的标题、输出面数、移除材质、用时、图集利用率与材质覆盖摘要；两端只注入各自的数据和附加区块。
- `web/shared/RatioField.tsx` 与 `web/shared/triangle-budget.ts`：保留面数比例、目标/实际面数与轻量/可接受/偏高区间。
- `web/shared/file-save.ts`：浏览器下载回退与 Windows 安全的 `.zip` 文件名；桌面保存和网页版导出共用。
- `web/shared/appearance.ts`：把主题与配色写入文档、同步 `theme-color` 并广播 `appearancechange`；两端持久化仍各自负责。
- `web/shared/poly-mesh-preview.ts`：导出的 `poly_mesh` → three.js 网格、纹理与统一取景 preset（`PREVIEW_CAMERA` / `PREVIEW_FRAMING`）；桌面端皮肤包预览、网页版 3D 预览和工作台共用。
- `web/shared/preview-viewport.ts`：renderer、scene、camera、OrbitControls、ResizeObserver、连续/按需渲染循环、光照与正面指示的共享外壳；网页版和桌面皮肤包预览完整使用，工作台复用它并保留姿势/材质/focus 逻辑。
- `web/shared/preview-lighting.ts`：预览用的环境光、三点光、软阴影和自适应光位；网页版、桌面皮肤包预览和工作台共用。
- `web/shared/preview-orientation.ts`：预览的绿色前向箭头和文字标签，方向和位置可配置；三个预览入口共用。
- `web/shared/demand-render.ts`：按需渲染的帧合并；共享外壳与工作台共用。
- `web/shared/viewport-appearance.ts`：主题 `--viewport` 背景与 `--muted` 网格着色；共享外壳与工作台共用。
- `web/shared/format.ts`：网页版使用的 `formatBytes` / `safeFilename` / `formatCount`。
- `web/shared/useDialogDismiss.ts`：网页版弹窗共用的 Esc、背景点击与初始焦点行为。
- 测试中的校验器：网页版导出的皮肤包会用桌面版同一套 `validateSkinPackFiles` / `validateSkinPackPath` 检查。

没有直接共用：

- 模型导入与导出。桌面版基于 `glTF-transform`、`sharp`、`libassimp`；浏览器版基于 three.js 加载器和 Canvas。强行抽象会把 Node 依赖带进浏览器。
- 图集规划。桌面版和网页版共用 `src/texture-chart-math.ts` 的 UV 连通分岛、合并启发式和展开边界；网页版在此基础上按 128×128 的轻量 MaxRects 打包，桌面版继续使用 `sharp` 逐岛重采样。
- 布局 CSS。桌面工作台是固定 `100dvh`、三栏、密集表单；网页版需要单列滚动和触控尺寸，只共用设计变量与视觉规范。弹窗外壳（桌面 `web/ui/Modal.tsx`、网页 `.sources-dialog` / `.preview-dialog`）也各自保留，但 Esc、背景点击与初始焦点统一走 `web/shared/useDialogDismiss.ts`。
- 数据与持久化。`/api/...`、`window.desktop`、IndexedDB 和皮肤包模型都不进入 `web/shared/`。
- 体积格式化。桌面设置页的 `formatSize` 使用 `zh-CN` 本地化数字并支持 TB，网页版 `formatBytes` 是紧凑格式（最多 MB、固定小数位）；语义不同，未合并。
- 配色缩略图 CSS。桌面 `.palette-preview` 与网页版 `.palette-swatch` 尺寸不同，目前只共享配色元数据。
- `bedrock-exporter.ts`。桌面版按 glTF primitive/骨骼流导出，网页版按三角面汤导出；两者共享输出格式、坐标约定、校验器，以及 `poly-mesh-writer.ts` 中的顶点流、镜像和包围盒基础，但导出上游仍各自保留。

## 与桌面版的差异

| 能力 | 网页版 | 桌面版 / 本地工作台 |
| --- | --- | --- |
| 图片平面皮肤 | 支持 | 支持 |
| GLB / glTF / VRM / OBJ | 支持 | 支持 |
| PMX 2.0 / 2.1 | 支持，浏览器内 WASM 转 GLB | 支持 |
| PMD / 其他 Assimp 格式 | 不支持 | 支持 |
| 人形六部位绑定 | 支持，自动识别 VRM / 常见 MMD / Mixamo 骨骼；无法识别时退回静态整体绑定 | 支持 |
| 骨骼动画 / 表情 / 姿势 | 支持六部位刚性绑定、Y 轴旋转和手臂下放；不播放动画 | 支持姿势、形态键冻结与人形绑定 |
| 减面与材质权重 | 支持按材质减面、筛选、像素权重与双面策略 | 支持减面、材质筛选与像素权重 |
| 皮肤包管理 | 单包，浏览器本地，可导入/导出 ZIP | 多包、导入导出与游戏目录写入 |
| 写入游戏目录 | 不支持，手动解压 ZIP | 支持 |
| 文件处理位置 | 浏览器内存 | 本机 Node 服务 |

## 已知限制

- 贴图固定 128 × 128。这是目前基岩版客户端验证过的 poly_mesh 皮肤尺寸。
- 六部位绑定是刚性绑定：头、躯干、双臂、双腿跟随玩家动作，但不支持平滑蒙皮、肘膝独立弯曲、手指动画、形态键和头发/裙摆物理。识别不到完整骨骼时会按静态整体导出。
- 六部位按每个三角面的源权重总和归属到唯一部位；肩部、裙摆等混合权重区域可能出现刚性接缝，没有桌面版的逐材质衣物规则。
- PMX 需要首次加载约 12 MB 的 `libassimp` WebAssembly（gzip 后约 3 MB），且转换在主线程完成；PMD 不支持，请先转成 PMX 2.0/2.1。
- PMX 只保留基础网格、材质颜色和贴图；toon、球面贴图、描边、物理、表情和骨骼动画都会丢弃。一个 ZIP 里有多个模型时先让你选择，未选择时取体积最大的那个。
- 手臂下放优先使用 VRM 人形元数据；非 VRM 模型按常见 MMD 日文名、Mixamo 或英文骨骼名识别，自定义骨骼名可能识别不到。只旋转左右上臂，不处理肘部、手腕和手指。
- TGA 贴图会转成 PNG，最长边超过 1024 px 时会先缩小；4K 贴图较多的包首次导入可能需要几十秒。
- UV 超出 0–1 的材质会按贴图的重复 / 钳制 / 镜像环绕模式采样，不再裁切；重复跨度很大时仍受 128 图集分辨率限制，可能出现模糊。
- 顶点色会被忽略，只保留材质基础色与贴图。
- Draco、KTX2/Basis 压缩暂不支持；请先用普通 glTF/GLB 或 PNG/JPEG 贴图。
- 多材质模型会共享 128 × 128 图集，材质越多，单个材质的有效分辨率越低。
- 减面按材质分别进行，材质边界不会合并；选择「全部双面」会让输出三角面翻倍。
- 输出超过约 52,106 个三角面时会提示在实际客户端确认；这是已验证样本的参考值，不是客户端硬上限。
- 转换在主线程完成。很大的模型可能短暂卡住页面，后续可以移到 Web Worker。
- 预览需要 WebGL；转换本身只依赖 Canvas 2D。
- 预览展示的是导出的静态几何，不包含骨骼动画、表情和源模型姿势。
- 源模型朝向不做自动归一化；预览按 −Z 作为角色正面，源模型本身朝 +Z 时看起来会是背面。
- 网页版只保留一个皮肤包，且存储在当前浏览器的 IndexedDB 中。
- 导入只支持 `1.8.0` legacy poly_mesh 皮肤包；内置人形、cube 几何和 KTX2/Draco 资源会被跳过。
- 导出是平铺 `.zip`，皮肤文件直接在压缩包顶层；解压到 `skin_packs/<包名>/`，网页版不提供一键写入游戏目录。

## 代码结构

```text
webapp/
  App.tsx                 页面骨架、模式切换、主题
  components/
    ImageStudio.tsx       图片模式
    ModelStudio.tsx       模型模式
    ModelSourcesDialog.tsx 获取模型弹窗外壳（目录本体在 web/shared）
    PackStudio.tsx        单包管理、导入与导出
    SkinPreview.tsx       导出的 poly_mesh 三维预览与弹窗
    ConversionReport.tsx  模型转换结果摘要与警告
    Viewport.tsx          three.js 预览、共享光照/正面指示与轨道控制
    DropZone.tsx          文件选择 / 拖放
  engine/                 浏览器转换引擎，不依赖 React 或单包状态
    import-model.ts       GLTF/OBJ/FBX/DAE/STL/PLY 加载
    model-zip.ts          解包模型 ZIP（模型 + .bin/.mtl/贴图）
    pmx.ts                PMX → GLB（libassimp WASM），多 PMX 选最大
    textures.ts           TGA → PNG（最长边限制 1024），保留相对路径
    extract.ts            世界变换、材质分组、UV 展开、蒙皮姿势烘焙
    humanoid.ts           VRM / MMD / Mixamo 六部位骨骼识别与部位归属
    pose.ts               左右手臂骨骼识别与实时下放
    reduce.ts             按材质和部位减面（meshoptimizer），法线/UV 权重固定
    atlas.ts              128 图集分岛规划、绘制与逐岛 UV 重映射
    bedrock.ts            poly_mesh 导出
    convert.ts            图集 → 几何 → 皮肤包流程
    image-skin.ts         图片平面皮肤
    model-job.ts          文件 → 模型加载/提取 → 减面/图集的编排
    frame.ts              帧让步
    canvas.ts             Canvas → PNG
    names.ts              皮肤名称校验
    types.ts              转换输入/输出类型
  lib/                    应用状态与基础设施
    output-preview.ts     共享 poly_mesh 预览的薄封装
    pack-types.ts         单包与皮肤的数据结构
    pack-store.ts         IndexedDB 持久化
    pack-context.tsx      单包状态、添加、导入、导出
    pack-import.ts        解析 legacy poly_mesh 皮肤包 ZIP
    download.ts           下载、分享与 ZIP 文件名
    theme.ts              明暗主题
    links.ts              外部链接
    use-compact-viewport.ts 布局断点
    material-visibility.ts 预览材质显隐
```

`engine/` 不导入 React、`components/`、`pack-context`、IndexedDB、主题或下载；这些应用层职责只留在 `lib/` 和 `components/`。模型页的 `ModelStudio` 只保留状态、预览和交互，导入/转换编排走 `engine/model-job.ts`。`tests/architecture.test.ts` 会检查这条边界。

共享模块：

- `src/skin-pack-files.ts`：无 Node 依赖的皮肤包构建器、PNG/UUID 校验，桌面版与网页版共用。
- `src/skin-pack-zip.ts`：平铺皮肤包 ZIP 写入器，两端共用。
- `src/poly-mesh-writer.ts`：poly_mesh 顶点流、镜像与可见包围盒，两端共用。
- `src/image-skin-geometry.ts`：图片平面皮肤的共享几何。
- `src/geometry-validator.ts`：导出前后的 Bedrock 几何结构校验。
- `src/source-sites.ts`：模型站点目录与分类数据。
- `web/shared/build-log.ts`：当前构建号与更新日志数据，桌面与网页版共用。
- `web/shared/Changelog.tsx`：构建号按钮和更新日志弹窗，桌面工作台、桌面应用和网页版共用。
- `web/shared/palettes.ts`：配色 key、名称、说明与默认值。
- `web/shared/SourceDirectory.tsx`：站点目录的搜索、分类、卡片与复制状态，图标和剪贴板由调用方注入。
- `web/shared/ConversionSummary.tsx`：转换报告摘要，桌面工作台与网页版共用。
- `web/shared/file-save.ts`：`downloadBlob` 与 `zipFileName`，桌面保存和网页版导出共用。
- `web/shared/appearance.ts`：主题/配色写入与 `appearancechange` 广播，桌面与网页版共用。
- `web/shared/poly-mesh-preview.ts`：导出的 `poly_mesh` → three.js 网格、纹理与统一取景 preset，桌面端（含工作台输出预览）与网页端共用。
- `web/shared/preview-viewport.ts`：共享预览外壳（renderer、camera、OrbitControls、渲染循环、光照、正面指示、网格/背景与对象生命周期）。
- `web/shared/preview-lighting.ts`：预览环境光、三点光、软阴影与自适应光位，桌面端与网页端共用。
- `web/shared/preview-orientation.ts`：预览的前向箭头与标签，桌面端与网页端共用。
- `web/shared/demand-render.ts`：按需渲染的帧合并。
- `web/shared/viewport-appearance.ts`：主题背景与网格着色。
- `web/shared/format.ts`：`formatBytes`、`safeFilename`、`formatCount`。
- `web/shared/useDialogDismiss.ts`：Esc、背景点击与初始焦点。
- `web/styles/theme.css`：网页版直接复用本地工作台的配色变量，保持明暗主题一致。
- `web/styles/shared.css`：站点目录的共享卡片与响应式样式。

## 隐私

没有上传接口、没有账号、没有遥测。图片、模型、贴图和生成结果都在当前浏览器内处理。皮肤包保存在浏览器 IndexedDB 中，刷新后仍在；单个模型的预览和尚未加入皮肤包的结果只保留在内存里。
