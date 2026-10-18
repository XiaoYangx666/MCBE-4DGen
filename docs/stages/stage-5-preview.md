# 第 5B-1 阶段：实际导出结果的离线预览

目标：通过导出的 geometry.json 和 PNG 检查方向、UV、透明和面朝向，不重新读取源模型，避免只看见导入模型正确却漏掉导出错误。

## 结构

- geometry-preview.ts：独立几何校验/解码 → CPU 正交光栅化 → 四视图 PNG。
- preview.ts：读取已写出的目录、mcpack，或独立几何与 PNG；按 skins.json 解析几何和贴图引用。
- CLI preview：输出文件独占写入，stdout 返回尺寸、几何 ID、三角面数和限制说明。

不增加依赖，不改动导出结果，不需要浏览器、网络、GPU 或 CI。沿用 Sharp 写 PNG，新增代码只依赖输出数据与独立校验器，不调用 Importer、Optimizer 或 Exporter。

## 用法

```sh
bun run preview ./pack --out ./preview.png
bun run preview ./pack.mcpack --out ./archive-preview.png --unlit
bun run preview ./geometry.json --texture ./skin0.png --out ./geometry-preview.png
bun run preview ./pack --out ./large-preview.png --size 512 --no-cull
```

| 选项 | 含义 |
| --- | --- |
| --out | 输出 PNG；默认输入名称加 -preview.png；拒绝覆盖已有文件 |
| --texture | 独立 JSON 输入必填；皮肤包从 skins.json 解析贴图 |
| --geometry | 多几何输入显式选择标识符；同几何的多个皮肤变体尚不支持 |
| --size | 每个视图边长，64–1024 整数，默认 384 |
| --unlit | 不加诊断光照，显示 PNG 原始颜色 |
| --no-cull | 关闭背面剔除，便于排查反向面 |

默认最终图片为 768×816，包含四个 384×384 视口及各 24 像素标题栏。轴向直接使用导出的 Bedrock 坐标，不把 +Z/-Z 擅自称作角色正面/背面。每个视图按模型包围盒对角线统一缩放。

## 渲染约定与限制

- 独立解引用位置、法线、UV 三套索引，真四边形拆三角形；不把 pivot 当作几何平移。
- Bedrock 镜像后的多边形在屏幕投影中正面积为正面，默认剔除背面。法线只参与光照，不用于代替绕序判定。
- normalized_uvs=false 时按几何纹理尺寸换算；底部原点 V 转换为 PNG 顶部原点，使用最近邻与边缘钳制采样。
- 不透明片元先逐像素深度测试；透明三角形按平均深度从远到近混合，不写不透明深度缓冲。完全透明像素不遮挡。共享边使用 top-left 归属，防止四边形对角线重复混合。
- 背景为棋盘格，便于识别透明区域；简单诊断光照可关闭。没有 PBR、Minecraft 动画、角色姿势或原版光照模拟。
- 当前支持 Static 导出的骨骼。非零初始 bone.rotation 明确拒绝，避免静默显示错误姿态；不支持 Cube 或历史 tri_list/quad_list。
- 相交透明面、透明闭合体、关闭剔除后的重叠正反面可能与客户端不同；该图不能证明客户端加载/穿戴兼容性。

## 验证

Bun 1.4.3：类型检查通过；全量 62 项测试通过。新增四项验证：

1. 自制四色贴图与独立索引四边形：四象限像素精确匹配、+Z/-Z 镜像与剔除、非零 pivot 不平移顶点。
2. 前后重叠面：半透明红色与不透明蓝色精确混合，共享对角线不重复混合，前后深度交换后正确遮挡。
3. 像素 UV、错误贴图尺寸、无效几何 ID、非零初始旋转和非法尺寸处理。
4. 无源模型的目录、mcpack、独立 JSON/PNG 渲染一致，CLI 输出与拒绝覆盖、缺失 PNG 报错。

额外以实际输出的 Avocado（682 三角形）目录和 ToyCar（67790 三角形）mcpack 生成四视图并目视检查。它们分别展示真实贴图、模型不同方向与复杂网格；样本许可证与来源见 stage-2.md，预览图与二进制留在忽略的缓存中，不加入代码仓库。
