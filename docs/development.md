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
npm run desktop:package    # 打包 Windows 便携版到 release/
```

桌面版打包、目录结构和验证说明见 [桌面版使用与打包](desktop.md)。

## 仓库约定

不要提交模型、贴图、皮肤包、游戏目录配置、备份，以及以下目录中的内容：

- `4dgen-data/`
- `.cache/`
- `outputs/`
- `release/`
- `video/`

第三方模型和样本只放在本地忽略目录，不随仓库分发。
