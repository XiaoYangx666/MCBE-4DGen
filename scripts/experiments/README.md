# 本次客户端试验脚本归档

此目录保留历次 UUID、贴图尺寸、归属与姿势试验的复现证据，含固定的本地环境路径和备份时间戳。不要将它们作为日常部署入口。

日常流程使用仓库根目录的 `bun run workflow`、`bun run packs` 与 [使用文档](../../docs/workflow.md)。

旧 `scripts/client/client-test.py` 保留在新客户端目录，兼容已有收据的恢复命令。新管理器已接入本次原始空包备份；迁移之后优先用 `packs restore`，混用旧部署脚本会被新管理器识别为外部修改。
