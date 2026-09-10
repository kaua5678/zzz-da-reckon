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
> **要改时间/收敛/截断逻辑前，先读坑 19 的「否决记录」**——九条已量过的死路都在那里。
> **按症状查（不用通读）**：滑块改了面板/结果不变→1 · 强特次数不对/接管 EX 链→2 · 倍率/失衡/喧响全错→3 · 按 name/note 找不到执行行→4 · 附伤 daze/异常双计→5 · 专属动作不占时间→6 · 贯穿力疑似双计→7 · 招式命中类计数没源→8 · 轴内动作次数/时间不对→9 · 进场能量不对→10 · 指定招式增伤误放大→11 · 前台超时/账本虚增→12 · 队伍联动静默错值→13 · 界面能量与次数对不上→14 · 不收敛/数值抖动→15 · 两次算结果漂移→16 · 同输入落点漂移→17 · 物化行打不满战斗时间（欠打）/轴需求超预算误报超时→19 · 「汇总卡说快满了、角色条却空一截」（账本口径 vs 物化口径不同源）→19① + `composables/teamTimeSummary.ts`。 · 出现小数次数 / 招式行凭空消失 / 失衡池被清空致结果为 null →22（时间线截断）。 · **失衡次数显示 0 / 同一队冷热启动给出不同次数·同一队算两次留白不一样**→25（非轴失衡不动点的阶梯 2-循环 / 热启动缓存注入收敛末态）。 · **直伤比同类异常角色偏低 / 减防·无视防御不生效**→26（面板通用 enemyDefReduction 未进直伤通道）。 · **资源卡「总计」= 180s + 赠送秒数 / 赠送队超预算**→28（赠送行未回扣截断上限与前台展示）。 · **轴里捏的招式超过资源总量还被算进去**→29（轴栈资源门控应为「去掉」）。 · **连携技/招式「单次」时长比同族小一个量级（雅连携显示 0.515s 一类）/ 一次连携的倍率是全段而喧响-时间只是头段** →31（多段招式三侧口径不一致，含自动攻击段特例）。 · **自动轴下令牌招式行凭空消失（雨果决算 1291_ex_verdict_final 整行不见）/ 轴栈说 N 块而资源池 0 行** →36（轴内块数取连续失衡次数小数后被 `Math.floor` 归零；2026-09-10 已修复：轴内块数与池同源取整数，判据见 `hugoVerdictLanding.test.ts`）。 · **实战对比部署算出的伤害远低于实战 / 感觉失衡易伤没算** →37（失衡易伤接了但只兑现约两成：未进轴槽位走覆盖率、主C未认领招式=0；结果页伤害池已有「失衡易伤」列 + 加权汇总行，见 `composables/stunVulnSummary.ts`）。 · **想知道「还有多少静默不算的」/ 哪些缺口界面永远不提示** →38（待办清单已按 pending 非空现形 + 52 条死滑块/basis/死函数已清，逐条带复算命令）。


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
18. **Boss 预设弹刀反推（2026-08）**：`boss-presets.json` 的 `defaults.parryTotal` / `parryNoFollowUpTotal` +
    「保底4失衡」勾选时，`useResourceCalc` 外层不动点线程（`prevParrySplit`，般岳 `prevBanyueTopUp`
    同款收敛）按当前队伍反推——击破位（首个 `specialty==='stun'` 槽位）**正常弹刀** = 保底 4 次失衡所需、
    主C（槽位 0）= `parryTotal − 击破位`（主C 已手填不覆盖）；**不带支援突击弹刀**（只有轻弹刀倍率行 +
    喧响 215、无支援突击行）全部归击破位、非用户可调（执行行：轻弹刀 count = parry + 无突击、支援突击
    count = parry）。**口径坑**：①缺口必须按「非弹刀失衡基数」算（失衡池 total − 击破位弹刀行贡献，行
    count 随弹刀缩放），否则补齐自身把缺口关掉会 0↔T 振荡；②无突击弹刀的失衡值先从缺口里扣掉再反推
    正常弹刀；③击破位每次弹刀失衡 = 招架支援 + 支援突击两行 `effectiveStun/count` 之和（无突击 = 仅招架
    支援）；④**首轮注入 ≥1 探针**保证轻弹刀行存在供测量，但探针的 215 喧响会经「喧响→终结技→连携」级联
    污染本轮失衡（曾致反推归零后无行卡死）——**每次弹刀失衡值随线程携带**（`perParryDaze`，本轮无行沿用
    上轮实测值）；⑤弹刀 215 喧响必须用注入后有效次数（`parryForBonus` 读 `characters[slot].parryCount +
    parryNoFollowUpCount`，勿用 store 原值，曾漏算反推弹刀喧响）。纯函数 `core/parrySplit.ts` 单测 + 集成
    `parrySplitInt.test.ts`（真数据叶释渊/司祭/未知复合侵蚀体）。**只给喧响的弹刀**（`parryDecibelOnlyTotal`，
    轻弹刀打小怪无 daze）只计 215 喧响、不产任何行（不进 parryForBonus 之外的行生成）；**失衡赠礼**
    `stunGiftRatio` 应用时换算 `bossStunGift = 比例 × stunValue`，`calcStunPool` 加 `stunGift` 直接计入
    stunCount 推导（不计抗性/返还），反推的非弹刀基数也把它加进去（减少缺口）。
19. **时间预算欠打回填 + 轴退化（2026-08-30）**：坑 12 的折叠循环是单向的（只折正 excess），
    「estimate 高估 → basic 池被挤到 0 → 物化行打不满战斗时间」无人管——般岳队曾实测前台 172.8s
    欠打 7.2s（账本高估 13s 把平A池挤光）。双向修法：
    ①**欠打回填**：把「团队 Σ(账本−物化必要行) 正差」写入 `config.timeBudgetRefund`（团队级）
    → `iterate` 的 `availableBasicTime` 加回该差额（按 timeWeight 分配，时间守恒）。
    **首轮冻结已被末轮重测取代（2026-09-05）**：原语义只在 pass0 测一次，而 pass0 **恒测到正 excess**
    （此时平A池按权重满额发放 → 模块专属行爆量）→ refund 被冻成 0，此后 excess 转负（账本 > 物化行
    = 时间没打满）再也拿不到回填——实测 96/125 预设 refund=0、41 队留白 >1s、最大 93.7s
    （朱鸢队 1241 槽：账本必要 138.3s vs 物化必要行 44.6s），而 `timeBudgetConverged` 仍报 true。
    现在折叠循环退出后按「预算 − 物化前台净占用」重测欠打量，**折半试探**注入 refund 并重收敛，
    接受条件三条：内层判稳 + `trialRows ≤ 预算 − 容差`（可行性）+ 行数确实变多；任一不满足就
    **连 cfg 一起回滚**（试探轮跑 `iterate` 会触发模块写回：叶瞬光自动选轴在
    `estimateExSpecialTime` 里按 `timeBudgetExcess` 退化并改 `record.yeshuguangAutoAxis`，
    只回滚 refund 会把退化后的轴留在 cfg 上 → 该队留白反增 7.8s、伤害 −13%）。三条纪律：
    - **门槛 = 1s（量化容差，2026-09-08 改）**：用户口径「平A权重与留白不应并存，剩余自由时间按权重
      全部分配」——欠打 >1s 一律试探回填（refund→平A池→按 timeWeight 水填），≤1s 属量化地板
      （坑12「不追求精确 0」，合轴可覆盖）不试探。旧 10s 门槛（09-05 定：≤5s 会把近均衡队
      推进 `stunCount=0` 吸引盆——失衡 116k→9.5k，`runArchiveDeploy` 雅/南宫/柚叶队崩、
      `anomalyUtilization` 丽娜积蓄偏 0.3%；门槛扫描 1s=335/41/2(+2队崩) 5s=353/31/2
      10s=391/23/2 20s=421/20/2）在 09-08 引擎（1051/1531 实数化、轴栈资源门控、sigrid 估时钩子、
      琉音三件套）上复核 1s 门槛：ratchet 绝对不变量（stun>0/outerExit≠maxIter）/runArchiveDeploy
      （116k 样本）/allAgentsSweep（C6>C0 等）/yidhariInteractionGrid 全绿，旧盆不复现。
      **排除队：2026-09-10 起为空**（1591 一族解除，见下「撤 1591 收口」；1051/1531 于 09-08 放回）。
      **历史（2026-09-08 门槛 1s 落地时逐族定位，同日从三族收窄到一族）**——1591 希格莉德：
      试探的行测量口径（`buildExecutions` + 赠送行）**看不见装配期追加的行**（实测其队最终 s0 行比
      试探测得的多 ~1.9s），于是会接受「按自己的测量合规、按最终装配却超账本」的注入 → 破跨路径
      「行≤账本」（auto-1591-1481 队超 0.07~1.13s）。**试过并否决**：试探接受前加「逐槽原始行≤账本」
      判据——用的是同一份测量，照样看不见缺的那行 → 无效；升级路径 = 让试探与装配共用同一套行测量。
      **1051/1531 已放回**（同日）：它们当初被排除只因热启动缓存注入收敛末态导致冷/热落点分叉
      （0.009s / 0.0015s），而「缓存只存规范种子」修好后同配置计算逐位稳定，两族试探全绿。
      **时间行生产者地图（2026-09-08 阶段1 调查结论，自顶向下重构的靶子）**：同一条时间轴上
      「谁在建行」有 **7 处**，而试探只看得见其中 1 处 + 两处赠时的**近似**——
      ① `core/resource/helpers.ts#buildExecutions`（13 个 push 点 + 模块钩子 `getAgentMechanic(...).buildExecutions`）；
      ② 各角色模块 `mechanics/agents/*.ts` 的 `buildExecutions` 钩子；
      ③ `composables/resourceCalc/normaHatChain.ts:67`（诺姆膛温换连携赠行，**装配期**）；
      ④ `composables/resourceCalc/liuyinPromote.ts:97/184/188/193`（琉音好评转大赠行 + 连携次数改写 + **carve 自平A行**，**装配期**）；
      ⑤ `enrichExecutionPlan`（倍率表回填，会**重建行对象**——`source` 等标记在此丢失）；
      ⑥ `truncateExecutionsToFrontline`（装配截断）；
      ⑦ 轴栈 `core/stunAxisStack.ts`（轴模式时间线自持块）。
      试探的 `frontlineRowsOf` = ① + ③④的**赠时近似**（`normaGiftChainInfo`/`liuyinGiftChainInfo`），
      **看不见 ③④ 的行本身与 carve、⑤的重建、⑦的轴块** → 于是会出现「试探自测合规、装配后超账本」
      （1591 队实测超 0.07~1.13s；多出的正是 `source:'gift'` 的赠连携行 + carve 的净效应）。
      **阶段1 的靶子** = 把这 7 处收进**一个** `materialize(state, cfg) → rows[]`（纯函数、放 core/），
      试探/折叠/装配/UI 全调它；完成判据 = `timeGolden`（阶段0 脚手架）delta 逐条可解释 + 撤 `probeExcludedTeam`
      （后半已于 2026-09-10 达成，但成因是病根被能量侧改动带走而非 7 处收进单一入口——见下「撤 1591 收口」）。
      **阶段1 第一刀实测（2026-09-08）**：已建单一入口 `materializeRows`（`core/resource/helpers.ts`，
      行物化 + 相位快照/恢复；`rowDecibelTotal` 改走它，**golden 0 delta**）。但把**试探测量**也切过去
      → **golden 18 条 delta（最大 `agent:1431:c6` 伤害 +22.9%、`auto-1431-1341-1031` −2.8%）**：
      `buildExecutions` 的相位写入是**载荷性**的，而全仓只有 `rowDecibelTotal` 一处做了快照/恢复。
      载荷写入共 **3 处**，都在模块物化钩子里：`grace.ts:145 buildGraceExecutions.graceBasicPoolPrev`
      （注释明写「留给下一轮 estimate」）、`luciaElowen.ts:181 buildLuciaExecutions.luciaAdditionalAttackCap`
      （留给 buildResourceResult）、`yixuan.ts:572 buildYixuanExecutions.yixuanBackstageDecibel`。
      **阶段1 第二刀实测（2026-09-09，全部 0 delta 收口）**：
      · 卢西娅 cap → 移到 `buildResourceResult`，用同一纯函数 + 新增输入
        `AgentResourceResultInput.preModuleExecutions`（物化钩子派发**前**的行基准，引擎在
        `buildExecutions` 里快照一份）重算；
      · 仪玄 `yixuanBackstageDecibel` → **全仓零消费者**（喧响行级化后遗留的死回写），连同零读的
        `yixuanMoveDecibel` 预存与 `types/resource.ts` 字段一并删除；
      · 格莉丝 5 字段（`graceBasicPoolPrev`/`graceC1Cycles`/`graceC4Energy`/`gracePulseGrenadeCount`
        /`initialEnergyGift`）+ 叶瞬光 2 字段（`yeshuguangCycle`/`yeshuguangOutsideSword`）→ 全部
        拆到新钩子 **`materializePhaseState`**：产行钩子对 cfg 只读，相位状态由**引擎**在物化调用点
        按**同一 state** 显式补写（`core/resource.ts#buildExecutionsWithPhase`，356/523/744 三处）。
      · 然后**试探测量切 `materializeRows`**（523）——与装配同源、不再污染相位，golden **0 delta**。
      **否决记录（都量过数字，勿重走）**：
      · 「estimate 改读 prevState 现算」替代格莉丝相位缓存 → golden 15 条 delta（1181 c0 留白
        23.5→0s、c6 失衡 1→2）+ `underfillRefund` 1 红 + `inStunAttribution` 4 红（[1511,1181] 轴队
        `axisFallback` false→true）。根因：旧值是**最后一次物化调用**写的（含装配相位），estimate 读
        prevState 是另一相位的解——折叠环未收敛时两者不同解，不是等价改写。同理 1431 cycle 改读
        prevState 破 `warmStart`（1431 系二次调用逐位一致）并把 `auto-1431-1341-1031` 留白推到 9s。
      · 「先切试探测量、再拆相位写入」→ 顺序反了：切换时相位写入仍在钩子里，golden 多 18/9 条 delta
        （全在 1431/1181），测到的是相位污染而不是测量口径差异。
      · 「试探测量切 `materializeRows` 但**不补**相位写入」→ golden 10 条 delta（1431 c0 留白
        57.9→65.4s、1181:c6 ex −1.29）——下一轮 estimate 读到上一次物化的陈旧值。补写即 0 delta。
      · 全仓「模块钩子写 cfg」实测 **73 处**（探针口径 = 钩子调用前后 cfg 顶层键 diff，覆盖 127 预设
        + 60 角色×命座 0/6）；判据不是「有几处写入」，而是「有没有跨相位的读者」——本轮把跨相位的那
        7 处拆净后，探针切换 0 delta 即证明其余写入都是同调用内消费者。
      验收 = golden 0 delta + 全库不变量（`warmStart` / `inStunAttribution` / `underfillRefund` /
      `timeFillRatchet`）同绿。
      **撤 1591 排除的实测（2026-09-09，拆成两半各自量过，单独任何一半都是回归）**：
      · 复现：临时关掉 `probeExcludedTeam` → `timeLedgerInvariants` 破 2 条（`auto-1591-1481-1211`
        槽0 物化行 88.88 > 账本 88.81；`auto-1591-1481-1311` 98.68 > 97.54）。
      · 根因（探针实测）：装配期 `applyLiuyinPromote` 追加的 `source:'gift'` 行（本队 3.146s）在
        **轴模式**下既无引擎预留（`liuyinGiftTimeReserved` 空），旧 carve 又抠不到——它只认
        `basic_attack` 聚合行，而 1591 的平A池时间住在 8 条分段行里、聚合行 `totalTime=0` → carve 恒 0；
        同时试探测量侧 `liuyinGiftChainInfo` 在轴模式直接跳过（实测 `giftLiu=0`）→ 试探按「看不见赠行」
        的量注入 refund。
      · 半修 A（carve 不够时按前台 basic 分段行等比分摊）：`timeLedgerInvariants` 转绿，但两队留白
        反而变差（`auto-1591-1481-1211` 6.03→7.39s、`auto-1591-1481-1311` 2.51→5.21s）——账本没预留、
        行又被抠走 = 凭空多出留白。
      · 半修 B（只关排除、不动 carve）：两队 `over` 0→0.044 / 1.863s（超预算）——试探测量看不见赠行
        → 多注入 refund。
      · 结论：两半必须与「试探测量看见装配期追加行」**一起**落地（阶段1 单一行模型）；单独落任何一半
        都是回归。两次实验均已回滚，未改数值。
      · **半修 C（2026-09-09 第三轮，最接近正解但仍否决）**：把轴模式转大次数从轴层线程化进资源层
        （`ResourceCalcConfig.axisPromote = axisHug`，`iterate` 据此在轴模式也预留、`liuyinGiftChainInfo`
        轴模式不再跳过测量）。实测：**`timeLedgerInvariants` 在 `probeExcludedTeam=false` 下转绿**
        （预留与装配赠行逐位相等：`reserved === giftTime`，如 1591 队 2.5237s），但
        `timeFillRatchet` 报 **4 队留白变差**（`yidhari-liuyin-lucia`/`auto-1051-1481-1451`
        1.3→3.1s、`auto-1591-1481-1211` 1.0→4.2s、`auto-1591-1481-1311` 0.7→4.1s），而同一队在
        **预设配装**下留白反而改善（golden：1591 队 6.03→4.07s）——预留改变了不动点落点，方向随配装
        翻转。按棘轮纪律「先归因、别重生成基线」→ 回滚，未改数值。**下轮起点**：落点为何翻转（预留的
        `promote×终结技时长` 是否与轴栈已分摊的赠大时间重复计量）——这一条没查清之前不要再落任何
        撤 1591 的改动。
      · **半修 D/E（2026-09-09 第四轮）**：只改**试探测量**（D：轴模式也让 `frontlineRowsOf` 看见
        赠行；E：再收窄成「只补 carve 抠不掉的余量」并在账本里同额补记 necessary）——1591 队不再
        越账，但 `timeFillRatchet` 仍报同一批 **axis+琉音** 队留白变差（`yidhari-liuyin-lucia` /
        `auto-1051-1481-1451` 1.3→2.7s、`billy-liuyin-lucia` / `auto-1531-1481-1451` 3.4→4.5s）。
        说明测量侧一动就会改试探注入量 → 改落点，而**轴栈本身已把赠大动作时长计入窗口**
        （`stunAxisStack.ts`：`windowTimeSum += act.actionTime`、`fillSec = windowDuration − 末动作结束`），
        所以「测量、账本、carve」三者的口径必须在**同一层**统一，不是任一处补丁能收口的。
      · **结论（2026-09-09，五种候选 A/B/C/D/E 全部实测否决）**：撤 1591 需要一次**跨层口径统一 +
        数值重排**（涉及轴栈窗口分摊与引擎账本的关系），超出「阶段1 单一行模型」的验收口径
        （golden 0 delta 或逐条可解释 + 护栏同绿）——**须用户裁决**后再动。当前 `probeExcludedTeam`
        保持原样（仅 1591 一族），1s 门槛不变。
      · **撤 1591 收口（2026-09-10，能量收入行级 Σ 切换 07481b8/a337c02 之后重测 → 排除直接删除）**：
        重测发现**病根已被能量侧改动带走**——该族试探现在**进入但全部被 `fits` 门拒绝**：
        探针实测 `auto-1591-1481-1311` `underfill=1.563` → attempt0 `trialRows=181.35 > 预算−容差 179`
        （fits=false）→ 回滚「宁可留白不制造超预算」；`auto-1591-1481-1211` `underfill=2.418` →
        attempt0 `trialRows=181.35` 同拒。故开关该排除**全链逐位零差异**：`timeGolden`（127 预设 +
        60 角色×命座 0/6）**全 0 delta**、`timeLedgerInvariants`/`timeFillRatchet`/`underfillRefund`
        同绿、`npm run verify` **EXIT=0**（含 allAgentsSweep / runArchiveDeploy / typecheck / build）。
        → 删除 `probeExcludedTeam`（现**无任何排除队**），不再需要为它做数值重排。
        **诚实边界**：这只解除挂账，**不等于单一行模型完成**——测量口径缺口仍在（轴模式赠大时间不进
        `frontlineRowsOf`；轴模式 promote 次数由轴预设决定，`liuyinGiftChainInfo` 回落通用公式会算错
        次数），只是不再被排除掩盖：真出现越账时由 `timeLedgerInvariants` 立刻红。真收口仍是
        「把轴 promote 计数线程化进 core」（= 半修 C/D 的完整版，涉及落点，须先量 delta 再裁决）。
        对账探针：`PROBE_GIFT_TEAM=<预设id> npx vitest run src/composables/__tests__/giftAxisProbe.test.ts`。
      · **轴 promote 线程化实测（2026-09-10，三处各自量过 → 只有「试探测量」可落）**：
        新增 `ResourceCalcConfig.axisLiuyinPromote`（`useResourceCalc` 按轴预设 promoteVariant 块 × 窗口数
        加权注入）+ `core/resource.ts#liuyinGiftTime` 统一入口。三个落点分别开关实测：
        ① **只统一试探测量**（`frontlineRowsOf`）→ `timeGolden` 127 预设 + 60 角色×命座 0/6 **0 delta**、
        账本不变量/棘轮同绿 → **已落地**（试探量的就是装配会物化的行，轴模式赠大时间原先压根没量）。
        ② **再统一 iterate 预留** → 4 队留白变差：`yidhari-liuyin-lucia`/`auto-1051-1481-1451`
        1.617→**4.317**s、`auto-1591-1481-1211` 1.180→**1.454**s、`auto-1591-1481-1311`
        0.903→**1.358**s——预留把平A池挤掉、赠行不等量补回 ⇒ 发呆 +X（与 09-09 半修 C 同病，
        只是根因不是「轴栈已计窗口」，而是**池侧减法没有行侧加法配平**）。
        ③ **只统一装配侧**（`giftTimeOfSlot` 计入截断上限）→ **落点大改**：`auto-1591-1481-1311`
        stun 4→6、dmg 81100114→**107436588（+32.5%）**；`yidhari-liuyin-lucia` dmg **−5.8%**、
        次数/平A/连携全变。
        ④ **再补上「carve 打到分段平A行」**（预留 + 从 `category:'basic'` 行按占比抠回，替旧 carve
        只认聚合 `basic_attack` 行）→ 更差：`yidhari-liuyin-lucia`/`auto-1051-1481-1451`
        1.617→**8.020**s、`auto-1591-1481-1211` 1.180→**2.622**s、`auto-1591-1481-1311`
        0.903→**3.295**s + stun 4→6、dmg −3.4%/+27.6%——**预留已经在池侧减过一次，carve 再减一次**
        = 二次减法。
        **结论（三变体一致）**：轴模式赠大时间**已经**由轴窗口/carve 计入，**不该再加账本预留**；
        当前口径「轴模式不预留、装配侧不计入、只有试探测量按轴口径统一」是**实测结论**而非未决
        （①已落地，②③④全部否决）。残余风险 = 聚合平A行为 0 的队（1591 一族）carve 找不到目标 →
        由 `timeLedgerInvariants`「行≤账本」兜住，不是靠排除。
      · **赠行单一口径（2026-09-10，阶段1 ② 第一步）**：赠行**行对象**构造统一到
        `core/resource/giftRows.ts#buildGiftRow`（诺姆赠链 / 琉音赠大共用；零值与
        `totalX = 单次 × 次数` 换算单源，可选字段缺席语义显式）。判据两条：
        ① `timeLedgerInvariants` 复用既有全预设扫描（零额外计算）新增「赠行单一口径」断言——
        非轴队 `liuyinGiftTimeReserved + normaGiftTimeReserved` == 装配赠行 Σ，**库级全绿**；
        ② `giftMoveTimeLedger.test.ts` 诺姆/琉音两侧逐位相等 + `core/__tests__/giftRows.test.ts` 锁契约。
        → **「core 推导计数 vs 失衡池不动点计数」两套计数库级无差异**，不再是搬行的障碍；
        剩下的「让 `materialize` 直接产出行」经探针实测**不是纯搬运**（2026-09-10）：
        ① 池的行提取 `extractSkillExecutions` 逐行遍历 `rr.executions` 且不筛 `source==='gift'`
        ——赠行进引擎后池会与 `adjustStunExecs` 的 `count + promote` **双计失衡**；
        ② 赠行进引擎就会走 enrich，**凭空补上生产侧刻意留空的字段**（实测同 moveId 对照：琉音赠行
        `daze` 由缺席变 398.9、诺姆赠行 `skillDamageTarget` 由缺席变 `chain`，后者还会吃上定向增伤）；
        ③ 截断顺序 / carve 位置 / 展示用 `chainCountTotal` 三处须一并搬。
        → 属**口径改造 + 行为改变**，须先裁决，**未做**；当前已达成的是「行**契约**单一 + 时间口径
        单源 + 库级机器判据」。
        **第三条（同日实测，最硬的一条）**：**目标槽推导不一致**——core 用 `configs.length`（引擎只
        拿到已配置角色，单角色扫描时 = 1 → 目标 = 自己），编排层用 `configStore.team.length`（= 3，
        含空槽 → 目标 = 上一个空槽 → 不产行）。实测把行搬进引擎后 `agent:1481:c0/c6` 留白
        5.4/7.2→0、`agent:1571:c0/c6` 14.6/16.2→2/0（front 全部顶到 180）：引擎凭空物化出编排层
        永远会撤掉的赠行。
        · **收口（同日晚，已落地）**：三条各自给出保真解——①池侧读「装配前 rr」时 `skipGift`
        （`extractSkillExecutions` 新增 opts）；②enrich 对 `source==='gift'` / `normaGiftChain` 行
        **直接返回不补**（保住「琉音赠行无 daze、诺姆赠行无 skillDamageTarget」两条刻意留空）；
        ③新增 `ResourceCalcConfig.teamSize`（编排层队长）**只用于行口径**解析目标槽
        （`giftRowTargetSlot`），账本/试探口径仍用 `configs.length`（不动基线）。
        编排层两函数退化为「补倍率 + carve + 把池的计数/时长写回」，池口径为 0 时**撤掉占位行**。
        验收：`timeGolden` 127 预设 + 60 角色×命座 0/6 **0 delta**、`timeLedgerInvariants` /
        `timeFillRatchet` / `giftMoveTimeLedger`（含两条保真判据）同绿、`npm run verify` EXIT=0。
      **A/B 归因（同工作区、仅切门槛 10s↔1s 的隔离对拍，2026-09-08 终测）**：留白合计 **192.6→148.4s**
      （净收 44.2s），**16 队改善、0 队变差**——最大 auto-1181-1511-1411 7.4→1.1s、auto-1401-1511-1411
      8→2s；放回 1051 后再收 auto-1051-1481-1451 3.0→1.3、yidhari-trigger-lucia 2.3→0.2 等 5 队
      （唯一「变差」条 yidhari-jufufu-lucia 是 slack 0.1→0 / over 0→0.1 的等价交换）。**别拿 HEAD 基线
      直接比**——本工作区并行会话的改动自己就把留白推到 192.6s（9 队 +8.2s），那笔账归它、不归门槛
      改动；棘轮基线已按当前引擎态重生成（148.4s）。
    - **可行性优先于留白**：refund→平A→回能→次数→物化行 是放大环，naive 逐轮跟随实测把留白
      1544s→267s 的同时把超预算队从 8 推到 20，破坏 `netFrontlineOccupation ≤ 预算` 这条被
      轴退化/降配/队伍对比消费的硬不变量。宁可留白，不制造超预算。
    - **热启动逐位透明**：缓存存**试探前**末态（`warmSeedStates`）。存回填后的末态会让下一次
      调用从「已回填」出发、不再测到那个巨大正 excess → 折出不同账本 → 冷/热落点分叉
      （实测 1241/1191 队由冷热一致变不一致）。
    生效测试 `underfillRefund.test.ts`（4 例：回填生效 / 不制造超预算 / 门槛下不扰动 / 冷热一致）；
    全库留白与超预算由 `timeFillRatchet.test.ts` 棘轮钉住（存量冻结、只拦变差，
    `TIME_RATCHET_UPDATE=1` 重生成）。落地后预设库留白合计 1075s→391s（−64%）。②**轴退化**（用户口径 2026-08）：轴的资源需求
    （轴内块/自动补齐交互 × 窗口数）超出战斗时间预算 = 轴不可操作（需 boss 秽盾等外界环境才打得成）
    → `useResourceCalc.calcOutput` 检测轴模式前台行 > 预算+2s 时跑一次**非轴对照**，仅当对照可行
    （般岳金身20/招架10 等配置本身超预算的场景与轴无关，弃轴无意义）才弃轴重算，`convergence.axisFallback=true`
    上报（队伍对比页 timeDetail 追加「已退化为一般轴」）。自动补齐（`banyue.autoTopUpInteractions`）
    的生效测试须落在补齐后仍可行的需求域，厚需求场景归退化用例管（banyue.test「轴退化」）。
    ③**estimate/物化双算坑（两个方向都会虚高）**：
    - *estimate 侧多算*：模块把「池守恒、不生成执行行」的动作块计入 estimateExSpecialTime（般岳
      banyue-combo 连段块 = 怒相免费连段的表达，时间已含在怒相内/外连段行）——estimate 与
      buildExecutions 必须逐项对账（`computeBanyueCycleFromCfg` 输出 vs 物化行），差值恒定非零即双算。
    - *物化侧多算*（2026-09-05 朱鸢案，更隐蔽）：模块 push 的行**占的是平A池那份时间**（1 枚霰弹
      = 1 段平A），却没从通用 `basic_attack` 聚合行里挤出来 ⇒ 同一段时间被计两次（实测聚合行
      47.24s + 以太弹 46.60s）。折叠循环照单全收折进 `necessaryTime`（虚高 59s）→ 平A池被挤光 →
      该队留白 30.1s 是全预设库最大单队，而 `timeBudgetConverged` 一路报 true。
      **凡模块生成 `category: 'basic'` 或时间来源于 `state.basicAttackTime` 的行，必须 carve 聚合行**
      （琉音转大 `liuyinPromote` 是正面样板；已按此修掉 朱鸢 1241 压制以太弹 30.1s、
      希格莉德 1591 出枪式段 20.6s —— 后者注意 **只缩时间、保留回能**，因为分段行不带
      `energyRecovery`，按比例一起缩会凭空丢掉她的能量）。判据 = `Σ前台行 ≤ 账本(necessary+basic)` 恒成立，
      `teamTimeSummary.ledgerInflation` 就是这条的逐队读数（>2s 即双算，棘轮逐队钉）。
    ④**轴内合轴（2026-08-30 同日补）**：窗口内跨角色块并行（般岳强特时琉音抱拳）只计一次前台——
    栈引擎 `calcStunAxisStack` 按执行块区间并集算 `overlapSeconds`（按块时长比例分摊到
    `overlapByAction['slot:moveId']`，严格可加）；净占用口径 = Σ物化前台行 − 合轴分摊，
    iterate 平A池吃进节省（`config.axisOverlapSeconds`）、折叠循环 excess 测量与
    `TeamComparePage` 超时判定、`ConvergenceReport` 退化/降配判据（`frontlineTotalOf`）全链同口径。
    同槽位顺序块不重叠（cursor 顺序排）；赠块 `:gift` 后缀 key 不匹配 → 不扣（保守方向）。
    ⑤**非轴降配**：无轴态前台净占用仍超预算 = 手填交互（招架/金身/双反/闪反）总需求超预算，
    与轴厚需求本质相同 → 二分缩放交互次数（`runCalcRound opts.interactionScale`，只缩 store 侧输入，
    boss 强制弹刀 `parrySplit` 直读 store 不被缩、轴补齐在其后叠加）直到回到预算（6 轮精度 ~1.6%）；
    scale→0 仍超 = 非交互必要时间本身超预算，如实保留报超时。`convergence.interactionScale` 上报
    （`axisFallback` 与之可同真：轴退化后配置本身仍超）。**锁定失衡次数（`stunCountLock` ≥ 0，
    命座对比/锁窗测试）一律不触发退化/降配**——锁定 = 用户明确意图，引擎不自动改结构。
    **实数化的正确下手处（2026-09-05 找到，1431 已落地）**：要松弛的是**模块自己的"资源→动作套数"映射**里那个 `floor`，不是引擎的折叠动力学。
    判据三条：① 该量必须挂在**连续量**上（平A时间、回能、局外剑势），否则没有增益可消；
    ② 它必须是"套数/轮数"而不是**命中事件计数**（`floor(T/cycleTime)` 数"#4 打中几次"不能实数化——
    你不能打中 3.4 次，希格莉德的 `countBasicFinisherHits` 就属于这类，不该动）；
    ③ 用户显式指定的次数（滑块）保持取整，那是意图不是推导量。
    1431 落地效果：留白 321→301s、留白>10s 6→4 队、她 8 支预设里 3 支留白归零，**全量 1585 测试零改动通过**
    （对比：动引擎折叠的 5 个变体每次都让别的队掉进 stunCount=0 盆）。
    **否决记录（别再重新发明这些，都是量过数字的）**：
    - 折叠改 `fold = excess`（不累加）或 `max(fold, excess)` → 正反馈队（猫又/伊德海莉）欠补偿，**溢出 186s**（2026-09-03 三语义对比；此前只记在 `core/resource.ts` 代码注释里，docs 零命中）。
    - refund 逐轮跟随（不冻结）→ 留白 1544→267s 好看，但**超预算队 8→20**，破坏 `netFrontlineOccupation ≤ 预算` 这条被轴退化/降配/队伍对比消费的硬不变量。
    - 换收敛初值（种子 basic=0 起步）→ **完全无效**：excess 在内层收敛之后才测，零种子与现种子逐位相同；个别队反而换落点（=不动点不唯一的症状，不是可修的口子）。
    - 必要前台按可行比例封顶后**回灌平A池** → ~~不做~~ **已接（2026-09-05，改判据之后）**：留白 393→321s、最大超预算 51.6→14.4s（般岳/诺姆/卢西娅那种"声称打了 230s"被治住）。当初挡路的 `seedInvariance` 逐位相等**不是游戏性质，而是实数化收敛的副产品**——判据改成两档：已实数化的角色（伊德海莉）保留逐位相等，未实数化的整数队退到「同一套打法」档（次数差 ≤1、平A差 ≤2s、喧响差 ≤2%，且两种落点都必须可行）。**代价如实记**：3 个希格莉德预设留白反而变大（最差 `auto-1591-1481-1311` 0.6→20.6s）——封顶动了她的账本→池→次数均衡，正是 DEBT_REGISTRY 记的「sigrid 出枪式消失」那个敏感面。
    - 折叠残差**双向回退**（`fold ← max(0, fold + excess)`）→ 留白 1075→266s 但红 14 条，含 `allAgentsSweep`「时间不溢出」与**命座有效性不变量**（C6>C0 被破坏）。
    - 消掉星徽·比利(1531)的估时滞后（把 `basicAttackTime` 传进 `estimateExSpecialTime`、让估时与物化共用同一个链求解器）→ 留白 −18s 但**超预算 +21s**（两支预设顶破 10.4s）。她的动力压制链数 ∝ HP 池 ∝ 回能 ∝ **平A时间** = 正反馈，那个"读上一轮 `billyChainCount`"的滞后是**无意的稳定器**；消滞后等于拆掉阻尼。**别照 1431 的做法套到她身上**（1431 的 floor 是纯离散化、无正反馈，所以安全）。
    - 再把装配截断上限从「账本」改成「min(账本, 本槽可用前台)」→ 留白 240→**1476s** 灾难：可用前台是拿**队友的虚高账本**算的，厚槽互相将对方压成 0（与坑19① 那条逐槽封顶同错）。要钳制必须全队按同一比例分摊，不能逐槽看余量。
    - **refund 是"算一次就永不回退"的存量**（2026-09-05 定位，未修）：`availableBasicTime = 预算 − Σ必要净 + 抵扣 + refund`，而 refund 是**早先某个操作点**测出的欠打量。正反馈模块会把多给的平A**转成必要动作时长**（诺姆行 67.1s ≡ 其账本），于是 Σ账本 = 预算 + refund > 预算 —— 同一份秒数被"平A"和"动作"各花一次（实测 1531/1571/1451：refund 20.9s → 净占用 190.4、超预算 10.4s）。**加账本闸能修它**（拒绝让 Σ账本超预算的注入），但实测把 1431/1341/1311 推进 `stunCount=0` 吸引盆 ⇒ 与比利消滞后、单槽时间闸三者耦合，局部修不动，需要联合求解（=实数化专项）。
    - **只做 refund 生命周期（账本闸），不消滞后** → 留白/超预算/队数**一个数都没变**（240s/156s/18 队），代价是一支 1431/1341/1311 掉进 `stunCount=0` 盆。原因：双重花费只在"消滞后之后"才出现（滞后版本里比利不会把多给的平A转成必要时长），所以单独做 refund 生命周期 = **为还不存在的问题做手术**。顺序必须是：先让她的链有可咬合的时间闸（需要把 `state` 传进 `estimateExSpecialTime`，接口级改动），refund 生命周期才有意义。
    - 比利消滞后 + **单槽**时间闸（链段总时长 ≤ 本槽可用前台 − 其余必做动作）→ **闸不咬合**：她单槽 107.7s « 可用 117.7s，溢出全来自上面那条 refund 双重花费。另注：估时输入拿不到本轮 `chainCountTotal`，连携时长只能从余量里省略（约 1–3s 宽松）——要精确必须把 `state` 传进 `estimateExSpecialTime`（接口级改动）。
    - 截断**从装配尾部整行丢** → 模块行（叶瞬光架势段、琉音抱拳）恰好排最后又正是伤害与失衡的主要载体，删光后**失衡池空、`calcOutput` 返回 null**。
    - 截断**等比缩 count** → 产出「强化特殊技 ×2.78 次」这种不存在的动作，红 11 条（次数必须整数，见坑 22）。
    - 给叶瞬光「打短轴压时间」→ **压不住**：轮数由资源驱动，每轮变便宜反而多打几轮（full 6 轮 121.5s → short_mie 9 轮 206.9s）；缩交互同样无效（弹刀 6→0 省出的 31s 被平A池原样吃回，净占用纹丝不动）。省下的时间不会消失，它会变成能量、变成次数、变回动作。
    - 比利实数化后**最高马力星光行仍不带时间**（只进估时）→ 「账本 > 行」的系统性 idle 被 pass0 回填测成 **refund 双击**：auto-1531-1571-1451 refund 26.5s → Σ账本 = 预算 + refund、超预算 16s。行时间必须物化到行本身（坑19③ 的对称侧：账本有的秒数行必须也有）。
    - 最高马力星光行时间物化**套用轴模式** → 比琉通用轴被顶出预算触发**轴退化**（axisMode 丢失、两用例红）。轴内捏轴时间由栈引擎窗口时间轴计账，物化只对非轴模式生效。
    - 比利终局整数重推**套用轴模式** → 空转且扰动轴外层循环：重推的 iterate 副作用（cfg 写回/overflowSeconds）把比琉轴留白 2.7→**8s**。轴模式链数恒整数，无实数可 floor，重推块跳过轴模式。
    - 诺姆膛温赠链时间预留按 **prev 轮** hatCount（iterate 滞后）→ 5↔6 两循环（预留 11.9s vs 最终行 14.3s，超预算 2.4s 阴魂不散）；根因是 `computeNormaHatToChainCount` 长按项**漏乘 exCount**（迭代期喧响信道与 computeNormaSource 差 1 条赠链）——修纯函数对齐本体 + 赠链时间进必要时间与折叠/探针测量同口径后归零。
    - **refund 生命周期（账本闸）在比利实数化之后重测（2026-09-06）→ 零收益**：终局把冻结存量收缩到「行用得上」的量（cap = refund − max(0, 行−预算)）+ 重收敛可行性验证，125 队上**零次有益触发**——存量双花已随赠链时间信道 + 星光行时间物化归零（原病号 1531/1571/1451 现 over 0 / refund 0）。剩余 8 队超预算（合计 10.6s、最大 2.0s）全部是**非 refund 原因**：3 支 1431-1481 队 refund=0 纯量化、1591 队收缩被拒（trial 行 180.4 > 179 容差 + 计数 2-循环不稳）、1461 队同拒——账本闸对它们无作用面。**下一刀 = 1591 estimate 漏计**（其行超账本 +1.08s 正是 estimate 少计她的多段强特链）。
    - **琉音（1481）强特计划估时单独补（2026-09-06 首测）→ 7 队回归 + 收敛判据破，随后以三件套落地**：三强特轮转 + 送客计入必要时间的钩子本身口径正确，但单独补会①把折叠残差压到 0.0005s → `maxExcess ≤ 1e-6` 判据 8 轮耗尽、`timeBudgetConverged=false`（allAgentsSweep 硬断言恒 true）；②转大赠行的守恒破洞随之暴露。**三件套（同日落地）**：折叠收敛判据放宽到 1e-3（1 毫秒，秒级量化残差口径下无损）、非轴转大赠链时间进引擎必要时间（promote 从好评/连携窗口同求解推导，iterate 预留 + 折叠/探针同口径，post-hoc carve 废弃——carve 只抠聚合行、分段行目标会落空 +7.2s）、轴模式钩子回落通用公式（轴内 60/90 转大由轴预设决定）。效果：1591/1481 队 over 7.1→0、全库留白 193→179s。
    - **连携/破阵改读「实际失衡次数」（用户裁决 A，2026-09-07 两次尝试均未落地，已回退）**：病灶是量纲混用——`chainCountPerStun × stunCount` 这个公式全仓有 **14 个消费点**（`core/resource.ts` 3、`core/resource/helpers.ts` 5、`useResourceCalc.ts` 5、`liuyinPromote.ts` 1），而 `config.stunCount` 是**净失衡**（池答案 ×(1−窗口覆盖) 再经时间充足性钳制，属**失衡值域**的折算量），连携/破阵/赠链却是「发生在失衡上的**事件**」。实测 125 队：91 队两值差 >0.5，**14 队连携执行行完全归零**，而 `stunPool.ts:204` 仍按池的次数算 `chainCountTotal`、`:207` 按它发连携喧响奖励、`ResultPage:242`/`RunArchivePage:135` 显示池的次数 → **同一个 `resourceResult` 自相矛盾**（UI 说连携 6 次、计划里 0 行）。希格莉德受害最重：连携技·冰凌卷地是[砥砺]（敛枪式+20%）与破阵的唯一来源。
      **第二次已把 14 个消费点全部改齐**（新增 `config.eventStunCount` = 上一轮池的原始答案；热启动种子命中时按当前 config 重算该输入量；外层 cycle/maxIter 退出后迭代补轮至「池次数 == 用上次数」自洽）。**症状确实修好了**：1591/1481/1211 她连携行 0.00 → 2.00、伤害/血量 30.5% → 48.9%，6 队里 5 队自洽。**但仍回退**，因为 8 条测试变红，其中 **corin / lycaon 两条是锁定失衡次数（`stunCountLock=3/4`）的测试——按 A 的设计锁定路径必须完全免疫**（`lockedStunCount ≥ 0` 时 `eventStunCount = lockedStunCount`）。插桩实测：`applyCorinTeamConfig` converge 被调 3 次，第一次收到 `stunCount=3`（正确），**后两次收到 2**。即 hole 不在消费点串线，而在**锁定/重算路径**（外层还有 `runOuterLoop(true)` 轴退化与 `runOuterLoop(true, mid)` 降配试探两条独立调用，各自维护自己的 `eventStunCount`，锁定时是否都取 `lockedStunCount` 未逐一核）。**下次做先立这条不变量并加测试：`stunCountLock ≥ 0` 的队，A 前后所有输出必须逐位相同**；打通它再谈改基线，不要绕过这 8 条红直接 `TIME_RATCHET_UPDATE=1`。

    - **欠打试探「规范试探输入」（2026-09-08 首测，未落地 → 改用 1051 队排除）**：1s 门槛后 1051
      连续松弛队被试探触发，`seedInvariance` 逐位档破（inflated vs 零种子 basic 差 0.009s）——
      根因是试探的 `convergeCounts` 停点随种子轨迹变 + 试探**接受**持久化 cfg 写回（模块钩子
      写回 / `overflowSeconds` / `timeFeasibleScale`）→ 跨外层轮污染。首测方案「注入种子路径
      重跑默认零种子取规范停点做试探输入」实测**无效**：`runInnerLoop(defaultSeed)` 只重跑内层，
      缺折叠残差累加，其停点 underfill ≤1s 不触发试探 → 1051 队退回未试探旧值（hot 结果 = 旧
      非试探值 7/3+27.50s，与冷 6/2+30.04s 仍分叉）。要真正规范须整条折叠+比利管线重放
      （`runFoldLoop` 提取 + pristine cfg 快照），属「全局实数化收敛重构」debt 范围，**本次不落地**
      → 改为 **1051 连续松弛队整体排除试探**（`yidhariContinuousPresent` 门控），其留白归专属
      终局整数重推 + 量化地板（实测 auto-1051-1481-1451 3.0s / yidhari-roxy-lucia 0.9s，均 ≤ 棘轮
      地板，无 UI 可见回归）；seedInvariance / determinism / yidhariInteractionGrid 全绿。
      升级路径 = 实数化专项做管线级规范重放后恢复 1051 队试探。
      **最终裁决（同日，两轮）**：① 不做管线级重放（成本高、未过验证）→ 先改三族排除；② 热启动
      「只存规范种子」修好后，**1051/1531 两族的排除随之撤销**（当初排除的直接原因是热启动注入
      收敛末态导致冷/热分叉，根因已修）——实测放回后 seedInvariance / warmStart /
      yidhariInteractionGrid / timeLedgerInvariants 全绿，yidhari 系 5 队留白再收 6.9s。
      **排除队已于 2026-09-10 全部解除**（1591 一族删除，见本节上一条「撤 1591 收口」）——但那是
      「病根被别的改动带走」，不是「试探与装配共用同一套行测量」做到了；该升级路径仍待做。


    - **剩余 over 队归因定案（2026-09-06 对账）**：banyue-liuyin 1.4s 与 1431-1481 1.5~1.9s 的 over **不是估时缺口**——般岳估时与物化逐项相等、转大预留与实际赠行逐队相等；真相 = 厚需求降配的**移动靶残差**（预设交互超预算 → 外层 interactionScale 逐轮缩放，折叠环 8 轮收敛不完 → `timeBudgetConverged=false` + 2~28s 残差 + 装配截断 39s）。属坑19② 降配 + 坑22 截断的既有量化口径（interactionScale 精度 ~1.6%），修它不是改估时而是改降配精度/判稳口径——待定，不再立项为估时类。
    - **1591「机会→敛枪式套数」targeted 实数化 + 终局整数重推（2026-09-07 实测否决）**：删 #4 双计（用户改判，一次出枪式命中只记一次机会）后 `auto-1591-1571-1211` slack +0.3 → **over 1.63s**，且 `refund 1.62 ≡ over −1.63` 逐位相等 = 上面那条 **refund 存量双花**（五队 `interactionScale` 全空，**不是**移动靶类）。按 1051/1531 骨架开第三个引擎侧块（`splitLanceRotation` 连续延拓 + 迭代期实数套数 + `sigridFinalizeLance` 终局 floor 重推 ≤12 轮）实测：**目标队纹丝不动**（slack −1.63 / tbConv=false / passes=8 / refund=1.62 全同），因为 refund 是折叠环 pass0 冻的存量，重推在它**之前**跑、改不到它；代价却先付了两笔——① 两支 1481 队（轴模式被 finalize 过滤器跳过、迭代期仍是实数）**漏出小数次数**（`敛枪式 12.232961…+11.232961…+11.232961…`，坑22 明令禁止的不存在的动作）；② `auto-1591-1161-1211` tbConv 由 true 退回 false、passes 3→8。**结论：1591 的 over 不在「套数 floor」这一层，在 refund 存量生命周期那一层**，而后者已量过（上上条：账本闸零收益 / 单做会把 1431-1341-1311 推进 `stunCount=0` 盆）。要真修必须与「比利消滞后 + 单槽时间闸」联合求解（= DEBT_REGISTRY「全局实数化收敛重构」专项），**不要在 1591 上局部再试**。已落地的只有双计删除（保真度修正，与时间落点无关）；`timeFillRatchet` 那 1.63s **仍红、待用户裁决**（重生成基线 or 回退双计），不要擅自 `TIME_RATCHET_UPDATE=1`。
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
    **消费方**：`overflowSeconds` 已并入 TeamComparePage 操作难度横轴（`computeDifficulty` 加
    overflow 参数，默认 1 秒 = 1 难度点；只厚轴队 >0，用户口径 2026-09-04）。难度是主观量——
    交互权重与溢出权重都只是默认值，用户在对比页「难度权重」弹层自填覆盖（localStorage 持久化，
    优先级 条目weight > 用户覆盖 > INTERACTION_WEIGHTS 默认表）。

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

30. **「属性没做」的三种真身：静默失效通道（2026-09-08 用户三条观察逐条查证）**：
    用户报了三个「看着像没实现」的现象，实测**效果全都接了线**，缺的是三处静默通道与可见性——
    记在这里，下次别急着往引擎里加乘区：
    - **① 角色特化标错 → 整条音擎效果为 0**：朱鸢 1241 的 catalog `specialty=stun`，原文
      （`data/raw/nanoka_missing/full/1241.json` weapon_type=强攻）与其专武 14124 的
      `requirement.specialty=attack` 都是强攻。`collectAllBuffs` 用「音擎 specialty === 角色 specialty」
      当**总开关**（`collectWEngineBuffs` 首行 return），于是她装专武时暴击率+15%、平A/冲刺充能增伤
      整块丢掉，且**不报错、数字自洽**。修复入口 `scripts/fix-agent-specialty.mjs`（幂等，读原文对齐）；
      护栏 `catalogData.test.ts`「角色特化 == 专武特化 == 音擎 requirement」（全库 55 把带 requirement
      的音擎，修前只有朱鸢这一条红）。自查动作：录完/改完角色跑一次「装专武 vs 不装音擎」面板差分，
      差值 0 就是这门对不上。
    - **② 套装覆盖率只并本槽位 → 全队段滑块是死控件**：4pc 全队段（山大王/月光骑士颂/雪兔/摇摆爵士…）
      由**装备者供给、全队受益**，覆盖率属于「效果」不属于「受益者」；旧 `mergeDiscEffectCoverages`
      只并当前角色自己盘上的效果 id → 队友面板拿不到装备者的滑块值（实测差值 +0）。
      现 `mergeTeamDiscEffectCoverages` 并**全队三人**盘（口径钉在函数头 @fact）。
    - **③ 面板页只列条件类效果 → 常驻/门槛/未建模段整块隐身**：旧 `discCoverageEffects` 过滤
      `!condition && !maxStacks`，于是荆棘玫瑰（常驻增伤 + 防御门槛暴伤）、沧浪行歌（组级条件没落到条目）、
      灵魂摇滚（4pc 减伤确实未建模）都表现为「一行都没有」，用户合理推断成「属性都没做」。
      现由 `src/utils/discEffectRows.ts`（纯函数，页面与测试同源）把 2pc/4pc **全部**效果列成行，
      三类状态如实标：可折算 → 给滑块；门槛（属性/职业/局外属性）→ 标「门槛自动判定」不给滑块
      （再挂 uptime 会双重打折）；有文本没效果 → 标「未建模」。配套把触发型效果的条件元数据
      （`condition` + `coverage{default:1}`）补进 catalog（`patch-disc-sets.mjs`，**默认数值一分不变**），
      并修掉 10 个套装 2pc 共用通用 id「effect-1」的隐患（覆盖率按 id 存，共用即串改）。
    护栏：`utils/__tests__/discEffectRows.test.ts`（每套单穿 4 件必出行）+
    `core/__tests__/discSetEffects.test.ts`（新暴露滑块 50% → 面板正好折半，含 teamBuff 通道）。
    **否决记录**：给门槛类效果也挂覆盖率滑块 → 与引擎自动判定叠两次打折 → 否决；
    把 subgroup（二级属性）在运行时从 catalog 反推 → 预设库是同步模块、catalog 异步加载，
    且会在三处页面各写一遍推导 → 否决，改为「数据里写死 + `validate:data` 按单源口径重算护栏」。

 31. **多段招式「一次动作」只回头段：时间 / 喧响 / 赠送回填三侧同错（2026-09-11 用户报「连携技时间显示 0.5s」，并裁决「倍率表必须融合，因为连携本身就是打3段」「时间不是以招式为单元的吗，怎么会如此偷懒」）**：
     catalog 把一次玩家动作拆成 `#1/#2/#3` 时，倍率侧早已按 `data/moveFusions.ts` 登记组求和
     （`fusedRowValue`），但 `core/resource.ts` 的一族 `find*` 全部 `move.actionTime ?? 0` ——
     **只回头段**。于是结果页同屏出现「春临 1258.3% / 单次 0.515s」两套口径（坑 3）：0.515 是
     #1 一段，一次连携真正的前台时间 = 0.515+0.515+0.687 = **1.717s**（同族基线：连携单次
     1.2~3.5s，头段只占三成——量级一眼不对就是这一族）。
     **现口径（一处登记、多处消费）**：`core/resource.ts#fusedGroupMetrics` 给出融合组「一次动作」
     的整段量，`channelMetricsOf` 是**全部** `find*` 的唯一出口（连携/强特/终结/闪反/招架/支援突击/
     蕾米两段）；喧响同口径——`decibelRecoveryByMoveId` 表与 `enrichExecutionPlan` 的 decibel 分支
     都走 `fusedRowValue(..., 'decibel_recovery')`，账本行级 Σ 与展示层同值（`decibelRowParity`
     不破）；赠送回填不再取头段（`normaHatChain` 赠链行、`liuyinPromote` 转大行的倍率/失衡/积蓄/
     时长全取融合值）。
     **自动攻击段特例 `countsTime: false`**（`MoveFusionTerm` / `SustainedExTerm`）：「打是全打，
     但不站场」——妮可三处能量场（连携 1031303、终结 1031305、强特 1031106）倍率·失衡·积蓄·喧响
     照算、前台时间记 0：她一次连携 = 0.25+0.25 = **0.5s（只算炮击）**，一次强特少占 1.484s。
     影响（登记组头段 → 整段）：雅连携 0.515→1.717s、喧响 69.05→230.1475；雅飞雪 0.387→0.967s；
     希希芙毒牙 0.565→1.883s；珂蕾妲熔炉 1.45→2.816s；月城柳月华 0.667→1.334s；千夏泡泡糖
     0.733→1.649s；可琳[舍] 0.658→1.316s；真斗断獠 2.083→4.183s；妮可连携 0.25→0.5s
     （倍率 210.4→987.6%、喧响 43.45→217.25）、终结倍率 1293.6→3040.2%。
     护栏：`moveFusion.test.ts`「时间通道」+「全通道一次动作口径」（含**双计护栏**——遍历登记组
     逐角色部署，断言兄弟段永不出现在执行计划里；这是允许组级求和的硬前提）。
     **否决记录**（都量过数字）：① 「同 category 带 `#N` 后缀的段全加」启发式 → 叶瞬光 1431
     连携两段是**两个独立动作**（头段 3.3s、喧响 218.9 已在全体基线内），启发式顶成 5.8s 假时长；
     伊德海莉 1051 由模块自写 `cfg.chainActionTime`，blanket 求和覆盖模块口径 → 只认登记组。
     ② 只把 `cfg.chainDecibelRecovery` 改成融合值 → 被 `decibelRecoveryByMoveId` 按 moveId
     覆盖回 69.05（实测），改表与改 enrich 才是有效闸口。③ 妮可强特不登记融合组——`sustainedEx`
     已把 1031103/104/105/106 各自成行，再登记即四段双计 → 只标 `countsTime: false`。
     **38 组候选的收口审计（2026-09-11 逐条对到引擎实况，结论：表已完整）**：登记 18 组，
     其余 20 组的处置各有实测依据，**不要"顺手"补登记**——
     - **模块接管段**（登记即双计）：莱卡恩 1141（`lycaon.ts` 推 1141016 点按 / 1141017 长按，
       长按一次 = #1 505.4% + #3 1075% = 1580.4%）、雨果 1291（`hugo.ts` 推合成行
       `1291_ex_normal_final` 709.8% / `1291_ex_verdict_final` 3552.7%）。护栏：`moveFusion.test.ts`
       「模块接管段不入表」。
     - **变体 ≠ 分段**（同一角色不同招式，不是一次动作被拆）：叶瞬光「连携技：斩邪祟」(1431024)
       vs「连携技：明心境·掣惊雷」(1431026)、伊德海莉「踱寒践约」(1051015) vs「[以太帷幕·涌泉]中」
       (1051025，模块接管)、橘福福「虎釜崩」(1391012) vs「虎釜震煞」(1391013)——nanoka 里各自
       只有 `{Skill:单个}`，**没有求和式**，故 head-only 正确（引擎只建第一个变体，是否补第二变体
       属建模决策、不是融合问题）。
     - **平A/basic 组**（不物化或兄弟也物化）：妮可狡兔连打/为所欲为（6 变体共头 1031001…）、
       艾莲霜锋（1191027 与 1191028 **都成行**→登记即双计）、照凛冽裁决、真斗炽风斩、爱芮绝对音准
       ——平A 走 `averageBasicRows` 汇总，登记对引擎无益。
     - **不物化的特殊技/快支段**：妮可特殊技糖衣炮弹、冲刺攻击两变体——引擎不发行这些行。
     护栏（全预设库）：遍历 127 条预设断言「登记组的兄弟段永不作为执行行出现」，新登记组先过它。
     **两条例外要认得**：① **终结技秽盾加成可能被拆到多段**——照·兔兔连斩两段共享 500 加成、
     拆成 400+100 → #1 = 积蓄 146.66/100 = 1.4666s、#2 = 36.7/100 = 0.367s（catalog 旧值
     0.467 / null，旧公式对两段都减满 500 才出这个坑；用户口径 2026-09-11「奖励分成两半，
     用秒均积蓄=100 来算」）。定点修正走 `scripts/patch-move-action-time.mjs`，整段 1.8336s，
     再由 `zhao.ts` 按「Q 打一半被快速支援取消」取半（前台 0.9168s/次）——**遇到某段时长
     null / 推不出先怀疑这条**。连带影响：照队留白 8.8→4.1s（auto-1431-1341-1311 3.1→7.7s），
     `timeFillRatchet` 基线已按 `TIME_RATCHET_UPDATE=1` 重生成、`teamTimeSummary` 样例阈值
     8.8→4.1 同步下调（该样例只验「归因到账本虚高」而非留白绝对量）、`docs/multiplier-record.md`
     按 `npm run gen:multiplier-record` 重生成——**这三处是这条口径改动的既定配套，不是新回归**。② **后台自动连携不是"未建模的变体"**：橘福福「虎釜震煞」
     (1391013, actionTime 0) 由 `specPanelBuffs.ts` 威风账本发射（默认配置实测 21 次/局、
     0 前台时间），前台「虎釜崩」只吃失衡赠送/诺姆赠送——用户 2026-09-11「她就靠后台自动
     连携打数据」，账上已有；叶瞬光两个连携（斩邪祟 / 明心境·掣惊雷）收益相当，只算一个即可。

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
    现状：折叠环把每槽 `rows − 账本` 的超出量**累加**进 `cfg.timeBudgetExcess`（`+=`，2026-09-03
    定的口径），而 `iterate` 里还有一层「必要前台可行比例封顶」（`cappedNecessary = netNecessary ×
    budget/ΣnetNecessary`）。两者叠加导致：**累加被同一封顶部分抹掉，却又通过封顶的分配比例
    改变槽间预算**——折叠环因此在 26 队上跑满 8 轮不收敛、累加器涨到 600s+。
    **实测度量**（`PROBE_CONV_SCAN=1`，127 预设）：`timeBudgetConverged=false` **26 队**、
    折叠轮数 8 轮顶格 **27 队**、留白合计 179.4s、超预算合计 2.4s；不收敛队集中在
    叶瞬光(1431)/般岳(1471)/仪玄(1371)/席德(1461) 系。
    **三版「统一残差 + τ 求解」实测否决（都量过全库 delta）**：
    ① **封顶生效即停折**（`capActive` 时不累加 + 判收敛）→ 不收敛 26→**2**、超预算 2.4→**0.1s**，
    但留白 179.4→**193.4s**，`timeFillRatchet` 报叶瞬光三队变差（3.5→9 / 3.8→13.5 / 4.2→9.4s）
    → 否决：累加**不是惰性**，它把预算按「实测需求」重新分配，停掉即失去这个分配器。
    ② **全局 τ**（只注入 `necessaryScale = 预算/Σ实测需求`，分配仍按 estimate 比例）→
    不收敛 →**113 队**、留白 **198.9s** → 否决：全局缩放不改**槽间分配**。
    ③ **逐槽需求上限**（`cap_i = 实测需求_i × τ`）→ 留白 179.4→**149.4s**（−30s，唯一亮点）、
    但不收敛 →**74 队**、超预算 2.4→**5.3s**、`timeGolden` **674 条 delta**（含失衡次数 4→8、
    3→4、5→4）→ 否决：动落点太广，须逐队验证后才能谈落地。
    ④ **共享平A池缩放 τ**（残差 = Σ实测物化行 − 预算，τ 按比例步 + 阻尼半步解，取代
    「逐槽累加 + refund 冻结 + 折半试探」）→ 不收敛 26→**25 队**、留白 179.4→**174.1s**、
    超预算 2.4→**2.2s**，但 `timeGolden` **242 条 delta**（含 auto-1431-1341-1311 留白
    2.4→6.4s、yixuan-roxy 超预算 0.25→0.90s）→ 否决：**横向替换、收敛没治**。
    ⑤ **累加器钳到实测需求**（`accum_i = min(accum_i + excess, rows_i − 抵扣)`，防发散轮独吞预算）
    → 不收敛 26→**27 队**、留白 179.4→**189.9s**、超预算 2.4→**1.5s** → 否决：留白换超预算，净负。
    **⑥ 停滞判据（2026-09-10，用户裁决后落地，✅ 采纳）**：用户口径「平A 是招式循环的重要组成部分，
    必须计算其回能/喧响/失衡/伤害效用，资源增长会让特殊招式次数增长」——即**池→资源→次数 的正反馈
    是模型本身，不能去掉**。于是问题回到**求解器的停止规则**：`PROBE_TRACE_FOLD` 实测叶瞬光队
    pass7 起 `maxExcess` **恒定 0.092~0.093s 持续 20+ 轮**（累加器仍在增长、残差不动）——这不是
    发散，是**停在量化地板**（不动点），而判据 `maxExcess ≤ 1e-3` 对离散系统过严。
    改为**停滞判据**：连续 3 轮无改善即判收敛。阈值取 **1e-2（10 毫秒，量化噪声量级）**——
    依据：比利系每轮只改善 ~0.002s（比利终局整数重推的量化残差），1e-3 会让停滞计数不断重置、
    差一两轮跑满上限；改 1e-2 后 `timeGolden` **0 delta**（只改报告不改落点）。实测（127 预设）：
    `timeBudgetConverged=false` **26 → 3 队**（余 `billy-roxy-lucia` 0.417s + 2 支 1591 系 2~3 毫秒；
    这 3 队已于同日「尾巴专项 + 上限放开」收口为 **0 队**，见本节末），
    折叠轮数 8 轮顶格 **27 → 6 队**（21 队在 5 轮停下，更快）、留白合计 179.4→**178.0s**、
    超预算 2.4→2.4s，**`timeFillRatchet` 无需重生成**（零变差）；`timeGolden` 106 条 delta
    （绝大多数 ≤0.3s 的停点差，最大 auto-1431-1481-1341 dmg +3.5%），已按裁决重生成。
    **结论（六版）**：折叠环的旋钮不能换（①~⑤），但**停止规则可以修**（⑥）——
    模型侧的反馈是对的，错的只是「用 1 毫秒门槛判离散系统收敛」。
    **尾巴专项收口（2026-09-10，实测）**：三条尾巴查清了——**报告口径没问题，问题是「读的是哪条管线」**。
    一次预设求值会跑 **N 次 `calcTeamResources`**（`billy-roxy-lucia` 实测 **18 次** = 外层不动点轮 + 非轴对照
    + 降配二分 6 轮×2（拒绝/接受各一次）+ 下游重算；`auto-1591-1161-1211` 6 次），每次自带一份折叠环与诊断量；
    `ConvergenceReport` 五字段**全部同源于被接受的那次调用**（`PROBE_CONV_TEAM` 探针实测：冷跑 / 同队热跑 /
    换队后回来 三次读数逐位一致）。**逐 pass 打表不按调用分组 = 会把某次可行试探的末轮（残差 0.000）误当成
    被接受管线的末轮**——`billy-roxy-lucia` 的 18 次调用里 11 次在第 2 轮就收敛（`maxExcess ≤ 1e-3` 直接 break，
    连一条逐 pass 记录都不留）；「单队直跑看到末轮 maxExcess=0」即出自这一批，不是被接受那条。
    **逐队定案**（`PROBE_TRACE_FOLD=1 PROBE_CONV_TEAM=<id>`，残差轨迹按调用分组）：
    · `billy-roxy-lucia`：被接受管线残差轨迹 `3.637 → 2.467 → 1.702 → 1.187 → 0.834 → 0.589 → 0.417`
      （**几何收敛比 ≈0.70/轮**，7 条记录 = pass1~7，pass8 用尽上限退出）；停滞计数**恒 0**（每轮改善 ≈0.17s
      ≫ 阈值 1e-2）→ 两条判据都不触发。**与 `runBillyFinalize` 无关（原假设作废）**：该队 `slack=-1.99`
      是超预算队，走**降配**路径（`interactionScale=0.688`、`axisFallback=false`、`exit=cycle`）——
      属坑19②/坑22 已定案的「厚需求降配**移动靶残差**」，不是估时缺口。外推：0.70/轮要 ≈**24 轮**才到 1e-3。
    · `auto-1591-1161-1211`（**账本原写 1481-1211 是笔误**；扫描实际是 1161，而 `auto-1591-1481-1211`
      现值 `tbConv=true`）与 `auto-1591-1481-1311`：残差按 **0.5/轮**减半（`0.173 → … → 0.003` /
      `0.150 → … → 0.002`），末轮停滞计数**已到 2**——**再给 1 轮就触发停滞判据**，即「8 轮上限比停滞判据
      早一步」。残差 2~3 毫秒物理上无意义（≪ 仓库自身的 1s 量化门槛），文本上却是 `tbConv=false`。
    **落地方案（2026-09-10，用户裁决「重排就重排，以长期利益为主」）**：口径没改——判据仍是
    `maxExcess ≤ 1e-3`，改的是**算力护栏**：`maxTimeIterations` 缺省 8 → `TIME_FOLD_MAX_PASSES = 32`
    （`core/resource.ts`，`ResourceCalcConfig.maxTimeIterations` 仍可覆写）。理由：8 轮上限曾是
    「`tbConv=false`」的**唯一来源**（三条尾巴的残差都在几何收敛，只是没跑够），而它只对
    「本来就要跑满」的队收费。
    **实测（127 预设，改动前后）**：`timeBudgetConverged=false` **3 → 0 队**；折叠轮数分布
    8 轮顶格 **6 → 3**（新增 9 轮 1 / 10 轮 1 / **21 轮 1** = `billy-roxy-lucia`，ρ≈0.70 实测需 21 轮）；
    留白合计 **189.3s 不变**、超预算合计 **2.2s 不变**；`timeFillRatchet` **零变差（无需重生成）**；
    `timeGolden` **15 条 delta / 5 队**，逐条归因（规则 10）：`billy-roxy-lucia` 逐槽 `nec`
    `+0.308 / −0.348 / +0.039`（**Σ 守恒再分配**：折叠轮走满后 `timeBudgetExcess` 的逐槽分配落定，
    总必要时间 180.001→180.000 不动、slack −1.990 与失衡 4 均不变）；4 支 `auto-1591-*`
    全部 ≤3 毫秒（`chain` ±0.0004 / `nec` ±0.003 / `slack` ±0.002）；`dmg` 仅浮点尾巴
    （最大 6.2 万 / 5.7e7 ≈ **−0.0001%**）。**无一条失衡次数、留白量级或截断量变化** → 已
    `TIME_GOLDEN_UPDATE=1` 重生成基线（20 行 / 5 队），全量 `npx vitest run`
    **1701 passed / 0 failed**（改前唯一红就是 golden 的 delta 闸）。
    **未采纳的替代方案**：把判据容差从 1e-3 放宽到量化地板 1s（`TIME_BUDGET_TOLERANCE_SECONDS`）——
    会让 21 支 5 轮队与 6 支 8 轮队**集体提前停车**（停车改变落点：累加器是分配器，见上文 ①
    实测留白 +14s 的教训），爆炸半径远大于「只给跑不满的队多跑几轮」；且 1e-3 判据本身没错，
    错的是上限不足以达到它。
    **阶段4「撤补丁层」五刀实测否决（2026-09-10，同一会话，判据=留白/超预算/棘轮/golden/硬不变量）**：
    ① **撤 `refundFrozen`（refund 逐轮跟随）** → 留白合计 **189.3 → 341.5s**、超预算 **2.2 → 6.0s**、
    `refund>0` 41→55 队、golden **214 条**、棘轮 **2 红** → 否决。原冻结论据（「逐轮跟随会抖动到
    8 轮耗尽」）虽然写在旧引擎上，但 32 轮上限 + 停滞判据**并不解除**它——病根是
    `refund→平A→回能→次数→物化行` 的放大环，不是「跑不够轮」。
    ② **撤 post-hoc 欠打试探层（与①同时）** → 与①**逐项同值**（留白 341.5 / 超预算 6.0 / 轮数分布全同）
    → 说明①下试探层本就基本不触发，**不是①的混淆项**；两层各自承重。
    ③ **对称折叠**（负超出时释放历史残差 `timeBudgetExcess = max(0, accum − idle)`，floor 0 防 necessary
    变负）→ 留白 **189.3 → 358.2s**（近乎翻倍）、`refund>0` 41→11 队、golden 173 条、棘轮红 → 否决。
    **机制**：现行「只折正超出 + 单侧判据 `maxExcess`」看着像缺陷（实测 `auto-1191-1481-1311`
    pass2 就报收敛、槽0 账本 100.81 vs 行 83.13 = 白留 17.68s），但释放历史残差会让平A池膨胀而
    行接不住 → 留白更大。**棘轮累加器是承重的**（与坑33 ① 的结论同源：累加不是惰性，它是分配器）。
    **④ 耦合重测（2026-09-10 round 2）：均衡权重 + refund 逐轮跟随 → 仍然否决**。上一条结论曾被质疑
    「①的失败或许只是静态权重把注进去的 refund 又流回厚槽」，故用仓库自带的边际均衡器
    （`optimizeTeamTimeWeights`，`maxIter=2`）重测 2×2：
    | 分配制度 \ refund | 冻结（现状） | 逐轮跟随（撤冻结） |
    |---|---|---|
    | 默认静态权重 | 留白 **189.3s** / 超预算 **2.2s**（基线） | 留白 **341.5s** / 超预算 **6.0s**（①，否决） |
    | 边际均衡权重 | 留白 **171.8s** / 超预算 **3.1s** | 留白 **280.8s** / 超预算 **6.8s**（④，否决） |
    → **跟随失败与分配制度无关**：两种制度下都劣化 90~150s 留白、超预算翻倍。放大环在
    `refund→平A→回能→次数→物化行` 这条链上，与权重无关。**「让折叠环自己承担欠打回填」这条路
    在两种分配制度下都被实测封死**（阶段4 的立项前提不成立）。
    附带读数：**边际均衡权重（maxIter=2）不是留白的解药**——它优化的是**伤害**，实测留白只降
    17.5s（189.3→171.8s）而超预算是**变差**的（2.2→3.1s）。与坑35 的结论一致：留白与伤害不同向，
    别拿留白当权重优化的目标函数。
    **⑤ 撤「专属重推」层（2026-09-10 round 3）：聚合指标变好、硬不变量断掉 → 否决**。做法 = 关掉
    1531 比利终局整数重推（`runBillyFinalize`）+ 1051 伊德海莉终局整数重推（`yidhariFinalizeEx` 块）。
    实测：留白 **189.3 → 171.9s**、超预算 **2.2 → 0.3s**（两项都「变好」！）——**但 `npm run verify` 红**：
    `yidhariInteractionGrid.test.ts` 断言 `parry=0 dodge=0 终局次数应为整数: expected false to be true`
    （**动作次数必须是整数** = 坑22 硬不变量），棘轮留白变差，golden 62 条。
    **教训（比结论本身更值钱）**：`留白/超预算` 是**代理指标**，它们可以在模型变得更不保真（小数次数 =
    不存在的动作）时同时「变好」——所以任何以留白为判据的改动**必须同时过硬不变量测试**
    （`yidhariInteractionGrid` / `seedInvariance` / `giftConsumption` / `decibelRowParity` 等），
    否则会拿保真度换指标。历次以留白为目标的 6 个 τ 变体 + 本会话 4 刀，凡「指标变好」的都要回看这一条。
    → **阶段4 结论（经 2×2 耦合重测 + 最后一层实测加固）：阶段4 名单上已**没有任何可撤的补丁层**——
    `probeExcludedTeam` 已删（2026-09-10）、`refundFrozen` / post-hoc 试探层 / 专属重推三者全为承重件，
    现有四件套（单侧判据 + 棘轮累加 + pass0 冻结 refund + post-hoc 试探）是自洽局部最优；
    要动留白必须与「按容量分配平A池」一起解（坑33 ③ 逐槽需求上限曾把留白压到 149.4s 但 74 队不收敛
    ——那是旧求解器，可作为下一轮的候选，须先量δ）。
    **「这四件套各是什么游戏机制？到底想拟合什么？」（2026-09-10 用户追问，逐件交代）**：
    先分清拟合对象——引擎里的「时间」**不是一个可观测真值**，而是三条**内部自洽约束**：
    ① 物化行净占用 ≤ 预算（不超时；硬不变量，坑22）；② 账本必要时间与物化行不脱节（不白留白）；
    ③ 动作次数为整数（现实里打不出 0.4 次强特；硬不变量，见上文⑤）。**伤害无外部真值锚**（AGENTS §3）
    ⇒ 四件套不是「拟合现实」，而是「让这三条约束的解存在且可收敛」的装置。逐件归属：
    | 件 | 游戏机制那半边 | 数值装置那半边 |
    |---|---|---|
    | 平A池按权重分配（前提，不属补丁层） | 必要动作打完后，剩余时间玩家会拿去平A（回能） | — |
    | pass0 **冻结** refund | 欠打掉的时间「本该被重新利用成平A」 | **冻结**是为掐死 `refund→平A→回能→次数→物化行` 放大环（逐轮跟随实测留白 189.3→341.5s） |
    | **单侧**判据 `maxExcess` | 只承认「欠打」方向的残差 | 释放负残差实测更差（358.2s）⇒ 单侧是承重的 |
    | **棘轮累加器** | 历史欠打的时间债要记住（否则不知道平A池该多分多少） | 累加器**同时是分配器**（坑33①「累加不是惰性」） |
    | **post-hoc 试探** | 收敛之后再「补打一次」自由时间 | 与①同生共赢（①撤掉它就不触发）⇒ 两层各自承重 |
    结论：**只有「平A池/欠打回填/整数次数」是游戏机制，冻结与单侧累加是数值装置**——但它们的存在
    是为了让机制那半边成立。所以「撤补丁层」的正确前提不是撤装置，而是**换掉产生欠打的源头**
    （模块读 `state.basicAttackTime` 产行 → 非单调映射，见本坑末尾候选清单 / 账本 C8 条）；
    只撤装置 = 拿保真度换指标（⑤实测）。**另：主路径默认改成边际均衡后（账本 B5，2026-09-10），
    留白不再是「要消灭的敌人」**——均衡优化的是伤害、留白只降 17.5s（本坑结论），剩下的留白反映
    模型结构，而不是分配不当。
    **留白 189s 的结构诊断（2026-09-10，探针 `PROBE_TRACE_FOLD=1 PROBE_CONV_ROWS=1`）**：留白 top-10
    （合计 ≈75s）**全部是「单厚槽」队**——一个槽的账本 ≫ 物化行而队友槽差恰好 `0.000`：
    `auto-1191-1481-1311` 槽0(艾莲) 行 83.13 / 账本 100.81（nec 96.65 + basic 4.16）= **−17.68s**；
    `auto-1191-1361-1311` 槽0(艾莲) −19.94s；`auto-1401-1031-1411` 槽0(爱丽丝) −15.93s。
    即：**厚槽的 `necessaryTime` 比它真打出来的行多 15~20s**，而折叠环的收敛判据只看正超出 →
    该状态被报成「已收敛」（`passes=2`）→ 那 15~20s 变成团队留白。这不是估时公式错（逐项核过
    艾莲的 ex/ult/chain/dodge/assist 组件的表值时间与物化行一致），而是**账本口径与物化口径在
    「历史残差」这一层分家**——正是上面③要动的东西，而动它更差。**下一轮入口**：把
    `maxExcess` 判据改成双侧（`max|excess|`）会把这些队如实报成未收敛（24 队残差 >1s 已在册），
    属「诚实报告」而非「修数值」，须先与用户确认是否要这种报法。
    **仍成立的上游假设（未证）**：`timeBudgetConverged=false` 的**原始 26 队**根因在模块级反馈——
    一批模块的行/次数生成直接读 `state.basicAttackTime`（alice 224/266、claret 193、ellen 154/188/267、
    grace 147/171、orphie 258/267、banyue 692…），池 ↓ 行 ↓、池 ↑ 行 ↑，形成非单调映射，
    折叠环的标量残差无法单调收敛到 0。→ **阶段2 的真路径 = 逐个把这类模块的产行改成
    「与池无关的确定性函数」**（或显式声明单调性），而不是在折叠环里换求解器。
    落地顺序建议：先 alice/grace/ellen 三个最常出现在不收敛队的模块，每改一个跑
    `PROBE_CONV_SCAN` 看该队是否退出 8 轮顶格 + `timeGolden` 逐条解释。

35. **留白不是求解器缺陷，是平A池**权重分配**的表征（2026-09-10 实测，重定向整条「留白专项」）**：
    前文坑33 的 6 个 τ 变体 + 本轮阶段4 的三刀，全部以「留白」为判据去改**求解器**——全负。
    真因量出来了：留白由 `basicAttackTimeWeight`（平A池按权重分配）主导，与求解器无关。
    **实测（探针 `PROBE_CONV_WEIGHTS_SWEEP=1`，127 预设：默认权重 vs 逐队把某一个槽的权重置 0）**：
    留白合计 **189.33 → 72.38s（−117s / −62%）**，**49 队可改善**，且改善几乎全来自「槽0（主C）权重置 0」
     （`auto-1191-1481-1311` 15.47→0.00、`auto-1191-1361-1311` 14.95→0.00、`auto-1401-1511-1411` 3.98→0.00…）。
     **但不要把它读成「主C 不该拿平A池」**——同一批改动下**伤害有涨有跌**：
    `auto-1401-1511-1411` **+4.9%**、`billy-liuyin-lucia` **+5.8%**、`auto-1191-1161-1311` **−8.1%**、
    `auto-1401-1261-1411` **−13.2%**、`yidhari-trigger-lucia` **−15.6%**、`auto-1181-1511-1411` **−28.0%**、
    `auto-1591-1481-1211` 还会翻成**超预算 1.71s**。即：**留白与「模型对不对」不同向**——留白 0 常常是
    「把自由时间挪给了边际产出更低的槽」买来的。历史口径「平A权重与留白不应并存、剩余时间按权重全分配」
    只在**权重本身被优化过**时才自洽。
    **正确仪器仓库里已有、只是没接主路径**：`composables/timeWeightBalancer.ts#equalizeTimeWeights`
    （边际均衡坐标上升：单变量扰动 → 团队总伤增量 → 转移权重）+ 编排层包装
    `teamTimeline.ts#optimizeTeamTimeWeights`（set-read-restore 经 `calc.teamTotalDamage`），
    实测接线在 `timeWeightBalancer.int.test.ts`。**调用点只有一处**：金数分配路径
    `teamTimeline.ts:484`（`allocateGoldByGreedy` 基础态）。**主计算路径 + `timeGolden`/`timeFillRatchet`
    两份基线全部使用静态默认权重**（`stores/config.ts#defaultBasicAttackTimeWeight`：强攻/异常/击破=1、
    支援/防护=0，用户 2026-09-04 裁决「不设职业统一阶梯」）。
    **落地形态（2026-09-10，用户两轮裁决：先「做个开关吧，这个算的太慢了，默认关」，后
    「默认快一些的B，做个开关，如果开了就是更慢的C」）**：
    · **默认（`configStore.deepTimeWeightSearch=false`）= 边际均衡（B，`marginal-equalize`）**——
      队伍签名变化时跑一次（`CalculatorView` 内 `useTimeWeightAutoAllocation`），
      一次 ≈ **3 倍求值**（实测均值 239.5ms/队、p90 494ms、最坏 1301ms；对照一次全队求值 78.6ms）；
    · **深度开关打开 = 多杠杆联合（C，`joint-levers`）**：均衡 + 弹刀次数阶梯（≈15~20 次求值 ~1.5s）；
    · 策略映射单一来源 = `timeWeightStrategyIdForDeepSearch(deep)`（UI/调用点不硬编码 id）；
    · 触发签名**刻意排除权重本身**（`timeWeightAllocationSignature`）——否则策略写回权重会自触发成死循环，
      该约束有测试（`__tests__/timeWeightAllocation.test.ts` ②）；
    · 必须先有生成规则的痕迹：UI 开关在 TeamConfigPage「平A时间权重」旁（标签「深度联合搜索（慢）」），
      tooltip 写明「默认=边际均衡（快）、开=联合（慢）、会覆盖手改」。
    · **引擎与两份基线（`timeGolden`/`timeFillRatchet`）保持静态权重口径**：策略是「计算外侧」的显式求解，
      只在 UI 触发点跑，不进引擎/不进基线——所以本默认值切换**零 delta**，基线仍是引擎回归的参照面。
    **扩展点（用户 2026-09-10：「这个自动计算以后还要加逻辑，比如能量不够就多a，甚至总时间可以把队友的
    时间都合轴」）**：新逻辑各自实现一个 `TimeWeightStrategy` 注册进表即可，UI 开关与 watcher 调用点不动。
    **价值实测（127 预设，默认 vs 边际均衡）**：团队总伤合计 **8103M → 8335M（+2.86%）**、
    **67 队提升 / 60 队无变化 / 0 队变差**、**56 队的主C 平A池被默认权重分少**；
    单队最大 `auto-1521-1361-1311` **+23.9%**（主C 平A **31.8→65.7s**、强特 **16→18**）、
    `auto-1501-1511-1311` +21.9%（31.9→57.6s、强特 11→14）、`auto-1521-1251-1311` +16.3%、
    `auto-1591-1481-1311` +10.1%。→ **默认权重表本身是个待修默认值**（用户 2026-09-04 口径：不设职业统一
    阶梯、抬权重归角色级滑块/预设）——「把均衡权重烘进预设数据」仍是待办候选（静态、零运行时成本、可 diff
    复核），与本开关不冲突（开关=运行时权威；预设=静态默认）。
    **否决记录·烘进预设（2026-09-10，用户口径）**：曾提议「把均衡权重一次性烘进 `teamPresets` 数据」
    （静态、零运行时成本、可 diff）——**否决**。用户给的机制依据：①「达成失衡目标后，**一定是主C 享有
    全部时间**」——终点分配是**角色驱动的角点解**（主C 独占），不是各槽边际相等的内点均衡，烘一个中间值
    会在别的失衡目标下错；②「异常队的时间分配**只有双战场同时在场才会抢时间**」——争抢是**条件性**的
    （双战场重叠时），静态值与条件解不同构。→ 分配必须**按当时的失衡目标与在场结构现算**（策略注册表），
    不能预烘焙。
    **分配规则的机制实测（2026-09-10，探针 `PROBE_CONV_GRID` + `PROBE_CONV_RULE`）**：
    用户口径「达成失衡目标后**一定是主C 享有全部时间**」「异常队只有双战场同时在场才抢时间」，实测：
    · **失衡目标基本不依赖平A池**：击破位平A 池置 0 时失衡次数与给它时间**相同**（`auto-1521-1361-1311`
      5=5、`auto-1501-1511-1311` 3=3）——失衡值来自**必做动作的 daze**（已在账本里），不是平A。
      故「击破位拿刚好打满目标的最小时间」在多数队里退化为 **0**（时间全归主C），与用户直觉一致；
      但**并非全部**：给击破位 0 会让 `auto-1591-1481-1311` / `claret-koleda-rina` 的失衡 **4→3**，
      即这些队的平A daze 确实参与攒条 → 规则必须带「最小够用」的阈值搜索，不能硬编码 0。
    · **但「主C 独占」不是普适最优**：`auto-1401-1511-1411`（爱丽丝异常 + 南宫羽击破）给击破位
      4× 权重反而 **+8.4%**（主C 只留 4.9s）——引擎按边际伤害判，异常主C 的每平A秒产出可能低于队友。
    · **静态规则「只有伤害特化拿池」全库实测**：总伤 **8103M → 8208M（+1.30%）**，但
      **56 队提升 / 29 队变差**（最坏 `claret-koleda-rina` **−27.5%**、`auto-1261-1331-1581` −11.6%）
      → 静态规则**不安全**（它假设「击破/支援不产伤」，而珂蕾妲/青衣/妮可那类角色本身就产伤）。
      对照**边际均衡：+2.86% / 0 队变差（构造性单调）**。
    → **结论**：① 预烘焙任何静态值或静态规则都不准（用户判断被实测证实）；② 分配必须**现算**，且只有
    边际口径能保证「不变差」；③ 用户点名的「击破位最小够用量」是一条**约束**（失衡次数的下限），
    适合作为策略里的**阈值搜索**与边际搜索联合，而不是替代它。
    **策略落地：多杠杆联合搜索（2026-09-10，用户「做吧」）**：`jointLeverStrategy`
    （注册表默认策略）= ① 平A 权重（委托边际均衡）+ ② **弹刀次数**（±2 阶梯坐标上升，≤3 轮），
    目标=团队总伤，**硬门 = 装配期不发生时间线截断**（`convergence.timeTruncatedSeconds ≤ 0`，
    即前台净占用 ≤ 预算）——用户原话「**弹刀多了也不能超过总时间，否则他可能无限制的加了**」：
    没有这道门，弹刀的 daze/喧响/闪能奖励照算而超时部分被装配截断（坑22）⇒ 优化器白拿奖励、一路加到上限。
    **实现坑（踩过）**：这道门**不能读 `rr.overflowSeconds`**——它是 cfg 上的副作用字段（每次
    `calcTeamResources` 调用都写），一次预设求值跑十几次调用 ⇒ 读数翻面（实测门槛读 0 而终态 0.906s）。
    必须读**结果自带**的 `convergence.timeTruncatedSeconds`（同坑33「尾巴专项：收敛读数归属」）。
    **全库实测（127 预设，默认 vs 联合）**：团队总伤 **8103M → 8666M（+6.95%）**、95 队提升 /
    32 队无变化 / **32 队拒绝**（基线本身已超时，自动分配不敢动）、**88 队弹刀被改动**、
    失衡次数仅 5 队变化。增益 top：`auto-1521-1361-1311` 88.1M→**126.3M（+43.4%）**、
    `auto-1521-1481-1311` +39.4%、`auto-1311-1521-1361` +42.9%、`auto-1581-1261-1561` +19.5%。
    **弹刀下限 = boss 预设强制次数（2026-09-10，用户裁决落地）**：用户口径「**允许减少交互**，因为有时候
    主c的平a比队友弹刀好用，**但不能降低到 boss 预设的最低次数，因为 boss 预设的次数是强制完成的**」
    → 搜索的弹刀阶梯在 `dir < 0` 时加下限判据 `Σparry + dir ≥ appliedBoss.parryTotal`
    （与 `core/parrySplit.ts` 同源；低于下限的补齐由 `parrySplit` 负责，本策略只承诺**不下调越过它**，
    不重复造第二份）。**实测下限确实在起作用**：`auto-1181-1561-1581` 搜索把弹刀 **6/6/6 → 12/2/0**
    （总数 18→14 ≥ 13）——把弹刀从主C **转移**到击破位/支援位，总伤 +15.7%。
    **两种语境的收益（127 预设）**：
    · **无 boss 预设**（`appliedBoss=null`，即「弹刀是自我选择的语境」）：总伤 8103M → **8666M（+6.95%）**，
      95 队提升 / 88 队弹刀被改动（增益形态=删弹刀）；
    · **有 boss 托底**（`appliedBoss.parryTotal=13`，叶释渊量级）：总伤 8103M → **8413M（+3.83%）**，
      87 队提升 / 40 队无变化 / **39 队拒绝**（基线已超时）/ 55 队弹刀被改动 / 失衡次数仅 2 队变化。
      top：`auto-1521-1361-1311` +23.9%（弹刀未动 ⇒ 纯权重收益，与边际均衡一致）、
      `auto-1181-1561-1581` +15.7%（弹刀再分配）、`auto-1311-1521-1361` +19.7%。
    **弹刀口径三件事（2026-09-10 用户裁决，已落地/已更正）**：
    · **不带支援突击弹刀改「对半分」**（原「全部归击破位」**是错的、已删**）：用户口径「不带支援突击的
      弹刀**必须对半分**，强制归击破位是错的——那是把「补失衡」误解成「只有击破弹刀」，删掉吧」。
      实现：`core/parrySplit.ts` 新增 `mainDpsNoFollowUp = floor(total/2)`、`breakerNoFollowUp = 余`
      （奇数归击破位），缺口抵扣只用**击破位那一半**；消费端 `useResourceCalc` 在两槽分别写
      `parryNoFollowUpCount`（无击破位队仍全归主C），`parrySplitResult` 投影补 `mainDpsNoFollowUp`，
      并修了 `perSlotParry`（原先主C 那半的 **215 喧响奖励漏计**）。测试：`parrySplit.test.ts` /
      `parrySplitInt.test.ts` 21 tests 全绿（含「15 → 8/7」「2 → 1/1」）；**两份基线 0 delta**
      （基线不应用 boss 预设 ⇒ parrySplit 不激活）。
    · **正常弹刀的拆分保持现状**：用户口径「正常弹刀作为一个招式，如果失衡不够就给击破，如果主C 喧响不够
      就给主C，**但是很难判断，所以对半分差不了多少**」→ 现行「击破位按失衡缺口先取、主C 拿剩余」落在
      该容差内，不改。
    · **轻弹刀只取 #1 段是对的**（无需"补三段"）：用户口径「引擎的轻弹刀和重弹刀在**额外喧响**那奖励了
      一次 **215**……动作本身的数据行确实只有失衡值。**计算器只取轻弹刀没问题**，这三次弹刀的名字分别是
      轻、重、连续弹刀，**后面两种没必要算**」→ 表里 `1521015/16/17` 三段只是命名（轻/重/连续），
      引擎取 `1521015` + 支援突击 `1521018` 即为完整一次弹刀。
    · **更正我上一版的说法（读漏）**：215 **确实存在**——`core/anomalyPool.ts#PARRY_DECIBEL_BONUS = 215`，
      走「特殊动作奖励」通道（`calcSpecialActionBonus`：弹刀215/闪反10/连携10/快支20，**队友伴随 50%**），
      由 `useResourceCalc` 按槽位注入。所以一次弹刀（希希芙）在引擎里的完整账 =
      **3.232s 必要前台时间 + 987 daze + 123.45 行内喧响 + 215 特殊动作喧响**（+ 1042% 支援突击倍率）。
      上一版写「引擎可能少给喧响」是错的，已按此更正。
    **⚠ 弹刀计价（仍未定，但已不影响上述落地）**：无 boss 预设时 top 增益全部来自「把弹刀删到 0」
    （`6/6/0 → 0/0/0`）——引擎把弹刀按 `assistFollowUpActionTime` 记进**必要前台时间**，其
    decibel/daze 回报在小队里低于把这时间给主C 的边际伤害。用户 2026-09-10 说明：「弹刀本身奖励了一些
    喧响，后面跟的支援突击差不多能弥补前面弹刀的损失，所以主C 弹刀通常白赚喧响和部分数据；击破弹刀
    造成较高失衡值」——若引擎的双侧计价与该描述不符（弹刀被系统性算成净亏），那是**计价口径**问题，
    需要单独核对 `core/resource/helpers.ts` 的弹刀行（`assistFollowUpActionTime` 计费 vs
    `assistFollowUpDecibelRecovery` 回报，含 `parryTimeFreeCount` 免费次数），而不是让搜索去删弹刀。
    当前落地按用户裁决「计算器里弹刀是自我选择的语境，可以根据收益抉择」执行：**允许减少**，
    下限 = boss 预设强制次数。
    **用户的分配模型（2026-09-10 口径，策略的目标函数与约束都以此为准）**：
    「**失衡次数只是第一个决策**，其次还有很多分配逻辑，不过总体而言是**为了总伤最大化**；
    战场性能强的主C 平A 不仅自身倍率和属性优秀，他产出的**能量、特殊资源也能转化为更多倍率**。」
    → 落到实现：**次数当硬约束（先定）、伤害当目标函数**，且目标里必须包含「平A→能量→强特/大招」与
    「平A→专属资源→倍率行」两条间接通道（引擎里就是 `iterate` 的平A池→回能／模块专属资源）。
    **实测约束会咬**（`PROBE_CONV_BALANCE_STUN`，127 预设）：现均衡器只最大化伤害 → **4 队掉失衡次数**
    （`yidhari-trigger-lucia` 3→2 换 +7.2%、`auto-1591-1481-1311` 4→3 换 +10.1%、
    `auto-1201-1361-1211` 4→3 +3.6%、`auto-1201-1361-1311` 4→3 +1.8%）。
    → 已实现为**硬约束**（`marginalEqualizeStrategy`）：均衡解若掉次数则**回滚权重并在 `note` 里如实上报
    这笔交易**（不静默接受、也不静默丢弃），有测试锁（`timeWeightAllocation.test.ts` ⑤）。
    **下一步（用户点名的其余分配逻辑，按优先级）**：① 平衡次数约束下的**受限边际搜索**（现在是回滚，
    更优解是「在保次数的可行域内继续爬」）；② 「能量不够就多A」（把能量短缺当约束/惩罚项）；
    ③ 双主C 队（「有些队伍不是一个主c」）在主C 之间的分配。扩展方式=注册表加策略，UI 开关不动。
    **可行性优先（2026-09-10，账本 A1 落地）**：`jointLeverStrategy` 新增**阶段 -1**——基线已超时的队
    先用**减交互**杠杆（弹刀/金身/双反/闪反，与引擎非轴降配同族；加交互只会加剧截断，故只试减向 ±2 ≤2 轮）
    把配置拉回可行：接受 = 「截断减少 **且** 总伤不低于基线」（判据「timeTruncatedSeconds → 0 且总伤不降」），
    截断归零提前退出；拉不回的队保底**相对门**（`feasibleFloor` = 阶段 -1 找到的最小截断，后续搜索不得推回去）。
    全库实测（PROBE_CONV_JOINT，127 预设）：结束后仍截断 **15 → 9 队**、团队总伤 **+8.75% → +9.27%**、
    提升 116 → 120 队；拉回样例 `auto-1591-1481-1311`：截断 0.91→0.00s、总伤 81.1→94.0M（+15.9%）、
    弹刀 12→6。**剩余 9 队实证「拉不回来」**（最高截断 91.6s = `auto-1431-1481-1341`）：必要行本身超预算，
    交互减到 0 也装不下（引擎侧轴退化/非轴降配已先跑过），note 如实上报「拉不回来…保持相对门」，不在策略层硬塞。
    **能量驱动（2026-09-10，账本 A2 落地，用户点名「能量不够就多A」）**：联合搜索新增 ③ 杠杆——主C 强特
    次数 = `floor(总能量/耗能)`（`resolveExSpecialCount`），平A 池是主C 能量的主要来源（basicAttackTime ×
    秒均回能）；①② 后若主C 次数被挤掉（能量紧张），把低边际槽的权重转给主C 多A，接受 = 主C ex 上升 +
    总伤 ≥ 基线 + 仍可行；**未挤的队只接受伤害不降的喂能**（不许用伤害换次数，实测首版 39 队喂能版把
    +9.07% 拖回 +8.01%，收窄后 +9.27%）；守卫判据「主C exSpecialCount 不降 + 总伤不降」按**逐杠杆**
    解释（v2，见下方 A4 否决记录）。全库实测：喂能 17 → **20 队**、总伤 **+9.22%**（每队总伤 ≥ 自身
    基线；与 A3 的 +9.27% 差值是「被挤队花少量伤害买回次数 + 喂能先行、角点机会减少」的预期成本）。
    测试：`timeWeightAllocation.test.ts` ⑥c（A1 判据）/⑥d（A2 判据）。
    **双主C 推广（2026-09-10，账本 A4，用户「有些队伍不是一个主c」）**：策略层「主C」从写死槽0 改为
    **队内全部输出定位槽**（单源 `scripts/lib/presetCategories.mjs#isCarrySpecialty`，`carrySlotsOf`；
    首元素=分类口径第一核心；无输出位回落 [0]）。③ 能量喂能与 ex 守卫**逐核心**执行；④ 角点解**只压
    非输出槽**（预设库 28 支双异常核心队里，第二个 carry 此前会被角点解当辅助压到最小够用 = 卖伤害）；
    核心之间份额由 ① 均衡器按伤害边际协调（逐槽坐标上升即 A4 说的 1D；喂能同样只从非输出槽抽，
    饿不到另一个主C）。顺带修正：③ 的 `starved` 曾与 `exBase` 同刻抓取 ⇒ 恒 false（伤害地板永远走
    「未挤」分支）——现 `exStart` 在**策略入口**抓取，被挤判定恢复生效。@fact engine:分配策略/主C判定。
    测试 ⑥f（双核心队：两槽次数都不降 + 角点解不压输出槽）。
    **否决记录·严格守卫（2026-09-10 实测）**：把判据「主C ex 不降」实现成**全量严格版**（逐核心对照
    策略入口，不满足就把权重+弹刀整体回滚基线）实测**否决**——咬 **17 队**：均衡 ① 本会在核心间挪
    次数（与 ⑤「次数是分配的结果、如实上报不拦截」先例冲突），且回滚连 A1 拉回可行的成果一起抵消
    （结束仍截断 9→12 队、总伤 +9.27% → +7.08%）。**守卫 v2** = 判据按**逐杠杆**解释：③④ 每步接受
    都以该核心 ex 上升为条件、末态防御兜底（若仍变坏只回滚**权重到 ①② 末态**，保住 ①②/阶段-1 收益）；
    ① 的核心间挪动允许 + note 逐核心上报（`槽N 基线→现值 次`）。勿再把守卫改回全量回滚。
    **待用户裁决（产品级，爆炸半径=全库数值）**：主路径是否也走边际均衡（即「默认权重」= 均衡权重）？
    实测提示：那会让 49 队的落点变（伤害 ±0.4%~±28%）、留白 −117s；而**伤害没有外部真值锚**（AGENTS §3
    实战归档不作误差判据），所以只有用户能定这个口径。**在那之前：不要再为「降低留白」动折叠环**
    （已试 9 种，全负）。

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

## 5. 验收命令

```bash
npm run verify      # validate:data + validate:specs + vitest + typecheck + build（一条链）
npm run docs:status # 重新生成 docs/implementation-status.md（勿手改；CI 检查漂移）
```

新增机制后同步 `public/static/character-mechanics.json` / `character-constellations.json`
（实现状态 + codePaths；`validate:data` 有状态表同步护栏——新角色缺条目即红），并补一条全管线冒烟测试
（参考 `src/mechanics/__tests__/billySmoke.test.ts` 的 harness：`src/test/harness.ts` 的
`setupHarness` + `useResourceCalc().resourceResult`；三文件 fetch stub 不再复制，用 `mockStaticFetch()`）。
