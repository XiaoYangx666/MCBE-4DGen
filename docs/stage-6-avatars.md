# 第 6A 阶段：PMX / VRM 静态角色接入

本阶段接入常见角色文件的静态转换，保留原有单向流水线。不添加动画播放、MMD 物理、Unity 项目加载或 MC 肢体绑定，不引入新依赖。

## 能力范围

| 来源 | 当前行为 | 验证范围 |
| --- | --- | --- |
| PMX 2.0/2.1 | Assimp 读几何/骨骼；补回原材质名、双面标记、diffuse alpha 与 PNG alpha；冻结初始姿态 | UTF16LE/UTF8、1/2/4 字节索引、中文/Windows 路径、native/WASM 校准；真实 Gene_light PMX |
| VRM 0.x | glTF Transform 直接读；MToon 0 基础色、主贴图、混合/裁剪、支持的剔除降级 | 自制 GLB 夹具及真实 Sendagaya Shino；兼容未写 specVersion 的旧 VRM，以 0.x 标记 |
| VRM 1.0 | 直接读 glTF 基础材质和蒙皮；允许明确舍弃的 VRMC 运行时扩展 | 自制 GLB 夹具，含 required VRMC_vrm / VRMC_materials_mtoon；尚无真实 VRM 1.0 角色验证 |
| FBX | 沿用 Assimp 路径，新增简单带骨骼模型的 native/WASM、初始姿态与完整转换测试 | 自制单网格骨骼夹具；不是所有 Unity/FBX 导出器变体的兼容性证明 |
| PMD | 明确拒绝，提示先导出 PMX | Assimp 当前编译入口未开放 PMD，不能只加后缀冒充支持 |
| Unitypackage / Prefab / .asset / .bundle | 明确拒绝，提示从来源工具导出 FBX/VRM 与贴图 | 不解析 Unity 项目引用、贴图导入设置或 AssetBundle |

.gltf/.glb 内若带 VRM 根扩展，也进入相同的显式降级逻辑。不会把任意改名为 .vrm 的 GLB 作为 VRM 接受，必须存在可识别的 VRM 元数据。source.avatar 保留可读的版本、名称、作者和许可标识；这不是自动许可审核，也不把许可元数据等同于使用授权。

## PMX 元数据补全

pmx-metadata.ts 只扫描到材质表，几何与蒙皮仍由 Assimp 导入。逐步检查缓冲区边界、头版本、编码、索引宽度、顶点 skinning 布局、贴图字符串、面数与材质索引范围，不实现第二套 PMX 模型解析器。

Assimp 的 PMX 材质输出会遗漏双面 draw flag。导入器按经过校验的一一对应材质顺序补回该标记，映射数量不一致时明确失败。PMX 没有 glTF 的 OPAQUE 开关，因此以 BLEND 保留 PNG 与 diffuse alpha；最终纯不透明像素仍不受影响。原 diffuse alpha 直接取自材质表，避免依赖 Assimp 的不透明度转换约定。

PMX 的 Morph、IK、物理、描边、toon/sphere map、影子 draw flag 等不会完整保留；SDEF/QDEF 不承诺原始变形算法，当前仅使用转换后的线性权重冻结初始姿态。附加 UV 和复杂材质不承诺原样重现。所有转换都会给出静态降级警告。

## VRM 降级

VRM 的几何、基础蒙皮与初始 Morph 仍使用 glTF 原始数据。VRM 0 MToon 优先读取 _Color、_MainTex、_BlendMode、_Cutoff、_CullMode；VRM 1 使用其 glTF 基础材质回退。纹理优化继续将基础色与 alpha 烘焙到单图集。

只从 extensionsRequired 中去掉明确按静态语义舍弃的 VRM/VRMC 扩展；未知必需扩展继续报错。MToon 0 非单位主贴图变换、正面剔除等尚未实现的行为明确拒绝，不静默渲染错误。描边、toon 光照、rim/shade map、UV 动画、spring bones、node constraint、第一人称裁剪及 VRM 表情驱动没有模拟。

## 运行

```sh
bun run convert ./角色/模型.pmx --out ./pmx-pack
bun run convert ./avatar.vrm --out ./vrm-pack
bun run preview ./pmx-pack.mcpack --out ./pmx-preview.png --unlit
bun run scripts/fetch-avatar-sample.ts GeneLight
bun run scripts/fetch-avatar-sample.ts Shino
```

下载清单 scripts/avatar-samples.json 固定上游修订、每个文件大小及 SHA256，缓存存在时也复核，拒绝被改动的文件。样本和导出二进制不进入代码仓库。

## 真实样本、许可与结果

### Gene Light / PMX

来源：[mmdagent-ex/gene](https://github.com/mmdagent-ex/gene)，修订 c7eace43dffaccff6ad0597433ef85fa57c91e03，Gene_light.pmx 与 light/ 贴图。原始 47106 三角形、13 材质、224 骨骼，native/WASM 导入统计一致。

作者 README 标注 CC-BY 4.0，并单独保留商标/设计权、列出其使用条件；本次仅作开发验证，不重新分发模型或转换后的皮肤。模型不应被描述为无条件商用素材。作者指定署名：

CG-CA Gene (c) 2023 by Nagoya Institute of Technology, Moonshot R&D Goal 1 Avatar Symbiotic Society

### Sendagaya Shino / VRM 0.x

来源：[madjin/vrm-samples](https://github.com/madjin/vrm-samples)，修订 e16eb187100149a315ad92c3c9968f1d5baa6c7d，vroid/beta/sample.vrm。实际文件的 VRM meta 中 title 为 Sendagaya Shino，licenseName 为 CC0；不是依据仓库总许可推断所有模型均为 CC0。真实样本含31,211个三角形。

### 导出结果

使用 --max-texture 128 --atlas 2048，默认保留正面数：

| 模型 | 优化正面 | 补充反面 | 最终三角形 | geometry.json 字节 | PNG 字节 | mcpack 字节 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| GeneLight | 47106 | 2 | 47108 | 7963877 | 196932 | 2504758 |
| Shino | 31211 | 20895 | 52106 | 7868477 | 247282 | 2058391 |

两个样本均完成写出、目录/归档独立回读、四视图生成和目视检查。Gene 为源 A-pose，Shino 为源 T-pose；本阶段不会自动把手臂放下。仍然整体挂在 MC body 上，不会随 MC 四肢独立摆动。未进行 MC 实机验证；体积优化按既定顺序延后。

## 本地验证与参考

Bun 1.4.3：类型检查、全量 69 项测试通过。新增七项覆盖 PMX 编码/索引/路径/双面/透明/初始蒙皮、截断数据、VRM 0/1 元数据与材质降级、必需扩展、带骨骼 FBX，以及项目容器和 PMD 的错误说明。

实现行为参考/复核：

- [Assimp MMDImporter.cpp](https://github.com/assimp/assimp/blob/master/code/AssetLib/MMD/MMDImporter.cpp) 与 MMDPmxParser：观察上游材质/蒙皮行为，没有复制其网格实现。
- [oguna/MMDFormats](https://github.com/oguna/MMDFormats)：PMX 二进制布局参考；测试几何和二进制写入器由本项目独立编写。
- [VRM specification](https://github.com/vrm-c/vrm-specification) 和实际样本的 VRM 扩展字段：静态回退与未实现效果明确区分。
