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
| `estimateExSpecialTime` | iterate 每轮 | 强特链/专属动作的必做前台时间 | state（可用 cfg 字段存上轮值） |
| `buildExecutions` | 收敛后一次 | push 专属执行（EX 链/附伤/事件执行） | — |
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

> **按症状查（不用通读）**：滑块改了面板/结果不变→1 · 强特次数不对/接管 EX 链→2 · 倍率/失衡/喧响全错→3 · 按 name/note 找不到执行行→4 · 附伤 daze/异常双计→5 · 专属动作不占时间→6 · 贯穿力疑似双计→7 · 招式命中类计数没源→8 · 轴内动作次数/时间不对→9 · 进场能量不对→10 · 指定招式增伤误放大→11 · 前台超时/账本虚增→12 · 队伍联动静默错值→13 · 界面能量与次数对不上→14 · 不收敛/数值抖动→15 · 两次算结果漂移→16 · 同输入落点漂移→17 · 物化行打不满战斗时间（欠打）/轴需求超预算误报超时→19。

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
    ①**欠打回填**：折叠循环首轮测得「团队 Σ(账本−物化必要行) 正差」写入 `config.timeBudgetRefund`
    （团队级）→ `iterate` 的 `availableBasicTime` 加回该差额（按 timeWeight 分配，时间守恒）。
    **冻结语义**：只测一次不再改写——refund 与次数收敛存在耦合（平A回能→次数→必要时间→idle，
    伊德海莉烧血/艾莲等强依赖角色），逐轮跟随会抖到 maxTimeIter 耗尽假红（`timeBudgetConverged=false`
    但 residual=0）；判据保持 excess-only（坑 12 原样），代价是 ±1s 量化残差。天然上限：idle_i ≤ E_i
    → refund ≤ ΣE → basic 池 ≤ 预算，不会填超。②**轴退化**（用户口径 2026-08）：轴的资源需求
    （轴内块/自动补齐交互 × 窗口数）超出战斗时间预算 = 轴不可操作（需 boss 秽盾等外界环境才打得成）
    → `useResourceCalc.calcOutput` 检测轴模式前台行 > 预算+2s 时跑一次**非轴对照**，仅当对照可行
    （般岳金身20/招架10 等配置本身超预算的场景与轴无关，弃轴无意义）才弃轴重算，`convergence.axisFallback=true`
    上报（队伍对比页 timeDetail 追加「已退化为一般轴」）。自动补齐（`banyue.autoTopUpInteractions`）
    的生效测试须落在补齐后仍可行的需求域，厚需求场景归退化用例管（banyue.test「轴退化」）。
    ③**estimate/物化双算坑**：模块把「池守恒、不生成执行行」的动作块计入 estimateExSpecialTime 就是
    账本虚高（般岳 banyue-combo 连段块 = 怒相免费连段的表达，时间已含在怒相内/外连段行）——estimate
    与 buildExecutions 必须逐项对账（`computeBanyueCycleFromCfg` 输出 vs 物化行），差值恒定非零即双算或漏计。
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
    另加**单角色前台 ≤ 战斗总时间**硬顶（合轴放宽团队预算不放宽单人物理时间轴，截断份额留池不重分配）。
    生效测试 `src/composables/__tests__/comboAlignBudget.test.ts`（8 例：池扩大/overflow 净额/
    GROSS-NET/max 不叠加/硬顶/端到端/回归守卫）。
    **消费方**：`overflowSeconds` 已并入 TeamComparePage 操作难度横轴（`computeDifficulty` 加
    overflow 参数，1 秒 = 1 难度点线性；只厚轴队 >0，用户口径 2026-09-04）。

## 5. 验收命令

```bash
npm run verify      # validate:data + validate:specs + vitest + typecheck + build（一条链）
npm run docs:status # 重新生成 docs/implementation-status.md（勿手改；CI 检查漂移）
```

新增机制后同步 `public/static/character-mechanics.json` / `character-constellations.json`
（实现状态 + codePaths；`validate:data` 有状态表同步护栏——新角色缺条目即红），并补一条全管线冒烟测试
（参考 `src/mechanics/__tests__/billySmoke.test.ts` 的 harness：`src/test/harness.ts` 的
`setupHarness` + `useResourceCalc().resourceResult`；三文件 fetch stub 不再复制，用 `mockStaticFetch()`）。
