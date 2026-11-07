# 客户端试验脚本归档

此目录保留历次 UUID、贴图尺寸、归属与姿势试验的复现脚本，供历史对照。不要把它们作为日常部署入口。运行前需设置环境变量 `SKIN_PACKS_ROOT` 指向本机 Minecraft 的 `skin_packs` 目录。

日常流程使用仓库根目录的 `npm run workflow`、`npm run packs` 与 [使用文档](../../docs/workflow.md)。

`scripts/client/client-test.py` 是旧版部署工具，仅用于复现早期试验。新管理器接管后，混用旧部署脚本会被识别为外部修改；日常操作请使用 `npm run packs`。
