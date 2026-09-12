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

## 耗能位置（2026-09-12 用户纠错补录：第一版曾漏抓、误按 60 兜底）

**能量消耗不在 param 数值字典里，也不在 gachabase**——它是 full JSON `skill.<cat>.description[].param[]`
里的**独立展示行**：`name` 含「能量消耗」，**数值在 `desc` 文本里**（如 `"(Test1)80点"`，无 `{Skill:id}` 引用）。
归属 moveId = 该 entry 参数序列中**前一个带 id 的 param 行**的 moveId（展示顺序保证耗能行跟在本招的倍率行后）：

```
(Test1)组合技伤害倍率   param:{1631008:{damage_percentage:…}}   ← 带 id
(Test1)组合技失衡倍率   param:{1631008:{stun_ratio:…}}          ← 带 id
(Test1)组合技能量消耗   desc:"(Test1)80点"                       ← 归 1631008
(Test1)风刃最大能量消耗 desc:"(Test1)40点"                       ← 跟在 1631009 倍率行后 → 归 1631009
```

- 提取实现：`scripts/import-nanoka-beta-agent.mjs` 的 `collectEnergyCosts`（正则 `/能量消耗/` + desc 解析「N点」）。
- 已知坑：**dump 参数时若「每个 moveId 只取首次出现」会把耗能行整个漏掉**（1631/1641 第一版就是这么漏的）；
- catalog 落法：`energyCost: { 'Energy Cost': 'N' }`（`resolveExSpecialCount`/helpers:1538 以 energyCost 区分普通 special 与 exSpecial）。真实值示例（3.3 beta）：1631 组合技 80 / 风刃 40；1641 强特两段各 40。

## ⚠️ 版本：用 `manifest.zzz.live`，别用带 hash 的构建（2026-08 教训 + 2026-09 修订）

```bash
curl -sS https://static.nanoka.cc/manifest.json   # zzz.latest / zzz.live / zzz.available
```

- **正式服 = `zzz.live`**（如 `3.2`）；`zzz.available` 里带 hash 的构建（如 `3.2.12+18747718`、`3.3.0+18716457`）是**预发布/测试服**快照——**名字与文案可能是占位 `"..."`**（实测 14162 专武在 `3.2.12+18747718` 里 name/desc 全是 `"..."`，在 `live=3.2` 里是「绯月银棺」）。
- 脚本已不再硬编码 hash：`fetch-nanoka-full-missing.mjs` / `import-nanoka-wengine.mjs` / `sync-build-recommendations.mjs` 都读 `manifest.zzz.live`（可用 `--version` 覆写）。
- 判断「仓库里的数据是不是最新」：看 `data/raw/nanoka_missing/full/<id>.json` 的 `talent[].desc` / 音擎 raw 的 `name`——出现 `...`/`PlaceHolder` = 旧版或预发布占位，需按正式服重爬。

## hdiff：版本对比（改数值前先看，别全库扫）

**只对「新角色」和「新潜能激发」跑** —— 老角色数值通常不变，全库扫一遍是浪费（用户口径 2026-09-12）。

- **网站看法**：`https://zzz.nanoka.cc/character/<id>?from=<旧版本>`（上端改版本号即可对比）。
- **机器读法**（同一件事，可沉淀/可复现）：

```bash
node scripts/hdiff-agent.mjs <id> --from 3.2          # --to 省略 = manifest.zzz.latest
node scripts/hdiff-agent.mjs --new --from 3.2         # 自动跑 manifest 的 zzz.new.character
node scripts/hdiff-agent.mjs 1621 --from 3.2 --save   # 顺带把新版存档进 full/<id>.json
```

只报**会进 catalog 的字段**（规则表字段 + impact/异常精通/异常掌控/回能/能量上限），
并单独提示**突破加成性质变化**（如 `13102 DEF+28.8%` → `20101 暴击+14.4%`——这改的是口径不是数值）。
有差异 `EXIT=1`，可直接挂 CI。

**判据：发现差异后先分清是哪一类，处置完全不同**

| 类型 | 特征 | 处置 |
|---|---|---|
| **A 版本漂移** | 旧存档算得的值 ≈ catalog，线上新版不同 | catalog 整体按新版重导（1621 属此类：整份停在 08-04 旧版） |
| **B 存档本身是错值** | 线上**各版本一致**，只有仓库旧存档不同 | 只改那一个字段；**别当成"版本更新"整体重导**（1611 defBase 属此类：线上 3.2/3.3.2 都是 35/48155，旧存档 30/41134 是错值） |

⚠ **误判代价**：把 B 当 A 会去动本不该动的字段；把 A 当 B 只改一个字段会留下**版本混血**
（1621 曾出现 critRate 按新版订正、defBase 仍含旧版 DEF 突破加成）。
**区分方法：把线上至少两个版本互相比一遍**——一致 = B，不一致 = A。

## 测试服（beta）≠ 正式服：先判断要不要录

- **测试服倍率/核心被动/影画都可能变**（v4 beta 把洛克茜整套 moveId 重排、核心被动重做、克拉蕾 C1/C2 改效果）。
- 若倍率/被动/影画在测试服还在变 → **等正式服再重构**；否则录一半测试服值，正式服上线又得重录一遍。
- **2026-09-09 正式服复核（1611 克拉蕾 / 1621 洛克茜）**：技能倍率/被动/影画文本与 v12 测试服一致（被动/影画 2·6 仅措辞修订），但**音擎被改过**——14161 锐化伤害从测试服叠层口径（12%→20%）改成正式服的 10%→16%，14162 才拿到正式名「绯月银棺」。**结论：影画/被动文本可以按测试服录，音擎数值必须等正式服重抓。**
- 影画文本（talent desc）相对稳定，但 v4 也出现过「克拉蕾 C1/C2 从 3.2.1 到 v4 完全改写」——**别假设测试服影画=最终**。

## 记录归档

- 爬到的 raw 落在 `data/raw/`（gachabase/ nanoka_*_zh.json nanoka_*_skills_lv12.json 等），**不要手改**。
- 改 `public/static/catalog.json` 数值走 `scripts/import-*` 或专门重导入脚本，改完跑 `npm run minify:static`（validate:data 报「compact」红时用它修）。
