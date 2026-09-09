# data/raw 布局与数据管线

> 中间产物（爬取快照）目录。**运行时不被 src/ 读取**（仅 spec notes 引用作出处）；
> 最终产物在 `public/static/*.json`（catalog 等），由 scripts/ 从这里导入生成。

## 目录约定（2026-08 收编统一：文件名一律 = nanoka 数字 id）

| 目录 | 内容 | 生产者 | 消费者（scripts/） |
|---|---|---|---|
| `audit/<id>.json` | 老角色完整抓取（角色信息+技能描述+参数，含 attack_data 原始值 ÷10000 口径） | 早期手工抓取（slug 命名，2026-08 统一改为数字 id） | import-factions（camp→faction）、sync-attack-data、validate-data（attack_data 完整性）、sync-move-zh-names（fallback）、fix-agent-rarity（fallback） |
| `nanoka_missing/list.json` | 30 个新角色 nanoka id 清单 | fetch-nanoka-missing.py（已退役） | import-nanoka-missing、enrich-nanoka-missing、sync-new-role-status、audit-nanoka-missing |
| `nanoka_missing/<id>_skills.json` / `<id>_stats.json` | 新角色技能（预缩放 attack_data）/ 基础属性 | fetch-nanoka-missing.py（已退役） | import-nanoka-missing、import-attack-data、sync-attack-data、audit-nanoka-missing、validate-data |
| `nanoka_missing/full/<id>.json` | 新角色完整抓取（被动/影画/潜能/技能原文，**录角色机制的原文数据源**） | fetch-nanoka-full-missing.mjs | enrich-nanoka-missing、sync-new-role-status、sync-move-zh-names（优先）、import-factions、audit-nanoka-missing |
| `bosses/{zh,en}/<id>.json`、`bosses/monster/`、`bosses/{summary,version}.json` | Boss 数据（属性/阶段/版本，中英双语） | fetch-nanoka-bosses.mjs | import-nanoka-bosses → boss-presets.json |
| `zzz-run-archive/*.json` | 危局通关档案快照（分页 API） | fetch-zzz-run-archive.mjs | import-zzz-run-archive → run-archive.json |
| `gachabase/<id>.json` | 第二数据源交叉校验快照（倍率/回能双源确认） | fetch-gachabase-agent.mjs | 只写不读（对账证据留存） |
| `nanoka_wengine_<id>_{zh,en}.json` | 音擎数据（根目录） | import-nanoka-wengine.mjs（缺则现场抓；`--force` 按正式服重爬） | import-nanoka-wengine.mjs → catalog.wEngines |
| `nanoka_character.json` / `nanoka_equipment.json` / `nanoka_weapon.json` | nanoka 正式服索引快照：角色 en 名 / 驱动盘套装 zh+en 名与 2pc·4pc 文本 / 音擎 en 名·atk·sub·icon | sync-build-recommendations.mjs（缺则现场抓） | sync-build-recommendations → build-recommendations.json；patch-disc-sets（套装名对齐） |
| `nanoka_<id>.json` / `nanoka_<id>_skills_lv12.json` / `noun_3.2.3.json` | 特殊口径留存：`nanoka_1611/1621.json` 是**早期英文/预发布快照**（1621 的 talent 还是 `PlaceHolder`，**勿当数据源**）；`*_skills_lv12.json` = 12 级倍率专项抓取；`noun_3.2.3.json` = 名词表 | 手工抓取 | 仅 spec notes 作出处引用（见 src/specs/agents/1611.json 等）；**正式服全量看 `nanoka_missing/full/<id>.json`** |
| `_archive/scratch/` | 历史会话遗留的无引用草稿（2026-08 清点归档，13 个文件） | — | 无（勿恢复） |

## 关键链路（谁生成最终产物）

```
audit/ + nanoka_missing/{skills,stats} ──import-nanoka-missing──▶ catalog.json（agents/agentSkills 骨架）
nanoka_missing/full/          ──enrich-nanoka-missing──────────▶ catalog.json（招式中文名）+ specs notes
audit/ + full/                ──import-factions────────────────▶ catalog.json（faction）
nanoka_missing/*_skills + audit/ ──sync-attack-data────────────▶ catalog.json（attack_data 行）
nanoka_missing/full/ + list   ──sync-new-role-status───────────▶ character-mechanics/constellations 占位
bosses/                       ──import-nanoka-bosses───────────▶ boss-presets.json
zzz-run-archive/              ──import-zzz-run-archive─────────▶ run-archive.json
```

手维护（无生成脚本，validate:data 护栏兜底）：`teammate-buffs.json`、`character-mechanics.json`、`character-constellations.json`（真实状态）、`build-recommendations.json`（初始爬取 + sync-signature-wengine-recs 增量补）。

## 已知取舍

- 1611/1621 的 audit 副本是**测试服**抓取（含 `(Test1)` 字样），catalog 沿用了当时的测试数据；
  正式服数据在根目录 `nanoka_<id>.json` 与 `nanoka_missing/full/<id>.json`，未重导（重导需人工核对倍率口径）。
  **2026-09-09 正式服上线后已复核**（`node scripts/fetch-nanoka-full-missing.mjs 1611 1621 --force`，
  版本取 `manifest.zzz.live` = 3.2）：full 存档与正式服逐字段一致；技能倍率/被动/影画数值与 v12 相同
  （仅 1611 强化特殊技正式名「血华誓·铸锋秘术」、`stats.tags` 阵营 Camp12→Camp16），故 catalog 行无需重导；
  两把专武 raw 同步按正式服重抓（14161 锐化伤害 12%→20% 的测试服叠层口径作废，改 10%→16%；
  14162 正式名「绯月银棺」）。
- `fetch-nanoka-missing.py` 已退役（依赖本机外部抓取器 `F:/trae_output/nanoka_scraper`）；补新角色走
  `fetch-nanoka-full-missing.mjs`（纯 node）。`import-nanoka-missing.mjs` 的别名表收编为本仓库
  `nanoka_missing/teammate_nanoka_map.json`（当前 60 角色已全量导入，别名表缺失按空表处理）。
- scripts/ 中一次性 patch 脚本（patch-move-* / fix-agent-rarity / patch-misplaced-attack-data）是
  历史修正记录，保留作审计痕迹；改数值一律新写脚本重跑，不手改 catalog.json。
