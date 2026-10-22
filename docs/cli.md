# 命令行与皮肤包管理

> 普通用户不需要阅读本文。直接下载 [Release](https://github.com/XiaoYangx666/MCBE-4DGen/releases)，或按 README 启动本地网页工作台即可。
>
> 本文面向批处理、自动化和需要直接管理皮肤包的用户。

## 命令行转换

```sh
# 生成并校验皮肤包
node src/cli.ts convert model.glb --out ./my-skin --name "My Skin"
node src/cli.ts validate ./my-skin

# 查看模型信息
node src/cli.ts inspect model.pmx

# 导出四视图预览
node src/cli.ts preview ./my-skin --out ./preview.png
```

常用参数：

| 参数 | 说明 |
| --- | --- |
| `--ratio 0.5` | 减面比例，默认保留原面数 |
| `--height 32` | 目标模型高度 |
| `--max-texture 256` | 单张贴图边长上限 |
| `--atlas 512` | 中间图集尺寸 |
| `--binding humanoid` | VRM 六部位人形绑定 |
| `--humanoid-profile profiles/humanoid.example.json` | 人形绑定调校配置 |
| `--no-zip` | 只输出目录，不生成 ZIP |

更完整的转换、校验、预览和客户端说明见 [完整工作流程](workflow.md)。

## 皮肤包管理

```sh
npm run packs status
node src/pack-cli.ts init --root 'D:/Minecraft/Content/data/skin_packs'
npm run packs enable custom my-skin
npm run workflow workflows/example.json
```

`workflows/example.json` 使用通用占位路径：模型默认指向 `workflows/model.glb`，管理配置指向 `skin-manager.example.json`。运行前请准备模型并修改 `model`、`output`、`libraryId` 等字段。

默认流程不写游戏目录；只有显式执行 `enable` 或给 workflow 加 `--deploy` 才会部署。完整命令和恢复流程见 [完整工作流程](workflow.md)。
