# 第 3B 阶段：贴图处理与显式图集

> 运行方式已统一为 Bun；下文 Node 验证结果为该阶段的历史记录。
`src/texture-optimizer.ts` 使用 Sharp 处理图片，并独立实施图集分配与 UV 重映射，不依赖 glTF Transform 自动生成 Minecraft 图集。`src/optimizer.ts` 将网格和贴图处理接成通用 ModelOptimizer；尚未处理 Minecraft 坐标或骨骼。

## 当前行为

- `maxTextureSize` 可省略（Original，不缩放），或设为 64/128/256/512/1024 及其它 1–8192 整数；按最长边缩小，不放大、保持比例。输出 PNG 包含透明通道。
- `filter` 为 nearest 或 lanczos3。`atlasSize` 是独立的最终正方形图集尺寸；省略时自动选择 8–8192 的二次幂。不在装不下时擅自继续降低贴图质量。
- 每个使用中的材质得到一个图集区域，包括无纹理材质的纯色区域。Best-short-side free rectangle 算法不旋转贴图；默认 2 像素留白。
- glTF 的基础色因子按线性 RGB 乘法烘焙，透明度按 OPAQUE/BLEND/MASK 语义处理。不会将 sRGB 字节直接乘颜色因子。
- 正确读取 UV 集、KHR_texture_transform 的 UV 集覆盖/平移/缩放/旋转。重复、镜像和 Clamp 采样烘焙成实际图像区域；跨多个 tile 的 UV 保持连续，不把每个顶点单独取模。
- 图集边缘按原 sampler 填充留白，防止基础过滤采到邻区。留白有有限宽度，不承诺任意 mipmap/minification 条件下都无串色。
- 最终各材质引用同一个图集并使用 TEXCOORD_0。原有 UV 属性不原地修改；输入 Document 不变，输出保留几何、节点和蒙皮。
- PBR 光照/法线/粗糙度/清漆/透射等效果不在图集中重现，逐材质警告后移除；只保留基础颜色及透明度。该降级会改变 ToyCar 等 PBR 材质的外观。

当前明确拒绝：缺少所需 UV、COLOR_0 顶点色烘焙（尚未实现）、超过 16×16 tile 的 UV 范围、损坏图片或图集容量不足。错误说明如何提高图集尺寸或降低源图片上限，不能静默丢贴图。首期不能宣称任意材质/模型都无损转换。

`atlasSize` 与 `maxTextureSize` 不同：例如 256 像素源纹理重复 3×3 后需要 768×768，再加留白；不是一个 256×256 区域。

## 真实样本结果

全部使用来源、许可证及校验和已锁定的 CC0 模型（见 stage-2.md）。先按 ratio=0.5/maxError=0.001 减面，再优化贴图，写出真实 GLB 并重新导入检查所有材质引用及面数。

| 模型 | 原 GLB | 原三角面 → 最终 | 源图片上限 | 最终图集 | 图集 PNG | 最终 GLB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| ToyCar | 5,422,412 B | 108,936 → 54,466 | 256 | 2048×2048 | 377,843 B | 2,167,044 B |
| Avocado | 8,110,040 B | 682 → 676 | 128 | 256×256 | 33,999 B | 见复现脚本输出 |

ToyCar 有 3 个材质区域：256² 车身、768² 的 3×3 布料重复区域、4² 纯色玻璃替代区域。原模型的 8 张纹理中包含 PBR 效果纹理，不把它们全部当成基础色拼接。1024² 容量测试明确失败，2048² 成功；没有丢弃布料重复采样。玻璃透射是已报告的未支持效果，替代区域不等价于原来的玻璃材质。

```sh
bun run scripts/atlas-sample.ts ToyCar 256 2048
bun run scripts/atlas-sample.ts Avocado 128 256
bun test tests/texture-optimizer.test.ts
```

中间产物位于忽略的 `.cache/samples/`：`*-atlas.glb`、`*-atlas.png`，不是 Minecraft 皮肤包。

## 验证

新增 7 项贴图测试覆盖：不同材质区域互不重叠、UV 对应实际像素、RGBA 及材质 alpha 因子、Nearest/Lanczos、原分辨率、容量错误、线性颜色因子、OPAQUE/MASK、KHR_texture_transform/备用 UV 集、重复/镜像/Clamp 留白和错误数据。另补充 glTF strip/fan 三角化与真实减面时相邻骨骼区域的边界保留测试。90° 纹理旋转的整数 tile 边界已加入浮点误差回归检查。

2026-10-18，Linux x64：strict 类型检查通过；Bun 共 28 项通过；Node 共 26 项通过。Avocado 的 Node/Bun 完整优化报告一致。看过实际生成图集；尚未完成纹理模型的三维渲染对照，也没有 Minecraft 实机验证。

## 尚未完成

模型指定高度/居中/旋转/平移及坐标变换烘焙、Static 绑定、旧版 poly_mesh、mcpack 与独立输出校验仍待下一步。不将当前 GLB 中间结果当成任务的最终 MVP。
