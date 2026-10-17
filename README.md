# Minecraft Bedrock 4D/5D Skin Converter

通用模型 → 优化 → Static 刚性绑定 → Bedrock 1.8.0 poly_mesh → mcpack。

目前完成 **第 1 阶段：项目初始化与依赖可行性验证**。尚未实现 inspect/convert/validate，不宣称已有可用转换器或客户端穿戴支持。

## 运行验证

使用 Node 24.19.0 或 Bun 1.4.3。当前 Linux x64 测试通过，其它系统未验证。

```sh
bun install --frozen-lockfile
bun run check
bun test
node scripts/probe.ts
bun run probe
```

Node 可直接运行当前不含需编译语法的 TypeScript。Bun 用于安装锁定依赖与自动化测试，不将业务代码绑定到 Bun 专属 API。

## 阶段计划

| 阶段 | 交付 | 状态 |
| --- | --- | --- |
| 1 | strict TS、版本锁定、原生/WASM 依赖验证 | 完成 |
| 2 | OBJ/MTL/贴图、GLB、外部 glTF 导入及 inspect | 下一阶段 |
| 3 | 网格清理、误差受限减面、模型变换、贴图和显式图集 | 待实现 |
| 4 | Static 绑定、旧版 poly_mesh、完整 mcpack | 待实现 |
| 5 | 独立 validate、真实复杂模型演示、使用文档 | 待实现 |

每个阶段完成验证后独立提交。Humanoid、Web UI、其它输入格式留待后续。

## 架构决定

保留 Importer → IntermediateModel → ModelOptimizer → BoneMapper → BedrockExporter → SkinPackBuilder 单向流水线。统一中间数据优先采用 glTF Transform Document，另存来源、单位/坐标元数据与警告；不复制整个 glTF 标准。Minecraft 逻辑仅进入绑定和导出阶段。

GLB/glTF 直接由 glTF Transform 读取以保留节点、材质和蒙皮。OBJ 由 libassimp 转为 glTF，再统一进入 Document。Importer 必须维护外部资源映射，不能假设 Assimp 的 GLB 已嵌入纹理。此设计的多节点/蒙皮完整性将在阶段 2 用测试确认，不将当前三角形探针等同于完整格式支持。

依赖证据和已知限制见 [docs/dependencies.md](docs/dependencies.md)。
