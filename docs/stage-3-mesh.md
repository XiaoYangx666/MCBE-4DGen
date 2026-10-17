# 第 3A 阶段：网格清理与减面

> 运行方式已统一为 Bun；下文 Node 验证结果为该阶段的历史记录。
`src/mesh-optimizer.ts` 接受 IntermediateModel，克隆 Document 后处理，不修改导入结果。不是 GLB 压缩：实际修改三角形索引、再压紧顶点流。

支持 Original/High/Balanced/Performance（1/0.75/0.5/0.25），或显式 ratio、triangles，三者互斥。maxError 默认 0.001，为 Meshoptimizer 的相对误差预算（逐 Primitive 归一化；包含属性误差），不等同于世界单位或严格 Hausdorff 上界。返回每部件实际误差、目标/实际面数、清理数量和警告。

保护措施：

- 各 Primitive 独立焊接，仅合并所有属性逐位一致的顶点；不跨材质、骨骼权重或 UV 接缝焊接。
- LockBorder；UV/法线/顶点色参加误差计算；不启用 Permissive、Sloppy 或 Prune。
- 小于等于 12 面的拓扑连通部件锁定，跨不同 Skin influence 签名的三角形顶点锁定。平滑蒙皮可能因此基本不减面，这是保守限制。
- Morph 部件保留原网格并警告，尚未建模变形后的误差。
- 仅删除严格零面积/重复索引的退化面，不用容差清除小型有效结构；去掉未使用顶点，按现有拓扑补面积加权法线。
- 每个非空部件至少保留一面；达不到目标时保留更多面并明确警告。

## 实测（2026-10-18，Linux x64 / Node 24.19.0）

| CC0 模型 | 原面数 | 50% 目标 | 实际面数 | 减少 | 结果 |
| --- | ---: | ---: | ---: | ---: | --- |
| ToyCar | 108,936 | 54,468 | 54,466 | 50.0018% | 3 个部件的误差分别约 0.000305 / 0.000913 / 0.000456 |
| Avocado | 682 | 341 | 676 | 0.8798% | 受误差/细节约束，明确报告未达目标 |

设置 ratio=0.5、maxError=0.001。导出优化后的真实 GLB 并重新导入，断言读回面数与报告一致。另用实际三角形生成斜视/侧视几何预览，核对 ToyCar 原始/简化轮廓；预览不含 PBR、纹理或精确光栅化，不能代替最终外观和客户端验证。

```sh
bun run scripts/optimize-sample.ts ToyCar 0.5 0.001
bun run scripts/optimize-sample.ts Avocado 0.5 0.001
bun run scripts/preview-mesh.ts .cache/samples/ToyCar.glb .cache/samples/ToyCar-optimized.glb
bun test tests/mesh-optimizer.test.ts
```

5 项新增测试覆盖真实面数下降、UV 对应、输入不可变、严格误差下未达目标、Original、退化面、小结构/材质/骨骼隔离和错误参数。Bun 全量 19 项通过。

贴图图集、尺寸/全局变换烘焙、Static 绑定和 Minecraft 导出尚未完成；不把本阶段当作完整优化器或转换器。
