# 第 4B 阶段：单模型皮肤包导出

目标只解决正确生成并关联格式文件；暂不处理面数、JSON 字节数和 Humanoid 动画。

## 输出结构

对照第三方 5D 皮肤参考包，单模型采用如下根目录：

- manifest.json（format_version: 2，随机 header/module UUID，module.type: skin_pack）
- skins.json（skin0 → geometry.skin0 → skin0.png；hide_armor: true，type: free）
- geometry.json（format_version: 1.8.0，geometry.skin0，真实索引 poly_mesh）
- skin0.png（优化阶段生成的 PNG 图集）

还可把上述四个文件按原样打包为 .mcpack（ZIP/Deflate）。参考样本包含 108 个 skin；当前阶段只构建一个，不复制其几何或纹理内容。

## CLI

    npm ci
    node src/cli.ts convert ./model.glb --out ./output --name "Custom Skin"
    node src/cli.ts validate ./output
    node src/cli.ts validate ./output.mcpack

也可用 node src/cli.ts convert model.glb --out ./output；--no-mcpack 可仅输出目录文件。

默认行为：冻结初始姿态，保留原三角面（只清理非法退化面），按模型高度 32 落地居中，单图最大 256 像素，自动图集，整个几何体刚性挂在 body。可用 --ratio 0.5 开启有误差约束的减面，--height、--max-texture、--atlas 调整常用参数。仍会对不支持的材质、变形或缺失资源报错，不静默生成有损内容。

## 验证层级

独立包级验证会：读取真实目录或 ZIP；拒绝非根目录、越界或多余文件名；严格解析 JSON；校验 manifest UUID、module、version；校验 skins 映射与 geometry ID；对几何执行已存在的索引/法线/UV/骨骼验证；用 Sharp 读取实际 PNG 并校验几何贴图尺寸；对 ZIP 启用 CRC32 校验。convert 完成时会对写入磁盘的目录和 mcpack 分别复验。

这只证明文件内部结构和跨文件关联一致；是否能穿戴，仍需指定客户端/加载器实测。官方原版对于 poly_mesh 的支持不能由 schema 校验推出。

## 明确延后

- 体积预算及自动迭代减面、JSON 精度/索引压缩
- Humanoid 动画/多骨骼拆分和 Web UI
- 一次导入多个独立皮肤
- Minecraft/第三方加载器实际渲染、穿戴与版本兼容性验证
