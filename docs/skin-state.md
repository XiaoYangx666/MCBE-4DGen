# Minecraft 原版皮肤与角色创建器研究

> 范围：Windows 版 Minecraft Bedrock（GDK，`%APPDATA%\Minecraft Bedrock`）。
> 目标：理解原版皮肤、角色创建器（persona）档案与 Xbox 云同步的存储方式，并据此确定 4DGen 的安全边界。

## 结论摘要

- 原版皮肤分两类：
  - **经典皮肤 / 皮肤包**：`skin_packs/<pack>/skins.json` + PNG，`game_skintypefull` 指向它。
  - **角色创建器（persona）**：档案保存在 `ud*.dat`，由 `lastUsedPersonaSlot` 选择；`skin_packs/persona` 只是一个空壳包。
- `options.txt` 的 `game_skintypefull` 主要对经典皮肤生效，不是 persona 的当前角色索引。
- persona 部件位于 `premium_cache/persona`（ZIP）和游戏内置的 `resource_packs/persona/__brarchive`。
- Xbox 云档案是 persona 的权威来源：启动后会覆盖本地 `ud*.dat`，因此不建议修改本地文件来恢复角色。
- 4DGen 的边界：**persona 只读**，不作为 4D 皮肤槽；4D 皮肤只写 `custom`。角色创建器以“游戏皮肤”包的形式展示、导出配方并做紧凑备份。

## 文件与路径

| 内容 | 路径 | 说明 |
| --- | --- | --- |
| 角色创建器档案 | `%APPDATA%\Minecraft Bedrock\Users\<user>\games\com.mojang\ud<id>.dat` | 带 BOM 的 JSON，含 5 组 persona 档案与最后使用槽位 |
| 当前皮肤索引 | `...\games\com.mojang\minecraftpe\options.txt` | `game_skintypefull`、`game_recentskin1..3` |
| 经典自定义皮肤 | `...\games\com.mojang\custom_skins\` | 导入的 PNG |
| Persona 包 | `<skin_packs>\persona\` | 游戏自带的空壳包，通常 `skins.json` 为空 |
| 4D 皮肤槽 | `<skin_packs>\custom\` | 4DGen 唯一写入的槽 |
| Persona 部件缓存 | `%APPDATA%\Minecraft Bedrock\premium_cache\persona\` | 每个部件一个 ZIP 与缓存索引 |
| 内置 Persona 资源 | `...\Content\data\resource_packs\persona\` | 目录清单、打包资源与缩略图 |
| 4DGen 游戏皮肤备份 | `<4dgen-data>\skins\game-skins\backups\` | 紧凑 JSON |

## 皮肤索引

`options.txt` 中的经典皮肤索引形如：

```text
game_skintypefull:<pack-uuid>_<skin-identifier>
```

- 经典皮肤：`<skin-identifier>` 是 `skins.json` 里的 `localization_name`。
- Persona：标识符形如 `persona-<hash>-<index>`，但当前版本真正决定 persona 角色的是 `ud*.dat` 里的 `lastUsedPersonaSlot`。两者是两套索引。
- `game_recentskin1..3` 是另一组历史记录，可能为空。
- 游戏退出时会重写整个 `options.txt`，因此不能整文件覆盖，只能改其中的单个键。

## `ud<id>.dat` 与云同步

- `ud<id>.dat` 是带 BOM 的 JSON，包含 `personaProfile1..5`、`personaCollection`，以及记录最后使用槽位的 `personaProfile`。
- 每个档案由基础肤色/体型项和若干部件引用组成；部件带层类型后缀与颜色数组。
- Xbox 云同步会在启动后覆盖本地 `ud*.dat`；在线状态下直接替换本地文件不能恢复 persona。
- 恢复 persona 的可靠方式是在游戏内按配方重建，由游戏自己写入并同步。
- 4DGen 不写 `ud*.dat`，也不把 persona 当作可恢复的皮肤槽。

## Persona 部件

- 内置部件以打包资源（`__brarchive`）形式随游戏分发，其元数据是明文 JSON，包含部件 ID、名称、类型、颜色与贴图来源；目录清单与官方缩略图可公开读取。
- Marketplace 部件以受保护的加密资源形式缓存在 `premium_cache/persona` 下；清单与文本可读，模型、贴图与元数据受加密保护。
- **本项目不解密 Marketplace 资源，不绕过授权，不注入或 hook 游戏进程。**
- 内置部件的缩略图可直接展示；Marketplace 部件的名称/类型/图标通过公开 persona 目录补齐。
- `src/persona-marketplace.json` 保存公开目录的元数据映射（UUID → 名称/类型/图标），**仅为公开目录元数据快照，不含加密资源或账号数据**。
- 图标由 `/api/persona/marketplace-icon` 代理并缓存到 `4dgen-data/skins/cache/marketplace-icons`。

## 4DGen 设计决策

### 槽位

- `custom`：唯一可写的 4D 皮肤槽，对应经典皮肤包。
- `persona`：游戏角色创建器所有，4DGen 不管理、不覆盖、不恢复。
- `pruneBackups`：只保留原始基线；操作快照仅在写入期间存在，成功后清理，写入中断时才保留用于 recover。

### 游戏皮肤包

“皮肤包管理 → 游戏”里只有两行：

- `自定义皮肤`（custom）
- `游戏皮肤`（5 个角色创建器档案的只读聚合包）

`游戏皮肤` 内：

- 顶部 5 个角色标签（角色 1..5），标出当前使用；
- 每个角色显示 base、部件名称/类型/颜色、每件部件的官方缩略图；
- 不显示默认角色的大预览图；
- 支持立即备份、导出完整配方、刷新；
- 备份列表支持查看/下载、删除。

### 配方导出

`POST /api/persona/export` 写出完整配方 JSON，包含：

- 5 个 profile 的 base / pieces / colors；
- 内置部件的 `piece_name` / `piece_type` / 本地缩略图；
- Marketplace 部件的名称/类型/图标 URL；
- `lastUsedPersonaSlot`。

文件位置：`4dgen-data/skins/exports/persona-recipes-<timestamp>.json`。

### 紧凑备份

每次修改 `custom`（enable / disable / restore / apply-update / edit / install）自动备份一次，也可以手动备份。

格式（只保留重建所需的最小数据）：

```json
{
  "version": 1,
  "id": "<timestamp-random>",
  "created": "<ISO>",
  "kind": "auto",
  "reason": "custom:enable",
  "lastUsedPersonaSlot": "persona_profile_persona2",
  "profiles": [
    {
      "slot": "personaProfile2",
      "kind": "persona",
      "lastUsed": true,
      "base": { "arm": "wide", "skinColor": "#ffb37b62", "skin": false },
      "pieces": [{ "id": ".../d", "colors": ["#ff2e180e"] }]
    }
  ]
}
```

- 不存图片、不存 `ud*.dat` 全量、不存名称/缩略图/raw appearance。
- 5 个角色约 7 KB。
- 相同内容按 SHA-256 去重。
- 自动与手动备份合计最多保留最近 10 个。
- 位置：`4dgen-data/skins/game-skins/backups/<id>.json`。

## 验证范围

- 创建/切换角色只修改 `ud*.dat` 中对应档案与 `lastUsedPersonaSlot`，不修改 `persona/skins.json`。
- persona 应用后 `game_skintypefull` 仍保持经典皮肤值。
- Xbox 云同步会覆盖本地 `ud*.dat`；本地离线恢复不可用。
- 内置部件元数据为明文；Marketplace 缓存为加密资源，本项目不读取其内容。
- 公开 persona 目录可解析常见 Marketplace 部件的名称与类型。
- `npm run check`、`npm run check:web` 通过；`tests/persona-recipe.test.ts`、`tests/game-skins.test.ts` 通过。
- API：`/api/packs`、`/api/persona/export`、`/api/persona/backups`、`/api/persona/backup`、备份下载/删除与部件图标代理正常。

## 未做 / 限制

- **没有实现精确的 persona 3D 渲染**。Marketplace 部件受加密保护，单张 atlas 的近似渲染不可靠，已放弃。
- **没有做 Marketplace 资源解密、授权绕过或游戏进程注入**。
- **没有做在线 persona 自动恢复**。Xbox 云档案是权威源，只能在游戏内重建。
- 公开目录是快照；非常新的 Marketplace 部件可能暂时不在 `persona-marketplace.json` 中。
- `matchedCast` 仍保留在完整导出 JSON 里，但 UI 不显示默认角色预览。

## 合规边界

- 仓库不包含、不分发任何受版权保护的模型、贴图或加密资源。
- 本项目不提供绕过授权、解密受保护资源或修改客户端行为的实现。
- 使用本项目处理第三方模型时，请遵守模型自身的许可，以及 Minecraft EULA 与 Microsoft 服务条款。

## 数据来源

- Minecraft Bedrock 本地文件与 `resource_packs/persona` 的公开结构。
- [Bedrock Wiki: contents.json](https://wiki.bedrock.dev/concepts/contents) 与 Microsoft Learn 的 skin pack 文档。
- [BehaviorPack/Bedrock-Item-Viewer](https://github.com/BehaviorPack/Bedrock-Item-Viewer) 的公开 Marketplace persona 目录（`marketplace/data.json`），用于生成 `src/persona-marketplace.json`。
- 关于 Xbox 云同步覆盖本地档案的公开讨论记录。
