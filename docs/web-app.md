# 网页版（纯浏览器）

`webapp/` 是一个独立的静态单页应用，用来在浏览器里直接生成 4D 皮肤。它不需要 Node 服务端，也不包含桌面版的皮肤包管理、游戏目录写入和模型库。

## 启动与构建

```powershell
npm run webapp:dev      # http://127.0.0.1:4174
npm run webapp:build    # 输出到 webapp/dist/
npm run webapp:preview  # 预览构建产物
npm run check:webapp    # 只检查网页版
```

开发服务器和预览服务器都监听 `0.0.0.0`，Vite 会同时打印一个 `Network` 地址。手机和电脑连同一个 Wi-Fi 后，直接打开这个地址即可，例如 `http://192.168.1.20:4174`。如果手机打不开，检查 Windows 防火墙是否允许 Node.js 的入站连接。

`webapp/dist/` 可以部署到任意静态托管（Cloudflare Pages、GitHub Pages、Netlify、对象存储等）。构建使用相对路径，放在子目录也能打开。网页版没有 API 请求，不需要配置后端。

## 功能

### 图片皮肤

- 支持 PNG、JPEG、WebP、GIF、BMP、SVG、AVIF（取决于浏览器解码能力），单张最大 40 MB。
- 图片按比例放进 128 × 128 贴图，居中、保留透明背景。
- 平面高度默认 32，约为玩家身高；宽度按图片比例计算。
- 导出包含 `manifest.json`、`skins.json`、`geometry.json`、`skin0.png` 和语言文件的 `.mcpack`。

### 3D 模型

| 格式 | 加载方式 | 状态 |
| --- | --- | --- |
| GLB / glTF | `GLTFLoader` | 推荐，支持 Meshopt 压缩 |
| VRM 0.x / 1.0 | `GLTFLoader` | 读取基础网格，忽略 VRM 骨骼与表情扩展 |
| OBJ | `OBJLoader` + `MTLLoader` | 推荐同时选中 `.mtl` 和贴图 |
| FBX / DAE / STL / PLY | three.js 加载器 | 实验支持 |

转换流程：

1. 在浏览器里解析模型和贴图。
2. 把所有材质的贴图按表面积预算拼进一张 128 × 128 图集。
3. 应用世界变换、居中、落地、缩放到指定高度，并镜像到 Bedrock 坐标系。
4. 生成单骨骼 `body` 的 `poly_mesh`，按需补充背面三角面。
5. 用共享的 `src/skin-pack-files.ts` 打包，导出 `.mcpack`。

背面渲染有三种策略：

- **跟随材质**：源材质为双面时补充背面，默认。
- **全部双面**：所有三角面都补背面，面数约翻倍。
- **仅正面**：最省面，但背面不可见。

## 移动端

- 宽度小于 860 px 时，设置区与结果区改为单列，页面正常滚动；桌面端仍是固定高度的双栏工作台。
- 输入框在移动端使用 16 px 字号，避免 iOS Safari 聚焦时自动放大；主要按钮和文件选择区的最小高度按触控目标调整。
- 生成或转换完成后，移动端会自动滚动到结果卡片，不需要手动往下找。
- 三维预览使用 `touch-action: none`，支持单指旋转、双指缩放/平移。
- 高 DPI 屏幕上 canvas 的 CSS 尺寸与绘制缓冲区分开处理，避免手机只显示左上角一块。
- 手机下载 `.mcpack` 时优先调用系统分享/保存面板（Web Share API），可存到“文件”或直接发送；不支持时回退为普通下载。Web Share 通常需要 HTTPS，局域网 HTTP 调试时可能只走下载回退。
- WebGL 不可用时，预览区会显示提示，但转换和 `.mcpack` 下载仍然可用。
- 建议 iOS 16.4+ / 最新 Android Chrome。手机内存有限，建议先处理 50 MB 以下、5 万面以内的模型；超大模型可能卡住页面。

## 复用边界

网页版没有复制一整套桌面转换代码，而是复用兼容层，保留各自擅长的运行环境。

已复用：

- `src/skin-pack-files.ts`：`manifest.json`、`skins.json`、语言文件与皮肤包身份，桌面版和网页版导出完全同源。
- `src/geometry-validator.ts`、`src/bedrock-types.ts`：导出前后的 Bedrock 几何结构校验和类型。
- `src/image-skin-geometry.ts`：图片平面皮肤的几何由桌面 sharp 路径和浏览器 Canvas 路径共用。
- `web/styles/theme.css`：明暗主题、调色板与 CSS 变量。
- 测试中的校验器：网页版导出的 `.mcpack` 会用桌面版同一套 `validateSkinPackPath` 检查。

没有直接共用：

- 模型导入与导出。桌面版基于 `glTF-transform`、`sharp`、`libassimp`；浏览器版基于 three.js 加载器和 Canvas。强行抽象会把 Node 依赖带进浏览器。
- 图集规划。桌面版有 UV 连通分岛、材质权重和逐岛重采样；网页版使用适合 128×128 的轻量 shelf packing。
- 布局 CSS。桌面工作台是固定 `100dvh`、三栏、密集表单；网页版需要单列滚动和触控尺寸，只共用设计变量与视觉规范。
- `bedrock-exporter.ts`。桌面版按 glTF primitive/骨骼流导出，网页版按三角面汤导出；两者共享输出格式、坐标约定和同一个校验器。以后如果两端都要改 poly_mesh 细节，可以再抽出纯写入器。

## 与桌面版的差异

| 能力 | 网页版 | 桌面版 / 本地工作台 |
| --- | --- | --- |
| 图片平面皮肤 | 支持 | 支持 |
| GLB / glTF / VRM / OBJ | 支持 | 支持 |
| PMX / PMD / Assimp 全格式 | 不支持 | 支持 |
| 人形六部位绑定 | 不支持，静态整体绑定 | 支持 |
| 骨骼动画 / 表情 / 姿势 | 不评估，使用绑定姿势 | 支持姿势与形态键冻结 |
| 减面与材质权重 | 不支持 | 支持 |
| 皮肤包管理、写入游戏 | 不支持 | 支持 |
| 文件处理位置 | 浏览器内存 | 本机 Node 服务 |

## 已知限制

- 贴图固定 128 × 128。这是目前基岩版客户端验证过的 poly_mesh 皮肤尺寸。
- 模型按静态整体绑定导出，不随骨骼独立运动；动画、形态键和当前姿势不会保留。
- UV 超出 0–1 的材质会按裁切后的范围导出，可能出现接缝。
- 顶点色会被忽略，只保留材质基础色与贴图。
- Draco、KTX2/Basis 压缩暂不支持；请先用普通 glTF/GLB 或 PNG/JPEG 贴图。
- 多材质模型会共享 128 × 128 图集，材质越多，单个材质的有效分辨率越低。
- 输出超过约 52,106 个三角面时会提示在实际客户端确认；这是已验证样本的参考值，不是客户端硬上限。
- 转换在主线程完成。很大的模型可能短暂卡住页面，后续可以移到 Web Worker。
- 预览需要 WebGL；转换本身只依赖 Canvas 2D。

## 代码结构

```text
webapp/
  App.tsx                 页面骨架、模式切换、主题
  components/
    ImageStudio.tsx       图片模式
    ModelStudio.tsx       模型模式
    Viewport.tsx          three.js 预览与轨道控制
    DropZone.tsx          文件选择 / 拖放
  lib/
    import-model.ts       GLTF/OBJ/FBX/DAE/STL/PLY 加载
    extract.ts            世界变换、材质分组、UV 归一化
    atlas.ts              128 图集规划、绘制与 UV 重映射
    bedrock.ts            poly_mesh 导出
    convert.ts            图集 → 几何 → .mcpack 流程
    image-skin.ts         图片平面皮肤
    output-preview.ts     从导出的 geometry.json 构建预览
    skin-pack.ts          通过共享构建器打包
    theme.ts              明暗主题
```

共享模块：

- `src/skin-pack-files.ts`：无 Node 依赖的皮肤包构建器，桌面版与网页版共用。
- `src/image-skin-geometry.ts`：图片平面皮肤的共享几何。
- `src/geometry-validator.ts`：导出前后的 Bedrock 几何结构校验。
- `web/styles/theme.css`：网页版直接复用本地工作台的配色变量，保持明暗主题一致。

## 隐私

没有上传接口、没有账号、没有遥测。图片、模型、贴图和生成结果都只在当前浏览器的内存里处理；刷新或关闭页面后不会保留。
