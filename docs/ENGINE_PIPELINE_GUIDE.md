# 引擎管线导读（角色录入必读）

> 给后续 AI 录入角色时读的引擎数据流与钩子说明。角色口径见 `docs/MECHANICS_IMPLEMENTATION.md`，
> 中文术语→字段映射见 `docs/GAME_TERM_TO_CODE_FIELD.md`，录入流程见 `README.md` §3。
> 本文只讲"代码怎么跑"，是排查管线问题时的路线图。

## 1. 一轮计算的数据流

```
computePanelPhases(slot)         逐角色面板（局外→局内）
  └─ module.applyPanel           面板级机制（转模/面板 buff；此时 configStore 不可用）
buildCharConfig(slot)            逐角色操作配置 cfg
  └─ module.buildCharConfig      cfg 级机制（初始能量/跳过通用强特/预存倍率表）
calcTeamResources()              资源池主循环（core/resource.ts calcTeamResources）
  ├─ 时间预算收敛外层循环（maxTimeIterations 缺省 8，见 §4 坑12）
  │    ├─ iterate()               不动点：能量→强特次数→喧响→终结技→时间分配（多轮收敛）；
  │    │    喧响含按槽位注入的奖励（specialAction/anomalyDecibelBonusPerSlot，含伴随50%），
  │    │    终结技次数 = floor(totalDecibel/3000) 与 decibelSource.total 同口径；
  │    │    快支 20 奖励只在 specialActionBonus 计一次，bonusRegen 仅剩时光切片
  │    │    └─ module.estimateExSpecialTime   强特链占用的必做前台时间（每轮调用）
  │    └─ 测执行行前台时间：excess = Σ执行行 totalTime − 战斗时间，只折正 excess 进 necessaryTime（压缩平A池）重收敛
  ├─ buildExecutions()           招式执行计划（从收敛后的 state 生成）
  │    ├─ 通用动作（平A汇总/强特/终结/连携/闪反/弹刀/支援突击）；
  │    │    强特成本类型化（2026-09，src/core/resource.ts findExSpecial）：energyCost 键含
  │    │    energy 才算能量；替代资源键（如克拉蕾 "Sharpness Cost"＝锐能）→ costType=resource，
  │    │    不扣能量、次数由模块资源账本给出（cfg.exSpecialResourcePaidCount 钩子/模块自发行行）；
  │    │    无键 → free（免费强特）
  │    ├─ 额外强特行（extraExPlans，注册表 src/data/exSpecialPlans.ts）：免费/窗口门控的
  │    │    次要强特（千夏特别拍照技巧 40s/次），行值经 moveFusions 融合，喧响同口径进轨
  │    ├─ module.buildExecutions 模块专属动作（EX 链/附伤）
  │    └─ module.patchExecutions 对最终执行列表修正（moveId 级增伤/暴伤）
  └─ module.buildResourceResult  专属资源结果（specResources/billyChain 等）
enrichExecutionPlan()            从倍率表回填 damage/daze/decibel/anomaly（见 §4 坑）
extractSkillExecutions()         失衡池/异常积蓄池输入提取
伤害池/失衡池/异常池              最终伤害与覆盖率
```

关键：**`iterate`（次数/时间）与 `buildExecutions`（执行计划）是分离的**。次数先收敛，
执行计划从收敛后的 state 生成一次；`estimateExSpecialTime` 在 iterate 每轮被调用，因此
模块在 buildExecutions 里算出的值（如最高马力星光次数）只能经 **cfg 字段**留给下一轮
estimate 使用（收敛即可，见般岳/星徽·比利模式）。

**无敌时间口径（2026-08-30，`core/effectiveTime.ts`）**：boss 无敌（秽盾/转阶段）期间不可被攻击——
dot 与后台/CD 自动伤害都不结算。已扣无敌的位置：异常池 DoT 覆盖（anomalyPool effectiveTime）、
平A池（`resource/helpers.ts` `totalTime − invTime − 必要`）、失衡轴有效时间、莱卡恩围猎后台预算、
以及全部后台/CD 伤害通道（统一经 `effectiveBattleTime`/`effectiveBackstageTime`/`minusInvincibleTime`
折算，cfg 字段 `invincibleTime` 在 resourceCalc/helpers cfg 构建点注入）。**能量/喧响类通道不扣**
（口径见 resource/helpers.ts 平A池注释）；次要 CD 封顶（凯撒/希汐芙/诺姆/普罗米亚等，主源非时间）保持原值。

**后台自动招式的相位延后（2026-08-30，`phaseDelayedCooldown` + `frontBlockSeconds`）**：拥有者本人被换上前台做
必要动作（连携/强特/终结/交互）的时间插在他自己后台自动招式的 CD 循环里——前台期间 CD 照转但打不出来。
延后期望由**前台块长 t** 决定（极限：无限细分 → 延后 → 0）：相位均匀假设下平均延后 D = p·t/2（p = 前台
占比 F/W），**等效使用 CD c' = c + p·t/2**，次数 = 有效后台时间 / c'。块长 t = 前台时间 / 切上前台次数，
切上次数 = **「切上前台频率」滑块**（`<agent>.frontSwitchRatio`，clamp 0~1，无下限——后台有大量
纯跑 CD 的时间，拉到 0 = 一次切上做完全部前台，不会「一次都出不来」；默认：橘福福 0.7〔用户口径
2026-08-31〕、奥菲丝 1.0〔实测：动作 30+ 次把块切到 ~2s、延后项极小，典型副C 21~24 次 ≈ 原 主C 21/
副C 30 的中间数 25，次数天花板 = 后台时间/5s〕）× **前台动作次数**（`countFrontActions`：非平A前台行 count 之和，**接续动作融合**——支援突击
必须接在弹刀后连着 → 传 `fusedMoveIds=[cfg.assistFollowUpMoveId]` 融合进弹刀块不单独计数；
奥菲丝长按强特自动接的燥焰迸射/与火共舞#2 合一行已标 backstage 天然不计；平A是连续输出流不计）。
已接入：橘福福虎威、奥菲丝后台（原 主C 21/副C 30 静态分档删除）、卢西娅追加攻击（CD 封顶从
有效战斗时间/8 收紧为 有效后台时间/等效CD，支援位实测封顶 20 不挤压梦境瓶颈的默认 20 次；
滑块 `lucia.frontSwitchRatio` 默认 1）、蕾米 Radiant Turn（暂无滑块声明，频率缺省 1，可经 cfg 覆盖）。
约束：**合轴时间计入前台时间**（合轴时仍在做动作，
做完才轮到自动攻击）；合轴率自 2026-09-04 起**同时抵扣团队时间预算**（见坑 21）——抵扣进平A池
→ 加权角色前台变长、后台变短 → 后台自动招式次数随之下降；相位延后公式本身不变（仍读全额前台）。
不适用本修正：纯 DoT tick（薇薇安预言——敌人身上的 debuff，与施放者前后台无关）、
永续全场型（猫又每秒爪印）、以及纯封顶用途的 CD 上限（耀嘉音 C2/C6、柏妮思 C6 等，主源是事件/资源，
封顶偏松不产生误差）。扳机/触手/邦布/加农转子为队友·事件触发，本人前台时间不影响触发源，暂不接入。

**新角色接入配方**（三步，全部现成工具，无需新口径）：
1. `settings` 声明 `<agent>.frontSwitchRatio` 滑块（min 0 / max 1 / step 0.05，default 按实测反带）；
2. 模块 buildExecutions 里：`const block = frontBlockSeconds(state.frontlineTime, countFrontActions(executions, { fusedMoveIds: [cfg.assistFollowUpMoveId] }), 滑块值, CD秒数)`，
   再 `const cd = phaseDelayedCooldown(CD秒数, state.frontlineTime, effectiveBattleTime(cfg), block)`；
3. 次数 = `Math.floor(effectiveBackstageTime(state.backstageTime, cfg) / cd)`，与其他上限取 min。
   需要账本/行一致的（资源 result 也引用次数）→ 把 cap 写 cfg 字段给 buildResourceResult 复用（卢西娅模式）。

**阶段顺序（S0–S5）的单一事实源在代码里**（2026-09-11 显式化）：`core/resource.ts#calcTeamResources`
函数头有阶段表（名字 / 位置 / 输入→输出 / 判据），S1 的四步顺序在 `core/resource/helpers.ts#iterate` 头注释。
已抽出的命名阶段：`runInnerLoop`(S1) · `runFoldLoop`(S2) · `useResourceCalc#stageResolveFeasibility`(S3，含
降配验收三臂与枚举取最大可行) · 逐槽装配截断(S4) 仍在 `calcTeamResources` 体内 · `return`(S5)。
改核心前先读那张表，按阶段定位；**A 项（截断回灌）的预留接口** = `cfg.rowTimeLimit` → `feasibleRows`
（缺省不截断 ⇒ 既有口径不动）。

## 2. 模块钩子速查（src/mechanics/types.ts）

| 钩子 | 调用时机 | 能做什么 | 拿不到什么 |
|---|---|---|---|
| `applyPanel` | 面板计算时（最早） | 面板字段（critDmg/抗性无视/转模）；覆盖率滑块直接读 `input.settings` | cfg、state（轮次数） |
| `applyTeamConfig` | 全队 cfg 就绪后（三阶段，见下） | **写全队 cfg**：跨槽位联动（邻位回能/后场全队增益/入场次数汇总） | state（用 input 里的 exCounts/stunCount） |
| `buildCharConfig` | 面板之后、资源池之前 | cfg 字段、initialEnergyGift、skipGenericExSpecial、预存倍率表 | state（轮次数） |
| `estimateExSpecialTime` | iterate 每轮 | 强特链/专属动作的必做前台时间 | 全队 state（拿到的是本槽 prevState） |
| `buildExecutions` | 收敛后一次 | push 专属执行（EX 链/附伤/事件执行）；**对 cfg 只读** | — |
| `materializePhaseState` | 引擎物化调用点（紧随 buildExecutions） | **写相位状态**：把「本次物化用的 state」记进 cfg 供下一轮 estimate / 装配读（grace 平A池、1431 cycle） | — |
| `patchExecutions` | buildExecutions 末尾 | 按 moveId 补 dmgBonus/critDmgBonus | — |
| `buildResourceResult` | buildExecutions 之后 | specResources/专属展示数据 | — |
| `buildAnomalyEvents` | 异常事件计划构建时 | push 专属异常事件 | — |
| `resolveExecutionDamage` | 直伤行结算时 | 覆盖该行的元素/来源/note（返回 null 走通用规则） | — |
| `releaseModifier` | 异放/乱流释放伤害 | 减抗修正 | — |
| `transformAnomalyPool` | 异常池 perElement 汇总前 | 向 elementMap 注入积蓄贡献（风蚀等） | — |
| `resourceSections` | 展示 | 资源卡片（资源利用率页） | cfg（只读 result） |
| `transformSkillExecutions` | 失衡/异常提取时 | 专属失衡/积蓄贡献或最终面板后处理 | — |

**`transformSkillExecutions` 只做面板后处理时不要开 `replaceSkillExecutionExtraction`**：该标志为 true
才会关掉通用失衡/积蓄提取（目前只有雅/维琳娜开）。历史事故：旧代码按「是否定义了钩子」判断，
导致仅做面板后处理的 specPanelBuffs 模块（赛斯等 9 个角色）连非普攻行的失衡值一并被跳过，
修正（f20b2d5）后这些角色失衡值重新进池 —— 连带把仪玄冒烟的强特当量从 13 抬到 14。

**`applyTeamConfig` 的三个阶段**（`AgentTeamPhase`，编排层按槽位 0→1→2 派发）：

| phase | 时机 | 手上有什么 | 典型用途 |
|---|---|---|---|
| `build` | 全队 cfg 刚构建完 | 次数全 0 | 邻位回能表、读滑块写 cfg |
| `converge` | 外层不动点进入本轮 | **上一轮**收敛的 exCounts/stunCount/teamEnergyConsumed | 按失衡次数汇总全队连携、按上轮能耗算回能 |
| `postRound` | 本轮资源结果已出 | 本轮 exCounts | 为**下一轮**估派生量（全队能量消耗） |

跨角色联动一律走这个钩子，**不要**再往 `useResourceCalc` 里加 `agentId === 'xxxx'` 分支。

## 3. 关键文件地图

| 文件 | 内容 |
|---|---|
| `src/core/resource.ts` | calcTeamResources：资源池主循环、findExSpecial 等招式选取 |
| `src/core/resource/helpers.ts` | calcEnergySource（能量/闪能池）、buildExecutions（通用执行）、iterate |
| `src/composables/resourceCalc/helpers.ts` | computePanelPhases（面板+applyPanel 调用点）、buildCharConfig（cfg 构建）、enrichExecutionPlan（回填）、extractSkillExecutions |
| `src/composables/resourceCalc/roundThreads.ts` | CalcRoundThreads：外层不动点跨轮反馈量集合（新增跨轮反馈 = 加字段 + 初值 + 轮内读写，不再动 runCalcRound 签名） |
| `src/composables/resourceCalc/feasibilitySearch.ts` | 非轴降配搜索的**纯策略**：`DOWNSCALE_SCALES` / `selectDownscaleScale`（递减表 + 首个可行即停 = 最大可行档）/ `downscaleTrialAccepted`（验收三臂）；判据见判据⑤的 `@fact`，回归测试 `feasibilitySearch.test.ts` |
| `src/composables/resourceCalc/liuyinPromote.ts` | 琉音好评转大编排簇：buildPromoteParams / promoteFixpoint（内层不动点）/ applyLiuyinPromote（赠送终结技行） |
| `src/composables/resourceCalc/normaHatChain.ts` | 诺姆膛温换连携（赠送连携行注入） |
| `src/composables/resourceCalc/damagePool.ts` | buildDamagePoolRows：伤害池行构建（直伤/异放/乱流/紊乱/DoT + 轴内易伤拆分 + 角色专属直伤块），快照式入参纯函数 |
| `src/composables/useResourceCalc.ts` | useResourceCalc 编排主体：resourceConfig 构建、runCalcRound（外层不动点，线程走 roundThreads）、轴模式注入、蕾米虚耀事件 |
| `src/specs/mechanics.ts` | specToMechanicModule：spec → 模块的通用翻译（resources/events/settings） |
| `src/specs/resources.ts` | computeSpecResources：资源解释器（gain/spend/countSource） |
| `src/specs/runtime.ts` | applySpecAttributeConversions（属性转模） |
| `src/mechanics/registry.ts` | 每 agent 一个模块；spec 无显式模块才自动注册；settings 自动合并（重名抛错） |

## 4. 常见坑（实测踩过）

> **先对齐 §4 开头「时间系统三本账」表**（碰时间/账本/物化行/超时判定都先看它），再按症状查。
> **要改时间/收敛/截断逻辑前，先读坑 19 的「否决记录」**——22 条已量过数字的死路都在那里。
> **条目分层**（AGENTS 规则 8）：手册只收**协议/口径/证据**三类，编年叙事进 git/账本；带时效的结论挂触发器行 `⟳复核: <到点判什么> | 到期 <YYYY-MM-DD>`，`node scripts/zc.mjs drift` 点名逾期项——复核后撤标记或改写条目，别只删日期。
> **按症状查（不用通读）**：滑块改了面板/结果不变→1 · 强特次数不对/接管 EX 链→2 · 倍率/失衡/喧响全错→3 · 按 name/note 找不到执行行→4 · 附伤 daze/异常双计→5 · 专属动作不占时间→6 · 贯穿力疑似双计→7 · 招式命中类计数没源→8 · 轴内动作次数/时间不对→9 · 进场能量不对→10 · 指定招式增伤误放大→11 · 前台超时/账本虚增→12 · 队伍联动静默错值→13 · 界面能量与次数对不上→14 · 不收敛/数值抖动→15 · 两次算结果漂移→16 · **同一队只改降配候选集/顺序落点就变 → 先按 19⑤ 区分「选择规则敏感」与「状态泄漏」**（受控判据：把每个候选单独跑 vs 混在完整扫描里跑，结果逐位相同 ⇒ 不是泄漏） · 同输入落点漂移→17 · 物化行打不满战斗时间（欠打）/轴需求超预算误报超时→19 · 「汇总卡说快满了、角色条却空一截」（账本口径 vs 物化口径不同源）→19③（carve 缺失双算，读数 = `composables/teamTimeSummary.ts` 的 `ledgerInflation`）。 · 出现小数次数 / 招式行凭空消失 / 失衡池被清空致结果为 null →22（时间线截断）。 · **失衡次数显示 0 / 同一队冷热启动给出不同次数·同一队算两次留白不一样**→25（非轴失衡不动点的阶梯 2-循环 / 热启动缓存注入收敛末态）。 · **直伤比同类异常角色偏低 / 减防·无视防御不生效**→26（面板通用 enemyDefReduction 未进直伤通道）。 · **资源卡「总计」= 180s + 赠送秒数 / 赠送队超预算**→28（赠送行未回扣截断上限与前台展示）。 · **轴里捏的招式超过资源总量还被算进去**→29（轴栈资源门控应为「去掉」）。 · **连携技/招式「单次」时长比同族小一个量级（雅连携显示 0.515s 一类）/ 一次连携的倍率是全段而喧响-时间只是头段** →31（多段招式三侧口径不一致，含自动攻击段特例）。 · **自动轴下令牌招式行凭空消失（雨果决算 1291_ex_verdict_final 整行不见）/ 轴栈说 N 块而资源池 0 行** →36（轴内块数取连续失衡次数小数后被 `Math.floor` 归零；2026-09-10 已修复：轴内块数与池同源取整数，判据见 `hugoVerdictLanding.test.ts`）。 · **实战对比部署算出的伤害远低于实战 / 感觉失衡易伤没算** →37（失衡易伤接了但只兑现约两成：未进轴槽位走覆盖率、主C未认领招式=0；结果页伤害池已有「失衡易伤」列 + 加权汇总行，见 `composables/stunVulnSummary.ts`）。 · **想知道「还有多少静默不算的」/ 哪些缺口界面永远不提示** →38（待办清单已按 pending 非空现形 + 52 条死滑块/basis/死函数已清，逐条带复算命令）。


### ⏱ 时间系统三本账（读坑 12 / 19 / 21 / 22 前先对齐这张表）

引擎里跟"时间"有关的数**是三本不同的账**，天然不等。把它们当一本是这一族 bug 的共同根源
（实测：同一队三者可差 90s，而 UI 只报其中一本）。

| 账 | 是什么 | 谁写 | 谁读 | 与物化行不符时意味着 |
|---|---|---|---|---|
| **预算** | `battleTime − 无敌时间` | `iterate` 的 `budget` | 平A池、超时判定 | —（这是硬约束） |
| **账本** | `necessaryTime + basicAttackTime`<br>（= estimate + 折叠残差） | `iterate` 每轮 | 平A池分配、合轴抵扣、**模块的结构退化判据** | 账本 > 行 ⇒ **欠打**（发呆留白，坑19） |
| **物化行** | `executions[]` 前台行 Σ（扣合轴分摊） | `buildExecutions` + 装配截断 | 角色卡时间条、`netFrontlineOccupation`、超时判定、伤害池 | 行 > 可用 ⇒ **超打**（被截断，坑22） |

**字段名即账本名（2026-09-07 改名落地）**：`StunPoolResult.stunCount` 是**答案**（floor(有效总失衡值 ÷ boss失衡值)）；`TeamResourceResult.plannedStunCount` 是**输入**（外层不动点喂进本轮资源环的计划值）。旧名 `stunCount` 且注释写着池子的公式——读错零报错，实测同一部署 1.27 vs 4.00，据此得出的「引擎失衡偏低」结论整条作废。UI 侧 `ResultPage` 原来的 `stunPoolResult?.stunCount ?? resourceResult.stunCount` fallback 已删，池子缺席就明说。

三条纪律：
1. **超时/难度/轴退化只认 `netFrontlineOccupation`**（单一事实源），**永远不要用 `necessaryTime` 判超时**——它是"打算打多少"，不是"真打了多少"。
2. **`overflowSeconds` = 被时间线截断掉的秒数**（坑22），不是账本超预算量。历史上它是账本口径，会两头骗：真超 27s 报 0、欠打 18s 报 40.2。
3. **UI 同屏出现两套数时必须标口径**（结果页汇总卡 = 账本 + 物化并列 + 留白归因，见 `composables/teamTimeSummary.ts`）；只报一本必然被问"时间去哪了"。

**「小数次数」的实测归属（2026-09-10，仪器 `PROBE_COUNT_FRAC=1`；用户问「是缝合 180s 吗」）**：
127 预设 / 计数槽位样本 1143 → **非整数 269（23.5%）**，**主战场是连携 `chain`**（1411=24 队、1311=20、
1561=17 …），`ex`/`ult` 只有零星几个角色。**两类根因**：
① **外层失衡计划值是实数**（本表「失衡次数」行的 ⚠ 双源）：外层不动点要「净失衡按非失衡占比缩放 + 超窗口数
的残失衡按残差时间系数折小数 + 非失衡时间不足时用 `(有效−必要)/窗长` 反解」，再
`chainCountTotal = chainCountPerStun × 失衡计划值` ⇒ **连携次数大面积带小数**。语义是
**"折到时间账装得下"**，不是"凑满 180s"；
② **实数化松弛**（有意为之）：整数阶梯 = 环增益 >1 的振荡源（1431 轮数 / 1531 链数 / 1051 强特，@fact 在册），
故迭代期用实数；1051/1531 终局已投影回整数，其余没有。
**处置口径（用户 2026-09-10）**：离散动作（连携/强特/轮数/链数）**应当整数化**，时间缺口用**合轴率/预算**吸收；
**连续释放型动作（如 1171 柏妮思「单次时长可调」的喷火式强特）实数才是它的物理量**，整数化反而失真
（实测她的 `ex` 偏离仅 0.0277）⇒ 投影要**按动作性质分类**，不能一刀切。见账本 C 段第 7 条（C7a/C7b 拆法）。

### 🔁 同一物理量的多处实现（跨路径口径清单，2026-09-08 审计）

用户观察「顺序不对就有点见微知著」→ 全库审计（125 队 × 三条跨路径恒等式）：**修复前 42 队违反**，
最大差 −14.24s；收口后 0 队。护栏 = `timeLedgerInvariants.test.ts`（全预设库）。
这张表是「哪些量天生就有多份实现、单一源在哪」的现状清单——改任何一个都要回来看这一行：

| 物理量 | 现有实现处（≥2 即风险） | 单一事实源 | 状态 |
|---|---|---|---|
| **前台时间（展示）** | `buildResourceResult` 的 Σ行 / 卡片派生 / 赠送行追加后 | **最终执行行**（编排层 `normalizeDisplayTime` 重算） | ✅ 已收口（坑 28） |
| **账本必要时间** | iterate Step4 估时 + 折叠残差 + 赠送预留 | `state.necessaryTime`（cfg 字段） | ✅ 单一 |
| **截断上限** | 装配层按账本截断 | 账本 − 本槽赠送行时间 | ✅ 已收口（坑 28） |
| **赠送时间**（诺姆赠链/琉音赠大） | iterate 预留 / 折叠环行测量 / 截断上限 / 展示 | `giftTimeOfSlot`（`core/resource.ts`）+ 展示按最终行 | ✅ 已收口 |
| **失衡次数** | 池（`promoteFixpoint` 连续不动点）/ 外层不动点 `stunCount`（喂连携/喧响账本） | 池 = 答案；外层 = 计划值 | ⚠ **仍双源**（坑 25 已知残差，待裁决） |
| **连携次数** | `state.chainCountTotal` / 池 `chainCountPerStun × stunCount` / 轴 `chainCountTotalOverride` | `chainCountTotal`（三处派生同一字段） | ⚠ 与外层 stunCount 耦合 |
| **喧响收入** | 行级 Σ `rowDecibelTotal` / 旧聚合通道（已删） | 行级 Σ（`@fact engine:喧响收入行级Σ`） | ✅ 已收口 |
| **能量** | `energySource.total` / `derivedEnergy` | 同一函数同一入参（坑 14） | ✅ 已收口 |
| **伤害乘区** | `calcDirectDamage` / `calcAnomalyDamage` | 各自单源；**输入**（减防等）曾漏传 | ✅ 已收口（坑 26） |
| **暴击/锐暴乘区** | `core/damage.ts`（权威）/ `substatOptimizer` 贪心评分 / `FinalPanel`·`StatPanel` 展示 | **`core/damage.ts` `sharpCritMultiplier`**（锋御 200% 封顶、100% 以上额外锐暴**乘算**；优化器与 UI 一律调它，不得各自实现） | ✅ 已收口（2026-09-09 克拉蕾锐暴口径） |
| **倍率/失衡/积蓄行值** | 倍率表 / `enrichExecutionPlan` 回填 / 模块 override | 倍率表 + `*Override` 标记 | ✅ 单一 |
| **多段招式「一次动作」时长/喧响** | catalog 段行 / `find*` 头段 / `moveFusions` 登记组 / 赠送回填（诺姆·琉音） | `moveFusions` 登记组 → `fusedGroupMetrics`+`channelMetricsOf`（自动攻击段 `countsTime:false` 不占时间） | ✅ 全通道已收口（坑 31，未登记组属数据录入侧） |

模块侧唯一合法的「时间不够」信号是 `cfg.timePressureSeconds` / `cfg.timeAvailableFrontlineSeconds`
（折叠循环每轮实测写入）；**不要读累加的 `cfg.timeBudgetExcess`** 做结构决策——它 pass0 会被平A池
满额发放灌出虚高值且只增不减（叶瞬光自动选轴即因此被人为关掉过）。

1. **~~面板滑块拿不到 settings~~（已修，2026-08）**：`AgentPanelInput` 现在带 `settings`
   （已解析：用户值优先、回落 `setting.default`），applyPanel 直接 `input.settings['xxx'] ?? 默认值`。
   **两条历史绕法都已废弃**，不要再用：① 在 `computePanelPhases` 里写 agentId 硬编码块；
   ② 把滑块值经 panel 字段走私。走私路径本身就是 bug 温床——般岳 applyPanel 读
   `panel.banyueRageCoverage`，而该字段从未被任何代码写入 → 怒相增益覆盖率滑块**长期静默失效**
   （已修 + 补生效测试）。丽娜影画4 的硬编码块也已归位到 `rinaMechanic.applyPanel`。
2. **state.exSpecialCount 由闪能池驱动**：`resolveExSpecialCount` 用 `exSpecialEnergyConsume` 除。
   模块接管 EX 链时设 `skipGenericExSpecial = true` + `exSpecialCountFloor = true` + 一个合理 cost，
   让 state.exSpecialCount 表达"付费强特数"，再在 buildExecutions 里 push 自己的执行（般岳/星徽·比利模式）。
3. **执行计划的 moveId 必须是 catalog 倍率表编号**（1531010 才是最高马力星光），不是游戏技能列表编号，
   也不是模块自己的键名。曾把事件 carrierMoveId 写成 1531002（骑士斗技#2）导致倍率/失衡全错。
4. **enrichExecutionPlan 会改写执行**：`damageMultiplierOverride=true` 的执行保留自定义倍率，
   其余从行回填；**找不到 moveId 的执行会被替换 skillTableNote**（"未在倍率表中找到..."），
   所以测试不要按 `skillTableNote` 找执行，按 moveId。
5. **override 执行的 daze/anomaly 仍从 move 行读**：合成附伤（如 C6 煊赫星辉）不要用真实 moveId，
   用假 id（`1531_c6_radiant`），否则 daze/anomaly 双计；假 id 不进失衡/异常池、元素回退到 agent.damageElement。
6. **事件执行（spec event）actionTime=0**：不计时间。需要占时间的动作（如最高马力星光 3.1s）
   在 `estimateExSpecialTime` 里补，跨轮次经 cfg 字段传递次数（`billyFullThrottleCount` 模式）。
7. **命破贯穿力基底**：`atk×0.3 + hp×0.1 + sheerForceFlat`（core/damage.ts）。角色被动写
   "每点生命提高0.1贯穿力"只是复述基底，**不要**再在 spec 里声明 hp→sheerForce 转模（会双计；般岳 1471 历史遗留）。
8. **countSource 枚举有限**（src/specs/resources.ts）：招式命中类计数（如 attack_data_0）没有现成源，
   已扩展 `countSource: 'cfgField'` + `countField`——模块把合计写进 cfg，解释器读取。
9. **失衡轴模式**：轴内动作计数由 useResourceCalc 注入 cfg（`banyueAxisEx` / `billyAxisEx`，
   组合块已展开成 moveId），模块读 cfg 决定轴内次数；轴外剩余资源模块自行分配。
   轴内动作时间/能量由 `calcStunAxisStack` 的 combos（`module.combos`）定义，`buildStackAxes` 消费。
10. **进场闪能**：`cfg.initialEnergyGift` 默认 40（composables 构建），命破角色需模块设为 60（伊德海莉/星徽·比利）。
11. **星辉类"指定招式增伤"**：不要加全局 panel.dmgBonus，在 patchExecutions 按 moveId 集合加 exec.dmgBonus
    （星徽·比利 6 个目标招式 / 般岳 C4 / 诺姆弹头行 override 同款）。
12. **时间预算收敛（引擎外层循环，2026-08；同月改为对自家账本收敛）**：模块 buildExecutions 物化的专属
    动作行（雅霜月架势/叶瞬光飞光/柏妮思双喷/星徽比利EX链等）占用前台但若未计入 estimateExSpecialTime，
    会使前台行时间超过其账本份额。引擎在 calcTeamResources 外层循环测量 excess = Σ**前台**行 totalTime −
    （necessaryTime + basicAttackTime）【2026-08 起对自家账本收敛，不再对单人战斗预算】，**只折正 excess**
    进 timeBudgetExcess（压缩全队平A池）后重收敛；负 excess（estimate 高估/空闲前台）不动——否则
    necessary 变负、basic 膨胀。收敛后 Σ前台行 ≡ 账本，三人账本合计 ≤ 战斗时间（iterate 共享池钳制）。
    新增模块若推专属 on-field 行且不占 estimate，会被本循环自动纠正；**后台行必须显式
    `timeBucket: 'backstage'`**（如莱卡恩围猎蓄力/蕾米 Radiant Turn）——后台行不进折叠目标与队伍对比的
    超时校验（`isFrontlineExecution`，未打标按前台保守处理），否则会误报「超时」并虚增账本。
13. **队伍级联动别写进编排层**：跨槽位效果用 `applyTeamConfig` 钩子（见 §2），不要往
    `useResourceCalc` 加 agentId 分支。历史上 5 条队伍级机制被编排层手工 import + 手工按序调用，
    其中莱特那条要在 3 个位置各调一次，漏一处就是静默错值。
14. **能量口径分两个数**：`energySource.total`（展示明细合计，含队友联动 `crossAgent`）与
    `derivedEnergy`（真正驱动 exSpecialCount 的收敛能量）。二者应当一致：iterate 与最终装配
    用同一函数、同一入参（连携次数同口径）。历史版本 iterate 内调 `calcEnergySource` 时
    chainCountTotal 传 0，时光切片（音擎 13002）连携触发的回能只进展示、不参与次数推导——
    已修复对齐；两字段保留在结果上，差值 ≠ 0 即回归信号（`timeSliceChainEnergy.test.ts` 锁定）。
    跨角色回能只改 `calcCrossAgentEnergy` 一处（单一事实源）。
15. **收敛状态要看三层**：`TeamResourceResult.convergence` 上报时间预算层（converged/轮数/
    正残差/负残差 idle）与失衡外层（`stable | cycle | maxIter`）。`cycle` = 离散 2-循环兜底，正常；
    `maxIter` = 反馈量仍在变，结果可疑。`allAgentsSweep` 已对全角色断言这两条。
16. **异步数据就绪门（2026-08）**：teammate-buffs 由 `useResourceCalc` 工厂**不 await** 地触发加载，
    面板在数据未就绪时照算 → 首算无队友 buff、fetch 返回后数值漂移（曾致同配置两次全新计算
    给出 12/3,9/1 vs 12/4,8/1）；`setAgent → syncTeammateBuffsFromTeam` 同样时机敏感（数据晚到 =
    整队漏 buff）。现在：`resourceConfig` 在 `teammateBuffsReady` 前返回 **null**（失败也置就绪，
    空数据语义），config store 在数据晚到时 watch 自动重同步。**新测试只 `await catalog.load()`
    会在就绪门上拿到 null**——必须补 `await catalog.loadTeammateBuffs()`（或直接用 setupHarness）。
    回归：`determinism.test.ts`（双全新会话逐位一致）。
17. **连续松弛终局整数化（2026-08）**：强特/终结次数在迭代期以**实数**参与（`iterate` 的
    `finalCounts` 参数供终局覆盖），收敛判据 ε=1e-9（次数+平A时间）；终局「floor 基线 + 小数
    降序预算内加回」贪心装包 + 整数态重推抬升（≤3 轮）。floor 滞回曾致同输入不同初值落到相邻
    不动点（12/3 vs 12/4）；结构性整数模块（`exSpecialCountFloor=true`：琉音/诺姆/比利EX链等）
    不参与加回（其必要时间对次数非线性）。种子不变性回归：`seedInvariance.test.ts`。
    已知取舍：预算极紧时「小数次数按比例占时间」可产生轻微负命座提升（卢西娅C4 −1.2% 量级），
    旧整数动力学靠路径运气掩盖该权衡——彻底解法需按伤害评估加回候选，待定。
     **targeted 例外（2026-09-04）**：伊德海莉 refund 反馈（非失衡每发回15闪能 = 自指方程）走
     `resolveExSpecialCount` 1051 分支的专属连续松弛：refund 解析求解（`calcEnergySource`，不回读
     上一轮整数次数）+ 迭代期实数次数（必要时间信道阻尼破 2-循环）+ 终局整数重推（`calcTeamResources`
     floor 一次后重推 ≤12 轮到全状态逐位稳定）。只作用于 1051，其余模块不动。护栏：
     `yidhariInteractionGrid.test.ts`（交互网格 × 零/高种子）。全局「实数化松弛、终局才 floor」
     仍为 debt（重排所有带时间/资源循环模块的均衡，sigrid 出枪式消失前例），见 check-guards
     DEBT_REGISTRY。
     **targeted 例外 ②（2026-09-06）**：星徽·比利动力压制链数（HP 池 ∝ 普攻回血 ∝ 平A时间 =
     正反馈连续信道）走同骨架：`computeBillyHpModel(quantize=false)` 迭代期实数链 + 消滞后
     （`AgentExSpecialTimeInput.state` 传入当轮 basicAttackTime，估时与物化共用同一求解器，
     不再回读 `record.billyChainCount`）+ 终局 floor（`billyFinalizeChain` 重推 ≤12 轮，
     轴模式恒整数跳过重推——轴内捏轴是用户意图）。护栏：`billySmoke.test.ts` 实数化三例 +
     `seedInvariance.test.ts` 第二档升回逐位。配套必修的口子：① 最高马力星光 3.1s 行时间物化
     （坑19③ 对称侧，否则账本>行 idle 被回填成 refund 双击）；② 诺姆膛温赠链时间信道补账
     （iterate 必要时间预留 + 折叠/探针行测量同口径），并修 `computeNormaHatToChainCount`
     长按项漏乘 exCount（迭代期喧响信道与最终行差 1 条赠链）。
18. **Boss 预设弹刀反推（2026-08）+ 控制技（紫光技）组 × 反制支援（弹刀拆分/折算单一事实源条目）**
    - **机制（弹刀反推）**：`boss-presets.json` 的 `defaults.parryTotal` / `parryNoFollowUpTotal` +「保底4失衡」勾选
      ⇒ `useResourceCalc` 外层不动点线程（`prevParrySplit`，般岳 `prevBanyueTopUp` 同款收敛）按当前队伍反推：
      击破位（首个 `specialty==='stun'` 槽位）正常弹刀 = 保底 4 次失衡所需；主C（槽位 0）= `parryTotal − 击破位`
      （已手填不覆盖）；**不带支援突击弹刀**（只有轻弹刀倍率行 + 喧响 215、无支援突击行）按**对半分**
      （2026-09-10 更正，见「弹刀口径三件事」）、非用户可调；执行行：轻弹刀 count = parry + 无突击、支援突击
      count = parry。
    - **口径坑**：①缺口按「非弹刀失衡基数」算（失衡池 total − 击破位弹刀行贡献，行 count 随弹刀缩放）否则补齐
      自身把缺口关掉 ⇒ 0↔T 振荡；②无突击弹刀的失衡值先从缺口扣掉再反推正常弹刀；③击破位每次弹刀失衡 = 招架支援
      + 支援突击两行 `effectiveStun/count` 之和（无突击 = 仅招架支援）；④首轮注入 ≥1 探针保证轻弹刀行存在供测量，
      但探针 215 喧响经「喧响→终结技→连携」级联污染本轮失衡（曾致反推归零后无行卡死）⇒**每次弹刀失衡值随线程携带**
      （`perParryDaze`，本轮无行沿用上轮实测值）；⑤弹刀 215 喧响用**注入后有效次数**（`parryForBonus` 读
      `characters[slot].parryCount + parryNoFollowUpCount`，勿用 store 原值，曾漏算反推弹刀喧响）。
    - **只给喧响的弹刀 / 失衡赠礼**：`parryDecibelOnlyTotal`（轻弹刀打小怪无 daze）只计 215 喧响、**不产任何行**
      （不进 parryForBonus 之外的行生成）；`stunGiftRatio` 应用时换算 `bossStunGift = 比例 × stunValue`，`calcStunPool`
      加 `stunGift` 直接计入 stunCount 推导（不计抗性/返还），反推的非弹刀基数也加它（减少缺口）。
    - **控制技（紫光技）组 × 反制支援（2026-09-12 建通道，暂无 Boss 录数据）**：预设
      `defaults.counterAssistGroups: number[]` **逐组记招架段数**（数组长度 = 组数；一组控制技 = 连续数段无闪光提示
      的攻击 + 一次完美反制，术语 2000003）。折算在 **store 侧**（`stores/config.ts#syncBossInteractionPlan`，
      `flush:'sync'` 的 watch 驱动，**不改 convergence**）：队内有反制支援角色且开关 `boss.counterAssistReplace`
      （缺省开）为真 ⇒ **整组不并入** `appliedBoss.parryTotal/parryNoFollowUpTotal`（用户裁决，见「否决记录」）；
      否则每组并入「1 次正常弹刀 + 段数−1 次无突击弹刀」（= 旧手工抄录口径的自动化，折算式与其等价由此背书）。承接槽位 `configStore.counterAssistSlot`（可设
      `boss.counterAssistSlot` 指定，指定槽位没这招则回退自动，防静默失效）。执行行 =
      `core/resource/helpers#buildExecutions` 反制支援一行、**一次动作**（本体 1611028 + 专属支援突击 1611030 琢形
      由 `data/moveFusions.ts#CLARET_COUNTER_ASSIST` 融合，前台动作计数 +1 而非 +2 ⇒ `countFrontActions` 的
      fusedMoveIds 四处调用点无需改），时间/喧响走融合口径；**不并入 parryCount** ⇒ 自动不产轻弹刀/支援突击行、
      **不拿弹刀 215 特殊动作奖励**、不参与 `perParryDaze` 反推（用户口径「完全不拿 215，只算行内喧响」）。判据表：
      角色侧招式配对在 `src/data/counterAssists.ts`、**不能按名字扫**（克拉蕾 assist 段两条 `Assist Follow-Up`，
      无垢熔锋随招架、琢形随反制，名字匹配必挑错行）。时间口径：这俩 `ether_purify = 300 + 100t` 按
      `MOVE_ETHER_BASE` 定点扣，**catalog 已重跑**。
    - **两条附带口径（2026-09-12 用户裁决）**：**角力按弹刀同权重进操作难度**（`INTERACTION_WEIGHTS.counterAssist=1.0`，
      `difficultyCurve#liveInteractions` 运行时取组数并按承接槽位截断存活率缩——不是 store 字段，别去
      `ENGINE_INTERACTION_FIELDS` 里找）；**每组直接送 1 层残痕**（琢形原文「直接添加1层」⇒ `computeClaretSharpResource`
      +600 点且**不吃积蓄效率倍率**；表列 gash_buildup（本体 446 + 琢形 134 = 580/次）走「全招式积累」通道照常计入——
      送层是额外奖励、表值是实打积累，不双计）。
    - **否决记录（都量过数字，勿重新发明；规则 16③）**：
      · 无突击弹刀「全部归击破位」→ 2026-09-10 判错、改**对半分**，详「弹刀口径三件事」。
      · 整组并入后再反扣对应弹刀次数 → 用户裁决「直接不把对应弹刀次数录进去，就无需反扣」，比反扣少一个振荡面。
      · 时长只按名扣 闪反1.5/招架2.5/终结5（v12 导入器）→ 两行各多算 3s（6.717/4.117 实为 3.717/1.117）。
      · v12 一次性导入器 → 静默丢掉 gachabase 补的 gash_buildup/sharpness_gain 行（catalog 重跑时一并修）。
      · 残痕值旧算法 → 只算平A+EX、EX 错读 anomaly_buildup 列、把同时 3 层当整局毁伤上限，同日三处纠正
        （见 `MECHANICS_IMPLEMENTATION.md` 克拉蕾段）。
    - **生效测试**：纯函数 `core/parrySplit.ts` 单测 + 集成 `parrySplitInt.test.ts`（真数据叶释渊/司祭/未知复合侵蚀体）+
      `counterAssist.test.ts`（登记一致性/折算幂等/产行/不拿215/送层/难度权重/开关翻转结果确实变）+
      `claretSmoke.test.ts::反制支援送残痕`。
    > 编年史原文 = `git show 5e559f2:docs/ENGINE_PIPELINE_GUIDE.md` 坑18（原43行），2026-09-12 按规则 8 拆薄。
19. **时间预算族：欠打回填① / 轴退化② / 双算③ / 合轴④ / 降配⑤ / 截断⑥（时间账单一事实源条目）**
    > **档案指针**：本条曾是 340 行编年史（逐日对账/逐队归因/实验过程），2026-09-12 按
    > 「症状/根因/判据/否决记录」四栏拆薄（任务卡「经验手册防历史记录化」示范条）。
    > 原文逐字 = `git show 28886bb:docs/ENGINE_PIPELINE_GUIDE.md`（320–660 行）。
    > **症状→分条**：物化行打不满 180s（欠打/留白）→① · 轴模式误报超时/该退化不退→② ·
    > 汇总卡说快满、角色条却空一截（账本虚增）→③ · 轴内并行白计前台→④ · 手填交互超预算→⑤ ·
    > 资源卡「总计」与截断不自洽→⑥。生效测试族：`underfillRefund` / `timeLedgerInvariants` /
    > `timeFillRatchet`（棘轮，`TIME_RATCHET_UPDATE=1` 重生成）/ `teamTimeSummary.ledgerInflation`。
    > **口径母表 = §4 开头「时间系统三本账」**，本条只写各族判据与死路。
    - **根因（族共性）**：estimate（估时）、账本（必要+平A）、物化行（装配后）是同一真值的**三个投影**，
      收敛环在投影间求不动点；任何一处口径不同源/单向修正/滞后回写，都会被正反馈环
      （refund→平A→回能→次数→行）放大成落点。所以修一个症状前，先确认三投影谁在说谎。
    - **判据①（欠打回填）**：折叠循环原只折正 excess，「estimate 高估→平A池挤到 0→欠打」无人管
      （般岳队实测前台 172.8s 欠打 7.2s）。双向修法 = **末轮重测**（首轮冻结已废：pass0 恒测到正
      excess → refund 冻成 0，41 队留白 >1s 最大 93.7s 而 `timeBudgetConverged` 仍 true）：折叠退出后按
      「预算−物化前台净占用」量欠打，**折半试探**注入 `config.timeBudgetRefund`（团队级）回进
      `iterate.availableBasicTime`（按 timeWeight 分配、时间守恒）重收敛。接受三条件 = 内层判稳 +
      `trialRows ≤ 预算−容差`（可行性）+ 行数确实变多；任一不满足**连 cfg 整体回滚**（试探轮会触发
      模块写回：叶瞬光按 `timeBudgetExcess` 自动选轴改 `record.yeshuguangAutoAxis`，只回滚 refund
      会把退化后的轴留在 cfg → 留白反增 7.8s、伤害 −13%）。**门槛 1s = 量化容差**（用户口径：平A权重
      与留白不应并存；≤1s 属坑12 量化地板不试探——历史上 ≤5s 曾把近均衡队推进 `stunCount=0` 吸引盆，
      盆不复现于 09-08 实数化引擎后复核通过）。三条纪律：**可行性优先于留白**（`netFrontlineOccupation
      ≤ 预算` 是被轴退化/降配/队伍对比消费的硬不变量，宁可留白不制造超预算）；**热启动只存规范种子**
      （试探前末态 `warmSeedStates`，存回填后末态 ⇒ 下次测不到那个正 excess ⇒ 冷热落点分叉，实测
      1241/1191）；**排除队机制已废弃**（`probeExcludedTeam` 已删、2026-09-10 起无排除队——1591 病根被
      能量行级Σ 07481b8/a337c02 带走，**不是**「试探与装配同源」做完了，缺口见下一条）。
      真超预算的兜底读数：`timeGolden.over = max(0,−slack)`（截断后净占用），**不是**装配期截断
      `overflowSeconds`——判截断生效面必须直接读 `overflowSeconds`/`truncationBySlot`（测量陷阱，踩过两次）。
    - **判据①bis（行测量与相位契约，「阶段1」两刀已落部分）**：时间行有 **7 处生产者**（buildExecutions
      + 各模块钩子 + 诺姆膛温 `normaHatChain.ts` + 琉音赠大 `liuyinPromote.ts` + `enrichExecutionPlan`
      重建 + 装配截断 + 轴栈自持块），收敛试探原先只见其一 ⇒ 「自测合规、装配后超账本」（1591 系实测超
      0.07~1.13s）。已落：单一入口 `core/resource/helpers.ts#materializeRows`（行物化+快照/恢复）；
      **模块物化钩子对 cfg 只读**，跨相位载荷性回写（曾 3 处：格莉丝 basicPool 缓存/叶瞬光 cycle/卢西娅
      cap）一律迁 `materializePhaseState` 钩子、由引擎在 `buildExecutionsWithSpec` 物化调用点按同一 state
      显式补写（第二刀收口，探针口径 = 钩子前后 cfg 顶层键 diff，全仓 73 处写入中**跨相位读者**才是判据，
      已拆净 ⇒ 测量切 `materializeRows` 0 delta）。未落：③④装配期追加行的**行本身**（含 carve）、
      enrich 重建、轴块尚未进单一 `materialize`——「让 materialize 直接产出行」实测不是纯搬运：
      池提取会把赠行与 `adjustStunExecs` **双计失衡**、enrich 会**凭空补上**生产侧刻意留空的字段
      （琉音赠行 daze 398.9 / 诺姆 skillDamageTarget 吃定向增伤）、目标槽推导 core 用 `configs.length`
      vs 编排层用队长（单角色扫描时赠行目标=自己→不产行）。当前达成的替代口径 = 赠行**行契约**单源
      （`core/resource/giftRows.ts#buildGiftRow`，`totalX = 单次×次数` 换算单源）+ 三条保真：池提取
      `skipGift`、enrich 对 `source:'gift'`/`normaGiftChain` 行直接返回不补、`ResourceCalcConfig.teamSize`
      **只**用于行口径解析目标槽（账本/试探仍 `configs.length`）。库级判据：`giftMoveTimeLedger` +
      `timeLedgerInvariants` 赠行断言（非轴队 `liuyinGiftTimeReserved + normaGiftTimeReserved ==` 装配赠行Σ）。
    - **判据②（轴退化）**：轴的资源需求（轴内块/自动补齐交互×窗口数）超战斗预算 = 轴**不可操作**
      （需 boss 秽盾等外界才打得成）。检测：轴模式前台行 > 预算+2s 时跑一次非轴对照，**仅当对照可行**
      才弃轴重算（配置本身超预算的场景弃轴无意义，与⑤同判），`convergence.axisFallback=true` 上报
      （队伍对比页 timeDetail 标「已退化为一般轴」）。自动补齐类交互的生效测试须落在补齐后仍可行的
      需求域（banyue.test「轴退化」用例）。
    - **判据③（双算）**：两个方向都会虚高。*estimate 侧*：模块把「池守恒、不生成行」的块计入
      `estimateExSpecialTime`（般岳 banyue-combo 连段块时间已含在怒相行内）⇒ estimate 与物化**逐项对账**
      （`computeBanyueCycleFromCfg` 输出 vs 物化行），差值恒定非零 = 双算。*物化侧*（更隐蔽，朱鸢案）：
      模块 push 的行占的是平A池时间（1 枚霰弹 = 1 段平A）却没从 `basic_attack` 聚合行挤出 ⇒ 同一段时间
      计两次（实测聚合 47.24s + 以太弹 46.60s，虚高 59s，该队留白 30.1s 全库最大而 converged 一路 true）。
      **凡生成 `category:'basic'` 或时间来源于 `state.basicAttackTime` 的行，必须 carve 聚合行**
      （琉音转大是样板；已修朱鸢 1241 以太弹 30.1s、希格莉德 1591 出枪式 20.6s——后者**只缩时间、保留
      回能**：分段行不带 `energyRecovery`，按比例缩会凭空丢能量）。判据 = `Σ前台行 ≤ 账本(necessary+basic)`
      恒成立，`teamTimeSummary.ledgerInflation` 逐队读数（>2s 即双算，棘轮钉住）。对称侧同判：账本有的
      秒数行上也必须有（星光行时间物化，starlightBilly.ts），否则欠打试探把它测成 refund 双击。
    - **判据④（轴内合轴）**：窗口内跨角色块并行（般岳强特时琉音抱拳）只计一次前台——栈引擎
      `calcStunAxisStack` 按执行块区间并集算 `overlapSeconds`，按块时长比例分摊进
      `overlapByAction['slot:moveId']`（严格可加）；净占用 = Σ物化前台行 − 合轴分摊；iterate 平A池、
      折叠 excess、超时判定、退化/降配判据（`frontlineTotalOf`）**全链同口径**。同槽位顺序块不重叠；
      赠块 `:gift` 后缀 key 不匹配 → 不扣（保守方向）。
    - **判据⑤（非轴降配 + 验收三臂 + 搜索策略）**：无轴态净占用仍超预算 = 手填交互（招架/金身/双反/
      闪反）总需求超预算，与轴厚需求本质相同 → 缩放交互次数（`runCalcRound opts.interactionScale`，
      只缩 store 侧输入；boss 强制弹刀 `parrySplit` 直读 store 不被缩、轴补齐在其后叠加）。
      **触发双臂**：`overBudget`（旧单臂读截断后净占用 ⇒ 恒 ≤ 预算 ⇒ 对「必要行装不下」的队永不成立，
      = 死代码，2026-09-11 修）+ `truncatedToo`（装配期真截断 `overflowSeconds > 1s`）。
      **验收三臂**（各对二分前基线态、1s 量化容差）：①截断不更狠 ②净占用不更超 ③省下的时间不许变新留白；
      三臂相对基线**构造上不可能红棘轮**（只拦变差），红的只会是 golden 硬字段（有意改进按规则 10 归因重排）。
      **搜索**：SCALES 由大到小枚举（0.875…0.0625），首个「三臂不更差且截断≤1s」者采纳（= 保留最多交互的
      最大可行 scale）；无人满足 ⇒ 不动、如实上报截断（交给逐模块退化）。**已知成本**：结构性溢出队付满
      8 次整轮试算——「先最小候选探一次、失败即跳过」的成本闸门实测**会改结果**，不采用。
      **根因（2026-09-13 受控复现，推翻早前「试算不纯/状态泄漏」的说法）**：每个 scale 的试算结果与它前面
      跑过哪些试算**无关**（实测 `yixuan-roxy-lucia`：0.25 单独跑与跟在 0.0625 后跑，net 均 180.191、计数均
      16/6）；真因是**可行集不是 scale 的下闭区间**——全库进入枚举的 21 队里 **7 队**存在「可行 x 且存在
      y<x 不可行」，其中 **3 队最小档不可行但更大档可行**（`auto-1461-1521-1031` 可行={0.875,0.625,0.5}、
      `auto-1431-1481-1311` 可行={0.375}、`auto-1531-1571-1451` 可行={0.875…0.25}）⇒「最小档不行 ⇒ 全体不行」
      的前提为假，成本闸门必然漏掉更大档。**结论**：现行「由大到小全枚举、首个可行即停」是这条非单调可行集
      上保留最多交互的正确策略，不要再加成本闸门；真要省算力必须**先证明可行集下闭**（现在证伪）。
       **已尝试的两条省算力路线（都实测否决，勿重走）**：① 成本闸门（见上）；② **缩放配置去重**——
       实测 168 次试算的「缩放后交互配置」**两两不同**（`cfgUniq` 每队 = 8/8，无一对可合并）⇒ 无去重空间。
       **策略的单一事实源** = `resourceCalc/feasibilitySearch.ts`（纯函数 + `feasibilitySearch.test.ts` 12 例，
       含「非下闭可行集也必选最大可行」与成本闸门反例锁死）；引擎只注入 `runOuterLoop` 试算。
      **锁定失衡次数（`stunCountLock ≥ 0`）一律不触发退化/降配**
      （锁定=用户明确意图，引擎不改结构）。**验收臂设计教训（2026-09-11）**：「截断≤1s」并进验收会拒掉好
      试算、停在基线 3.78s 超预算；受控实验证明被拒试算**无可观测副作用**（「+2.8s 回归」=验收太严而非污染）
      ——要改的是**验收目标设计**（消截断/时间账不恶化/伤害不降的取舍），别拿「收紧验收」当修法。
      实测生效面：119 预设 0 delta（预设场景被净占用臂/轴路径覆盖），手组默认配置有效（仪玄+洛克茜+卢西娅
      截断 10.7→1.6s）；只动 6 队：截断 43.21→0/10.77→0/7.82→0/3.73→0/27.19→4.30，伤害 5 升 1 降。
      **残留 4 队（全是叶瞬光 1431 簇）已定性，别再加阶梯档位**：根因 `setting:yeshuguang.formAxis`
      声明默认 0=打满、绕过模块自带 full→short_pair→short_mie 自动阶梯；但**改默认成 auto 不是修法**——
      阶梯压不干净（full 截断 117.8s → 短轴仍 47.1s，代价伤害 −8%/−21%；超预算是**队伍级**的，她自己
      nec 只从 119.2→100.5）。正确处置 = 如实报「部分兑现」（`overflowSeconds`+`truncationCuts` 逐行清单
      + 难度轴交互按存活率缩）；真修法在实数化专项（轮数与平A池联立）+ 逐模块结构行收口。
      另注：该队两次等价调用 `axisFallback` true/false 分叉待查，疑属「未实数化队落点随初值漂移」既有性质
      （多不动点+调用顺序）。**移动靶残差定案**（勿再误归因成估时缺口）：banyue-liuyin 1.4s 与 1431-1481
      系 1.5~1.9s over 是降配逐轮缩放+折叠环收敛不完的**量化残差**（interactionScale 精度 ~1.6%，0.70/轮
      要到 1e-3 需 ≈24 轮），修它 = 改降配精度/判稳口径，不是改估时。
    - **判据⑥（截断不回灌资源循环，A 项已立项）**：装配期截断只削**行**，资源账本
      （`calcEnergySource/calcDecibelSource` 走 `materializeRows(state)`）取**未截断**收敛态 ⇒ 有截断时
      资源池与 180s 计划不自洽（实测般+诺+卢全关档：`overflowSeconds == timeTruncatedSeconds == 66.8s`/21 行，
      池子却显示「已打满」；槽0 回能账本 200 vs 截断后 Σ行 140）。**合轴率就是周转手段**（抵扣 0→40→80.1s
      时截断 66.8→25.9→0）。止血已落：结果页「时间截断 X s + 被砍招式清单」（旧文案「超预算」作废）+
      难度轴交互按 `kept/requested` 缩。正解登记于 DEBT_REGISTRY
      `src/core/resource.ts:截断不回灌资源循环`（用户语义：先按预算重分配平A池、交互只取「达成目标的最少
      要求」，装不下就重收敛到截断为 0）。
    - **判据·通用（实数化的正确下手处）**：要松弛的是**模块自己的「资源→动作套数」映射**里的 floor，
      不是引擎折叠动力学。三条判据：①该量必须挂在**连续量**上（平A时间/回能/局外剑势）；②必须是
      「套数/轮数」而非**命中事件计数**（你不能打中 3.4 次——`countBasicFinisherHits` 属这类，不该动）；
      ③用户显式次数（滑块）保持取整（那是意图不是推导量）。1431 样板：留白 321→301s、她 8 支预设 3 支
      留白归零、全量 1585 测试零改动通过（对比：动引擎折叠的 5 个变体每次都让别的队掉 stunCount=0 盆）。
      seedInvariance 两档判据 = 已实数化角色保留**逐位相等**，未实数化整数队退到「同一套打法」档
      （次数差 ≤1、平A差 ≤2s、喧响差 ≤2%，两落点都必须可行）。
    - **未落地·有裁决（别从零再论证，接着做）**：连携/破阵按「实际失衡次数」（用户裁决 A）——净失衡是
      值域折算量、连携是事件，混用致 91/125 队两值差 >0.5、14 队连携行归零而 UI 仍显示池次数（同一
      resourceResult 自相矛盾；1591 受害最重：冰凌卷地是[砺]/破阵唯一来源）。**开工第一步 = 先立不变量
      测试「`stunCountLock ≥ 0` 的队 A 前后输出逐位相同」并打通**（第 2 次尝试 14 消费点已改齐、症状消失，
      死在锁定路径被退化/降配两条独立调用各算各的 `eventStunCount`，corin/lycaon 锁 3/4 实收 2）；
      打通前**禁止** `TIME_RATCHET_UPDATE=1` 绕红。
      ⟳复核: 实数化专项立项/连携改造开工前，确认裁决 A 与「锁定队逐位相同」前置仍成立 | 到期 2026-10-31
    - **否决记录（都量过数字，勿重新发明；规则 16③）**：
      · 折叠 `fold=excess`（不累加）或 `max(fold,excess)` → 正反馈队（猫又/伊德海莉）欠补偿，**溢出 186s**。
      · refund 逐轮跟随（不冻结不试探）→ 留白 1544→267s 好看，但**超预算队 8→20**，毁 `净占用≤预算` 硬不变量。
      · 换收敛初值（basic=0 种子起步）→ **完全无效**（excess 测于内层收敛后，逐位相同）；个别队换落点 = 不动点不唯一的症状，不是可修的口子。
      · 折叠残差双向回退 `fold←max(0,fold+excess)` → 留白 1075→266s 但红 14 条，含 `allAgentsSweep` 时间不溢出 + **C6>C0 恒真不变量被破坏**。
      · 比利(1531)消估时滞后（估时与物化共用链求解器）→ 留白 −18s 但**超预算 +21s**（两预设顶破 10.4s）：她的链数 ∝ HP池 ∝ 回能 ∝ 平A时间 = 正反馈，「读上一轮 `billyChainCount`」的滞后是**无意的稳定器**——**别照 1431 做法套她**（1431 的 floor 是纯离散化无正反馈）。
      · 截断上限改「min(账本, 本槽可用前台)」→ 留白 240→**1476s** 灾难：可用前台拿队友虚高账本算、厚槽互压成 0；钳制必须全队按比例分摊，不许逐槽看余量。
      · 只做 refund 生命周期（账本闸）不消滞后 → 留白/超预算/队数**一个数没变**（双重花费只在消滞后后才出现 = 为还不存在的问题做手术）；比利实数化后重测 → **零次有益触发**（存量双花已随赠链信道+星光行物化归零），剩余 8 队超预算全非 refund 原因，账本闸无作用面。
      · 截断从装配尾部**整行丢** → 模块行（架势段/抱拳）恰排最后又正是伤害/失衡载体 → **失衡池空、`calcOutput` 返回 null**。
      · 截断**等比缩 count** → 产出「强化特殊技 ×2.78 次」不存在的动作，红 11 条（次数必整数，坑22）。
      · 给叶瞬光打短轴压时间 → **压不住**：轮数由资源驱动，每轮变便宜反而多打几轮（full 6轮121.5s → short_mie 9轮206.9s）；缩交互同理（弹刀 6→0 省 31s 被平A池吃回）。省下的时间会变成能量、次数、变回动作。
      · 星光行「只进估时不物化时间」→ 账本>行的系统性 idle 被试探测成 **refund 双击**（refund 26.5s → 超预算 16s）；物化**套用轴模式** → 顶破预算触发退化、两用例红（轴内时长归栈引擎窗口计账，物化只对非轴生效）；比利终局整数重推**套用轴模式** → 空转+cfg 回写扰动（留白 2.7→**8s**；轴内链数恒整数，重推块须跳过轴模式）。
      · 诺姆膛温赠链预留按 **prev 轮** hatCount → 预留 11.9 vs 行 14.3s、超预算 2.4s 在 5↔6 两循环阴魂不散；根因 = `computeNormaHatToChainCount` 长按项**漏乘 exCount**，修纯函数对齐 + 赠链时间进必要/折叠/探针同口径后归零。
      · 琉音强特估时**单独**补（三强特轮转+送客进必要时间）→ 7 队回归 + `maxExcess≤1e-6` 判据被 0.0005s 残差耗尽（sweep 硬断言 converged=true 破）；**三件套才可落**（判据放宽 1e-3 + 转大赠链进必要时间 + 轴模式回落通用公式）。
      · estimate 改读 prevState 现算（替代格莉丝相位缓存）→ golden 15 条 delta（1181 c0 留白 23.5→0s、c6 失衡 1→2）+ underfillRefund 1 红 + inStunAttribution 4 红：旧值由**最后一次物化调用**写（装配相位），prevState 是另一相位的解——折叠未收敛时不同解，不是等价改写（1431 cycle 同法破 warmStart + 留白 9s）。
      · 「先切试探测量、再拆相位写入」→ 顺序反了，golden 多 18/9 条 delta（全在 1431/1181）：测到的是相位污染不是口径差异；「切 `materializeRows` 但不补 `materializePhaseState`」→ 10 条 delta（1431 留白 57.9→65.4s，下轮 estimate 读陈旧值）。**先拆写入、后切测量**，补写即 0 delta。
      · 撤 1591 排除的五个半修 A/B/C/D/E（carve 按分段行分摊 / 只关排除 / 轴 promote 线程化进 iterate 预留 / 试探测量补赠行 / 再收窄补记）→ **全部否决**：A 留白变差、B 越账 1.863s、C `timeLedgerInvariants` 绿但 ratchet 4 队变差而**同队预设配装反而改善**（预留改变不动点落点、方向随配装翻转）、D/E 一动测量就改试探注入量⇒改落点。当时结论「撤 1591 须跨层口径统一+数值重排、用户裁决后再动」——后病根被能量侧改动带走（2026-09-10 解除，见判据①），五种半修本身仍是死路。
      · 轴 promote 三口关开关矩阵（见上 C 的扩展）→ 只有「**只统一试探测量**」0 delta 可落；iterate 预留 = 池侧减法无行侧加法配平（4 队留白 +2.7~+3.4s）；只统一装配侧 = 落点大改（stun 4→6、dmg +32.5%/−5.8%，属数值重排须裁决）；预留+分段 carve = **二次减法**（1.617→8.020s）。三变体一致结论：轴模式赠大时间已由轴窗口/carve 计入，**不该再加账本预留**；「轴模式不预留、装配侧不计入、只有试探测量按轴口径统一」是实测口径而非未决。
      · 资源账本行级收入改读「按 `necessaryTime+basicAttackTime` 截断后的行」（M1 第一版）→ golden **320 条 delta**（最大 −14%、ult 7→6）：`iterate` 中途账本 ≠ 最终账本，按中途小账本截收入 ⇒ 次数更少 ⇒ 账本更小 = **自锁的低吸引子**。正确形态 = A 外环（收入只按装配期实测可行量 `cfg.rowTimeLimit` 注入、缺省不截断，判据「over==0 队 delta 逐位 0」），设计见 `.claude/task-ledger-calc-core.md`。
      · M1 第二版（A 外环 + `rowTimeLimit` 注入装配期 kept）→ 机制跑通（100 队零变化）但**有截断的 19 队 0 收敛**（残差 1.57~67.21s）：这些队必要行是**结构性的**（模块按机制推行、不受回能支配），缩收入碰不到必要行（basic→0 后 Σ必要仍 > 预算）。**A 项剩下的杠杆不是账本而是必要行本身**（目标层不录取会把旋转推入结构性溢出的档，或模块自退化/判「不可行」= 坑22⑤），不是再调收入口径。
      · 1591「机会→敛枪式套数」targeted 实数化 + 终局整数重推 → **目标队纹丝不动**（refund 是折叠 pass0 冻的存量，重推在它之前跑改不到），代价先付两笔：2 队漏出小数次数（敛枪式 12.23 次，坑22 禁止）、1 队 tbConv true→退 false。**1591 的 over 在 refund 生命周期层不在套数 floor 层，勿再局部试**；要真修与「比利消滞后+单槽时间闸」联合求解 = 实数化专项（DEBT_REGISTRY）。已落地的只有 #4 双计删除（用户改判：一次出枪式命中只记一次机会，保真度修正、与落点无关）。
      · 欠打试探「规范试探输入」（重跑默认零种子取规范停点）→ 无效：`runInnerLoop(defaultSeed)` 只重跑内层、缺折叠残差累加，停点根本不触发试探。1051 连续松弛队一度整体排除试探（`yidhariContinuousPresent` 门控）——那是热启动缓存注入收敛末态导致冷热分叉的**症状止血**，「缓存只存规范种子」修好后排除已撤销（放回后 yidhari 系 5 队留白再收 6.9s）。管线级规范重放属实数化专项，未做。
      · 降配搜索用二分 → 可行域**不是** scale 的下闭区间（「截断≤1s」并进验收时好试算全被拒，停在基线 3.78s）；用「最小截断优先」→ 把结构性溢出队压到 0.0625（交互几乎清零），与「交互只取达成目标的最少要求」相反。现行 = 由大到小枚举取最大可行。
20. **transformSkillExecutions 里写 panel 字段会跨收敛轮累积（2026-09-01）**：`panels` computed 在
    calcOutput 一次求值（外层不动点 20 轮）内**缓存同一对象**，`transformSkillExecutions` 每轮调用
    → 裸 `panel.xxx = (panel.xxx ?? 0) + 贡献` 会把贡献 × 轮数叠加：派派物理积蓄效率 80%×20=1600%
    （物理积蓄 28.9 万）、安比充能 dmgBonus 45×16=720%、雅积蓄效率 600%。
    **架构铁律（用户 2026-09-01「属性和倍率招式分开」）**：面板 = 静态（gear + 队友 buff + 模块
    applyPanel，一次构建不再改），收敛循环只算招式/资源池。面板字段写入一律走 `applyPanel`
    （依赖必须是 settings/cinema/team/AA 等静态量）；transform 只许改 exec/异常 exec。
    已迁移：派派（积蓄效率）、安比（C6 充能 dmgBonus，兼修 C0 泄漏）、雅（冰抗无视/冰焰/霜灼积蓄）、
    雨果（暗渊回响暴击暴伤，兼弃布尔守卫冻结坑）、普罗米娅（额外能力冰积蓄）。**新增面板写入走
    applyPanel**；transform 里出现 `panel.xxx =` 即红灯信号。
21. **合轴率抵扣团队时间预算（2026-09-04 合轴口径落地）**：必做动作的合轴段与其他角色动作并行，
    `iterate` 平A池按 `Σ(necessary − 抵扣)` 收费——**Σnecessary 允许 > 战斗时间（Σ>180）**，
    只要合轴抵扣后净占用装得下；`overflowSeconds` 按抵扣后净额（不硬截断）。三条铁律：
    ①**只抵扣含在 necessary 内的合轴**：模块 `estimateExSpecialTime` 缺省 GROSS（necessary 按全额
    计，合轴可抵）；照/卢西娅把合轴动作从 necessaryTime 剔除（NET 约定），必须标
    `comboAlignIncludedInNecessary: false`，否则同一重叠双重抵扣（新写 NET 模块漏标 = 静默超放宽）。
    ②**轴模式与栈引擎节省按槽取 max 不叠加**（同一物理并行的两种模型；缺省合轴率全 0，退化为原口径）。
    ③**超时判定必须走单一事实源 `netFrontlineOccupation`**（Σ前台行 − 每槽 max(招式抵扣, 轴内节省)）：
    轴退化/降配（useResourceCalc.frontlineTotalOf）与队伍对比（teamCompare.actionTimeTotal）共用；
    另加**单角色前台 ≤ 战斗总时间**硬顶（合轴放宽团队预算不放宽单人物理时间轴）；硬顶截断的份额
    **按剩余权重水填回流给还有余量的队友**（2026-09-05 改，替代 09-04「留池不重分配」——旧口径下
    截断量直接在池里蒸发，而合轴放宽恰恰是为了把池打开）。水填至多 `configs.length` 轮必然收敛
    （每轮至少一个槽贴顶退出）；无有余量的队友时（支援/防护默认权重 0）仍留在池里。
    生效测试 `comboAlignBudget.test.ts`（截断到 180 + 回流 + 守恒四条断言）。
    生效测试 `src/composables/__tests__/comboAlignBudget.test.ts`（8 例：池扩大/overflow 净额/
    GROSS-NET/max 不叠加/硬顶/端到端/回归守卫）。
    **消费方**：`overflowSeconds` 已并入 TeamComparePage 操作难度横轴（`computeDifficulty` 的
    **时间压力**项，默认 1 秒 = 1 难度点；只厚轴队 >0，用户口径 2026-09-04）。**2026-09-11 口径合并**
    （用户：「合轴本身就有难度，通过合轴来让溢出时间降低这俩其实是一个东西；允许溢出一部分的原因
    是队友可以合轴，而合轴的效果是总动作时间可以溢出一部分」）：难度里的时间压力 = 硬溢出
    `overflowSeconds` + 合轴抵扣 `frontlineOccupationBreakdown().saved`，两半相加后**只挂一个权重**
    （`weights.timePressure`）——原「溢出权重 + 合轴权重」两旋钮会把「拿合轴换掉溢出」重复计一次，
    造成 V 型假象。难度是主观量——交互权重与时间压力权重都只是默认值，用户在对比页「难度权重」
    弹层自填覆盖（localStorage 持久化，优先级 条目weight > 用户覆盖 > INTERACTION_WEIGHTS 默认表；
    旧存的 overflow/align 两旋钮读取时合并成 timePressure）。

22. **时间线截断 = 资源循环的硬不变量（2026-09-05 用户口径）**：资源允许的**动作量**超过可用
    前台时，必须在时间线处**截断**——实战 180s 到点结算，不管这一轮明心境/这套连段打没打完。
    旧引擎没有这一层：装不下时只能靠折叠循环把超出量折进 `necessaryTime`（账本虚高）→ 平A池被
    挤成 0 → 物化行反而打不满（实测朱鸢队留白 93.7s、叶瞬光队 18~58s），既不准又解释不了。
    实现：`truncateExecutionsToFrontline`（装配阶段，`core/resource/helpers.ts`）——
    ① 平A是填充行先占位，招式行只能用「可用前台 − 平A」；② 次数**必须整数**（限定主体：本条只管
    截断函数自己的装包算术，复用坑17 的「floor + 小数降序预算内加回」；等比缩会产出「强特 ×2.78 次」，
    实测红 11 条。**不适用**于实数化推导出来的行——琉音好评转大的赠行 `count` 实测就是 0.3979 这样的
    期望值，口径合法（见 `agent:1431/轮数实数化`），别照本条去 floor 它）；
    ③ 砍到 0 次的行整行消失，不留 count=0 幽灵行；④ 派生量（喧响/能量/积蓄/回血）随次数同比例。
    **不要改成"从尾部整行丢"**：装配顺序 ≠ 出招顺序，而模块专属行（叶瞬光架势段、琉音抱拳）
    恰好排在最后又正是伤害与失衡的主要载体——实测把它们删光会清空失衡池、`calcOutput` 直接返回 null。
    配套：`overflowSeconds` 语义 = **被截断掉的秒数**（不再是账本超预算量），消费方 TeamCompare
    操作难度不变；`cfg.timePressureSeconds` / `timeAvailableFrontlineSeconds` 是模块侧唯一合法的
    「时间不够」信号（**不要读累加的 `timeBudgetExcess`**，它 pass0 会被平A池满额发放灌出虚高值，
    叶瞬光自动选轴曾因此被人为关掉）。
    **接入状态**：封顶后的必要前台（`iterate` 的 `cappedNecessary`）**同时**用于平A池与账本，
    所以截断在真实队上会触发（不再是纯安全网）。**轴模式除外**——轴是用户指定的打法，超预算
    该由「轴退化/降配」显式报"这套轴在 180s 里不可操作"并弃轴重算，不能被静默截断（轴态判据 =
    `axisUltimateTrackBySlot` 是否存在，它只在 axisActive 时注入；不加这道闸实测吞掉
    banyue.test「轴退化」判据）。剩余留白/超预算逐队钉在 `timeFillRatchet`。
    生效测试：`timeTruncation.test.ts`（6 例纯函数）+ `comboAlignBudget.test.ts`（截断份额水填回流）。

23. **喧响账本改行级 Σ 的三个耦合坑（2026-09-08，`4a0d9b2`）**：`calcRawDecibelParts.skillRegen`
    不再是「次数×常量」聚合，而是 `Σ buildExecutions` 行的 `rowDecibelTotal`（记账层==展示层，与
    伤害/失衡/异常「倍率列逐行进账」同构；口径 `@fact engine:喧响收入行级Σ`，验 `decibelRowParity.test.ts`）。
    能量侧同构迁移已完成（2026-09-09 两段式：债务清账 `07481b8` + Σ 切换，口径
    `@fact engine:能量收入行级Σ`，验 `energyRowParity.test.ts`；债务条目已销号）。切换时三个坑**必须一起处理，缺一即红**：
    ① **相位隔离**——`buildExecutions` 里仍有多模块写 cfg 缓存字段（同调用内消费者）。
      2026-09-08 点名的 3 处 + 2026-09-09 实测追加的 4 处（格莉丝 C1/C4/脉冲/initialEnergyGift、
      叶瞬光 cycle）**已全部拆到 `materializePhaseState`**（引擎在物化调用点按同一 state 显式补写，
      见坑19①第二刀）；卢西娅 cap 改走 `preModuleExecutions` 行基准、仪玄死回写已删。
      喧响通道每轮每角色额外调用物化（迭代 Step1 + 装配分享 `n×(n−1)` 次），不隔离就在错误相位
      覆写：实测格莉丝队 nt −7.14s → 轴 `frontTotal` 180.55→190.66 **误触轴回退**、
      `inStunAttribution` 4 条红。修法 = cfg 浅拷贝快照 + 调用后恢复（喧响通道对 cfg 只读）。
    ② **整数阶梯振荡器**——行级化把「喧响→能量→次数→必要时间→平A池→阶梯行数→喧响」闭成反馈环，
      环带整数阶梯项（丽娜 ex 行+子行随能量阈值 6↔7 量子跳变，账本阶跃 ~180 喧响经队伍分享放大），
      0.5 阻尼吸收不了 → 全状态精确 2-循环，甚至「冷种子收敛不动点 / 热种子入环」多吸引子共存
      （`yidhariInteractionGrid` parry=4/dodge=2 格复现）。**停点规范化的三层规则见
      `@fact engine:收敛环停点规范化`**（锚 `calcTeamResources`）。
    ③ **NaN 免疫**——畸形合成 cfg（模块字段缺失）行值 NaN 会毒化次数迭代，且被环检测的 JSON 签名
      物化成 `null` 写回状态（实测 `luciaElowen` 合成队 ex/ult 全 null）。修法 = `rowDecibelTotal`
      非有限值防线 + 环快照改 `structuredClone`。
    **否决记录（都是量过数字的死路，勿重走）**：
    - 「倍率表有 `decibel_recovery` 就把显式 0 全部回填」→ 衍生段（每击段 1.4×108、苍角扇团段、
      莱卡恩后台闪反）被当整招回填 → 喧响虚高 → 15 红（含 `allAgentsSweep` 1191 C6<C0、
      `runArchiveDeploy` 失衡=0、`timeFillRatchet` 1191 留白 2.3→8.9s）。
    - 反向「尊重显式 0、全不回填」→ 债务角色喧响塌 0（卢西娅 976→0）→ 同样失衡=0 红。
      正确路线 = **先做债务审计**（区分「债务 0」与「衍生段 0」：看 moveId 是否整招 + 行注释），
      Σ 切换在后。两次实测回滚记录见 `.zc/journal.jsonl` 09-07 两条。
    - 环均值阻尼（对环成员取均值）实测被吸回同一环，桥接不了共存吸引子 → 否决。
    **已知残差（诚实记账，不是待修的 bug）**：时间线截断只作用于展示行，账本按截断**前**的行计——
    超账本行在实战 180s 结算语义下本就兑现不出，与旧聚合通道口径一致（写在 `@fact engine:喧响收入行级Σ` 末句）。

24. **给 `@fact` 批量盖「复核」日期 = 双重陷阱（2026-09-08 实测）**：① `zc drift` 的判定粒度是
    **文件 mtime**，不是符号——改同文件里一条口径的日期，会把该文件其余 `@fact` **全部推进队列**
    （实测给 sigrid 一条加复核，5 条兄弟口径凭空入队）。② 于是"顺手批量补日期"必然误伤未复核口径
    （实测一把正则刷出 33 条，其中 31 条根本没读代码）——这正是 drift 规则「只报不红」要防的作弊面，
    做了就是给自己造假证据。正确做法 = **按 key 白名单逐条定位**，且先读锚点实码再动日期。
    （把这条写进来而只写进代码注释，就是规则 16③ 点名的历史失误。）

25. **非轴失衡不动点的阶梯 2-循环 = 「失衡 0 次」的来源（2026-09-08 用户实测）**：非轴模式
    窗口占比 x = 窗口时长/有效时间是连续量，而池计数是 `floor`——于是不动点映射
    `N ↦ floor(G(1−xN)/阈值)` 是**单调递减的阶梯函数**，在相邻两阶之间来回跳（实测
    雅/南宫/柚叶 对基塔布鲁·滞变畸兽：`G/B = 5.88` 时 0→5→1→4→2→4，`G/B = 6.02` 时 0→6→0）。
    旧实现「检测到重复即停、保留最后一次池」返回的是**循环里的任意一支**，且入口由热启动缓存
    决定 → 同一配置冷启动显示 4 次、热启动显示 **0 次**（用户报的 bug；`runArchiveDeploy.test.ts`
    的「同一队重复部署」用例钉住这条）。
    **现口径**（`@fact engine:非轴失衡不动点`，锚 `promoteFixpoint`）：解连续不动点闭式
    `N* = (g + gf − r) / ((1 − r) + g·x)`（g = 毛失衡/阈值、gf = Boss 白送/阈值、r = 雨果返还），
    `floor(N*)` 即物理次数——它也是唯一自洽解（上支 4 要求 4 个窗口 = 112s 窗口时间，
    只剩 68s 攒条 → 2.2 条，凑不出 4；下支 0 与 6 条毛失衡矛盾）。
    **否决记录（都量过数字）**：
    - 「检测到重复即停、保留最后池」→ 返回循环任意一支（同配置实测 4 / 0）→ 否决。
    - 阻尼平均 `N ← (N + f(N))/2` → N* 落在阶梯边界附近时最后一步仍可能取到上/下阶（G=6.02
      时收敛到 3 ✓，但 G=10 时迭代在 3.72/3.86 之间摆、次数 3/4 不定）→ 否决。
    - 取循环最大/最小成员 → 上支 4、下支 0，都不是自洽解 → 否决。
    **全库影响（125 队预设）**：20 队失衡次数下修 1~2 次（旧值多为循环上支 = 系统性高估），
    留白合计 188.1 → 189.3s（单队最差 0 → 1.6s，另一队 0.7 → 0.3s）；基线已重生成
    （`timeFillRatchet.baseline.json`，逐队 delta 见该次 diff）。
    **已知残差（诚实记账，待用户裁决）**：`useResourceCalc.runOuterLoop` 仍保留自己的
    `next = rawNext × (1 − coverage)` 净失衡缩放（2026-08 用户 Excel 口径），与池内
    `windowTimeFraction`（2026-09-01 时间守恒口径）是**同一物理量的两次折算**——外层 stunCount
    因此低于池计数（实测雅/南宫/柚叶：池 3 次失衡/9 连携 vs 账本每角色连携 1.395）。两处是否
    收敛到一处（去掉外层折算 = 全库连携/喧响/伤害抬升）需用户口径裁决，本次只修显示路径。
    **同族第二例：热启动缓存注入收敛末态 → 同一队算两次留白不同（2026-09-08 修）**。症状与坑 25
    同源（冷/热落点分叉），机制不同：折叠 pass0 的 refund 冻结（`teamRefund`）与内层落点都随初值变，
    而**非实数化队的落点本就随初值漂移**（`seedInvariance` 的「游戏等价」档）——旧实现把「试探前末态」
    写进热启动缓存，等于把本轮落点带进下一轮。实测 1431（叶瞬光）系 4 队：同配置第二次计算
    slack 9.20 vs 4.86 / 7.57 vs 1.03 / 3.06 vs 6.26 / 0.68 vs 0.45（门槛 10s 同样复现，与欠打
    回填门槛无关；用户可见症状 = 改滑块再改回来数值变了）。**修法**：缓存只存**规范种子**（本轮
    `states` 初值），牺牲加速换「同配置连续计算不许变」；护栏 = `warmStart.test.ts` 新增 1431 系
    逐位用例 + 全库冷/热对拍 0/127 不一致。真正的加速要等实数化专项（落点唯一）之后。

26. **减防/无视防御在直伤上整条通道静默失效（2026-09-08 用户实测「直伤角色伤害偏低」）**：
    `damagePool.pushDirect` 只把行级 `row.defIgnore`（moveId 限定：叶瞬光 C2/C6、雨果 C2、雅 1 命…）
    传给 `calcDirectDamage`，**面板通用 `enemyDefReduction` / `enemyDefFlatReduction` 从未传**——
    而面板值恰恰是绝大多数减防的落地形态（妮可核心 40% 满覆盖、叶瞬光 C1 20%、席德 C2 20%、
    伊芙琳 C1、爱芮 C2、千夏 C1、音擎 千面日陨 25%/索魂影眸…）。异常质量侧 `calcAnomalyMass`
    直接读施加者面板 → **只有直伤吃亏**，于是同一支援下直伤主C相对偏低（用户观察到的正是这个形态）；
    异放 `pushRelease` 同病（只传 releaseModifier 的异放限定值）。
    实测（preset 库，修复前→后）：猫又/琉音/妮可 25.55M→32.42M（+26.9%）、叶瞬光/照/妮可
    42.86M→54.66M（+27.5%）、席德/希希芙/妮可 61.94M→86.94M（+40.4%）、星见雅/妮可/南宫羽
    32.29M→37.25M（+15.4%）；无减防源的队（如 猫又/琉音/耀嘉音）逐位不变。
    修法：面板通用值与行级 moveId 限定值**同字段加算**（`enemyDefReduction` 加算、`enemyDefFlatReduction`
    进穿透值通道），口径见 `docs/GAME_TERM_TO_CODE_FIELD.md` §4 与 `docs/mechanism-reference.md` 结算区。
    护栏：`damagePoolDefDown.test.ts`（3 例：全局减防 20% 的直伤比值 = 防御区比值、固定减防、异放通道）。
    **否决记录**：① 只在直伤补、异放不补 → 同一面板值两条通道表现不一致，UI 伤害来源分解自相矛盾
    （异放行与直伤行同吃一个面板）→ 否决；② 把面板减防折进 `enemy.defense` → 异常质量区已经吃过
    一份（`calcAnomalyMass` 读施加者面板）→ 双计 → 否决；③ 在异常**结算区**再补一次 → 同双计 → 否决。

27. **直伤主C相对异常主C系统性偏低（2026-09-08 实测定位；公式已核无问题，成因未收口）**：
    跑 `PROBE_LOWGOLD=1 npx vitest run src/composables/__tests__/lowGoldFrontierProbe.test.ts`
    （最低金+3 前沿 625 队）对拍「模型伤害/血量」与「实战隐含 = 180s / 用时」：
    - **385/625 队是 fn**（实战击杀但模型未到击杀线），57 队 <50%；
    - 按主C聚合的中位因子（模型 ÷ 实战）：伊芙琳 0.48 · 零号安比 0.47 · 艾莲 0.53 ·
      **猫又 0.53** · 悠真 0.55 · 星见雅 0.57 · **希格莉德 0.58** · 仪玄 0.62 · **叶瞬光 0.68**
      …（直伤族，n=8~12）vs 维琳娜 1.27 · 蕾米埃尔 1.42 · 薇薇安 2.36（异常族）。
      即：**直伤主C被系统性低估 ~1.5-2×，异常主C被高估 ~1.3-2.4×**——用户感知的「直伤角色偏低」
      就是这个族级偏斜（他点名的三人正落在低段）。
    - **乘区公式已核对，不是「属性乘区/等级区少算」**：ZZZ Wiki `Damage` 的标准伤害 =
      基底 × 增伤 × 暴击 × 防御 × 抗性 × 易伤 × 失衡（**无等级区**；等级只进防御区的 Level Factor，
      60 级 = 794 ✓ 与引擎 `LEVEL_COEFF_60` 一致）；异常伤害额外有 Anomaly Level Multiplier
      （=2 @60，`1+1/59×(等级−1)`，与引擎 `LEVEL_MULT_60` 一致）。两条公式在引擎里都对得上。
    - 已排除：倍率表行值是 12 级单值（1021 全部 108 行 `values.length === 1`）、面板/音擎/套装/命座接线、
      暴击期望口径、减防通道（坑 26 已修，修后这些低金队 +11% 左右，房间固有 buff 舍身 24% 减防现在生效）。
    - 剩余嫌疑（按证据强度）：① **直伤主C的动作次数/前台时间**——模型给主C的平A时间常为 0~3s
      （辅助的 necessary 吃掉预算：实测 猫又M2/琉音/丽娜 平A 2.6s、琉音 necessary 65.7s），
      而实战主C大部分时间在场平A；② 异常族触发次数/覆盖率被高估。
    ⟳复核: 拿到实战视频/游戏内单跳校准数据后，重跑 `PROBE_LOWGOLD=1` 探针确认族级偏斜是否已被 19①/实数化改动带走 | 到期 2026-11-30
    - 下一步（择一）：拿一条实战视频按 dump 的招式计划逐动作对拍；或用户给一跳游戏内伤害 + 面板做单跳校准。

28. **赠送招式（诺姆赠链 / 琉音赠大）的时间账：装配后追加行必须回扣截断上限（2026-09-08 用户实测）**：
    赠送行由 `applyNormaHatChain` / `applyLiuyinPromote` 在**装配之后**追加到目标槽执行计划，
    不在 `buildExecutions` 产物里；其时间已由 iterate 计入目标槽必要时间（`helpers.ts` Step4 两处
    `normaGiftChainTime` / `liuyinGiftTime` 预留）。但 `buildResourceResult` 里
    ① 时间线截断上限 ② 前台展示**都没算这份时间** → 实测三症状：
    - 资源卡「总计」= 战斗时间 + 赠送秒数（猫又/诺姆/千夏 191.8s、希格莉德/诺姆/丽娜 188.8s、
      猫又/琉音/耀嘉音 183.8s，各多出赠送行秒数）——**用户报的就是这条**；
    - 其它行按「含赠送时间的账本」截断、再叠加赠送行 → 物化行超账本（预留被截断上限抵消）；
    - 赠送队普遍 over-budget（ratchet 实测 auto-1431-1481-1311 over 0.8s 等）。
    修法：`giftTimeOfSlot(i)`（诺姆赠链 + 非轴琉音赠大，与 iterate 预留同口径/同条件）——
    **截断上限先扣掉它**（引擎侧，物化行才不超账本）；**展示口径统一由编排层 `normalizeDisplayTime`
    按最终执行行重算**（前台 = Σ前台行，后台 = 战斗时间 − 前台）——轴模式琉音赠大走的是 post-hoc carve
    路径、引擎预留为 0，只有按最终行重算才能一并覆盖（实测修复前 125 队里 42 队违反跨路径不变量，
    最大差 −14.24s；修复后 0 队）。
    实测影响（125 队预设）：7 队基线变化，全部是赠送队，且方向是 **over-budget → 0**（
    auto-1431-1481-1311 over 0.8→0、banyue-liuyin-lucia 0.6→0 等），留白合计 189.3→197.2s；
    赠送队伤害 ±3% 以内（auto-1431-1481-1311 −2.9%，auto-1431-1481-1491 +1.0%，其余逐位不变）。
    护栏：`giftMoveTimeLedger.test.ts`（3 例：卡片总计 = 战斗时间、赠送行在账本内、琉音赠大同口径）；
    `banyue-preset-int.test.ts` 的论道守恒判据改 ≤（截断会砍行，恒等不再成立）。

29. **轴的资源门控 = 总量，两个通道都「去掉」而非「只警告」（用户口径 2026-09-08）**：
    `core/stunAxisStack.ts` 原来对闪能/喧响都只记警告、**照样计入执行**（与它自己的头注释「不够就跳过」
    相反，从初始提交起就如此）。用户裁决：**耗资源的招式一律从总量里拿，总量没有不能凭空创造**——
    实测语义「喧响总回复 9000 只够 3 次大招，轴里捏了 4 次 → 第 4 次打不出来，必须扣掉；
    轴里本来就只捏 3 次则不受影响」。现口径：闪能与喧响**都**在超出该槽位总量时 `continue`（去掉，
    不计入 `executed`），`decibelUsed/energyUsed` 不再越界。
    **四舍五入开关（保底4喧响）不在这里放行**：它是在**总量侧**补缺口（补弹刀 → `decibelSource.total`
    变高），所以「略微提升」体现为总量变大，门控本身不需要允许超支。
    影响（125 队预设基线）：9 队变化——席德系三队失衡次数 3→4 / 3→4 / 4→6、留白 6.9→0/4.3/0.9；
    其余 ±0.4s；留白合计 197.2→186.1s（改善）。护栏：`stunAxisStack.test.ts`（闪能 180/轴内 6 次 →
    执行 3 次 / 跳过 3 次；喧响 3000/轴内 6 次 → 执行 1 次 / 跳过 5 次）。
    **仍待收口**：编排层 `axisUltimateTotal` / `axisActionCounts`（按「块数 × 窗口数」独立算、不看资源，
    供希希芙 C2 / 猫又穿刺档位消费）——同一物理量的第二份实现，见 §4「同一物理量的多处实现」表。

30. **「属性没做」的三种真身：静默失效通道（2026-09-08 用户三条观察）**：
    - **症状**：三个「看着像没实现」的现象（用户合理推断「属性都没做」），实测**效果全都接了线**，缺的是三处静默通道与可见性——别急着往引擎里加乘区。
    - **① 角色特化标错 → 整条音擎效果为 0**：朱鸢 1241 catalog `specialty=stun`，原文（`data/raw/nanoka_missing/full/1241.json` weapon_type=强攻）与专武 14124 `requirement.specialty=attack` 都是强攻；`collectAllBuffs` 用「音擎 specialty === 角色 specialty」当**总开关**（`collectWEngineBuffs` 首行 return）→ 装专武时暴击率+15%、平A/冲刺充能增伤整块丢掉，**不报错、数字自洽**。修复入口 `scripts/fix-agent-specialty.mjs`（幂等，读原文对齐）；护栏 `catalogData.test.ts`「角色特化 == 专武特化 == 音擎 requirement」（全库 55 把带 requirement 的音擎，修前只有朱鸢一条红）。自查动作：录完/改完角色跑「装专武 vs 不装音擎」面板差分，差值 0 = 这门对不上。
    - **② 套装覆盖率只并本槽位 → 全队段滑块是死控件**：4pc 全队段（山大王/月光骑士颂/雪兔/摇摆爵士…）**装备者供给、全队受益**，覆盖率属于「效果」不属于「受益者」；旧 `mergeDiscEffectCoverages` 只并当前角色自己盘上的效果 id → 队友面板拿不到装备者滑块值（实测差值 +0）。现 `mergeTeamDiscEffectCoverages` 并**全队三人**盘（口径钉在函数头 @fact）。
    - **③ 面板页只列条件类效果 → 常驻/门槛/未建模段整块隐身**：旧 `discCoverageEffects` 过滤 `!condition && !maxStacks` → 荆棘玫瑰（常驻增伤 + 防御门槛暴伤）、沧浪行歌（组级条件没落到条目）、灵魂摇滚（4pc 减伤确实未建模）都「一行都没有」。现 `src/utils/discEffectRows.ts`（纯函数，页面与测试同源）把 2pc/4pc **全部**效果列成行，三类状态如实标：可折算 → 给滑块；门槛（属性/职业/局外属性）→ 标「门槛自动判定」不给滑块（再挂 uptime 会双重打折）；有文本没效果 → 标「未建模」。配套：触发型效果条件元数据（`condition` + `coverage{default:1}`）补进 catalog（`patch-disc-sets.mjs`，**默认数值一分不变**）；修 10 个套装 2pc 共用通用 id「effect-1」隐患（覆盖率按 id 存，共用即串改）。
    - **护栏**：`utils/__tests__/discEffectRows.test.ts`（每套单穿 4 件必出行）+ `core/__tests__/discSetEffects.test.ts`（新暴露滑块 50% → 面板正好折半，含 teamBuff 通道）。
    - **否决记录**：门槛类效果也挂覆盖率滑块 → 与引擎自动判定叠两次打折 → 否决；subgroup（二级属性）运行时从 catalog 反推 → 预设库是同步模块、catalog 异步加载，且三处页面各写一遍推导 → 否决，改「数据里写死 + `validate:data` 按单源口径重算护栏」。

 31. **多段招式「一次动作」只回头段：时间 / 喧响 / 赠送回填三侧同错（2026-09-11 用户裁决「倍率表必须融合，因为连携本身就是打3段」「时间不是以招式为单元的吗，怎么会如此偷懒」）**：
     - **症状**：用户报「连携技时间显示 0.5s」→ 结果页同屏「春临 1258.3% / 单次 0.515s」两套口径（坑 3）。
     - **根因**：catalog 把一次玩家动作拆成 `#1/#2/#3`，倍率侧已按 `data/moveFusions.ts` 登记组求和（`fusedRowValue`），但 `core/resource.ts` 的一族 `find*` 全部 `move.actionTime ?? 0`——**只回头段**；一次连携真正的前台时间 = 0.515+0.515+0.687 = **1.717s**（同族基线：连携单次 1.2~3.5s，头段只占三成——量级一眼不对就是这一族）。
     - **判据（现口径，一处登记、多处消费）**：`core/resource.ts#fusedGroupMetrics` 给融合组「一次动作」的整段量，`channelMetricsOf` 是**全部** `find*` 的唯一出口（连携/强特/终结/闪反/招架/支援突击/蕾米两段）；喧响同口径——`decibelRecoveryByMoveId` 表与 `enrichExecutionPlan` 的 decibel 分支都走 `fusedRowValue(..., 'decibel_recovery')`，账本行级 Σ 与展示层同值（`decibelRowParity` 不破）；赠送回填取融合值（`normaHatChain` 赠链行、`liuyinPromote` 转大行的倍率/失衡/积蓄/时长）。
     - **自动攻击段特例 `countsTime: false`**（`MoveFusionTerm` / `SustainedExTerm`）：「打是全打，但不站场」——妮可三处能量场（连携 1031303、终结 1031305、强特 1031106）倍率·失衡·积蓄·喧响照算、前台时间记 0：一次连携 = 0.25+0.25 = **0.5s（只算炮击）**，一次强特少占 1.484s。
     - **影响（登记组头段 → 整段）**：雅连携 0.515→1.717s、喧响 69.05→230.1475；雅飞雪 0.387→0.967s；希希芙毒牙 0.565→1.883s；珂蕾妲熔炉 1.45→2.816s；月城柳月华 0.667→1.334s；千夏泡泡糖 0.733→1.649s；可琳[舍] 0.658→1.316s；真斗断獠 2.083→4.183s；妮可连携 0.25→0.5s（倍率 210.4→987.6%、喧响 43.45→217.25）、终结倍率 1293.6→3040.2%。
     - **护栏**：`moveFusion.test.ts`「时间通道」+「全通道一次动作口径」（含**双计护栏**——遍历登记组逐角色部署，断言兄弟段永不出现在执行计划里 = 允许组级求和的硬前提）；全预设库遍历 127 条预设断言「登记组的兄弟段永不作为执行行出现」，新登记组先过它。
     - **收口审计（38 组候选，2026-09-11，结论：表已完整）**：登记 18 组，其余 20 组的处置各有实测依据，**不要"顺手"补登记**——
      · **模块接管段**（登记即双计）：莱卡恩 1141（`lycaon.ts` 推 1141016 点按 / 1141017 长按，长按一次 = #1 505.4% + #3 1075% = 1580.4%）、雨果 1291（`hugo.ts` 推合成行 `1291_ex_normal_final` 709.8% / `1291_ex_verdict_final` 3552.7%）；护栏 `moveFusion.test.ts`「模块接管段不入表」。
      · **变体 ≠ 分段**（同一角色不同招式，非一次动作被拆）：叶瞬光「连携技：斩邪祟」(1431024) vs「连携技：明心境·掣惊雷」(1431026)、伊德海莉「踱寒践约」(1051015) vs「[以太帷幕·涌泉]中」(1051025，模块接管)、橘福福「虎釜崩」(1391012) vs「虎釜震煞」(1391013)——nanoka 里各自只有 `{Skill:单个}`、**没有求和式**，故 head-only 正确（引擎只建第一个变体，补第二变体属建模决策、不是融合问题）。
      · **平A/basic 组**（不物化或兄弟也物化）：妮可狡兔连打/为所欲为（6 变体共头 1031001…）、艾莲霜锋（1191027 与 1191028 **都成行**→登记即双计）、照凛冽裁决、真斗炽风斩、爱芮绝对音准——平A 走 `averageBasicRows` 汇总，登记对引擎无益。
      · **不物化的特殊技/快支段**：妮可特殊技糖衣炮弹、冲刺攻击两变体——引擎不发行这些行。
     - **否决记录（都量过数字）**：① 「同 category 带 `#N` 后缀的段全加」启发式 → 叶瞬光 1431 连携两段是**两个独立动作**（头段 3.3s、喧响 218.9 已在全体基线内），启发式顶成 5.8s 假时长；伊德海莉 1051 由模块自写 `cfg.chainActionTime`，blanket 求和覆盖模块口径 → 只认登记组。② 只把 `cfg.chainDecibelRecovery` 改成融合值 → 被 `decibelRecoveryByMoveId` 按 moveId 覆盖回 69.05（实测），改表与改 enrich 才是有效闸口。③ 妮可强特不登记融合组——`sustainedEx` 已把 1031103/104/105/106 各自成行，再登记即四段双计 → 只标 `countsTime: false`。
     - **两条例外要认得**：① **终结技秽盾加成可能被拆到多段**——照·兔兔连斩两段共享 500 加成、拆成 400+100 → #1 = 积蓄 146.66/100 = 1.4666s、#2 = 36.7/100 = 0.367s（catalog 旧值 0.467 / null，旧公式对两段都减满 500；用户口径 2026-09-11「奖励分成两半，用秒均积蓄=100 来算」）；定点修正走 `scripts/patch-move-action-time.mjs` 整段 1.8336s，再由 `zhao.ts` 按「Q 打一半被快速支援取消」取半（前台 0.9168s/次）——**遇到某段时长 null / 推不出先怀疑这条**。连带（既定配套，不是新回归）：照队留白 8.8→4.1s（auto-1431-1341-1311 3.1→7.7s）、`timeFillRatchet` 基线已按 `TIME_RATCHET_UPDATE=1` 重生成、`teamTimeSummary` 样例阈值 8.8→4.1 同步下调（该样例只验「归因到账本虚高」而非留白绝对量）、`docs/multiplier-record.md` 按 `npm run gen:multiplier-record` 重生成。② **后台自动连携不是"未建模的变体"**：橘福福「虎釜震煞」(1391013, actionTime 0) 由 `specPanelBuffs.ts` 威风账本发射（默认配置实测 21 次/局、0 前台时间），前台「虎釜崩」只吃失衡赠送/诺姆赠送——用户 2026-09-11「她就靠后台自动连携打数据」，账上已有；叶瞬光两个连携（斩邪祟 / 明心境·掣惊雷）收益相当，只算一个即可。
     > 编年史原文 = `git show 5e559f2:docs/ENGINE_PIPELINE_GUIDE.md` 坑30+坑31 两条（合 85 行），2026-09-12 按规则 8 拆薄。
32. **轴预设的资源模型必须单一：从「本槽位总量」拿取，不跨槽挪用、不反填总量（2026-09-10 用户裁决）**：
    用户原话「预设动作是从总量拿取部分还是反填总量，逻辑不能混合」。当时 `core/stunAxisStack.ts`
    的门控是**队伍总量**（`totalEnergy/totalDecibel = Σ 各槽`，单个 `energyUsed/decibelUsed`
    累加器），而引擎 iterate 的 `ex/ult` 次数按**槽位**推导（`floor(槽位能量/消耗)`、
    `floor(槽位喧响/消耗)`、或轴时间轴 `axisUltimateTrackBySlot`）——同一个动作两套可行性口径。
    **实测症状**（`auto-1371-1251-1451` / 仪玄）：预设声明每窗 1×`1371020` + 1×`1371014`
    （终结技类，各 3000 喧响），4 窗共 8 次；仪玄自己喧响 11830 → 只够 **3** 次，队友喧响
    （9252/9231）被拿来补足 → 轴栈 executed 8 次、引擎 3 次 → 易伤归属按 8 次算（in-stun 占比
    被顶到 1）→ 伤害虚高。
    **现口径**：门控改为**逐槽剩余量**（`energyLeft/decibelLeft`），`totalEnergy/totalDecibel`
    仅作上报字段。实测 delta（127 预设 + 60 角色×命座）：
    - 时间/次数硬判据：仅 `yidhari-lycaon-lucia`/`auto-1051-1141-1451` 失衡 7→6，
      仪玄两队逐槽 chain/basic/nec/front 变化 ≤0.02s；
    - 伤害（信息项）：仪玄系 −4.7%/−6.5%/−12.5%（＝不再把队友喧响补出来的大招算成自己的
      在窗内输出），其余 10 队 ±0.2~0.9%；
    - 棘轮：`auto-1051-1481-1451` 留白 1.1→1.8s、`auto-1531-1481-1451` 2.4→3.2s、
      `auto-1371-1251-1451` over 0→0.1s（**按用户 2026-09-10 裁决「基线不拦开发」重生成**，
      不是回归）。
    护栏：`stunAxisStack.test.ts`（按槽位门控的用例）+ 上面这套 delta 记录。
    **次数权威收口（同日，用户裁决 A「总量为准」）**：引擎的大招次数 = **槽位喧响总量**
    `floor(decibel/消耗)`（来源 = 自攒 + 赠送；消耗由总量决定而非个数），
    旧的「时间轴反推次数」通道（`axisUltimateTrackBySlot`，每窗至多 1 次）**已删除**——
    新增 `ResourceCalcConfig.axisMode` 只作轴态信号（赠行预留/行口径、必要前台封顶豁免）。
    **实测：`timeGolden` 127 预设 + 60 角色×命座 0/6 全 0 delta**——说明该轨在收敛末轮本就未生效
    （注入条件 `prevStunCount === stunCount` 与首轮空轨使它在末轮恒为空），两套口径实际同值；
    收口后「引擎按总量推导次数」与「轴栈按本槽总量门控执行」由构造同源，不再需要额外预算通道。
    **仍待收口（同一物理量的第二份实现）**：`axisUltimateTotal`/`axisActionCounts` 仍按
    「块数 × 窗口数」独立算（不看资源），供希希芙 C2 / 般岳穿刺档位消费。
    → **已收口（同日）**：这两个值改为读**轴栈实际执行集合**（`axisExecutedStack.executed`，
    资源用上一轮收敛值滞后注入，与其它线程同款；首轮空 = 门控放行全部，等价旧口径），
    般岳模块的 `axisEx` 两处注入同源。**实测 0 delta**（旧口径与实际执行集合在现库上同值；
    另注：般岳预设队在末轮会 `axisFallback=true`，轴栈本就为空）。
    **队长口径统一（同日，用户裁决 #2「基线不拦开发」）**：`resolveUltimateTargetSlot` 的
    「上一位队友」原先两套队长——引擎用 `configs.length`（只含已配置角色）、编排层用
    `team.length`（含空槽）。现**统一按 `config.teamSize`**（编排层注入，缺省回落
    `configs.length`），账本/试探/行/展示四处同源。实测 delta：仅单角色扫描的**诺姆**两行
    （`agent:1571:c0` 留白 14.6→0.6s、dmg +4.6%；`agent:1571:c6` stun 2→3、留白 16.2→0.2s、
    dmg +14.5%）——**修正**：没有队友可赠时不该预留赠链时间白等；棘轮 1 条 3.9→3.8s。
34. **失衡次数必须满足时间约束：窗口占掉的时间不许再攒条（2026-09-10 用户裁决「顺序不对」）**：
    用户口径：正确顺序是「边打边攒 → 攒够开一次窗 → 窗占 18s → 再看剩余时间够不够下一次」，
    次数收敛于「剩余时间不足以打满下一次」。旧实现的错法是**先算全场招式的攒条量、再按占比扣**，
    而且**轴模式把「窗口时间占比」直接置 0**（`windowTimeFraction: axisMode ? 0 : …`，注释写
    「逐招 fraction 已精确扣除」）——只信轴内逐招分数，窗口占掉的时间根本不进攒条扣除。
    **实测反例**（`auto-1521-1481-1311`，探针 `PROBE_STUN_TEAM=<id>`）：boss 阈值 15486、
    毛攒条 157720（≈10.2 次）、窗内无效只扣 7504（**4.8%**）→ 有效 150216 = 9.70 次 → **次数 9**；
    而同一支队轴栈 `windowsUsed=3`、`timeUsed=15.8s`（只填满 3 窗）。9 窗 ×18s = **162s/180s**，
    只剩 18s 攒条，却声称 95% 攒条来自窗外动作——**时序差一个量级**。
    **现口径（两处一起改）**：
    ① 轴/非轴**都传时间占比** `stunWindowFraction = N×窗长/有效时间`，攒条扣除取
    `max(逐招 fraction, 时间占比)`（`calcStunPool` 本来就是取 max）；
    ② 轴模式也走**连续闭式求根**（`N* = (g+gf−r)/((1−r)+g·x)`），不再用「整数迭代 + 环检测」——
    直接把时间占比塞进整数迭代会 **0↔10 两循环**（实测）。
    实测该队 **9 → 5**，与手算模型 `N* = 10.18/(1+1.018) = 5.05` 吻合。
    **全库 delta（已按裁决重生成两份基线）**：48 队失衡次数下降（12×−1、30×−2、3×−3、2×−4、1×−5）、
    窗口时间占用 >0.8 的队 **1 → 0**（时序自洽）、留白合计 178.0→**189.3s**、超预算 2.4→2.2s。
    留白变大的因果：失衡次数驱动连携次数（`chainCountTotal = stunCount × 每窗连携`）与失衡喧响奖励
    （`stunCount × 常数`）→ 次数少 ⇒ 连携/大招少 ⇒ 招式少 ⇒ 留白变大（自洽，不是新 bug）。
    护栏：`stunPool.test.ts` + `PROBE_CONV_SCAN`（窗口占用比）+ `inStunAttribution` 38 tests。
    **连带暴露的差额（不在本次口径内，别回头放宽口径去凑）**：`excelAxisRepro` 队伍A
    真人 Excel 实操 **4 失衡**，引擎 3（旧）→ **2**（新）。根因 = 引擎该队前台只打出 ~154s/180s
    （轮换覆盖不足 = 在册债务「轮换动作覆盖实数化」），攒条总量比真人少约 1.7 倍；
    该测试的断言已从「≥3」改为「≥2」并注明它是结构锁而非对拍值。

33. **折叠环「必要时间超支」的两套机制互为惰性（2026-09-10 阶段2 立项度量 + 三版否决记录）**：
    - **根因**：折叠环把每槽 `rows − 账本` 超出量**累加**进 `cfg.timeBudgetExcess`（`+=`，2026-09-03 定的口径），`iterate` 另有「必要前台可行
      比例封顶」（`cappedNecessary = netNecessary × budget/ΣnetNecessary`）；叠加 = 累加被封顶部分抹掉、却又通过封顶的分配比例改变槽间预算 → 26 队
      跑满 8 轮不收敛、累加器涨到 600s+。度量基线（`PROBE_CONV_SCAN=1`，127 预设）：`timeBudgetConverged=false` 26 队、8 轮顶格 27 队、留白
      179.4s、超预算 2.4s；不收敛集中在叶瞬光(1431)/般岳(1471)/仪玄(1371)/席德(1461) 系。
    - **判据（现行口径）**：
      · **⑥ 停滞判据（✅ 采纳，用户口径 2026-09-10）**：「平A 是招式循环的重要组成部分，必须计算其回能/喧响/失衡/伤害效用，资源增长会让特殊招式次数增长」
        = 池→资源→次数 正反馈是模型本身、不能去掉，能改的只有**求解器的停止规则**：`PROBE_TRACE_FOLD` 实测叶瞬光队 pass7 起 `maxExcess` 恒
        0.092~0.093s 持续 20+ 轮（累加器仍增长、残差不动）= **停在量化地板**（不动点），`maxExcess ≤ 1e-3` 对离散系统过严 → 改**连续 3 轮无改善
        即判收敛**，阈值 **1e-2（10 毫秒，量化噪声量级）**（比利系每轮只改善 ~0.002s，1e-3 会令停滞计数不断重置）。实测：不收敛 26→**3 队**（余
        `billy-roxy-lucia` 0.417s + 2 支 1591 系 2~3 毫秒，同日收口为 0 队，见尾巴专项）、8 轮顶格 27→**6 队**（21 队在 5 轮即停）、留白 179.4→**178.0s**、
        超预算不变、`timeFillRatchet` 零变差无需重生成；`timeGolden` 106 条 delta（绝大多数 ≤0.3s 停点差，最大 auto-1431-1481-1341 dmg
        +3.5%）已按裁决重生成（归因注意：单纯把阈值改 1e-2 = 0 delta，只动报告；106 条全部出自**停滞规则改停点**——再调阈值前先分清这条）。**结论（六版）**：旋钮不能换（①~⑤），停止规则可以修（⑥）。
      · **算力护栏（✅ 采纳，用户裁决 2026-09-10「重排就重排，以长期利益为主」）**：判据仍 `maxExcess ≤ 1e-3` 不放宽，只把 `maxTimeIterations`
        缺省 8 → **`TIME_FOLD_MAX_PASSES = 32`**（`core/resource.ts`，`ResourceCalcConfig.maxTimeIterations` 仍可覆写）——8 轮上限曾是
        `tbConv=false` 的唯一来源。实测：不收敛 3→**0 队**（`billy-roxy-lucia` ρ≈0.70/轮、外推需 ≈**24 轮**、实测 21 轮收敛）；留白 **189.3s /
        超预算 2.2s 不变**、棘轮零变差；`timeGolden` 15 条 delta / 5 队 = **Σ 守恒再分配**（总必要时间 180.001→180.000，slack / 失衡次数 /
        slack −1.990 / 失衡 4 / 留白量级 / 截断量无一变化；4 支 auto-1591-* ≤3 毫秒（chain ±0.0004 / nec ±0.003 / slack ±0.002）、dmg 浮点尾巴 ≈−0.0001%）→ `TIME_GOLDEN_UPDATE=1` 重生成，全量
        `npx vitest run` **1701 passed / 0 failed**。
      · **尾巴专项收口（收敛读数归属，测量陷阱）**：报告口径没问题，问题是「读的是哪条管线」——一次预设求值跑 N 次 `calcTeamResources`
        （`billy-roxy-lucia` 实测 **18 次** = 外层不动点轮 + 非轴对照 + 降配二分 6 轮×2 + 下游重算；`auto-1591-1161-1211` 6 次），
        `ConvergenceReport` 五字段**全部同源于被接受的那次调用**（`PROBE_CONV_TEAM` 冷/热/换队三读数逐位一致）；**逐 pass 打表不按调用分组 =
        会把某次可行试探的末轮（残差 0.000）误当成被接受管线的末轮**（18 次里 11 次第 2 轮即收敛、不留记录）。`billy-roxy-lucia` 停滞计数**恒 0**
        （每轮改善 ≈0.17s ≫ 1e-2），**与 `runBillyFinalize` 无关（原假设作废）**——`slack=-1.99` 超预算队走**降配**路径
        （`interactionScale=0.688`、`axisFallback=false`、`exit=cycle`），属坑19⑤/坑22 已定案「厚需求降配**移动靶残差**」非估时缺口；
        `auto-1591-1161-1211`（**账本原写 1481-1211 是笔误**，扫描实际是 1161；`auto-1591-1481-1211` 现值 `tbConv=true`）与
        `auto-1591-1481-1311` 残差 0.5/轮减半、停滞计数到 2，再给 1 轮即触发（8 轮上限比停滞判据早一步）。
      · **「整数次数」不再是否决理由（用户修正 2026-09-10 晚，原话）**：「动作次数变小数应该是为了恰好在180s，这没必要，因为可以调整队友技能的合轴率稍微超时一些。暂时不否决，一切为了开发。」
        ⇒ 阶段4⑤ 撤专属重推**列为待重验**，判据换成「时间账自洽 + 指标」、整数性不再是硬门（用户依据：玩家用**队友合轴率**与**轻微超时**吸收）；
        但「保留一整刀的整数性例外」要先定语义层（UI 显示 / 物化行 / 账本），别直接松断言——见账本 B6 条。
      · **阶段4 结论**：名单上**没有任何可撤的补丁层**——`probeExcludedTeam` 已删（2026-09-10）、`refundFrozen` / post-hoc 试探层 / 专属重推
        三者全为承重件；现有四件套（单侧判据 + 棘轮累加 + pass0 冻结 refund + post-hoc 试探）是自洽局部最优；要动留白必须与「按容量分配平A池」一起解
        （坑33 ③ 逐槽需求上限是候选，但那是旧求解器，须先量δ）。主路径默认边际均衡后（账本 B5），剩下留白反映模型结构而非分配不当，不再是
        「要消灭的敌人」。
      · **四件套拟合对象（用户 2026-09-10 追问）**：引擎「时间」不是可观测真值，是三条内部自洽约束——① 物化行净占用 ≤ 预算（坑22 硬不变量）
        ② 账本必要时间与物化行不脱节 ③ 动作次数为整数（已被用户修正降档）；**伤害无外部真值锚**（AGENTS §3）⇒ 四件套不是「拟合现实」，是「让约束的解
        存在且可收敛」的装置（逐件实测见否决记录·阶段4）。**只有「平A池/欠打回填/整数次数」是游戏机制，冻结与单侧累加是数值装置**；撤补丁层的正确前提
        = **换掉产生欠打的源头**（模块读 `state.basicAttackTime` 产行 → 非单调映射，见下条），只撤装置 = 拿保真度换指标。教训：留白/超预算是
        **代理指标**，可在模型更不保真（小数次数 = 不存在的动作）时同时「变好」——以留白为判据的改动**必须同时过硬不变量测试**
        （`yidhariInteractionGrid` / `seedInvariance` / `giftConsumption` / `decibelRowParity`）；历次以留白为目标的 6 个 τ 变体 + 本会话
        4 刀，凡「指标变好」都回看这一条。
      · **留白 189s 结构诊断（`PROBE_TRACE_FOLD=1 PROBE_CONV_ROWS=1`）**：top-10（合计 ≈75s）全是**单厚槽**队——一槽账本 ≫ 物化行而队友槽差恰
        0.000（`auto-1191-1481-1311` 槽0(艾莲) 行 83.13 / 账本 100.81（nec 96.65 + basic 4.16）= −17.68s、`auto-1191-1361-1311` 槽0(艾莲)
        −19.94s、`auto-1401-1031-1411` 槽0(爱丽丝) −15.93s）：厚槽 `necessaryTime` 比真打出的行多 15~20s，而单侧判据只看正超出 → 被报「已收敛」
        （`passes=2`）。不是估时公式错（艾莲 ex/ult/chain/dodge/assist 表值与物化行逐项核过一致），是**账本口径与物化口径在「历史残差」层分家**——
        正是③要动的东西，动它更差。**下一轮入口**：`maxExcess` 改双侧（`max|excess|`）会把 24 队残差 >1s 如实报成未收敛，属「诚实报告」非
        「修数值」，须先与用户确认报法。
      · **上游假设已被推翻，动它前必读**：原假设（未证）「26 队非收敛根因 = 模块产行直接读 `state.basicAttackTime`（alice 224/266、claret 193、
        ellen 154/188/267、grace 147/171、orphie 258/267、banyue 692…）形成非单调映射，真路径 = 逐个改成与池无关的确定性函数」——2026-09-10 晚
        `PROBE_CONV_SCAN=1` 复核（静态权重）：不收敛 = **0 队**（轮数分布 2轮=89 / 3轮=9 / 4轮=2 / 5轮=21 / 8轮=3 / 9轮=1 / 10轮=1 / 21轮=1；
        留白 189.3s、超预算 2.2s 不变）⇒ 症状已由 `TIME_FOLD_MAX_PASSES = 32` 消化（不是不收敛，是原 8 轮上限不够），读池产行剩余影响只有 ≥8 轮的
        6 队多跑几轮（≈10 次额外求值/队），**不是正确性问题**；改这 12 个模块 = 全库 golden delta + 保真风险换迭代次数。**正确处置**：C8 从
        「改行生成」降级为 ①（可选）**单调性声明 + 机器护栏**（契约：允许读池、但必须单调递增、禁止拿池做条件跳变）；② 真要优化把预算投向那 6 队的
        残差收敛率（τ/阻尼已被 6 个变体实测否决）——**须先量 δ 再动**。
    - **否决记录（都量过全库 delta，勿重新发明）**：
      · 「统一残差 + τ 求解」① **封顶生效即停折**（`capActive` 时不累加 + 判收敛）→ 不收敛 26→**2**、超预算 2.4→**0.1s**，但留白
        179.4→**193.4s**、`timeFillRatchet` 叶瞬光三队变差（3.5→9 / 3.8→13.5 / 4.2→9.4s）→ 否决：累加不是惰性，它把预算按「实测需求」重新分配，
        停掉即失去这个分配器。
      · ② **全局 τ**（只注入 `necessaryScale = 预算/Σ实测需求`，分配仍按 estimate 比例）→ 不收敛 →**113 队**、留白 **198.9s** → 否决：
        全局缩放不改**槽间分配**。
      · ③ **逐槽需求上限**（`cap_i = 实测需求_i × τ`）→ 留白 179.4→**149.4s**（−30s，唯一亮点）但不收敛 →**74 队**、超预算 2.4→**5.3s**、
        `timeGolden` **674 条 delta**（含失衡次数 4→8、3→4、5→4）→ 否决：动落点太广，须逐队验证后才能谈落地。
      · ④ **共享平A池缩放 τ**（残差 = Σ实测物化行 − 预算，τ 按比例步 + 阻尼半步解，取代「逐槽累加 + refund 冻结 + 折半试探」）→ 不收敛
        26→**25 队**、留白 179.4→**174.1s**、超预算 2.4→**2.2s**，`timeGolden` **242 条 delta**（auto-1431-1341-1311 留白 2.4→6.4s、
        yixuan-roxy 超预算 0.25→0.90s）→ 否决：**横向替换、收敛没治**。
      · ⑤ **累加器钳到实测需求**（`accum_i = min(accum_i + excess, rows_i − 抵扣)`，防发散轮独吞预算）→ 不收敛 26→**27 队**、留白
        179.4→**189.9s**、超预算 2.4→**1.5s** → 否决：留白换超预算，净负。
      · **判据容差 1e-3 放宽到量化地板 1s**（`TIME_BUDGET_TOLERANCE_SECONDS`）→ 21 支 5 轮队与 6 支 8 轮队**集体提前停车**（停车改变落点：累加器
        是分配器，见①留白 +14s 的教训），爆炸半径远大于「只给跑不满的队多跑几轮」；1e-3 判据本身没错，错的是上限不足以达到它。
      · 阶段4 ① **撤 `refundFrozen`（refund 逐轮跟随）** → 留白 189.3→**341.5s**、超预算 2.2→**6.0s**、`refund>0` 41→55 队、golden
        **214 条**、棘轮 **2 红** → 否决：原冻结论据（「逐轮跟随会抖动到 8 轮耗尽」）虽写在旧引擎上，但 32 轮上限 + 停滞判据**并不解除**它——病根是
        `refund→平A→回能→次数→物化行` 的放大环，不是「跑不够轮」。
      · 阶段4 ② **撤 post-hoc 欠打试探层（与①同时）** → 与①**逐项同值**（留白/超预算/轮数分布全同）→ 否决：①下试探层本就基本不触发，**不是①的
        混淆项**；两层各自承重。
      · 阶段4 ③ **对称折叠**（负超出时释放历史残差 `timeBudgetExcess = max(0, accum − idle)`，floor 0 防 necessary 变负）→ 留白
        189.3→**358.2s**（近乎翻倍）、`refund>0` 41→11 队、golden 173 条、棘轮红 → 否决：释放历史残差会让平A池膨胀而行接不住。**棘轮累加器是承重的**
        （与坑33 ① 的结论同源：累加不是惰性，它是分配器）。
      · 阶段4 ④ **均衡权重 × refund 跟随 2×2 耦合重测**（验「①失败是否只是静态权重把 refund 流回厚槽」；`optimizeTeamTimeWeights`，maxIter=2）：
        均衡×冻结 **171.8/3.1**、均衡×跟随 **280.8/6.8**（静态两格 = 基线与 ① 同值）→ 否决：**跟随失败与分配制度无关**（两种制度下都劣化 90~150s
        留白、超预算翻倍）——「让折叠环自己承担欠打回填」在两种制度下都被实测封死（阶段4 立项前提不成立）。附带：**均衡权重不是留白解药**（优化的是伤害，
        留白只降 17.5s 而超预算变差），与坑35 一致——别拿留白当权重优化的目标函数。
      · 阶段4 ⑤ **撤专属重推层**（关 1531 比利终局整数重推 `runBillyFinalize` + 1051 伊德海莉 `yidhariFinalizeEx` 块）→ 留白 189.3→**171.9s**、
        超预算 2.2→**0.3s**（两项都「变好」！）但 `npm run verify` 红：`yidhariInteractionGrid.test.ts` 断言 `parry=0 dodge=0 终局次数应为整数:
        expected false to be true`（动作次数必整数 = 坑22 硬不变量）、棘轮留白变差、golden 62 条 → 否决（整数性理由后被用户修正撤销，**列为待重验**）。
    > 编年史原文 = `git show 5e559f2:docs/ENGINE_PIPELINE_GUIDE.md` 坑33（原164行），2026-09-12 按规则 8 拆薄。
35. **留白不是求解器缺陷，是平A池**权重分配**的表征（2026-09-10，重定向整条「留白专项」）**：
    - **根因**：留白由 `basicAttackTimeWeight`（平A池按权重分配）主导、与求解器无关——留白与「模型对不对」不同向，留白 0 常是把自由时间挪给低边际产出槽买来的；
      历史口径「平A权重与留白不应并存、剩余时间按权重全分配」只在权重本身被优化过时才自洽。实测（探针 `PROBE_CONV_WEIGHTS_SWEEP=1`，127 预设：默认 vs 逐队把某一个槽的权重置 0）：留白合计 189.33→72.38s（−117s/−62%）、
      49 队可改善、几乎全来自「槽0（主C）权重置 0」（`auto-1191-1481-1311` 15.47→0.00、`auto-1191-1361-1311` 14.95→0.00、`auto-1401-1511-1411` 3.98→0.00）；但别读成「主C 不该拿平A池」——同批改动伤害有涨有跌：`auto-1401-1511-1411`
      +4.9%、`billy-liuyin-lucia` +5.8%、`auto-1191-1161-1311` −8.1%、`auto-1401-1261-1411` −13.2%、`yidhari-trigger-lucia` −15.6%、`auto-1181-1511-1411` −28.0%、`auto-1591-1481-1211` 翻成超预算 1.71s。
    - **判据·仪器与现状**：边际均衡坐标上升 `composables/timeWeightBalancer.ts#equalizeTimeWeights`（单变量扰动→团队总伤增量→转移权重）+ 编排层包装 `teamTimeline.ts#optimizeTeamTimeWeights`（set-read-restore 经 `calc.teamTotalDamage`），
      接线测试 `timeWeightBalancer.int.test.ts`；调用点只有一处=金数分配 `teamTimeline.ts:484`（`allocateGoldByGreedy` 基础态）。主路径 + `timeGolden`/`timeFillRatchet` 两份基线全部静态默认权重
      `stores/config.ts#defaultBasicAttackTimeWeight`（强攻/异常/击破=1、支援/防护=0；用户裁决 2026-09-04「不设职业统一阶梯」、抬权重归角色级滑块/预设）。
    - **判据·落地形态**：`configStore.timeWeightStrategy` 三态（用户裁决 2026-09-10：默认快档 B、开了才是更慢的 C、补「全关」档支撑难度曲线）：`'static'`=不跑策略（静态默认权重/手填值；难度曲线「全关」档落点，
      还回手填自由度）/ `'balanced'`（默认）=边际均衡（B `marginal-equalize`，≈3 倍求值：均值 239.5ms/队、p90 494ms、最坏 1301ms，对照一次全队求值 78.6ms）/ `'joint'`=多杠杆联合（C `joint-levers`：均衡+弹刀阶梯 ≈15~20 次求值 ~1.5s）。
      队伍签名/档位变化跑一次（`CalculatorView#useTimeWeightAutoAllocation`）；策略映射单一来源 `timeWeightStrategyIdForMode(mode)`（`'static'`→`null`=不跑，不硬编码 id）；触发签名刻意排除权重本身（`timeWeightAllocationSignature`，
      防策略写回权重自触发死循环；测试 `__tests__/timeWeightAllocation.test.ts` ②）；生成规则须留痕：UI = TeamConfigPage「平A时间权重」旁标签「权重分配策略」三态下拉，
      tooltip「静态=不自动分配、均衡=快、联合=慢、切回静态不还原已写回的值」；引擎与两份基线保持静态权重口径（「计算外侧」的显式求解，只在 UI 触发点跑）⇒ 档位切换零 delta，基线仍是引擎回归的参照面。扩展点=新逻辑各实现一个
      `TimeWeightStrategy` 注册进表、UI 开关与 watcher 调用点不动（用户口径 2026-09-10：以后加逻辑如「能量不够就多a」、队友时间都合轴）。
    - **判据·joint 杠杆与硬门**：`jointLeverStrategy`（注册表默认策略；用户 2026-09-10「做吧」）= 阶段 -1 减交互 + ① 平A权重（委托边际均衡）+ ② 弹刀次数（±2 阶梯坐标上升，≤3 轮）+ ③ 能量喂能 + ④ 角点解；
      目标=团队总伤；硬门=装配期不发生时间线截断（`convergence.timeTruncatedSeconds ≤ 0` 即前台净占用 ≤ 预算；用户原话「弹刀多了也不能超过总时间，否则他可能无限制的加了」——无门则弹刀 daze/喧响/闪能奖励照算、
      超时部分被装配截断（坑22）⇒ 优化器白拿奖励一路加到上限）。
    - **判据·机制实测（`PROBE_CONV_GRID` + `PROBE_CONV_RULE`，2026-09-10）**：用户口径实测：「达成失衡目标后一定是主C 享有全部时间」「异常队的时间分配只有双战场同时在场才会抢时间」。①
      失衡目标基本不依赖平A池——击破位池置 0 失衡不变（`auto-1521-1361-1311` 5=5、`auto-1501-1511-1311` 3=3；失衡值来自必做动作的 daze，已在账本里），「击破位拿刚好打满目标的最小时间」多数队退化为 0；
      但并非全部（给击破位 0 会让 `auto-1591-1481-1311`/`claret-koleda-rina` 失衡 4→3）⇒ 必须带「最小够用」阈值搜索、不能硬编码 0。② 「主C 独占」非普适最优：`auto-1401-1511-1411`（爱丽丝异常+南宫羽击破）给击破位 4×
      权重反而 +8.4%（主C 只留 4.9s）——引擎按边际伤害判：异常主C 每平A秒产出可低于队友。⇒ 预烘焙任何静态值/规则都不准（实测证实用户判断），分配必须按当时的失衡目标与在场结构现算，
      只有边际口径能保证「不变差」；「击破位最小够用量」= 失衡次数下限约束，与边际搜索联合而非替代。
    - **判据·价值实测（127 预设，默认 vs）**：边际均衡 8103M→8335M（+2.86%）、67 提升/60 无变化/0 变差（构造性单调）、56 队主C 平A池被默认权重分少；最大 `auto-1521-1361-1311` +23.9%（主C 平A 31.8→65.7s、强特 16→18）、
      `auto-1501-1511-1311` +21.9%（31.9→57.6s、11→14）、`auto-1521-1251-1311` +16.3%、`auto-1591-1481-1311` +10.1% ⇒ 默认权重表本身是个待修默认值。联合·无 boss（`appliedBoss=null`）：8103M→8666M（+6.95%）、95 提升/32 无变化/32
      拒绝（基线超时不敢动）、88 队弹刀被改动（增益形态=删弹刀）、失衡仅 5 队变化；top `auto-1521-1361-1311` 88.1M→126.3M（+43.4%）、`auto-1521-1481-1311` +39.4%、`auto-1311-1521-1361` +42.9%、`auto-1581-1261-1561` +19.5%。联合·有 boss
      托底（`appliedBoss.parryTotal=13`，叶释渊量级）：8103M→8413M（+3.83%）、87 提升/40 无变化/39 拒绝/55 弹刀改动/失衡仅 2 队变化；top `auto-1521-1361-1311` +23.9%（弹刀未动⇒纯权重收益）、`auto-1181-1561-1581` +15.7%（弹刀再分配）、
      `auto-1311-1521-1361` +19.7%。
    - **判据·弹刀下限=boss 预设强制次数（用户裁决 2026-09-10）**：允许减少交互（「有时候主c的平a比队友弹刀好用」）但不得低于 boss 预设最低次数（「boss 预设的次数是强制完成的」）⇒ 阶梯在 `dir < 0` 时加下限判据
      `Σparry + dir ≥ appliedBoss.parryTotal`（与 `core/parrySplit.ts` 同源；低于下限的补齐由 `parrySplit` 负责，本策略只承诺不下调越过它、不造第二份）。实测下限起作用：`auto-1181-1561-1581` 弹刀 6/6/6→12/2/0（18→14 ≥ 13，从主C
      转移到击破/支援位），总伤 +15.7%。
    - **判据·弹刀口径三件事（用户裁决 2026-09-10）**：· 不带支援突击的弹刀对半分：`core/parrySplit.ts` `mainDpsNoFollowUp = floor(total/2)`、`breakerNoFollowUp = 余`（奇数归击破位），缺口抵扣只用击破位那一半；消费端 `useResourceCalc`
      两槽分别写 `parryNoFollowUpCount`（无击破位队仍全归主C），`parrySplitResult` 投影补 `mainDpsNoFollowUp`，并修 `perSlotParry` 主C 那半的 215 喧响奖励漏计；测试 `parrySplit.test.ts`/`parrySplitInt.test.ts` 21 tests 全绿（含「15 → 8/7」
      「2 → 1/1」）；两份基线 0 delta（基线不应用 boss 预设 ⇒ parrySplit 不激活）。· 正常弹刀拆分保持现状：现行「击破位按失衡缺口先取、主C 拿剩余」在用户容差内（原话「正常弹刀作为一个招式，如果失衡不够就给击破，如果主C 喧响不够就给主C，但是很难判断，所以对半分差不了多少」——两条判据维度都记在这），不改。
      · 轻弹刀只取 #1 段：表里 `1521015/16/17` 只是命名（轻/重/连续弹刀），后两种没必要算；引擎取 `1521015` + 支援突击 `1521018` = 完整一次弹刀。一次弹刀（希希芙）完整账 = 3.232s 必要前台时间 + 987 daze + 123.45 行内喧响 +
      215 特殊动作喧响（+ 1042% 支援突击倍率）；215 确存在 = `core/anomalyPool.ts#PARRY_DECIBEL_BONUS = 215` 走「特殊动作奖励」通道（`calcSpecialActionBonus`：弹刀215/闪反10/连携10/快支20，队友伴随 50%），`useResourceCalc` 按槽位注入。
    - **判据·次数-伤害联立（用户的分配模型，2026-09-10 口径；策略目标函数与约束以此为准）**：
      「失衡次数只是第一个决策…总体而言是为了总伤最大化；战场性能强的主C 平A 产出的能量、特殊资源也能转化为更多倍率」⇒ 次数当硬约束（先定）、伤害当目标函数，目标里必须含「平A→能量→强特/大招」
      「平A→专属资源→倍率行」两条间接通道（引擎里=`iterate` 平A池→回能／模块专属资源）。实测约束会咬（`PROBE_CONV_BALANCE_STUN`，127 预设）：均衡器只最大化伤害 → 4 队掉失衡次数（`yidhari-trigger-lucia` 3→2 换 +7.2%、
      `auto-1591-1481-1311` 4→3 换 +10.1%、`auto-1201-1361-1211` 4→3 换 +3.6%、`auto-1201-1361-1311` 4→3 换 +1.8%）⇒ 已实现为硬约束（`marginalEqualizeStrategy`）：均衡解掉次数则回滚权重 + `note` 如实上报这笔交易（不静默接受、
      也不静默丢弃），`timeWeightAllocation.test.ts` ⑤ 锁。
    - **判据·杠杆落地（账本 A1/A2/A4，2026-09-10）**：· A1 可行性优先：`jointLeverStrategy` 新增阶段 -1——基线已超时的队先用减交互杠杆（弹刀/金身/双反/闪反，与引擎非轴降配同族；加交互只会加剧截断，只试减向 ±2 ≤2
      轮）拉回可行：接受=截断减少且总伤不低于基线（判据「timeTruncatedSeconds → 0 且总伤不降」），截断归零提前退出；拉不回的队保底相对门（`feasibleFloor`=阶段 -1 找到的最小截断，后续搜索不得推回去）。
      实测（`PROBE_CONV_JOINT`，127 预设）：结束后仍截断 15→9 队、总伤 +8.75%→+9.27%、提升 116→120 队；样例 `auto-1591-1481-1311` 截断 0.91→0.00s、总伤 81.1→94.0M（+15.9%）、弹刀 12→6。剩余 9 队实证「拉不回来」（最高截断 91.6s
      = `auto-1431-1481-1341`）：必要行超预算、交互减 0 也装不下（轴退化/非轴降配已先跑）→ note 如实上报、不在策略层硬塞。测试 ⑥c（A1 判据）。· A2 能量驱动（③ 杠杆，用户点名「能量不够就多A」）：主C
      强特次数=`floor(总能量/耗能)`（`resolveExSpecialCount`），平A池是主C 能量主要来源（basicAttackTime × 秒均回能）；①② 后主C 次数被挤（能量紧张）则把低边际槽权重转给主C 多A，接受=主C exSpecialCount 上升 + 总伤 ≥ 基线 +
      仍可行；未挤的队只接受伤害不降的喂能。守卫判据「主C exSpecialCount 不降 + 总伤不降」按逐杠杆解释（v2，见否决记录）。实测：喂能 17→20 队、总伤 +9.22%（每队 ≥ 基线；与 A3 +9.27%
      差值=被挤队花少量伤害买回次数+喂能先行、角点机会减少的预期成本）。测试 ⑥d（A2 判据）。· A4 双主C（用户「有些队伍不是一个主c」）：策略层「主C」=队内全部输出定位槽（单源
      `scripts/lib/presetCategories.mjs#isCarrySpecialty`，`carrySlotsOf`；首元素=分类口径第一核心；无输出位回落 [0]）；③ 喂能与 ex 守卫逐核心执行、喂能只从非输出槽抽（饿不到另一个主C）；④ 角点解只压非输出槽（预设库 28
      支双异常核心队里第二个 carry 曾被当辅助压到最小够用=卖伤害）；核心间份额由 ① 均衡器按伤害边际协调（逐槽坐标上升=1D）。@fact engine:分配策略/主C判定。测试 ⑥f（双核心队：两槽次数都不降 +
      角点解不压输出槽）。· 下一步（用户点名，按优先级）：受限边际搜索——现在掉次数=回滚，更优解是「在保次数的可行域内继续爬」。
    - **未决·弹刀计价（仍未定，但已不影响上述落地）**：无 boss 预设时 top 增益全来自「把弹刀删到 0」（`6/6/0 → 0/0/0`）——引擎把弹刀按 `assistFollowUpActionTime` 记进必要前台时间，其 decibel/daze 回报在小队低于给主C
      的边际伤害。用户 2026-09-10 说明「弹刀本身奖励了一些喧响，后面跟的支援突击差不多能弥补前面弹刀的损失，所以主C 弹刀通常白赚喧响和部分数据；击破弹刀造成较高失衡值」
      ——若引擎双侧计价与该描述不符（弹刀被系统性算成净亏），那是计价口径问题：单独核对 `core/resource/helpers.ts` 的弹刀行（`assistFollowUpActionTime` 计费 vs `assistFollowUpDecibelRecovery` 回报，含 `parryTimeFreeCount` 免费次数），
      而不是让搜索去删弹刀。当前落地=用户裁决「计算器里弹刀是自我选择的语境，可以根据收益抉择」：允许减少，下限=boss 预设强制次数。
    - **否决记录（都量过数字，勿重新发明；规则 16③）**：
      · 以「留白」为判据改求解器（坑33 的 6 个 τ 变体 + 阶段4 三刀，共 9 种）→ 全负（留白由权重主导）。
      · 静态规则「只有伤害特化拿池」→ 仅 +1.30%（8103M→8208M）、56 提升/29 变差（最坏 `claret-koleda-rina` −27.5%、`auto-1261-1331-1581` −11.6%）——假设击破/支援不产伤，而珂蕾妲/青衣/妮可本身产伤。
      · 均衡权重一次性烘进 `teamPresets`（静态、零运行时成本、可 diff）→ 用户口径否决（2026-09-10）：终点分配=主C 独占的角色驱动角点解（非各槽边际相等的内点均衡）、异常队争抢=双战场重叠条件性解 ⇒
        烘中间值在别的失衡目标下错，必须现算。
      · 硬门读 `rr.overflowSeconds` → cfg 副作用字段（每次 `calcTeamResources` 都写、一次预设求值十几次调用）⇒ 读数翻面（实测门槛读 0 而终态 0.906s）；必须读结果自带的
        `convergence.timeTruncatedSeconds`（同坑33「尾巴专项：收敛读数归属」）。
      · 不带支援突击弹刀「全部归击破位」→ 用户裁定是错的、已删（把「补失衡」误解成「只有击破弹刀」）→ 对半分。
      · 「引擎可能少给喧响」→ 旧版说法读漏作废：215 确存在，走 `PARRY_DECIBEL_BONUS` 特殊动作通道。
      · 喂能首版允许伤害换次数 → 39 队喂能把 +9.07% 拖回 +8.01%；收窄为「未挤的队只接受伤害不降的喂能」后 +9.27%。
      · ③ 的 `starved` 与 `exBase` 同刻抓取 → 恒 false（伤害地板永远走「未挤」分支）；`exStart` 改在策略入口抓取后被挤判定恢复生效。
      · 守卫全量严格版（逐核心对照策略入口、不满足就把权重+弹刀整体回滚基线）→ 咬 17 队：均衡 ① 本会在核心间挪次数（与 ⑤「次数是分配的结果、如实上报不拦截」先例冲突），回滚抵消 A1
        拉回成果（结束仍截断 9→12 队、总伤 +9.27%→+7.08%）⇒ 守卫 v2=逐杠杆：③④ 每步接受以该核心 ex 上升为条件、末态防御兜底（若仍变坏只回滚权重到 ①② 末态，保住 ①②/阶段-1 收益），① 核心间挪动允许 + note
        逐核心上报（`槽N 基线→现值 次`）。勿再把守卫改回全量回滚。
    - **待用户裁决（产品级，爆炸半径=全库数值）**：主路径是否也走边际均衡（即「默认权重」= 均衡权重）？那会让 49 队落点变（伤害 ±0.4%~±28%）；而伤害没有外部真值锚（AGENTS §3 实战归档不作误差判据），
      只有用户能定。在那之前：不要再为「降低留白」动折叠环（已试 9 种，全负）。
    > 编年史原文 = `git show 5e559f2:docs/ENGINE_PIPELINE_GUIDE.md` 坑35（原168行），2026-09-12 按规则 8 拆薄。
36. **轴内块数取「连续失衡次数」→ 小数被截断 → 整行静默消失（2026-09-10 查证 → 同日修复）**：
    症状 = 实战对比部署（自动轴）里 **雨果的决算行整行不见/次数缩水**：轴栈 `executed` 明明有
    `s0·1291015×10 + s0·1291_ex_verdict_final×5`，资源池执行行却只落地 `×1`（最坏时
    `count <= 0` 短路 → 整行不发射）；把 `autoYidhariAxis` 关掉立刻变成 `1291_ex_verdict_final×9
    + 1291_ultimate_verdict_bonus×2`。探针：`PROBE_HUGO_MATRIX=1 npx vitest run
    src/composables/__tests__/hugoStunVulnMatrixProbe.test.ts`（案例 B/C 复现 + 案例 D 吃一部分）。
    **根因（引擎日志实测）**：同一轮里存在**两份失衡次数**——轴分配用的 `stunCount` 是外层不动点线程里的
    **连续值 0.824**，而失衡池在同一轮算出 **4**：
    `[round-return] 本轮输入 stunCount=0.8239426908104948 池=4 axisActive=true hugoExVerdict=0.8239426908104948`。
    于是轴内块数 = `动作 count × wins(0.824)` = 0.824，而 `hugo.ts#computeHugoCycle` 对轴注入次数做
    `Math.floor` → **0/1** → 决算行缩水/不发射（同时轴里那 4 个决算块认领不到伤害行，易伤空转）。
    代价量级：决算 = 709.8%（基础）+ 决算追加（remaining 11.43s →
    1000 + 5×280 + 6.43×100 = 3043%）= **3752.8%/次**，本该替代 709.8% 的普通终结一击且吃满失衡易伤。
    **为什么一直没人看见**：外层不动点报 `converged=true / outerExit=stable / outerRounds=4`，但这个量
    **不在收敛判据里**（`convergence` 只报时间预算层），所以「轴用 0.82 窗、池说 4 窗」可以稳态共存。
    **修复（2026-09-10 落地）**：轴内块数改读与池**同源**的整数失衡次数——新增收敛线程
    `prevPoolStunCount`（`resourceCalc/roundThreads.ts`，= 上一轮失衡池 `stunCount`，与其它
    prev* 线程同款滞后注入），`useResourceCalc.ts` 雨果块（`hugoAxisExVerdictCount`/
    `hugoAxisUltVerdictCount`）的 `allocateAxisWindows` 入参从「本轮计划小数」换成它；首轮无池 → 0，
    收敛期稳定后与最终池一致；锁定次数路径池 = 锁定值，不受影响。锁定场景下**旧断言 3 也修正为 4**：
    池/轴栈（同源）实测算出 4 窗，旧值 3 恰是 floor(锁定计划值) 的影子，与栈不一致。
    实测 delta：0 命轴决算 ×1→**×5**（与栈 executed 一致）、2 命轴决算 ×1→×5、决算追加 ×1→×3
    （= `min(终结技资源总量 3, 轴块 5)`，模块既有封顶，语义正确）；`timeGolden` /
    `timeFillRatchet` / `runArchiveDeploy` **零 delta**（基线未动，无需重生成）。
    **verifier**：`src/composables/__tests__/hugoVerdictLanding.test.ts`（先红后绿，栈/池/行三源一致）
    + `src/mechanics/__tests__/hugo.test.ts` 锁定路径断言。
    **否决记录**：①注入侧改 `Math.round`/上限夹取（止血）——小数计划值 round 后仍与池不同源，
    且掩盖「小数次数」这一更大病灶（坑22），不做；②读**本轮**池——池在 cfg 之后才算出（`sp1`
    在 `promoteFixpoint`，字符 cfg 在它之前构造），同轮读不到，只能滞后一轮；③把所有轴分配
    （连携/转大/合轴等）一并换池整数——超出本坑范围，且轴内连携小数（`1291015×2.36`）属
    「小数次数」系统问题，随时间系统重构账本的实数化专项收口，不在此局部动。

37. **部署态「失衡易伤」只兑现两成：未进轴槽位回落覆盖率 + 未认领招式=0（2026-09-10 实测，口径待裁决）**：
    症状 = 用户报「实战对比页计算伤害比实战低很多，失衡易伤静默不算」。**它接了，但信用极低**——
    同一次部署内只切 `enemy.stunVuln`（2.0→1.0）差分的加权易伤信用 = `总伤(2.0)/总伤(1.0) − 1`
    = **0.1966**（满额应为 1.0，即只吃到 19.7%）。行级实测（BOSS 失衡易伤 2.0、失衡 4 次 × 21s 窗、
    战斗 180s/无敌 24s、覆盖率 0.46）：
    · 雨果 46% 伤害里只有 **连携技 1 行吃满 2.00**（占 8.6%），其余 6 行**全 1.00（零易伤）**——
      终结技 11.1% / 支援突击 9.2% / 终结一击 7.8% / 闪反 6.0% / 平A 2.2%；
    · 未进轴的琉音 39% + 莱特 15% 全部走全局覆盖率 **1.46**。
    口径出处（设计如此，不是断链）：`damagePool.ts#pushDirect` 的 `stunned = row.stunOverride ??
    stunCoverage`；轴模式按 `axisSplitFor` 拆「轴内=1 / 轴外=0」，未进轴槽位回落覆盖率
    （`useResourceCalc.ts#computeStunCoverage`：`min(1, 失衡次数 × 单窗 ÷ 有效时长)`，决算截断另扣）。
    **待裁决**：自动轴只认领极少数动作（雨果预设仅 3 块）时，「主C 未认领招式=0」是否该回落覆盖率？
    改了会全库数值变动，属产品级口径。**读法提示（2026-09-10 已可见化）**：结果页伤害池新增
    「失衡易伤」列（行级生效易伤，雨果队满额 2.100 / 零 1.000 / 跨窗部分中间值，三档着色）+ 表尾
    「加权有效易伤」汇总行（= Σ(伤害×生效易伤)/Σ伤害 − 1 = 加权信用，满额参照 +1.10；异常行按 1
    计、信用偏保守）。纯函数 `composables/stunVulnSummary.ts` + 快照测试
    `stunVulnSummary.test.ts`（雨果 0 命轴 0.6860 / 覆盖率 0.6237 冻结）。

38. **「静默不算」清单：哪些缺口在界面上永远不出现（2026-09-10 快照 + 复算命令；多数条目同日已修）**：
    用户问「还有多少静默不算的」。**数字是快照会漂移，命令不会**——每条都给出复算命令，别照抄数字。
    ⟳复核: 快照数字过期后按本条各复算命令重跑对账（清完的销号、新静默补条） | 到期 2026-10-15
    · **① 已声明但 UI 不显示 → 已修（2026-09-10）**：部署页缺口清单（`utils/modelingGaps.ts`）判据
    从「只按 status 过滤」改为「**pending[] 非空即列**」（status 只定措辞：未接入计算/已实现·遗留待办），
    存量 104 命座 + 41 机制带 pending 的条目全部现形（原仅 6+1 可见），列表超 8 条自动折叠可展开；
    数据驱动断言见 `modelingGaps.test.ts`（真实账本逐条对账，pending 非空必在清单里）。复算：
    `node -e "const fs=require('fs');for(const [f,k] of [['character-constellations','cinemas'],['character-mechanics','mechanics']]){const j=JSON.parse(fs.readFileSync('public/static/'+f+'.json','utf8'));let t=0,h=0;for(const e of Object.values(j.characters))for(const i of e[k]||[]){const p=(i.pending||[]).length;if(p)t+=p}console.log(f,'pending',t)}"`
    · **② 声明了但引擎零消费 → 已清（2026-09-10）**：**16 条 spec `adjustable` 真死滑块已删除**
    （8 角色：1171/1181/1261/1281/1291/1411/1511/1581——模块存在但不调用 spec 资源解释器，
    `specToMechanicModule` 从不注册 ⇒ 零消费者，只在设置页当摆设）；**另 36 条经查是误报**：
    模块调用 `computeSpecResources`/`buildSpecEventExecutions` 时 adjustable **是活的**
    （解释器按 `setting:<id>` 应用倍率，且 `adjustable.default` 常携带真实口径——希希芙失衡命中占比
    0.5 就编码在 default 里，删掉即 5→10 数值回归），判据已改为「模块不调解释器才 WARN」
    （validate-specs.mjs，2026-09-10 同日修正，误报全部撤销）；`sync-spec-adjustables.mjs` 加护栏只给
    spec-only 角色（现仅 1551 佩洛伊斯）挂滑块，防重跑复活真死滑块；teammate-buffs **`basis` 4 条**
    （千夏 C2/照核心/照C2/露西核心，`src/core/buff.ts` 零命中，原文均为「提升 X%」普通面板 buff，
    `basis` 是错误标注）已删除，零数值变化。复算：`node scripts/validate-specs.mjs | grep -c WARN` → **0**。
    · **③ 零散静默 → 部分已清（2026-09-10）**：`shortAxisFeiguangCount` 死函数**已删**（4/10/5/12 历史
    口径，被「三档轴每轮消耗满 6 点青溟剑势」口径取代，文件注释原本就自标「未接线」）；归档
    `bangbooId` 解析后**现在告警**（`submissionToDeploy` 推一条「该投稿带邦布：计算器无邦布位」到部署
    警告，页面已渲染）；spec JSON 里的 `debt:` **已纳入 check-guards 扫描并登记**（1411 柚叶转积蓄
    施加者近似，5/5）；剩余：逐招耀变行不进队伍总伤（口径不同源，已在 MECHANICS_IMPLEMENTATION.md
    如实记录，不做误差判据）、`zc drift` 28 条待复核口径。
    · **④ 量级已登记的偏低主因**（不是本次新发现）：倍率融合缺段（`data/moveFusions.ts` 头注释自称
    「低估主因之一，最低金+3 前沿 80% fn 定位到此」）、最低金+3 前沿低估最重组仅 32%/39%
    （`damageSplitFrontierProbe` 头注释）、面板 316 ATK（曾全库 −12~16%，已修）、邦布无位、动作覆盖
    （仪玄强特 11 vs 实战 15+）；**留白实测 = 棘轮基线 127 队合计 162.7s**
    （`node -e "const j=require('./src/composables/__tests__/timeFillRatchet.baseline.json');let s=0,n=0;for(const [k,v] of Object.entries(j)){if(k.startsWith('_'))continue;n++;s+=v.slack||0}console.log(n,s.toFixed(1))"`），
    不是文档旧值 391s ⇒ **留白不构成 5× 量级的主因**，别再把「伤害低」记到它头上。

39. **「基线绿」不等于「改动生效」：数据订正类改动必须反向 A/B 证伪（2026-09-12 两条实测）**：
    **症状**：改了 catalog 数值，`timeGolden` 全绿零 delta → 极易被读成「改动没生效 / 漏改了」。
    **两个真实成因**（都可能表现为绿）：
    ① **基线已被前人重生成过**（最常见）：`TIME_GOLDEN_UPDATE=1` 跑过一次，基线里**已经是订正后的值**，
       于是「改对了」和「没改」都显示绿。1611 克拉蕾实测：基线里 `856266` 本就是订正后值。
    ② **改动路径不进该仪器的度量面**：`applyPanel` 钩子在**编排层**（`resourceCalc/helpers.ts` 派发），
       而 `PROBE_AGENT=<id> npm run probe:panel` 只调 `core/panel#calcPanel` —— 探针**看不到**任何
       `applyPanel` 施加的修正（1611 的 +17.5% 暴击率就不在其中）。
    **判据（照做，别凭绿/红下结论）**：
    1. **反向 A/B**：临时把值改回旧值重跑，看 delta 是否如预期出现。1611 实测改回 critDmg=0 →
       c0 **−21.569%** / c6 **−21.970%**（改完立刻用备份还原）。**出现预期 delta 才证明通道打通**。
    2. **选对仪器**：判断你要验的东西在不在该仪器的路径上（探针 = 只有 calcPanel；`useResourceCalc`
       的 `damagePanels` = 含 applyPanel 的权威面板）。不确定就两个都跑，对不上的差就是钩子贡献。
    3. **单变量归因**：多处同时改时，逐个回退定位到**唯一**诱因（本批 20 处订正里，只有 1051 引起
       时间账抖动、只有 1291 引起加权易伤快照漂移 —— 都是逐个回退实证出来的，不是猜的）。
    **复算/工具**：`node scripts/audit-catalog-level60.mjs`（catalog ↔ raw 对账，见坑 40）。
    **否决记录**：❌「测试绿了所以改动生效了」——这是本坑的全部代价；❌ 用探针读数当面板唯一权威
    （不含 applyPanel）；❌ 多处一起改后靠 delta 猜归因（必须单变量回退）。

40. **catalog 落库值必须与 raw 源可对账：漏加「突破加成」是最安静的一类数据错误（2026-09-12）**：
    **症状**：某角色的 level60 字段 = **全库通用裸基值**（如暴击率全部恰好 5、暴伤全部恰好 50）。
    因为「大家都一样」，**肉眼完全看不出来**；只有个别角色被单独订正后才会暴露口径分裂。
    **根因模式**：导入脚本写「base + 突破加成」类字段时只取了 base。实测 `import-nanoka-beta-agent.mjs`
    漏掉 `extra_level['6'].extra['20101'/'21101']` → **20 个角色**被落错（19 个 critRate + 1 个 critDmg），
    而 1481/1571/1241/1461 经另一条已废弃路径入库的却是**含加成**的 19.4/78.8 —— 同一 catalog 两套口径。
    **为什么这是「静默」的**：`core/panel#calcBasePanel` 直接读 `s.critRate`，**别处无补偿通道**，
    所以错了不会报错、不会红，只会全体偏低一档。
    **判据（改这类数据前必做三条自证）**：
    ① **无第二通道**：`grep -rn "critRate" src/core/panel.ts` 确认只有直读、别处不补（有补偿则订正会双计，
       必须停手上报）；② **库内已有正确样本**证明口径（本例：5 个角色已是 19.4/78.8）；
    ③ **错得整整齐齐**（全部恰好等于某个通用基值）⇒ 单脚本漏写特征，而非逐角色口径差异。
    **工具（泛用，不只查暴击）**：`scripts/lib/level60-rules.mjs` 是**规则表单一事实源**，
    被审计与修复脚本共用 —— 加一行规则即可扩到任意字段，别在两处各抄公式。
    · 审计：`node scripts/audit-catalog-level60.mjs [--field critRate] [--agent 1611] [--json]`（只读，有差异 EXIT=1）
    · 修复：`node scripts/patch-level60-ascension.mjs [--write]`（dry-run 默认；只动审计判定的字段）
    · 防复发：`import-nanoka-beta-agent.mjs` 已改为**从规则表取求值器**（`ruleOf('critRate')`），
      下次重导不会再漏；改口径只需改 `lib/level60-rules.mjs` 一处。
    **容差纪律**：对照组（如 atkBase）可设小容差（0.1）吸收历史舍入噪声，但**绝不能调到会吞掉真错误的量级**
    （本例真错误 +5.5 远超容差，仍被抓出）。
    **影响量级参考（供预判）**：critRate +14.4 的伤害涨幅 = `1+r·d` 模型下 **7%（critDmg 50%）～26%（critDmg 200%）**
    —— 暴伤越高收益越大；**且会经 `timeWeightAllocation` 按伤害边际微调平A权重**，
    故时间账可能出现 0.001–0.01s 的抖动（这是可解释传导，不是回归）。

## 5. 验收命令

```bash
npm run verify      # validate:data + validate:specs + vitest + typecheck + build（一条链）
npm run docs:status # 重新生成 docs/implementation-status.md（勿手改；CI 检查漂移）
```

新增机制后同步 `public/static/character-mechanics.json` / `character-constellations.json`
（实现状态 + codePaths；`validate:data` 有状态表同步护栏——新角色缺条目即红），并补一条全管线冒烟测试
（参考 `src/mechanics/__tests__/billySmoke.test.ts` 的 harness：`src/test/harness.ts` 的
`setupHarness` + `useResourceCalc().resourceResult`；三文件 fetch stub 不再复制，用 `mockStaticFetch()`）。
