# 4DGen 桌面版

```powershell
bun install
# 首次安装后若 Electron 运行时未安装：
node node_modules/electron/install.js
bun run desktop
```

默认窗口为 1280 × 820，按屏幕工作区缩小。设置 → 外观支持浅色、深色与跟随系统，选择保存在桌面配置中，重启后沿用。

桌面窗口采用统一的自定义顶栏，集成导航、应用菜单和窗口控制，支持拖动、双击最大化与还原。窗口和面板使用圆角；最大化时切换为直角以贴合屏幕。

Electron 自动启动私有本地转换服务并打开工作台，退出应用时关闭对应服务。后台端口自动分配，不占用网页模式的 4173。目录选择使用 Electron 原生对话框；数据迁移设置保存后可点击“重启应用”。

首次在源码目录启动桌面版时，将当前数据目录与游戏配置登记到 `%APPDATA%/4DGen/`，沿用现有模型和皮肤，不复制或删除数据。开发版与便携版使用同一桌面配置。桌面日志为 `%APPDATA%/4DGen/desktop.log`。没有现有项目配置的首次便携版运行，默认数据目录为 `%APPDATA%/4DGen/data`。

## Windows 便携版

```powershell
bun run desktop:package
```

输出 `release/4DGen-win32-x64/4DGen.exe`。分发整个目录，不能仅复制 exe。包含 Electron 与生产转换依赖，后台服务使用 Electron 自带 Node 运行，运行时不需要另装 Bun 或 Node.js。构建时预编译网页，启动时直接读取，包内不包含个人模型、皮肤包、备份或本地环境目录配置。

```powershell
bun run test:desktop
node scripts/check-desktop.ts release/4DGen-win32-x64/4DGen.exe
```

检查使用独立临时数据和配置，验证原生桥接、自定义顶栏、最大化与还原、带纹理模型预览、转换与 ZIP 下载、渲染进程隔离、后台认证与退出清理。后台服务使用 Electron 自带 Node 运行，不再打包 Bun。`bun run dev` 仍可启动浏览器版；浏览器模式可输入目录路径，系统选择按钮仅在桌面版可用。

当前环境的独立便携版尚未通过启动验收：复制到 release 目录的 Electron 运行时曾被系统防护拒绝文件写入并返回 EPERM。相同运行时在原开发依赖路径可正常工作；请使用已通过检查的 `bun run desktop`。未修改系统防护策略。
