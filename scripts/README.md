# 脚本目录

日常只需要 `bun run` 里的 npm script；下表是直接运行脚本时的入口。

## 常用入口

| 文件 | 用途 |
| --- | --- |
| `workflow.ts` | 读取 `workflows/*.json` 执行转换、校验、预览并入库；显式 `--deploy` 才写游戏目录。 |
| `reduce-avatar.ts` | PMX/GLB 人形减面并生成新版本目录，拒绝覆盖已有产物。 |
| `check-web.ts` | 对已启动的本地工作台执行真实 HTTP 冒烟检查（页面、跨源拒绝、上传、转换、皮肤包管理）。 |
| `probe.ts` | 依赖后端探测（Assimp native/WASM 等）。 |
| `client-test.py` | Windows 客户端 UI 自动化与备份/恢复入口；游戏由测试者操作时不要运行。 |

## samples/

CC0 免费样本的复现链路：`fetch-sample.ts` 下载并校验 SHA256，`check-sample.ts` 导入检查，`prepare-sample.ts` 变换/定高，`optimize-sample.ts` 减面，`atlas-sample.ts` 图集，`export-sample.ts` 导出 Bedrock 几何，`preview-mesh.ts` 生成四视图诊断图。`sample.ts` 是样本清单模块，`avatar-samples.json` 是角色样本清单，`fetch-avatar-sample.ts` 下载角色样本。二进制只写入忽略的 `.cache/`。

## diagnostics/

一次性调查脚本，不是稳定接口：`inspect-reference.ts`（皮肤包几何对照）、`inspect-pmx-components.ts`（PMX 材质/连通部分统计）、`inspect-avatar-binding.ts` 与 `preview-binding.ts`（绑定归属检查与预览）。

两个与转换耗时有关的脚本可重复使用：

- `bench-convert.ts`：复现工作台冷启动链路（导入 → 人形导出 → 打包），逐阶段计时并输出中位数。`--model sample-b|sample-a`、`--runs N`、`--no-cache`（走真实 PMX/Assimp 导入）。只读取缓存模型，不安装皮肤包。
- `fingerprint-convert.ts`：对同一输入保存几何 JSON、`skin0.png`、骨骼枢轴、部位面数与包内确定性文件（`manifest.json` 含随机 UUID，不参与比较）的 SHA256，用于证明性能改动没有改变输出。前后对比时把两次结果存到不同 `--out` 再比较字段。

## experiments/

历史实验（客户端控制、早期元数据试验），保留作证据，不再作为日常入口。

## 说明

`outputs/`、`.cache/`、`.skin-pack-manager/` 均被 Git 忽略：前两者是诊断与构建产物，最后一个是皮肤包管理器的持久备份，不能当缓存清理。
