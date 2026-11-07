# 开发与测试

## 环境

- Node.js 24+
- `npm ci` 安装依赖（使用仓库中的 `package-lock.json`）

## 检查与测试

```sh
npm run check
npm run check:web
npm run test
```

提交前请确保以上命令通过。

## 桌面版

```sh
npm run desktop            # Electron 开发模式
node scripts/desktop/package-desktop.ts --out <release-dir>   # 打包 Windows 便携版
```

不传 `--out` 时输出到仓库内 `release/`；发版产物统一放在安装脚本默认使用的 `<release-dir>`，避免仓库目录的写入和完整性限制影响启动。

桌面版打包、目录结构和验证说明见 [桌面版使用与打包](desktop.md)。在受限会话（`%APPDATA%` 不可写、Chromium 沙箱无法初始化）中启动开发版需要额外设置两个环境变量，见 [受限会话下的开发启动](desktop.md#受限会话下的开发启动)。

### Windows 安装包

```sh
node scripts/desktop/package-desktop.ts --out <release-dir>
node scripts/desktop/package-installer.ts --build <release-dir>\4DGen-win32-x64 --out <release-dir>
```

`package-installer.ts` 需要 Inno Setup 6：把 `ISCC.exe` 加入 PATH，或设置 `ISCC` 环境变量指向它。输出为 `<release-dir>\4DGen-<版本号>-setup.exe`。

安装包按当前用户安装到 `%LOCALAPPDATA%\Programs\4DGen`，不需要管理员权限，并包含卸载程序。

## 发版流程

1. 更新版本号：根目录 `package.json` 与 `package-lock.json`、`installer/4DGen.iss`（`MyAppVersion`、`VersionInfoVersion`）、`web/shared/build-log.ts` 的最新条目。
2. 运行 `npm run check`、`npm run test`、`npm run webapp:build`。
3. 按上一节的命令生成便携版和安装包，输出到 `<release-dir>`；便携版 ZIP 从 `4DGen-win32-x64` 目录内容打包，ZIP 根目录直接是 `4DGen.exe`。
4. 生成 SHA256 校验文件，在 GitHub Releases 上传安装包、便携版 ZIP 与校验文件，标签格式为 `v<版本号>`。
5. 推送 `main` 后确认 Cloudflare Workers 自动部署网页版成功。

## 仓库约定

不要提交模型、贴图、皮肤包、游戏目录配置、备份，以及以下目录中的内容：

- `4dgen-data/`
- `.cache/`
- `outputs/`
- `release/`
- `video/`

第三方模型和样本只放在本地忽略目录，不随仓库分发。
