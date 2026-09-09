# 数据爬取攻略（nanoka / gachabase）

> 角色数值与影画文本的**唯一事实源**是 nanoka.cc 与 gachabase（含测试服）。**不要用 web_search 搜角色数值/影画**——搜出来的是过时/第三方二次转载，会引入错误口径。

## 两个数据源

| 源 | 内容 | 版本 | 地址模式 |
|---|---|---|---|
| **nanoka.cc static** | 角色全量 JSON：`skill_list`（名字）、`skill`（分类倍率 param）、`talent`（影画 1-6）、`passive`（核心被动/额外能力）、`stats`；另有索引 `character.json` / `equipment.json` / `weapon.json` | 正式服版本（`manifest.zzz.live`） | `https://static.nanoka.cc/zzz/<version>/zh/character/<id>.json` |
| **gachabase beta** | 角色技能倍率（`skill_data`，无影画/被动文本） | **测试服（beta）** | `https://zzz.gachabase.net/agents/<id>/<slug>/beta?lang=chs` |

**关键区别**：
- gachabase 只有**倍率行**（damage/daze/energy/decibel/anomaly/ether_purify），**没有影画文本**。
- **影画（talent）/核心被动（passive）文本只有 nanoka 全量 JSON 有**（`data/raw/nanoka_<id>_zh.json`）。
- gachabase `/beta` = **测试服**，倍率会变；nanoka `manifest.zzz.live`（如 `3.2`）= 正式服稳定版，带 hash 的构建是预发布。

## 爬取脚本

| 脚本 | 用途 | 输出 |
|---|---|---|
| `scripts/fetch-gachabase-agent.mjs <id> <slug> [lang]` | 爬 gachabase beta 倍率 | `data/raw/gachabase/<id>.json`（归一化 skill_data） |
| `scripts/fetch-nanoka-full-missing.mjs [<id>...] [--force] [--version <v>]` | 爬 nanoka 全量（含 talent/passive）；不带 id = 补「缺失角色」，带 id = 重爬指定角色（`--force` 覆盖存档） | `data/raw/nanoka_missing/full/<id>.json` |
| `scripts/import-nanoka-wengine.mjs <id>... [--force]` | 音擎 raw + catalog.wEngines（`--force` 按正式服重抓 raw 后重导） | `data/raw/nanoka_wengine_<id>_{zh,en}.json` + catalog |
| `scripts/sync-build-recommendations.mjs <id>... [--write] [--force] [--verify-rule]` | 邦布精灵配装推荐（4pc/2pc/主词条/副词条/专武） | `data/raw/nanoka_{character,equipment,weapon}.json` + build-recommendations.json |
| `scripts/fetch-nanoka-missing.py` | 爬 nanoka skills+stats（依赖本机 `F:\trae_output\nanoka_scraper`，已退役） | `data/raw/nanoka_missing/<id>_skills.json` + `_stats.json` |

**出网**：脚本走 `scripts/lib/http.mjs` 的 `fetchJson`（node fetch 优先，失败回退 `curl`）——本机存在「node 出网被拦（ETIMEDOUT/ENETUNREACH）、curl 正常」的环境，回退让数据管线照跑。

**gachabase 倍率口径**（`fetch-gachabase-agent.mjs` 头注释）：Lv12 = base + step×11，再 `/100`（damage/daze/anomaly/ether_purify）或 `/10000`（energy/decibel）。

## ⚠️ 版本：用 `manifest.zzz.live`，别用带 hash 的构建（2026-08 教训 + 2026-09 修订）

```bash
curl -sS https://static.nanoka.cc/manifest.json   # zzz.latest / zzz.live / zzz.available
```

- **正式服 = `zzz.live`**（如 `3.2`）；`zzz.available` 里带 hash 的构建（如 `3.2.12+18747718`、`3.3.0+18716457`）是**预发布/测试服**快照——**名字与文案可能是占位 `"..."`**（实测 14162 专武在 `3.2.12+18747718` 里 name/desc 全是 `"..."`，在 `live=3.2` 里是「绯月银棺」）。
- 脚本已不再硬编码 hash：`fetch-nanoka-full-missing.mjs` / `import-nanoka-wengine.mjs` / `sync-build-recommendations.mjs` 都读 `manifest.zzz.live`（可用 `--version` 覆写）。
- 判断「仓库里的数据是不是最新」：看 `data/raw/nanoka_missing/full/<id>.json` 的 `talent[].desc` / 音擎 raw 的 `name`——出现 `...`/`PlaceHolder` = 旧版或预发布占位，需按正式服重爬。

## 测试服（beta）≠ 正式服：先判断要不要录

- **测试服倍率/核心被动/影画都可能变**（v4 beta 把洛克茜整套 moveId 重排、核心被动重做、克拉蕾 C1/C2 改效果）。
- 若倍率/被动/影画在测试服还在变 → **等正式服再重构**；否则录一半测试服值，正式服上线又得重录一遍。
- **2026-09-09 正式服复核（1611 克拉蕾 / 1621 洛克茜）**：技能倍率/被动/影画文本与 v12 测试服一致（被动/影画 2·6 仅措辞修订），但**音擎被改过**——14161 锐化伤害从测试服叠层口径（12%→20%）改成正式服的 10%→16%，14162 才拿到正式名「绯月银棺」。**结论：影画/被动文本可以按测试服录，音擎数值必须等正式服重抓。**
- 影画文本（talent desc）相对稳定，但 v4 也出现过「克拉蕾 C1/C2 从 3.2.1 到 v4 完全改写」——**别假设测试服影画=最终**。

## 记录归档

- 爬到的 raw 落在 `data/raw/`（gachabase/ nanoka_*_zh.json nanoka_*_skills_lv12.json 等），**不要手改**。
- 改 `public/static/catalog.json` 数值走 `scripts/import-*` 或专门重导入脚本，改完跑 `npm run minify:static`（validate:data 报「compact」红时用它修）。
