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
| Boss 抗性表/当期 buff 机制/最新期数值档 | `node scripts/resolve.mjs boss 焚昼余火` | 双源合并展示（见 §5） |
| 某角色倍率表全列 / 单招倍率行 | `node scripts/resolve.mjs 招式 1561 列表` / `… 招式 1371 1371008` | moveId 唯一权威（见 §6） |
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

- 主词条：1/2/3 号位固定主词条（S级+15：HP 2200 / ATK 316 / DEF 184）**全员无条件建模**；
  4/5/6 号位用户选择，池与 S 级满值在 `statRules.driveDisc.mainStatPools / sRankMaxMainStat`
  （如 critRate 主词条=24，critDmg=48，anomalyProficiency=92）。
- 副词条：步长表 `statRules.driveDisc.sRankSubStatBaseStep`（critRate 2.4 / critDmg 4.8 /
  hpPct 3 / atkPct 3 / anomalyProficiency 9 / penFlat 9）。分配上限与总步数口径见 `substatOptimizer`。
- 套装：`driveDiscSets[]`，2件套=固定面板效果，4件套 selfBuff=装备者效果、teamBuff=全队效果
  （消费端 `buff.ts collectDriveDiscBuffs` + `inCombatBuffs.ts`；生效测试 `discSetEffects.test.ts`）。
  例：折枝剑歌(32700) 2pc=暴击伤害+16%；啄木鸟电音(31000) 2pc=暴击率+8。
- 套装 requirement 门槛（`EffectRequirement`，2026-09 起消费）：
  `outOfCombatStat:{stat,min}`（selfBuff 侧粗算口径=基础值+主词条+副词条步数，teamBuff 侧用装备者源面板精确值）、
  `specialty`/`attribute`（装备者特化/属性）。生效中：棘刺玫瑰 def≥1000/1800、折枝剑歌 掌控≥115、
  山大王 4pc 二段 critRate≥50 + 击破限定、月光骑士颂=支援、雪兔=防护、拂晓行纪/谶羽之誓=属性限定。
- stat 模板：`enemy{attribute}AnomalyResReduction` 按装备者属性替换（首字母大写落 stat 名，自由蓝调 4pc）。
  自由蓝调 4pc 挂在敌人 8s、全队同属性积蓄受益 → 录在 `fourPiece.teamBuff`（includeOwner=装备者同吃），
  teamBuff 通道按【装备者】属性解析模板。**注意**：官方口径含装备者的全队效果（摇摆爵士 4pc）只录
  teamBuff 一份，selfBuff+teamBuff 并录会导致装备者双计。
- **烈霜(frostfire) 属性口径**（用户口径 2026-09-05）：一切【元素→数值】查找（冰伤/敌方冰抗/
  冰减抗/积蓄抗性等）经 `resolveStatElement` 按冰读；异常身份（独立积蓄槽、可与冰互相紊乱而非同种
  覆盖、独立持续时间/紊乱公式）仍用精确元素/getBaseElement，frostfire 不进 VARIANT_ELEMENT_TO_BASE。
- **招式类型定向两路径同源**（@fact 招式类型/两路径同源）：伤害行 `skillDamageTarget`（enrichExecutionPlan
  按 `inferSkillDamageTarget` 回填）与失衡/异常 exec 的 `skillType`（`normalizeResourceSkillType`，招式
  timeType/tags/名称优先于 raw skillType——冲刺招式 catalog 可能误标 'dodge'）产出同口径，定向键
  `X__<target>` 在标准行生效（音擎/队友 buff/驱动盘的招式限定 buff 通用）。
- **4pc 含 2pc**：count≥2 分支使 4 件套同时吃到 2pc 效果（同套不叠加，与游戏一致）。
- 条件恒开约定：condition/durationSeconds 文本不消费，按 coverage=1 全程生效（如炎狱 28% 暴击、极地冻结段）；
  驱动盘效果无 coverage 滑块入口（effectCoverageMap 只收音擎与队友 buff）。
- 未建模（无计算通道，非遗漏）：灵魂摇滚 4pc（受击减伤）、原始朋克 2pc（护盾量）。

## 4. Boss（**双数据源**，查证用 `resolve boss`）

Boss 的事实分裂在两个文件里，**用途不同，别混**：

| 源 | 文件 | 承载 | 谁消费 |
|---|---|---|---|
| 机制源 | `catalog.json → bosses[]` | `target`（防御/弱点 `weaknessElements`/抗性 `resistanceElements`/抗性覆盖）+ `encounters[]` 每期的 `enemyIntel` 机制文本、`playerBuffs`/`playerDebuffs`（当期 buff，带 `calculationStatus`） | 面板/伤害引擎 |
| 数值档源 | `boss-presets.json` | `monster`（失衡倍率 `stunVuln`/失衡时间）、`defaults`（battleTime/秽盾/弹刀）、`phases[]`（各期 HP/失衡值/异常系数/评分线） | 属性配置页、失衡推导 |

- 改 Boss 预设默认值 → `scripts/import-nanoka-bosses.mjs` 的 `BOSS_DEFAULTS` 重跑，不手改 JSON。
- 当期 debuff 的 `calculationStatus: modeled` = 引擎已消费；`pending/skip` = 文本存在但没进计算。
- 例（`resolve boss 焚昼余火`）：防御 953 · 弱点 冰/风 · 抗性 物理 · 3.0 P3 debuff「赴火」critDmg −25/层×5 [modeled]。

## 5. 局内角色全配置（CharacterConfig，`stores/config.ts`）

「一个角色上场」= 以下字段的**组合实体**，缺任何一项都算不完整（探针默认口径=前五项取推荐值）：

- 身份：`agentId` + `cinemaLevel`（命座 0-6）+ `potentialLevel`（潜能 1-6，缺省 6）
- 音擎：`wEngineId` + `wEngineModLevel`（精炼 1-5）——精炼效果阶梯见 §1 音擎卡 ④
- 驱动盘：`driveDisc`（4+2 套装 + 4/5/6 主词条 + 副词条分配，见 §3）
- 交互次数：`parryCount`/`dodgeCounterCount`/`blockCount`/`quickAssistCount`/`chainCountPerStun` + 角色专属交互字段（`yixuanInk2Count` 等十余个，字段注释在 `CharacterConfig` 定义处）
- 派生：面板/暴击预算由引擎算（`probe:panel`，PROBE_SUBSTATS/ENGINE/MOD/CINEMA/FOUR/TWO 覆盖）。

**注意**：`potentialLevel` 影响部分模块的档位取值（注释见 config.ts:24）；交互次数类字段是资源循环的输入（如般岳 `blockCount` 是嗔火来源），改它们=改资源池，不只是改面板。

## 6. 倍率表（agentSkills，moveId 的唯一权威）

- 结构：`catalog.json → agentSkills[]`（每角色一条）→ `categories[]`（basic/special/dodge/chain/assist 分段）→ `moves[]`（`id`=moveId、`rows[]`=damage/daze/energy_recovery/decibel_recovery/anomaly_buildup/ether_purify/attack_data_N）。
- **moveId 编号分段非连续**（1561005 → 1561008 跳号），禁止从 agentId 推算编号，一律查表：
  `node scripts/resolve.mjs 招式 <agentId> 列表` 全列 / `… <moveId|招式名>` 单条。
- ⚠ nanoka `skill_list` 的自有 id **不是** moveId（希格莉德整招挂错的旧事故）；按招式名对齐（`AGENT_RECORDING_SOP.md` §0.5 陷阱）。
- 附伤合成行用假 moveId（如 `1531_c6_radiant`）防 daze/anomaly 双计——假 id 不进失衡/异常池（ENGINE_PIPELINE §4 坑5）。

## 7. 权威指针表（同一个事实只信一处）

| 事实 | 唯一事实源 | 不要信 |
|---|---|---|
| 专武归属 | `wEngines[].ownerAgentId` | 音擎名联想、攻略站先验 |
| 推荐配装（主词条/套装） | `build-recommendations.json`（sync 脚本生成） | 记忆里的「毕业配装」 |
| 面板/派生数值 | 引擎（`calcPanel`，探针输出） | 手工汇总 JSON |
| 倍率/属性/boss 数值 | `catalog.json` | 任何文档转述 |
| 招式 moveId ↔ 倍率行 | `agentSkills`（`resolve 招式` 查表） | 从 agentId 推算编号、nanoka skill_list id |
| Boss 当期机制/抗性 | `catalog bosses[]`（机制源）+ `boss-presets.json`（数值档） | 只看其中一个源 |
| 中文术语→字段 | `GAME_TERM_TO_CODE_FIELD.md` | 训练数据里的字段名 |
| 特化/属性中文 | `MECHANICS_IMPLEMENTATION.md` §0 | 记忆推断 |

## 8. 事故登记（每次撞名/漏字段事故追加一行；模式同 ENGINE_PIPELINE 坑表）

| 日期 | 事故 | 根因 | 防线 |
|---|---|---|---|
| 2026-08-30 | 「心弦夜响」被联想为仪玄专武（实际伊芙琳 1321 专武；仪玄是青溟笼舍 14137） | 关键词 grep 音擎名 + 名字联想直接断言，未查 `ownerAgentId` | resolve CLI（事故当天重演：正确显示归属） |
| 2026-08-30 | 音擎解剖漏读 `effect.selfBuff`（精炼暴击率 20），手工暴击预算错 | 只读 level60 两字段就下结论，不知道音擎是四部分结构 | 实体卡 §1 四部分表 + resolve 输出精炼阶梯 |
| 2026-08-30 | 手算仪玄暴击 97%（漏 4件套条件暴击 +12，真实局内 69%） | 手工汇总替代引擎 | 探针 probe:panel |

## 9. 文档定位与维护纪律

- 本文档挂在 `README.md` §6 文档表 + `AGENTS.md` §0 导航（fast 档也读 §0+§1 查证工具节）。
- **实体结构变更时同步本文**（规则 8 知识单一事实源）；实体卡内容尽量「指指针」而不是抄数值，
  抄的数值会漂移，指针不会。
- 事故登记是活文档：AI 每次撞名/漏字段事故，登记一行（日期/事故/根因/防线），
  这就是把一次性错误变成系统性免疫的机制。
