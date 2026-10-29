# 4DGen 桌面版

桌面版复用本地网页工作台，由 Electron 提供窗口、原生目录选择、系统菜单和私有后台服务。运行时使用 Electron 自带的 Node，不要求另装 Node.js。

## 开发运行

```powershell
npm install
# 首次安装后若 Electron 运行时未安装：
node node_modules/electron/install.js
npm run desktop
```

默认窗口为 1280 × 820，按屏幕工作区缩小。设置 → 外观支持浅色、深色与跟随系统，选择保存在桌面配置中，重启后沿用。

桌面窗口采用统一的自定义顶栏，集成导航、应用菜单和窗口控制，支持拖动、双击最大化与还原。窗口和面板使用圆角；最大化时切换为直角以贴合屏幕。

Electron 自动启动私有本地转换服务并打开工作台，退出应用时关闭对应服务。后台端口自动分配，不占用网页模式的 4173。目录选择使用 Electron 原生对话框；数据迁移设置保存后可点击“重启应用”。

应用菜单「关于 4DGen」和设置页的「关于 4DGen」都会打开同一个弹窗，显示版本、Electron/Node/Chromium 版本和数据目录。

首次在源码目录启动桌面版时，将当前数据目录与游戏配置登记到 `%APPDATA%/4DGen/`，沿用现有模型和皮肤，不复制或删除数据。开发版与便携版使用同一桌面配置。桌面日志为 `%APPDATA%/4DGen/desktop.log`。没有现有项目配置的首次便携版运行，默认数据目录为 `%APPDATA%/4DGen/data`。

## Windows 便携版

```powershell
npm run desktop:package
```

默认输出 `release/4DGen-win32-x64/4DGen.exe`。分发整个目录，不能仅复制 exe。包含 Electron 与生产转换依赖，后台服务使用 Electron 自带 Node 运行。构建时预编译网页，启动时直接读取，包内不包含个人模型、皮肤包、备份或本地目录配置。

需要输出到其它位置时使用 `--out` 或 `FOURDGEN_RELEASE_DIR`（相对仓库根目录或绝对路径）：

```powershell
node scripts/desktop/package-desktop.ts --out C:\path\to\4DGen-portable
# 或
$env:FOURDGEN_RELEASE_DIR = 'C:\path\to\4DGen-portable'
npm run desktop:package
node scripts/checks/check-desktop.ts C:\path\to\4DGen-portable\4DGen-win32-x64\4DGen.exe
```

### 工作区完整性限制

如果仓库所在目录被宿主标记为 Low 完整性（`icacls` 显示 `Mandatory Label\Low Mandatory Level`），从仓库内启动的 exe 也会以 Low 完整性运行，无法写入 `%APPDATA%`，表现为双击后没有窗口、也没有日志。此时把便携版输出到普通目录即可：

```powershell
node scripts/desktop/package-desktop.ts --out C:\path\to\4DGen-portable
```

这不会影响普通机器上的默认 `release/` 输出。

### 受限会话下的开发启动

受限会话里有两个独立的失败点，通常需要同时处理，否则表现为“命令秒退、没有窗口”：

1. **配置目录不可写**：`%APPDATA%` 或其它非工作区目录被拒绝写入时，Electron 创建 Chromium 单实例锁失败，日志出现 `Lock file can not be created: 拒绝访问 (0x5)`；`requestSingleInstanceLock()` 返回 false 后应用直接 `app.quit()`。
2. **Chromium 沙箱无法初始化**：进程以 `0x80000003`（STATUS_BREAKPOINT）退出且没有任何输出。用 `node_modules/electron/dist/electron.exe --version` 可以复现，加 `--no-sandbox` 后正常输出版本号。

把桌面配置放到仓库内可写目录，并仅对受限开发会话关闭 Chromium 沙箱：

```powershell
$env:FOURDGEN_DESKTOP_USER_DATA = "$PWD\.cache\desktop-profile"
$env:FOURDGEN_DESKTOP_NO_SANDBOX = '1'
npm run desktop
```

`FOURDGEN_DESKTOP_NO_SANDBOX` 只用于本地受限环境或 CI，正常分发和日常桌面使用不要设置。`FOURDGEN_DESKTOP_USER_DATA` 只改变桌面配置与 Chromium profile 的位置，模型、皮肤包和游戏目录仍由 `storage.local.json`、`skin-manager.local.json` 决定。这两个变量只影响 `npm run desktop`；直接调用 `electron.exe` 时需自行传 `--no-sandbox` 与 `--user-data-dir`。在普通桌面会话中直接 `npm run desktop` 即可，不需要任何额外参数。

### 体积与裁剪

打包时只安装生产依赖；`react`、`react-dom`、`three`、`vite` 等仅用于构建前端，不再进入便携版。Vite 在服务端改为按需动态导入，桌面模式跳过网页构建。打包完成后还会：

- 只保留 `en-US`、`zh-CN`、`zh-TW` 三个 Electron locale；
- 清理 `node_modules` 中的 `@types`、`.bin`、文档、类型声明和 source map；
- 删除运行时不用的 `package-lock.json`。

当前构建约 **373.0 MB**，ZIP 约 **157.6 MB**（2026-10-28，Windows x64）。实际大小随依赖版本变化。

## 检查

```powershell
npm run test:desktop
# 已打包的便携版（按实际输出位置替换）：
node scripts/checks/check-desktop.ts C:\path\to\4DGen-portable\4DGen-win32-x64\4DGen.exe
```

检查使用独立临时数据和配置，验证原生桥接、自定义顶栏、最大化与还原、带纹理模型预览、转换与 ZIP 下载、渲染进程隔离、后台认证与退出清理。`npm run dev` 仍可启动浏览器版；浏览器模式可输入目录路径，系统选择按钮仅在桌面版可用。

## Windows 验证记录

- 2026-10-29：在受限自动化会话中用 `FOURDGEN_DESKTOP_USER_DATA=$PWD\.cache\4dgen-desktop` + `FOURDGEN_DESKTOP_NO_SANDBOX=1` 成功启动开发版窗口；同一会话中直接 `npm run desktop` 会因单实例锁写入失败和沙箱初始化崩溃（`0x80000003`）退出，确认这两个变量缺一不可。
- 2026-10-28：v0.2.0 便携版（373.0 MB）与安装包构建成功，版本号与网页资源已写入产物；本次自动化会话无法启动 Electron 图形进程（退出码 0x80000003），未重跑完整冒烟检查，发布前请在普通桌面会话运行 `npm run test:desktop`。
- 2026-10-19：开发版冒烟检查通过；便携版打包后通过完整冒烟检查；不带测试参数直接启动时后台服务正常就绪，窗口保持运行。
- 仓库所在目录被标记为 Low 完整性时，仓库内 `release/` 的构建可能因无法写 `%APPDATA%` 而静默退出。此时使用 `--out` 输出到普通目录即可。
- 便携版未做代码签名，首次运行可能出现 Windows SmartScreen 提示。分发时请说明来源，不要通过关闭系统防护来绕过。
