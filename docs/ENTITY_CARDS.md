# 实体卡 —— 计算器本体论（AI 陈述性知识层）

> 本文回答一个问题：**「X 是什么、由哪几部分构成、归属去哪查」**。
> 它是全套文档里缺失的一层：其余文档都是程序性知识（怎么干活/怎么排查），这里是
> 实体的事实陈述。自然语言名词（音擎名/角色名）在 LLM 训练分布里有强先验，
> 名字联想会产生「感觉已知但从未验证」的断言，且名字是真的、只是挂错实体，
> 错误能一路通过不报错。**读完本文不代表可以跳过查证——跨实体断言必须跑 resolve。**

## 0. 查证工具（比背诵本文更重要）

| 想知道 | 命令 | 备注 |
|---|---|---|
| 某音擎完整解剖（归属/副属性/精炼效果） | `node scripts/resolve.mjs 音擎 心弦夜响` | 歧义=大声失败 exit 1 |
| 某角色的专武是谁 | `node scripts/resolve.mjs 专武 仪玄` | 经 ownerAgentId 权威路径 |
| 角色/套装/boss/队友buff/spec 摘要 | `node scripts/resolve.mjs 角色\|套装\|boss\|buff\|spec <名\|id>` | 同上 |
| 全量体检（专武一致性 + 混淆名对） | `node scripts/resolve.mjs audit` | 信息版；护栏测试在 buildRecWengine.test.ts |
| **派生数值：面板/暴击预算** | `PROBE_AGENT=1371 npm run probe:panel` | 引擎为权威，勿手工加 JSON |

解析规则：精确 id → 精确名 → 唯一子串；多候选打印清单并失败。**绝不静默选最像的。**

## 1. 音擎（WEngine，`catalog.json → wEngines[]`）

**完整结构 = 四部分，缺一不可**（2026-08-30 事故：只读了前两部分，把精炼里的暴击率漏了）：

| 部分 | 字段 | 内容 |
|---|---|---|
| ① 白值 | `level60.atkBase` | 基础攻击（S级 684/713/743 三档） |
| ② 副属性 | `level60.advancedStat` | `{stat, value, mode}`，如 hpPct+30 / critRate+24 |
| ③ 精炼元数据 | `modification` | **只有等级范围**（minLevel/maxLevel/defaultLevel），无任何效果数值 |
| ④ 精炼效果本体 | `effect.selfBuff[].effects[]` | 每条 effect：`stat + 数值阶梯`（`modificationValues.value = [R1..R5]`）；stacked 型按 `valuePerStack×层`，条件型按 `coverage` 折算 |

- **专武归属唯一事实源 = `ownerAgentId`**（59 把已录；无指向 = 非专武，如仿制星徽引擎）。
  `build-recommendations.json` 的推荐音擎是快照，两者一致性由 `buildRecWengine.test.ts` 护栏锁定。
- `requirement.specialty` 是装备门槛（音擎被动只对同特化角色生效）——resolve 输出会显示。
- 特例：星徽引擎(13004)/仿制星徽引擎(13108) 互为子串——`resolve 音擎 星徽` 会歧义失败，这是故意的。

## 2. 角色（Agent，`catalog.json → agents[]`）

- 身份：`id`（nanoka 数字 id，如 1371=仪玄）+ `name` + `specialty` + `attribute` + `faction`。
  **特化/属性中文映射权威表在 `MECHANICS_IMPLEMENTATION.md` §0，禁止凭记忆推断。**
- 基础数值：`level60`（hpBase/atkBase/defBase/critRate 5/critDmg 50/impact/anomalyProficiency/anomalyMastery/…）。
- 机制文本：`combatBuffs.corePassive / additionalAbility / cinemaBuffs[]`——**只是描述文本，
  计算是否消费看 spec/模块**（`AGENT_RECORDING_SOP.md` 铁律 2：spec 不是数据源，代码消费端才是）。
- 暴击预算类**派生数值以引擎探针为权威**（音擎精炼/套装/被动逐层生效），勿手工加总。

## 3. 驱动盘（DriveDisc）

- 主词条：4/5/6 号位，池与 S 级满值在 `statRules.driveDisc.mainStatPools / sRankMaxMainStat`
  （如 critRate 主词条=24，critDmg=48，anomalyProficiency=92）。
- 副词条：步长表 `statRules.driveDisc.sRankSubStatBaseStep`（critRate 2.4 / critDmg 4.8 /
  hpPct 3 / atkPct 3 / anomalyProficiency 9 / penFlat 9）。分配上限与总步数口径见 `substatOptimizer`。
- 套装：`driveDiscSets[]`，2件套=固定面板效果，4件套=条件触发（`coverage` 折算）。
  例：折枝剑歌(32700) 2pc=暴击伤害+16%；啄木鸟电音(31000) 2pc=暴击率+8。

## 4. 权威指针表（同一个事实只信一处）

| 事实 | 唯一事实源 | 不要信 |
|---|---|---|
| 专武归属 | `wEngines[].ownerAgentId` | 音擎名联想、攻略站先验 |
| 推荐配装（主词条/套装） | `build-recommendations.json`（sync 脚本生成） | 记忆里的「毕业配装」 |
| 面板/派生数值 | 引擎（`calcPanel`，探针输出） | 手工汇总 JSON |
| 倍率/属性/boss 数值 | `catalog.json` | 任何文档转述 |
| 中文术语→字段 | `GAME_TERM_TO_CODE_FIELD.md` | 训练数据里的字段名 |
| 特化/属性中文 | `MECHANICS_IMPLEMENTATION.md` §0 | 记忆推断 |

## 5. 事故登记（每次撞名/漏字段事故追加一行；模式同 ENGINE_PIPELINE 坑表）

| 日期 | 事故 | 根因 | 防线 |
|---|---|---|---|
| 2026-08-30 | 「心弦夜响」被联想为仪玄专武（实际伊芙琳 1321 专武；仪玄是青溟笼舍 14137） | 关键词 grep 音擎名 + 名字联想直接断言，未查 `ownerAgentId` | resolve CLI（事故当天重演：正确显示归属） |
| 2026-08-30 | 音擎解剖漏读 `effect.selfBuff`（精炼暴击率 20），手工暴击预算错 | 只读 level60 两字段就下结论，不知道音擎是四部分结构 | 实体卡 §1 四部分表 + resolve 输出精炼阶梯 |
| 2026-08-30 | 手算仪玄暴击 97%（漏 4件套条件暴击 +12，真实局内 69%） | 手工汇总替代引擎 | 探针 probe:panel |

## 6. 文档定位与维护纪律

- 本文档挂在 `README.md` §6 文档表 + `AGENTS.md` §0 导航（fast 档也读 §0+§1 查证工具节）。
- **实体结构变更时同步本文**（规则 8 知识单一事实源）；实体卡内容尽量「指指针」而不是抄数值，
  抄的数值会漂移，指针不会。
- 事故登记是活文档：AI 每次撞名/漏字段事故，登记一行（日期/事故/根因/防线），
  这就是把一次性错误变成系统性免疫的机制。
