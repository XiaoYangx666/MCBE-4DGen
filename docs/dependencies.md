# 依赖、版本与许可证

依赖版本以根目录 `package.json` 为准，`package-lock.json` 锁定实际安装版本。升级依赖后请同时更新本页的许可证说明，并运行 `npm run check`、`npm run test` 与网页版构建。

## 运行时依赖

| 依赖 | 用途 | 许可证 |
| --- | --- | --- |
| `@gltf-transform/core` / `extensions` / `functions` | GLB / glTF / VRM 读写、节点与材质处理 | MIT |
| `libassimp` | OBJ / FBX / DAE / STL / PLY / PMX 导入（Node 原生与浏览器 WASM） | Apache-2.0 |
| `sharp` | 桌面端图片解码、缩放、图集与 PNG 编码 | Apache-2.0 |
| `meshoptimizer` | 减面与网格简化 | MIT |
| `jszip` | 皮肤包与模型 ZIP 读写 | MIT OR GPL-3.0-or-later（本项目使用 MIT） |
| `gl-matrix` | 骨骼矩阵、法线变换与模型变换 | MIT |

## 构建与开发依赖

| 依赖 | 用途 | 许可证 |
| --- | --- | --- |
| `react` / `react-dom` | 工作台与网页版界面 | MIT |
| `three` | 三维预览 | MIT |
| `vite` | 前端构建与开发服务器 | MIT |
| `typescript` | 类型检查 | Apache-2.0 |
| `vitest` | 测试 | MIT |
| `electron` | 桌面运行时 | MIT |
| `@electron/packager` | Windows 便携版打包 | BSD-2-Clause |
| `wrangler` | 网页版部署 | MIT OR Apache-2.0 |

生产便携版只安装运行时依赖；`react`、`three`、`vite` 等仅用于构建，不进入安装包。

## 许可证范围

根包使用 GPL-3.0-only，但这不等于全部依赖的许可证。发布二进制或 WASM 时需要随附适用的许可证与 NOTICE：

- `libassimp` 的 NOTICE 包含 Assimp（BSD-3-Clause）、tinyusdz（MIT）、web-ifc（MPL-2.0）、CDT（MPL-2.0）等内嵌组件；MPL-2.0 组件还需满足源码提供义务。
- `sharp` 原生分发需保留其随附的第三方许可。
- Electron 与 Chromium 的许可证随打包产物中的 `LICENSE` / `LICENSES.chromium.html` 一并分发。

本项目只引用第三方格式行为作为研究参考，不复制其实现。完整发布许可清单仍应在每次发版前核对。
