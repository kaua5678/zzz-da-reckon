# 数据爬取攻略（nanoka / gachabase）

> 角色数值与影画文本的**唯一事实源**是 nanoka.cc 与 gachabase（含测试服）。**不要用 web_search 搜角色数值/影画**——搜出来的是过时/第三方二次转载，会引入错误口径。

## 两个数据源

| 源 | 内容 | 版本 | 地址模式 |
|---|---|---|---|
| **nanoka.cc static** | 角色全量 JSON：`skill_list`（名字）、`skill`（分类倍率 param）、`talent`（影画 1-6）、`passive`（核心被动/额外能力）、`stats` | 正式服版本号 hash | `https://static.nanoka.cc/zzz/<version>/zh/character/<id>.json` |
| **gachabase beta** | 角色技能倍率（`skill_data`，无影画/被动文本） | **测试服（beta）** | `https://zzz.gachabase.net/agents/<id>/<slug>/beta?lang=chs` |

**关键区别**：
- gachabase 只有**倍率行**（damage/daze/energy/decibel/anomaly/ether_purify），**没有影画文本**。
- **影画（talent）/核心被动（passive）文本只有 nanoka 全量 JSON 有**（`data/raw/nanoka_<id>_zh.json`）。
- gachabase `/beta` = **测试服**，倍率会变；nanoka `3.2.1+...` = 正式服稳定版。

## 爬取脚本

| 脚本 | 用途 | 输出 |
|---|---|---|
| `scripts/fetch-gachabase-agent.mjs <id> <slug> [lang]` | 爬 gachabase beta 倍率 | `data/raw/gachabase/<id>.json`（归一化 skill_data） |
| `scripts/fetch-nanoka-full-missing.mjs` | 爬 nanoka 全量（含 talent/passive）给「缺失」角色 | `data/raw/nanoka_missing/full/<id>.json` |
| `scripts/fetch-nanoka-missing.py` | 爬 nanoka skills+stats（依赖本机 `F:\trae_output\nanoka_scraper`） | `data/raw/nanoka_missing/<id>_skills.json` + `_stats.json` |

**gachabase 倍率口径**（`fetch-gachabase-agent.mjs` 头注释）：Lv12 = base + step×11，再 `/100`（damage/daze/anomaly/ether_purify）或 `/10000`（energy/decibel）。

## ⚠️ 版本 hash 是最容易踩的坑（2026-08 教训）

`fetch-nanoka-full-missing.mjs` 与 `fetch-nanoka-missing.py` 里**硬编码了版本 hash**：

```
https://static.nanoka.cc/zzz/3.2.1+17934514/zh/character/
```

- 要爬**新版本**（如 4.0 测试服），必须先把这两处的 `3.2.1+17934514` 换成新版本的 hash，否则爬到的还是旧版。
- 判断「仓库里的数据是不是最新」：直接看 `data/raw/nanoka_<id>_zh.json` 里 `talent` 的 desc——如果还是 `PlaceHolder`，说明是旧版占位，需要换 hash 重爬。
- 影画文本到底存哪个文件：`data/raw/nanoka_<id>_zh.json`（全量中文，含 `talent`/`passive`），**不是** `nanoka_missing/full/`（那是 skills-only 旧版，`fetch-nanoka-full-missing.mjs` 只对「缺失角色」补全量）。

## 测试服（beta）≠ 正式服：先判断要不要录

- **测试服倍率/核心被动/影画都可能变**（本次 v4 beta 把洛克茜整套 moveId 重排、核心被动重做、克拉蕾 C1/C2 改效果）。
- 若倍率/被动/影画在测试服还在变 → **建议等正式服再重构**；否则录一半测试服值，正式服上线又得重录一遍。
- 影画文本（talent desc）相对稳定，但本次 v4 也出现了「克拉蕾 C1/C2 从 3.2.1 到 v4 完全改写」——所以**别假设测试服影画=最终**。

## 记录归档

- 爬到的 raw 落在 `data/raw/`（gachabase/ nanoka_*_zh.json nanoka_*_skills_lv12.json 等），**不要手改**。
- 改 `public/static/catalog.json` 数值走 `scripts/import-*` 或专门重导入脚本，改完跑 `npm run minify:static`（validate:data 报「compact」红时用它修）。
