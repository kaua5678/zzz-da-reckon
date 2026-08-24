# 角色录入 SOP（AI 快速上手）

> 流程与口径见 `README.md` §3 与 `src/specs/template.json` `_comment`；管线数据流见 `docs/ENGINE_PIPELINE_GUIDE.md`；
> 中文术语→字段见 `docs/GAME_TERM_TO_CODE_FIELD.md`。本文只回答一个问题：
> **录的字段到底有没有被计算消费？**（教训：战栗减抗录了 spec 却从未进计算，靠用户肉眼发现。）

## 0. 铁律

1. **每个录入的机制 = spec 字段 + 生效测试**。没有测试的录入不算完成。
2. **spec 不是数据源，代码消费端才是**。录入后先回答：哪个函数读它？
3. **不要依赖 `enrichExecutionPlan` 之后的 name/note 匹配**（会被倍率表回填覆盖），测试/逻辑按 `moveId` 匹配。
4. **自定义 TS 模块角色**（`src/mechanics/agents/*.ts` 注册过的）**绕过 spec 解释器**：spec 里的 adjustable 滑块、attributeConversions 是死数据，机制必须在模块里实现。
5. **加成一律进既有乘区加算，禁止造独立乘区**（2026-08-23 用户铁律）：任何「提升 X%」都落在引擎既有的某个乘区里与同区其他来源**加算**——绝不写成行级 ×(1+X) 的独立乘区（如格莉丝积蓄 +130% 曾误写成 baseBuildUp×2.3，正确做法是进「异常积蓄效率区」+130）。先回答「这个加成属于哪个既有乘区」再写代码。
6. **招式限定必须落实到位，禁止一视同仁近似**：文本写明「只有某几招生效」时就做**引擎级招式限定**（行级字段/钩子按 moveId 精确到行），面板级/全局级一视同仁是马虎。确需近似的唯一合法姿势：先算限定招式的**占比**（如该招积蓄占总量比例），用 `边际效用 × 占比` 做最终加权修正，并注释公式——不是把满额加成分给所有人。

## 0.5 录入流程：先爬原文自主分析，只把不确定项问用户（入口动作）

> 单对话录单角色时，AI 零上下文，第一步**不是问用户，也不是翻 spec**，而是**读 nanoka 原文自主分析**。原文已含全部录入素材，能自主确定的直接实现，只把「原文没给数值/口径有歧义/引擎缺通道」这三类拿来问用户——这样不遗漏、不反复问。

**原文位置**：`data/raw/nanoka_missing/full/<agentId>.json`（部分角色在 `data/raw/nanoka_<id>_zh.json`）。四类信息承载：

| 想知道的 | 原文字段 | 例子（薇薇安 1331） |
|---|---|---|
| 逻辑/触发条件/状态 | `passive.level.<满级id>.desc`（核心被动+额外能力） | 「落羽生花命中**异常目标**才触发异放」「队友施加异常→消耗护羽→落羽生花，0.5s CD」 |
| 资源回复与消耗 | `skill.*.description`（招式描述里「回复 N 点 X / 消耗 N 点 Y」） | 飞羽来源（淑女礼仪+1/强特+3/连携+2/终结+5…）、悬落消耗飞羽转护羽 |
| 字段/数值 | `stats`（基础+成长）、`skill_list.<moveId>`（招式名/倍率）、`talent`（命座数值） | 基础攻击 127、命座 2「精通收益×130%+无视15%全抗」 |
| 命座 | `talent.<1-6>.desc` | 影画1「每4护羽回1飞羽 + 预言下异常/紊乱+16%」 |

**⚠️ 一个陷阱**：`skill_list` 的 id 是 nanoka 自有编号，**不是倍率表 moveId**（曾致希格莉德整招挂错）。招式名↔moveId 的权威映射在 `public/static/catalog.json` 的 `agentSkills[].categories[].moves[]`（`<agentId>00x` 按 basic/dodge/special/chain/assist 分段编号），按**招式名**对齐，不要按 id 硬套。

**自主分析清单（读完原文，逐项自答，答不出的才问用户）**：
1. 核心被动/额外能力的**触发条件**（命中什么/谁触发/CD）→ 能确定就实现，条件歧义才问
2. **资源循环**（来源动作→数值→上限→消耗动作→收益）→ 原文有就实现（模块 computeXxxCycle），原文没给数值（如"燎火累积速率原文未给"）才问
3. **每个数值的乘区归属**（提升 X% 进哪个既有乘区）→ 按 SOP 铁律 5 判断，拿不准才问
4. **命座哪些是数值强化/哪些是新机制**→ 数值强化直接实现，新机制（需引擎新通道）才问
5. **原文没写死、需实战口径的**（覆盖率/占比/循环次数）→ 列成问题清单一次性问，不要逐条问

> 反例（2026-08 薇薇安）：落羽双源、飞羽循环、命座数值原文写得清清楚楚，却拿来反复问用户；真正该问的「异常触发机制怎么建模」「侵蚀是否限定」反而没识别出来。

## 1. spec 字段 → 消费者 → 生效测试 清单

| spec 字段 | 消费端 | 生效测试模式 | 备注 |
|---|---|---|---|
| `attributeConversions` | spec 解释器 `specs/mechanics.ts`（仅无自定义模块的角色） | 面板字段断言 | 自定义模块角色 → 在模块 `applyPanel` 实现，spec 留空 |
| `resources`（含 adjustable） | spec 解释器 `specs/resources.ts`（仅 spec 模块角色） | 资源结果断言 | 自定义模块 → 模块读 `setting:<id>`，spec 无消费者 → 别录 |
| `events` / `rowFusions` / `stateMachines` | spec 解释器 | 执行行/事件断言 | 同上 |
| `teamBuffs` | **`stores/catalog.ts` `mergeSpecTeamBuffs`（加载时合并，按 id 去重，spec 优先）** | 面板 `enemyXxx`/全队字段断言 | 与 `teammate-buffs.json` 同 id 不重复 |
| `verifications` | `scripts/validate-specs.mjs` → vitest 自动跑 | panel → expected | 用户确认的数值都放这 |
| `notes` | 人读（spec 页面/排查） | 无 | `[已确认]` / `[猜测·X]` 标注 |
| `status` | `docs/implementation-status.md` 矩阵 | 无 | 不被 import 降级 |

## 2. 自定义模块钩子（`AgentMechanicModule`，JSDoc 在 `src/mechanics/types.ts`）

| 钩子 | 阶段 | 典型用途 | 生效测试 |
|---|---|---|---|
| `applyPanel` | computePanelPhases（面板层） | 转模、面板 buff、额外能力门控（`panel.additionalAbilityActive`） | `computePanelPhases` 面板字段断言 |
| `buildCharConfig` | 配置层 | 预存倍率/时间表到 cfg（`record.<key>`）、跳过通用强特 | cfg 字段断言 |
| `estimateExSpecialTime` | iterate 每轮 | 强特链必做前台时间（资源收敛用） | 收敛次数断言 |
| `buildExecutions` | 执行计划 | 专属动作行（连段/循环/附伤载体） | damagePoolRows 断言 |
| `patchExecutions` | 执行计划修正 | moveId 级增伤/暴伤、行替换 | 行字段断言 |
| `buildResourceResult` | 资源结果 | 专属 cycle/资源卡数据 | resourceResult 断言 |

**iterate 与 buildExecutions 分离**：次数先收敛（多轮），执行计划从收敛态生成一次。模块在 buildExecutions 里算出的值只能经 **cfg 字段**留给下一轮 estimate 使用（般岳嗔火固定点、比利星光同款模式）。

## 3. 常见坑（按踩坑频率）

1. **`import-specs.mjs` 整文件覆盖人工字段**（已修复：默认合并保留 notes/teamBuffs/verifications/status，`--force` 跳过）。
   跑完任何 import/生成脚本后，**跑一次 vitest** 确认人工字段（尤其 teamBuffs）还在。
2. **双轨数据源**：`teammate-buffs.json`（采集）与 spec `teamBuffs`（人工）。消费端已合并（spec 优先按 id 去重）。
   新角色队友增益 → 录 spec `teamBuffs`（source 写「影画X」自动按命座门控），不要手改 teammate-buffs.json。
3. **enrichExecutionPlan 回填覆盖**：moveName/note 会被倍率表 zhCN/回填文案替换；行匹配一律用 `moveId`。
4. **自定义模块角色 spec 字段无消费者**：adjustable 滑块/attributeConversions 是死数据（般岳战栗是反例：应录 teamBuffs，它有消费者）。
5. **命座提升率联动放大**：技能等级 → daze → 失衡次数变化 → 伤害暴涨假象（3 命技能+2 曾被放大成 +20%）。`computeCinemaGains` 固定失衡次数场景：**阈值调节会被失衡自激破坏**（阈值变小 → 失衡次数变多 → 连携/喧响变多 → 失衡总量暴涨，无稳定点），已改为 `enemy.stunCountLock` 直接锁定次数（`calcOutput` 按固定次数算一轮，不收敛）；手工对比命座时同样锁定。
6. **失衡窗口时长**：引擎 `computeWindowDuration` = stunTime + 4 + 全队 `stunDurationBonusSeconds`（角色级延长），轴编辑器 `maxDur` 用导出的 `windowDuration`，不要硬编码。
7. **测试环境**：fetch 需 stub 三个静态文件（catalog/teammate-buffs/build-recommendations），见 `src/mechanics/__tests__/banyue.test.ts` 顶部模板。
8. **新角色配装推荐缺专武块**：`build-recommendations.json` 是初始爬取快照，新角色驱动盘/主词条有、专武块没有 → 配装面板不显示专武、「一键应用」不装专武。专武归属唯一事实源 = catalog `wEngines[].ownerAgentId`；录完新角色跑 `npm run sync:wengine-recs` 补齐（幂等，只补缺、不覆盖爬取值），护栏测试 `src/data/__tests__/buildRecWengine.test.ts`（无专武归属的角色快照也在该测试里，录入后必须更新）。

## 3.5 命座提升率丢失 / buff 丢失 · 根因与自查（星徽·比利 1531 录入实证）

命座提升率显示 0% / 偏低 / 偏高，几乎都是**效果没被计算消费**或**消费在错误的层/乘区**。按根因分类自查：

| 根因 | 症状 | 实测案例 | 自查 |
|---|---|---|---|
| 面板 buff 施加点错误 | 覆盖率滑块不生效，提升率恒定不变 | 般岳 `rageGainCoverage`：applyPanel 读 `panel.banyueRageCoverage`（从未被写入的对象）→ 滑块**长期静默失效**（已修） | **已修接口**：`AgentPanelInput` 现在带已解析的 `settings`，面板阶段直接 `input.settings['<id>'] ?? 默认值`。旧两条绕法（computePanelPhases 硬编码块 / 经 panel 字段走私）**已废弃，勿再用**。滑块必须配一条「改滑块 → 面板/结果确实变」的生效测试 |
| 作用域错误 | 提升率偏高（buff 作用到不该作用的招式/角色） | 旧 `billyStarGlowMechanic` 把星辉挂**全局 dmgBonus**（文本只作用 6 个目标招式） | 每录一个 buff 问三问：谁受益（自身/全队/敌人）？哪些招式（moveId 集合）？哪个乘区？ |
| 乘区位置错误 | 提升率数值不对（非零但错） | C6"贯穿伤害+18%"最初挂通用增伤区，应为**贯穿增伤乘区**（`sheerDmgBonus`，引擎后补执行级通道） | 乘区查表：通用 `dmgBonus` / 元素 / `skillDmgBonus*` / 贯穿 `sheerDmgBonus` / 暴伤 `critDmgBonus` / 抗性 `enemyXxxResReduction` / 基础区 `flatDamageBonus` |
| 计数源错误 | 次数类 buff 量不对 | 孤轮+8 决意只按付费强特计（**免费衔接的孤轮漏算**，后改按孤轮总次数）；格挡按招架近似（应为 `blockCount` 交互次数） | buff 次数由什么驱动：闪能 / HP / 交互次数 / 命中次数？按真实来源计数，**不要拿邻近计数近似** |
| 条件门控缺失 | 不满足条件也生效 | 星辉未挂 `panel.additionalAbilityActive` 时无条件增伤 | 文本"队伍存在X时" → 声明式 `teamConditions` + 门控；"自身攻击" → 面板/执行级而非全队 |
| 无回归断言 | 改引擎后悄悄丢 | — | 每个命座效果补**命座差分测试**（见 §5），而非只断言"开着时字段=某值" |
| 命座切换不刷新资源配置 | 执行级命座效果（buildExecutions/patchExecutions 读 `record.<agent>CinemaLevel`）全部 +0%，面板级效果（applyPanel）却正常 | 仪玄 2/4/6 命 +0%：`setCinemaLevel` 不触发 `refreshTrigger` → `resourceConfig`（buildCharConfig 产物）缓存不失效 → 模块命座字段永远是旧值 | 模块级命座效果必须验证「setCinemaLevel 切换后生效」；`setCinemaLevel` 需 `refreshTrigger++`（该 setter 已修复，新角色照此） |
| 命座门槛缺失 | 低命座也有高命座专属执行 | 仪玄 0/1 命也生成聚墨·符法千重-破（影画2 专属，缺 `cinemaLevel >= 2` 判断） | 命座专属执行 push 前必须带 `cinemaLevel >= N` 门槛，并用差分测试断言 0 命不生成 |
| 面板通道走 transformSkillExecutions + 对象守卫 | 覆盖率滑块**首次求值后永久冻结**：改滑块后面板不重算 | 可琳影画1/2、额外能力覆盖率：模块无 applyPanel → `computePanelPhases` 从不调 `resolveMechanicSettings` → `panels` computed 不追踪滑块；缓存面板对象上的 `__corinPanelApplied` 守卫又挡住 extractSkillExecutions 重施（已修：迁入 applyPanel 读 settings） | 面板级效果一律走 `applyPanel`；不要在 transformSkillExecutions 里改 panel 再用对象守卫防重复——守卫会把「滑块变化后的重算」一并挡掉。另注意测试读取顺序：transformSkillExecutions 的面板改写发生在 calcOutput 求值期间，只读 `panels` 不触发它 |
| 同一效果双通道双计 | 提升率/面板值恰好是正确值的两倍 | 可琳影画2：spec teamBuffs 条（+10 固定）与模块覆盖率折算（+10）叠加 → 面板 +20；旧断言 `toBeGreaterThanOrEqual(10)` 掩盖了双计 | 录完 grep 一遍 spec teamBuffs / teammate-buffs / 模块三处是否声明同一 stat；面板断言用精确值（`toBeCloseTo`），不用 `>=` |

**铁律补充**：命座效果录完后，必须跑一次**该命座开/关的差分断言**（`computePanelPhases` / `damagePoolRows` / `resourceResult` 的字段差异）。只断言"开着时字段=某值"发现不了"效果从未接进计算"——字段恒为默认值的断言照样通过（般岳战栗减抗就是靠用户肉眼发现的）。

**系统级兜底（资源利用率页「命座提升率」自检）**：逐命座对比 局内面板字段 diff + 伤害增量，自动打标——`ok`（有字段变化）/ `执行级`（无面板变化但伤害提升，moveId 级效果属正常）/ `⚠无变化`（无字段无伤害，效果可能未接进计算）。录入时不必手工做整套差分，但**至少跑一次命座提升率计算确认无橙色警示**。

## 4. 验收命令（录入完成后）

```bash
npm run verify      # validate:data + validate:specs + vitest + typecheck + build（一条链）
npm run docs:status # 重新生成 implementation-status.md（CI 检查漂移）
```

## 3.8 异常结算区与跨角色计数（薇薇安 1331 实证，2026-08）

**异放（release）跟随事件触发**，不是独立资源。录入异放类核心被动时：
- 载体 = 触发异放的招式（如薇薇安落羽生花、爱芮绝对音准#3）；**触发有条件**——「命中处于异常状态的目标」才触发（异常角色默认满覆盖，`xxx.releaseCoverage` 滑块默认 1）。
- 次数口径：`载体命中异常目标次数 = 载体次数 × releaseCoverage`；`releaseRatio`（basis=anomalyProficiency / anomalyMastery，perTenByElement 各元素比例）→ 引擎按元素覆盖率分配次数、算倍率（参照爱芮模板）。
- **异放限定增益**（如「异放无视 15% 抗性」）必须走模块 `releaseModifier` 返回 `enemyResReduction`——**只作用于异放结算**（`pushRelease` 单独加）。禁止写成面板级 `enemyResReduction`（会让全伤害都无视抗性）。
- **异放暴击**（如爱芮 C1）用事件的 `releaseCrit` 字段（基础率/伤 + 掌控阈值递增）。

**跨角色计数（团队级触发）**：机制依赖「全队强特次数」「全队异常触发次数」时，`buildAnomalyEvents` 阶段拿不到（异常池在更后阶段）。用**收敛注入**模式（参照露西 `lucyTeammateExNext` / 莱卡恩 `backstageDodgeCount`）：
1. `useResourceCalc.ts` runCalcRound 增加 `prev<Agent><Metric>` 参数 + 返回值字段
2. 异常池算完后聚合（`rr.characters` 的 exSpecialCount、`ap1.perElement` 的 triggerCount）
3. merged 块按 agentId 注入 cfg（`vivianTeamExTotal` 等）
4. 模块 `cycleFromInput` 读注入字段，首轮回退 `state.exSpecialCount`
5. 收敛循环传 prev（`prevVivianTeamEx = out?.vivianTeamEx`）

**后台自动招式**（预言 DoT、邦布、虎威等）：`timeBucket: 'backstage'`、`actionTime 0` 不占前台时间；次数 = `floor(战斗时长 × 覆盖率 / 间隔)`（如预言 DoT = floor(t × dotCoverage × releaseCoverage / 0.55)）。文档先例：莱卡恩围猎蓄力、橘福福虎威、露西邦布、丽娜邦布。

**资源循环双资源**（飞羽→护羽→消耗）：spec `resources` 表达不了跨资源转化状态机 → 在模块 `computeXxxCycle` 实现（纯函数 + 单测），spec `resources: []` 留空并注明「实现位置：模块」。

**异常触发机制（失衡轴内，v2 已建 2026-08-24）**：逐窗多属性积蓄槽时间线已落地 `core/stunAxis/inStunAnomaly.ts`——进窗状态指定、按时间序累积各元素槽、超阈值（BUILDUP_THRESHOLD_TABLE 第1管 × 系数）同元素同窗触发一次、输出触发时刻与每元素窗内覆盖占比、跨窗继承余量。窗口序列按 `allocateAxisWindows(resolvedAxes, stunCount)` **逐失衡展开**（2026-08-24 收口：条目 count=该模式重复的失衡窗数，积蓄余量/异常状态跨窗真实传递；小数失衡取整窗模拟，残窗忽略）。useResourceCalc 轴模式在 runCalcRound 聚合块计算（全异常队伍通用，不限定角色），经 `inStunAnomalyState` 暴露给 UI「资源利用率页·失衡内异常状态」栏。**消费端**：①异放 dominant 元素归因 = Boss 异常状态轴**点时取样**（v2.2，与极性紊乱同口径；链上元素存在手动 `releaseShare` 覆盖、或非轴模式时回落全局覆盖率权重路径，柏妮思/爱芮同款）；②极性紊乱 dominant 归因 = **Boss 异常状态轴**（v2.2，2026-08-24 用户口径「看当前时间点是什么属性异常状态」）：`computeBossAnomalyStateTimeline` 把触发序列推进成状态机——不同属性异常在已有状态下触发=紊乱并**替换**状态（归因取被替换的原状态，如需改新状态一行可翻）、风化保持不变（独立覆盖层不参与替换）；事件总次数**均分到各真实失衡窗**、逐窗按该窗状态链取样归因（标准链优先、风化层补空档、无状态回退触发者自身元素；取样窗口时长必须读状态链注入的 `windowDuration`，禁止重算——两处独立调 `computeWindowDuration()` 会因面板收敛漂移错位）；③进窗初始异常状态+**多条异常条**可指定（v2 需求①②，v2.8 多条化）：全部在失衡捏轴页按轴填写（资源利用率页只读展示），随预设导出（normalizeAxesForExport 保留）——`entryAnomaly`（BOSS_ENTRY_ANOMALY_OPTIONS 索引，进窗时的活跃异常状态→边界注入状态机不记紊乱）+ `entryBars`（**按元素多条独立预填**第一管百分比，key=基础元素；多角色各攒各的条、两条接近满进窗一碰即连续触发紊乱；积蓄槽部分预填、其余元素条并存继承）。中间态口径（用户纠正）：第一次失衡前也有窗口外积累期，每次失衡都是中间态，条目声明「敌方以什么状态进入该段失衡」。时间线阈值系数已对齐全局池（传 `anomalyCoeff×bossAnomalyCoeff` 乘积——store/pool 两端字段命名互换，取乘积规避）；编辑注意：自动命中预设/条件方案模式下编辑器展示解析副本，自动模式首次编辑自动物化为手动轴、条件方案只读；④南宫羽颤音自动层数 = min(4, floor(每窗触发数))（收敛注入 `inStunWindowTriggers`，滑块>0 覆盖）；⑤**异放次数源·事件计数器**（v2.4，2026-08-24 用户指令）：元素失衡内触发占比 = 时间线触发数 / 全局池触发数，release 事件按占比拆「失衡内(stunned=1 全额失衡易伤)/轴外(stunned=0 无易伤)」两段，总次数守恒；`inStunBound: true` 标记的事件（南宫羽颤音异放=进窗清除结算）全额记失衡内不拆分。原三项待办已收口：①次数源→事件计数器；②非轴场景逐事件状态机→用户裁决不建（轴外 = 总量 − 失衡内，平凡减法）；③异放失衡易伤窗内外拆分→随①的计数器一并解决。

## 5. 生效测试模板（机制录入必备）

```ts
// 面板级机制：applyPanel / teamBuff
expect(computePanelPhases(0, config, catalog)!.inCombat.<field>).toBe(<value>)
// 执行行机制：buildExecutions / patchExecutions
const rows = calc.damagePoolRows.value
expect(rows.find(r => r.moveId === '<moveId>')!.count).toBe(<n>) // 按 moveId，不按 name/note
// 资源循环：buildResourceResult
expect(calc.resourceResult.value!.characters[0].banyueRageCycle.rageCount).toBe(<n>)
```

**命座差分模板（防"效果没接进计算"）**：断言 0 命 vs N 命的字段差异，而不是只断言开着时的值：

```ts
const p0 = computePanelPhases(0, config, catalog)!.inCombat
config.team[0].cinemaLevel = N
const pN = computePanelPhases(0, config, catalog)!.inCombat
expect(pN.critDmg - p0.critDmg).toBe(90)        // 例：星徽·比利核心被动暴伤（0→1命应看到 enemyPhysicalResReduction +18 等）
expect(pN.enemyPhysicalResReduction - p0.enemyPhysicalResReduction).toBe(18)
```

## 6. 拐力 / 快录清单（莱特·妮可·苍角·凯撒实证）

> 目标：已有 `teammate-buffs` 草稿的支援/防护，1～2 小时内可验证交付。

### 6.1 拐力双轨：何时改哪边

| 情况 | 做法 |
|---|---|
| `teammate-buffs.json` 已有该角色完整 buff 组 | **优先修/用现成 buff**（改 description、formula、cap、defaultStacks）；再补门控与薄模块 |
| 草稿没有 / 错 id / 要新命座拐 | 录 **spec `teamBuffs`**（`source.zhCN` 写「影画X」自动命座门控），由 `mergeSpecTeamBuffs` 合并 |
| 同一效果两边都有 | **不要双写**；保留一侧，另一侧 `hidden` 或删除 |

`source` 写「影画一」…「影画六」→ `syncTeammateBuffsFromTeam` 按影画等级启停。核心/额外能力不写影画字样。

### 6.2 额外能力标准接线（漏了就永远开着）

1. spec `additionalAbility.teamConditions`（`sameAttributeAsSelf` / `sameFactionAsSelf` / `specialty`…）
2. `computePanelPhases` 里 `evalAdditionalAbility(...)`
3. **按 buff id 过滤**启用的 teammate buff，例如：
   - `nicole.additional_ether_damage`
   - `soukaku.additional_ice_damage`
   - `lighter.additional_morale_ice_fire_dmg`
   - `caesar.additional_battle_spirit_dmg`（凯撒另：有队友即近似「可招架支援」）
4. 模块侧可读 `panel.additionalAbilityActive`

只写第 1 步不做第 3 步 = 条件文本存在但计算不关门。

### 6.3 `buffModifiers`（×1.2 / ×1.5）

- 挂在**命座 buff**上，`operation: multiplyResolvedValue`，`targetBuffIds` / `targetEffectIds` 指向核心条。
- 收集端扫**全部**已启用 buff 的 modifiers（不要写死某个 id）。
- 测 C2：断言 `c2.field - c0.field` 等于放大后的差分（例：凯撒 1000→1500 差分 +500，不是绝对值 1500）。

### 6.4 `hidden` buff

- `hidden: true` 的条**不得**再进 `collectInCombatTeamBuffs`（已过滤；spec `teamBuffs` 的 hidden 经 `specTeamBuffToTeammateBuff` 透传——2026-02 修复，此前 spec 路径不透传该字段，hidden 形同虚设）。
- 若改由 `helpers` 手写数值（耀嘉音咏叹随技能等级）：notes 写清「本条 hidden，数值在 helpers」；**禁止** hidden 仍带 effects 又 helpers 再加一遍。
- 典型场景：同一效果「模块已接入（带滑块）+ spec teamBuffs 又录一条」→ teamBuffs 条改 hidden 保 UI 展示（可琳影画2 曾双计面板 +20）。

### 6.5 公式读技能等级 `s` / 源面板

- formula 里 `s` = `dynamicSkillLevel` = `12 + source.skillLevelBonus`。
- 3/5 命要涨数值时：在 `buildTeammateBuffSourceContext` 之后给 `sourcePanelsByOwner[agentId].outOfCombat/inCombat.skillLevelBonus` 写入 2/4。
- 冲击力等「先自身加成再给队友公式」：先改 source 面板再 `calcPanel`（莱特喷发 impact×1.2）。

### 6.6 邻位回能模板（终结 +10 / 下一位再 +20）

1. 纯函数 `assignXxxUltNeighborEnergy(slots, selfSlot)` → 三人 30/10，两人 30  
2. `applyXxxTeamEnergyFlags(characters)` 写 `cfg.xxxEnergyPerXxxUlt`  
3. `useResourceCalc` 组队后调用 apply  
4. `calcXxxUltEnergy` 在 iterate 能量总和里 `+ per × ultimateCount`  
（丽娜 / 露西 / 苍角同款）

### 6.7 能量口径

| 点 | 规则 |
|---|---|
| 普通能量 vs 闪能 | `cfg.isFlashUser === true` 的消耗**不要**计入「全队能量消耗」类机制（莱特士气） |
| `exSpecialEnergyConsume = 0` | `resolveExSpecialCount` **恒返回 0**；和弦/士气等自管耗能时必须关掉通用强特 |
| CD 回能整局近似 | `floor(battleTime / cd) × amount` 并入 `initialEnergyGift`（妮可 C2、莱特 C4 喷发定额等） |

### 6.8 「简单角色」快录路径

1. 读 nanoka 原文满级被动 + 影画；对照 `teammate-buffs` 组是否已有  
2. 修 buff 文案/公式；补 `additionalAbility` + helpers 过滤  
3. 薄 `src/mechanics/agents/<id>.ts`：只做草稿没有的（执行级增伤、邻位回能、转模、C6）  
4. `mechanics/index.ts` 注册  
5. 测试：纯函数 + 面板差分 +（如有）执行行 `moveId`  
6. `character-constellations.json` 更新该 id 状态；`MECHANICS_IMPLEMENTATION.md` 加一小节  
7. `npm test -- <file>` + `npm run typecheck` → commit/push  

范围扩大/无敌/护盾吸收量等**无乘区**效果：constellations 标 skip/pending，不要假装进伤害。

### 6.9 改静态 JSON 纪律

- **禁止**对 `teammate-buffs.json` / `catalog.json` / `character-constellations.json` 整文件重 dump 改缩进。  
- 只改目标 `group id` / `buff id` / `characters[id]`。  
- 改完用脚本确认：`changed groups/chars` 只有预期 id。

## 6.10 录入完成清单（交付前自检，用户按此核对）

> 录入角色 / 补机制结束时，回复里逐项写「✅ + verifier（命令/测试名）」或「❌ + 为什么没做」。禁止用「已实现」概括。

**只有 3 项通用判据**（角色专属坑如异放限定走 releaseModifier、百分比攻击走 atkPct 加算，属于档案段口径，不重复列这里）：

1. **读了角色档案段**（`MECHANICS_IMPLEMENTATION.md` 对应段）——回复引用档案里的关键口径（触发条件/乘区归属），不凭印象实现。
2. **每条机制有生效测试**——测试断言「改机制 → 伤害池/面板**真的变**」（差分断言，不是字段存在）。`npm test -- <file>` 绿 + `allAgentsSweep` 绿。
3. **命座提升率页自检 + 档案段状态行已更新**——「资源利用率页·命座提升率」无橙色「⚠无变化」；档案段「当前实现状态」行改对、口径同步。

**核心原则**：完成 = 「机制进了伤害池/面板 **且** 有测试证明它进了」。写了代码改了 spec 但机制没进结算 = 未完成（2026-08 薇薇安实证：额外能力 +12% 声称"teammate-buffs 承载"实际没承载）。

## 7. 测试卫生（面板断言）

1. **用公共 harness，不要复制 stub**：`src/test/harness.ts` 提供 `mockStaticFetch()`（stub catalog/teammate-buffs/build-recommendations 三静态文件）、`setupHarness(team)`（pinia + 加载 + 队伍装配 + syncTeammateBuffsFromTeam）、`setTeam(config, team)` 自由组合；模板见 `src/mechanics/__tests__/billySmoke.test.ts`（已迁移）
2. **关掉默认全局危局** `globalBuffs`（默认常带 `dmgBonus +15`，会污染绝对值）
3. 优先 **差分**：`inCombat - outOfCombat`、`cinema N - cinema 0`
4. 队友自带 buff 时不要 `expect(etherDmg).toBe(0)` 这类绝对值；用「相对局外增量」
5. 额外能力负例：选**不同属性且不同阵营**的队友
6. 执行级：只 assert `moveId`，不 assert 回填后的 name/note
7. 全量回归网：`src/composables/__tests__/allAgentsSweep.test.ts` 自动跑 60 角色 × 命座 0/6 的
   数字 moveId 有效性 / 次数非负 / 时间字段非负 / 伤害有限断言——改引擎后跑一遍可提前发现跨角色回归
   （刻意不做 frontlineTime ≤ 战斗时间 全局断言，口径见该文件头注释）
