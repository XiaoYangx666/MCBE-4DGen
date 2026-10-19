# 文档索引

日常操作从「使用与流程」开始；阶段文档是实现历史记录，不是当前接口说明。

## 使用与流程

- [完整工作流程](workflow.md)：转换、校验、预览、皮肤包入库、备份与恢复。
- [本地网页工作台](local-web.md)：`bun run dev`（Node 服务端）、材质筛选、姿势预览、减面与图集参数。
- [样本 A与样本 B PMX 转换记录](pmx-model-tests.md)：实际模型、profile、产物与已知问题。
- [Windows 客户端验收记录](windows-client-test.md)：Shino、贴图尺寸与绑定结果。

## 当前问题与规划

- [交接说明](HANDOFF.md)：当前状态、样本 B色块问题证据链、下一步优先级。
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
