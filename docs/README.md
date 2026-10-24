# 文档索引

日常操作从「使用与流程」开始；阶段文档是实现历史记录，不是当前接口说明。部分阶段文档的验证环境为 Bun 1.4.3，当前统一使用 Node 24+ 与 npm。

## 使用与流程

- [完整工作流程](workflow.md)：转换、校验、预览、皮肤包入库、备份与恢复。
- [本地网页工作台](local-web.md)：`npm run dev`（Node 服务端）、材质筛选、姿势预览、减面与图集参数。
- [网页版（纯浏览器）](web-app.md)：`npm run webapp:dev`、图片皮肤、模型转换、静态部署与浏览器端限制。
- [桌面版使用与打包](desktop.md)：Electron 开发版、Windows 便携版、启动检查与验证限制。
- [命令行与皮肤包管理](cli.md)：批量转换、参数、启停与恢复命令（普通用户可跳过）。
- [PMX 转换记录](pmx-model-tests.md)：两个 PMX 样本的 profile、产物、减面与图集实验。
- [Windows 客户端测试记录](windows-client-test.md)：贴图尺寸、人形绑定与仍未验证的显示问题。

## 当前问题与规划

- [静态表情与图集预算调查](investigation-static-expressions.md)：表情遮挡审计、面积预算对照。
- [自动化路线图](automation-roadmap.md)：只写规划，不接入主流程。

## 阶段记录（按实现顺序）

- [第 2 阶段：导入与检查](stages/stage-2.md)
- [第 3 阶段：网格清理与减面](stages/stage-3-mesh.md)
- [第 3 阶段：贴图与图集](stages/stage-3-textures.md)
- [第 3 阶段：变换与姿态冻结](stages/stage-3-preparation.md)
- [第 4A 阶段：静态几何](stages/stage-4-geometry.md)
- [第 4B 阶段：皮肤包](stages/stage-4-pack.md)
- [第 5A 阶段：更多格式](stages/stage-5-formats.md)
- [第 5B 阶段：导出预览](stages/stage-5-preview.md)
- [第 6 阶段：VRM/PMX 角色](stages/stage-6-avatars.md)

## 参考

- [代码结构](code-structure.md)：入口、转换核心、服务端路由与前端模块职责。
- [依赖、版本与许可证](dependencies.md)
- [Minecraft 原版皮肤与角色创建器研究](skin-state.md)

## 参与与许可

- [开发与测试](development.md)：环境、检查命令、桌面版打包与仓库约定
- [GPL-3.0 许可证](../LICENSE)
