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
  │    ├─ 通用动作（平A汇总/强特/终结/连携/闪反/弹刀/支援突击）
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
| `src/composables/useResourceCalc.ts` | runCalcRound（外层不动点）、轴模式（banyueAxisEx/billyAxisEx 注入）、伤害池/直伤结算 |
| `src/specs/mechanics.ts` | specToMechanicModule：spec → 模块的通用翻译（resources/events/settings） |
| `src/specs/resources.ts` | computeSpecResources：资源解释器（gain/spend/countSource） |
| `src/specs/runtime.ts` | applySpecAttributeConversions（属性转模） |
| `src/mechanics/registry.ts` | 每 agent 一个模块；spec 无显式模块才自动注册；settings 自动合并（重名抛错） |

## 4. 常见坑（实测踩过）

> **按症状查（不用通读）**：滑块改了面板/结果不变→1 · 强特次数不对/接管 EX 链→2 · 倍率/失衡/喧响全错→3 · 按 name/note 找不到执行行→4 · 附伤 daze/异常双计→5 · 专属动作不占时间→6 · 贯穿力疑似双计→7 · 招式命中类计数没源→8 · 轴内动作次数/时间不对→9 · 进场能量不对→10 · 指定招式增伤误放大→11 · 前台超时/账本虚增→12 · 队伍联动静默错值→13 · 界面能量与次数对不上→14 · 不收敛/数值抖动→15 · 两次算结果漂移→16 · 同输入落点漂移→17。

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
    `derivedEnergy`（真正驱动 exSpecialCount 的收敛能量）。二者的差值是**已知口径差**：
    iterate 内调 `calcEnergySource` 时 chainCountTotal 传 0（连携次数尚未收敛），因此连携驱动的
    回能（莱卡恩影画2 等）只进展示、不参与次数推导。两个字段都在结果上，便于对账。
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

## 5. 验收命令

```bash
npm run verify      # validate:data + validate:specs + vitest + typecheck + build（一条链）
npm run docs:status # 重新生成 docs/implementation-status.md（勿手改；CI 检查漂移）
```

新增机制后同步 `public/static/character-mechanics.json` / `character-constellations.json`
（实现状态 + codePaths；`validate:data` 有状态表同步护栏——新角色缺条目即红），并补一条全管线冒烟测试
（参考 `src/mechanics/__tests__/billySmoke.test.ts` 的 harness：`src/test/harness.ts` 的
`setupHarness` + `useResourceCalc().resourceResult`；三文件 fetch stub 不再复制，用 `mockStaticFetch()`）。
