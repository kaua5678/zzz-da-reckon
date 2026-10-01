# D2：`CharacterOperationConfig` 去巨型化（类型层）

> 第 389 轮（arena-E）建；卡表 CC-359。对应 `.claude/OPEN-ITEMS.md` D2 / 评审 #13 /
> `docs/mcp-agent-development-roadmap.md`「战役 1」阶段 A + 阶段 B 的类型层部分。

## 1. 约定（新角色照此写）

- **只有本模块读写的 cfg 字段，声明写在本模块文件末尾**：
  ```ts
  declare module '@/types/resource/config' {
    interface CharacterOperationConfig {
      /** 说明 */
      fooBarCount?: number
    }
  }
  ```
  这是 TS 模块扩充：仍是同一个 `CharacterOperationConfig`（钩子签名、`cfg.fooBarCount` 访问、cast 一律不用改），
  **纯类型、零运行时**——产物 JS 逐字节不变（r389 用 `vite build` 前后 `diff -r` 64 文件全同验证）。
- **被第二处引用（引擎 / 机制公共层 / 视图 / 另一个角色模块）⇒ 迁回 `types/resource/config.ts` 公共接口**。
- 规则锁：`src/types/__tests__/privateCfgFields.test.ts`——公共接口里出现「剥注释后只被 1 个角色模块引用」的字段即红。
  红了就跑 `python3 scripts/d2-migrate-private-cfg.py . <模块名>`（已有扩充块会并入，不另起第二块）。
- 判据口径：**剥掉注释**后按单词边界匹配非测试源码。注释里的沿革说明不算引用（r389 首轮没剥，
  `convergence.ts` 的迁移沿革注释让 36 个私有字段被误判为公共，第二轮修正）。

## 2. 结果（r389）

- 公共接口 294 → **106** 字段（188 个迁入 26 个角色模块；`types/resource/config.ts` 851 → 459 行）。
- 顺带：公共类型文件不再 import 角色专属类型 `YidhariLoopMove`。
- 为什么这是架构收益而不是降计数：新角色加 cfg 字段 **只改自己的模块**（原先必须改共享类型文件，
  也是并行 lane 撞车热点）；字段声明与唯一读写者同处，读模块即读全它的状态。
- 没做、为什么：**没有**改成「模块私有子接口 + 交叉类型 cast」的强隔离（路线图原案 `AgentSpecificConfig<T>`）。
  那要改 26 个模块里每个钩子的 cfg 访问，收益只是「别的模块访问不到」，而现状 188 个字段本来就只被一处引用。
  扩充块是可逆的下一步前置：要强隔离时把块改成 `interface XxxCfg {...}` + 模块内 `cfg as CharacterOperationConfig & XxxCfg` 即可。
- 回滚：`git revert` CC-359 提交（纯类型，回滚无数值影响）。

## 3. 下一步（剩下的 106 个公共字段）

大头是引擎通用字段（`composables/resourceCalc/helpers.ts` 引用 63 个、`core/resource/rowBuild.ts` 38、
`core/resource/helpers.ts` 31），**不动**。真正值得看的是「**1 个角色模块 + 1 个非模块文件**」的 14 个——
非模块那一处若是引擎核心在读写角色专属字段，就是「引擎认识角色」的耦合，应改成模块钩子 / 通用声明（先例：CC-35b
把仪玄 5 项从 helpers.ts#buildCharConfig 迁进模块 `buildCharConfig`）。逐个判断，**可能结论是「这是通用契约、名字起坏了」⇒ 只改名或不做**：

| 字段 | 角色模块 | 非模块引用 |
|---|---|---|
| `promiaNiyingCount` | promia | `stores/config.ts` |
| `chainCountTotalExtra` | yuzuha | `core/resource.ts` |
| `aliceTeamAssaultCount` | alice | `mechanics/types.ts` |
| `aliceDisorderCount` | alice | `mechanics/types.ts` |
| `exRefundFreeCap` | yidhari | `core/resource/resourceIncome.ts` |
| `timePressureSeconds` | yeshuguang | `core/resource/foldLoop.ts` |
| `teamUltimateFlashBonus` | yixuan | `core/resource/crossAgentEnergy.ts` |
| `crossAgentFlatEnergyBySource` | lighter | `core/resource/crossAgentEnergy.ts` |
| `axisActionCounts` | nekomata | `composables/resourceCalc/convergence.ts` |
| `axisUltimateTotal` | xixifu | `composables/resourceCalc/convergence.ts` |
| `yixuanInk2Count` | yixuan | `stores/config.ts` |
| `yixuanInk3Count` | yixuan | `stores/config.ts` |
| `yixuanExtremeAssistCount` | yixuan | `stores/config.ts` |
| `yixuanBackstageComboCount` | yixuan | `stores/config.ts` |

注：`stores/config.ts` 的几项多半是与 `CharacterConfig` 同名字段（仪玄交互栏次数）造成的**同名误报**，
cfg 上的同名字段由模块 `buildCharConfig` 从 char 拷入——属正常，跳过。

## 4. 字段矩阵（`python3 scripts/d2-cfg-field-matrix.py . --md <out>` 可重生成）

分类：private = 只有 1 个角色模块引用（可迁模块私有）；agents-shared = 只在多个角色模块间；engine = 引擎/机制公共层/视图也引用；dead = 声明后无人引用。

| 分类 | 字段数 |
|---|---|
| engine | 105 |
| agents-shared | 1 |

## private 字段按模块

| 模块 | 私有字段数 |
|---|---|

## 全表

| 字段 | 可选 | 分类 | 角色模块 | 其他引用 |
|---|---|---|---|---|
| `slot` |  | engine | alice, anby, banyue, burnice, caesar, corin, harumasa, hugo, jane, lighter, liuyin, luciaElowen, lucy, lycaon, miyabi, nangong, norma, orphie, phoenix, remielle, rina, sigrid, soukaku, specPanelBuffs, starlightBilly, trigger, velina, xide, yidhari, yixuan, yuzuha, zhuYuan | components/BossCard.vue, components/CharacterCard.vue, components/FinalPanel.vue, components/ResourceResultCard.vue …+76 |
| `agentId` |  | engine | alice, anbyZero, banyue, burnice, caesar, ellen, hugo, jane, lighter, liuyin, luciaElowen, lucy, lycaon, orphie, promia, remielle, trigger, vivian, xide, xixifu, yaojiayin, yeshuguang, yixuan | components/BossCard.vue, components/CharacterCard.vue, components/DifficultyDescentPanel.vue, components/FinalPanel.vue …+108 |
| `isFlashUser` |  | engine | lighter | components/ResourceResultCard.vue, composables/resourceCalc/helpers.ts, core/resource/assembleSlot.ts, core/resource/resourceIncome.ts …+1 |
| `panel` |  | engine | aire, alice, anby, anbyZero, anton, banyue, ben, billy, burnice, caesar, claret, corin, ellen, evelyn, grace, harumasa, hugo, jane, koleda, lighter, liuyin, luciaElowen, lycaon, miyabi, nangong, nekomata, norma, orphie, phoenix, piper, promia, pulchra, qianxia, qingyi, remielle, rina, roxy, seth, severian, sigrid, soldier11, specPanelBuffs, starlightBilly, trigger, velina, vivian, xide, xixifu, yanagi, yaojiayin, yeshuguang, yidhari, yixuan, yuzuha, zhao, zhendou, zhuYuan | components/FinalPanel.vue, components/StatPanel.vue, components/charts/DifficultyCurve3DChart.vue, components/charts/ResponseSurface3D.vue …+36 |
| `outOfCombatPanel` | ? | engine | aire, ben, claret, harumasa, liuyin, luciaElowen, nangong, norma, promia, qianxia, vivian, xide, yuzuha, zhao, zhendou | composables/resourceCalc/helpers.ts, composables/resourceCalc/panelPhases.ts, mechanics/types.ts, views/TeamConfigPage.vue |
| `basicAttackRegenPerSec` |  | engine |  | composables/resourceCalc/helpers.ts, core/resource/rowBuild.ts |
| `basicAttackDecibelPerSec` |  | engine |  | composables/resourceCalc/helpers.ts, core/resource/rowBuild.ts |
| `basicBenchmarkMoveId` | ? | engine |  | composables/resourceCalc/helpers.ts, composables/resourceCalc/skillRows.ts, core/resource/rowBuild.ts, types/catalog.ts |
| `exSpecialMoveId` |  | engine | claret, ellen, koleda, luciaElowen, phoenix, severian, sigrid, yidhari | composables/resourceCalc/helpers.ts, core/resource/assembleSlot.ts, core/resource/rowBuild.ts, types/resource/agentResources.ts |
| `promiaNiyingCount` | ? | engine | promia | stores/config.ts |
| `freeExSpecialCount` | ? | engine | nangong | core/resource/helpers.ts, core/resource/rowBuild.ts |
| `parryTimeFreeCount` | ? | engine |  | composables/resourceCalc/convergence.ts, core/resource/rowBuild.ts |
| `exSpecialCostType` | ? | engine |  | composables/resourceCalc/helpers.ts, core/resource/helpers.ts |
| `exSpecialResourcePaidCount` | ? | engine |  | core/resource/helpers.ts |
| `extraExPlans` | ? | engine |  | composables/resourceCalc/helpers.ts, core/resource/rowBuild.ts |
| `inStunWindowTriggers` | ? | engine | nangong | composables/resourceCalc/convergence.ts, composables/resourceCalc/outerCycle.ts, composables/resourceCalc/roundThreads.ts |
| `exSpecialEnergyConsume` |  | engine | ben, burnice, lighter, liuyin, lycaon, norma, phoenix, pulchra, roxy, severian, sigrid, soukaku, starlightBilly, velina, xide, yanagi, yaojiayin, yidhari, yixuan | components/ResourceResultCard.vue, composables/resourceCalc/helpers.ts, core/resource/assembleSlot.ts, core/resource/helpers.ts …+4 |
| `exSpecialActionTime` |  | engine | ellen, liuyin, luciaElowen, lycaon, phoenix, qingyi, severian, sigrid, soldier11, soukaku, yeshuguang, yidhari, zhao | composables/resourceCalc/helpers.ts, core/resource/rowAccounting.ts, core/resource/rowBuild.ts |
| `exSpecialDecibelRecovery` |  | engine | starlightBilly, yidhari, yixuan | composables/resourceCalc/helpers.ts, core/resource/rowBuild.ts |
| `decibelRecoveryByMoveId` | ? | engine |  | composables/resourceCalc/helpers.ts, core/resource/rowAccounting.ts |
| `energyRecoveryByMoveId` | ? | engine |  | composables/resourceCalc/helpers.ts, core/resource/rowAccounting.ts |
| `ultimateMoveId` |  | engine | claret, koleda, luciaElowen, specPanelBuffs, yeshuguang | composables/resourceCalc/convergence.ts, composables/resourceCalc/helpers.ts, composables/resourceCalc/ultimatePromote.ts, core/resource/assembleSlot.ts …+1 |
| `ultimateCost` |  | engine | banyue, specPanelBuffs | components/ResourceResultCard.vue, composables/freeCompare/metrics.ts, composables/resourceCalc/convergence.ts, composables/resourceCalc/helpers.ts …+5 |
| `ultimateActionTime` |  | engine | liuyin, qingyi, specPanelBuffs, yeshuguang, zhao | composables/resourceCalc/helpers.ts, core/resource/assembleSlot.ts, core/resource/crossAgentSupply.ts, core/resource/helpers.ts …+1 |
| `ultimateDecibelRecovery` |  | engine |  | composables/resourceCalc/helpers.ts, core/resource/rowBuild.ts |
| `chainMoveId` |  | engine | claret, koleda, luciaElowen, yidhari | composables/resourceCalc/helpers.ts, composables/resourceCalc/ultimatePromote.ts, core/resource/assembleSlot.ts, core/resource/rowBuild.ts |
| `chainActionTime` |  | engine | norma, qingyi, yidhari | composables/resourceCalc/helpers.ts, core/resource/assembleSlot.ts, core/resource/helpers.ts, core/resource/rowBuild.ts |
| `chainDecibelRecovery` |  | engine | yidhari, yixuan | composables/resourceCalc/helpers.ts, core/resource/rowBuild.ts |
| `chainComboAlignRatio` |  | engine |  | composables/resourceCalc/helpers.ts, core/resource/assembleSlot.ts, core/resource/helpers.ts, core/resource/rowBuild.ts |
| `chainCountPerStun` |  | engine | anby, corin, liuyin, lycaon, sigrid, specPanelBuffs, yaojiayin | components/ResourceResultCard.vue, composables/resourceCalc/convergence.ts, composables/resourceCalc/helpers.ts, composables/resourceCalc/ultimatePromote.ts …+11 |
| `chainCountTotalOverride` | ? | engine | anby, claret, corin, liuyin, sigrid, soldier11, specPanelBuffs | composables/resourceCalc/convergence.ts, core/resource.ts, core/resource/helpers.ts |
| `chainCountTotalExtra` | ? | engine | yuzuha | core/resource.ts |
| `exSpecialComboAlignRatio` |  | engine | lycaon, phoenix, severian, sigrid, soldier11, soukaku | composables/resourceCalc/helpers.ts, core/resource/rowAccounting.ts, core/resource/rowBuild.ts |
| `ultimateComboAlignRatio` |  | engine | specPanelBuffs | composables/resourceCalc/helpers.ts, core/resource/helpers.ts, core/resource/rowBuild.ts |
| `parryCount` |  | engine | banyue, claret, corin, pulchra, qingyi, roxy, sigrid, specPanelBuffs, starlightBilly, trigger, vivian, yaojiayin, yixuan, yuzuha, zhendou, zhuYuan | composables/difficultyDescent.ts, composables/difficultyLadder.ts, composables/liveInteractions.ts, composables/resourceCalc/convergence.ts …+16 |
| `parryNoFollowUpCount` |  | engine | claret | composables/resourceCalc/convergence.ts, composables/resourceCalc/helpers.ts, core/resource/helpers.ts, core/resource/rowBuild.ts |
| `parryDecibelOnlyCount` |  | engine |  | composables/resourceCalc/convergence.ts, composables/resourceCalc/helpers.ts |
| `dodgeCounterCount` |  | engine | anby, banyue, claret, lycaon, qingyi, roxy, severian, sigrid, starlightBilly, yeshuguang, yixuan | composables/liveInteractions.ts, composables/resourceCalc/convergence.ts, composables/resourceCalc/feasibilitySearch.ts, composables/resourceCalc/helpers.ts …+12 |
| `quickAssistCount` |  | engine | corin, qingyi, starlightBilly, yaojiayin | composables/liveInteractions.ts, composables/resourceCalc/convergence.ts, composables/resourceCalc/helpers.ts, composables/teamCompare.ts …+9 |
| `perfectBlockCount` |  | engine | specPanelBuffs, yixuan | composables/liveInteractions.ts, composables/resourceCalc/helpers.ts, specs/resources.ts, specs/types.ts …+2 |
| `assaultOrderCount` |  | engine | specPanelBuffs | composables/resourceCalc/helpers.ts, stores/config.ts |
| `dodgeCounterMoveId` |  | engine | claret | composables/resourceCalc/helpers.ts, core/resource/rowBuild.ts |
| `dodgeCounterActionTime` |  | engine | qingyi, starlightBilly | composables/resourceCalc/helpers.ts, core/resource/helpers.ts, core/resource/rowBuild.ts |
| `dodgeCounterDecibelRecovery` |  | engine | starlightBilly | composables/resourceCalc/helpers.ts, core/resource/rowBuild.ts |
| `dodgeCounterComboAlignRatio` |  | engine |  | composables/resourceCalc/helpers.ts, core/resource/helpers.ts, core/resource/rowBuild.ts |
| `defensiveAssistMoveId` |  | engine | claret, seth | composables/resourceCalc/convergence.ts, composables/resourceCalc/helpers.ts, core/resource/rowBuild.ts |
| `defensiveAssistActionTime` |  | engine |  | composables/resourceCalc/convergence.ts, composables/resourceCalc/helpers.ts, core/resource/helpers.ts, core/resource/rowBuild.ts |
| `defensiveAssistDecibelRecovery` |  | engine |  | composables/resourceCalc/helpers.ts, core/resource/rowBuild.ts |
| `defensiveAssistComboAlignRatio` |  | engine |  | composables/resourceCalc/helpers.ts, core/resource/helpers.ts, core/resource/rowBuild.ts |
| `assistFollowUpMoveId` |  | engine | claret, luciaElowen, orphie, remielle, specPanelBuffs, yuzuha | composables/resourceCalc/convergence.ts, composables/resourceCalc/helpers.ts, core/resource/rowBuild.ts |
| `assistFollowUpActionTime` |  | engine | qingyi | composables/resourceCalc/convergence.ts, composables/resourceCalc/helpers.ts, core/resource/helpers.ts, core/resource/rowBuild.ts |
| `assistFollowUpDecibelRecovery` |  | engine |  | composables/resourceCalc/helpers.ts, core/resource/rowBuild.ts |
| `assistFollowUpComboAlignRatio` |  | engine |  | composables/resourceCalc/helpers.ts, core/resource/helpers.ts, core/resource/rowBuild.ts |
| `counterAssistMoveId` | ? | engine | claret | composables/resourceCalc/helpers.ts, core/resource/rowBuild.ts |
| `counterAssistActionTime` | ? | engine |  | composables/resourceCalc/helpers.ts, core/resource/helpers.ts, core/resource/rowBuild.ts |
| `counterAssistDecibelRecovery` | ? | engine |  | composables/resourceCalc/helpers.ts, core/resource/rowBuild.ts |
| `counterAssistComboAlignRatio` | ? | engine |  | composables/resourceCalc/helpers.ts, core/resource/helpers.ts, core/resource/rowBuild.ts |
| `counterAssistCount` | ? | engine | claret | composables/resourceCalc/helpers.ts, core/resource/helpers.ts, core/resource/rowBuild.ts |
| `backstageRegenBonus` |  | engine |  | composables/resourceCalc/helpers.ts, core/resource/resourceIncome.ts |
| `comboAlignRegenBonus` |  | engine |  | composables/resourceCalc/helpers.ts, core/resource/resourceIncome.ts |
| `zhenyuanTriggerCount` | ? | engine |  | composables/resourceCalc/helpers.ts, core/resource/resourceIncome.ts |
| `cannonRotorDamageMultiplier` | ? | engine |  | composables/resourceCalc/helpers.ts, core/resource/rowBuild.ts |
| `cannonRotorCooldownSeconds` | ? | engine |  | composables/resourceCalc/helpers.ts, core/resource/rowBuild.ts |
| `aliceTeamAssaultCount` | ? | engine | alice | mechanics/types.ts |
| `aliceDisorderCount` | ? | engine | alice | mechanics/types.ts |
| `skipGenericExSpecial` | ? | engine | banyue, ben, burnice, claret, grace, liuyin, luciaElowen, lycaon, norma, roxy, starlightBilly, yixuan | composables/resourceCalc/helpers.ts, core/resource/rowBuild.ts |
| `exSpecialCountFractional` | ? | engine | burnice | composables/resourceCalc/helpers.ts, core/resource/helpers.ts |
| `mechanicRowValues` | ? | engine | burnice, roxy | specs/mechanics.ts |
| `initialEnergyGift` |  | engine | aire, anby, corin, ellen, grace, liuyin, nicole, panYinhu, phoenix, piper, qianxia, roxy, soldier11, soukaku, starlightBilly, yidhari, yixuan, yuzuha, zhuYuan | composables/resourceCalc/helpers.ts, core/resource/resourceIncome.ts |
| `initialDecibelGift` |  | engine | aire, alice, evelyn, phoenix, specPanelBuffs, yaojiayin, yeshuguang, zhao | composables/resourceCalc/helpers.ts, core/resource.ts, core/resource/helpers.ts, core/resource/resourceIncome.ts |
| `extraSelfDecibelReward` |  | engine | orphie, promia, remielle, specPanelBuffs | composables/resourceCalc/helpers.ts, core/resource.ts, core/resource/helpers.ts, core/resource/resourceIncome.ts |
| `extraSelfDecibelPerUltimate` | ? | engine | specPanelBuffs | core/resource.ts, core/resource/helpers.ts, core/resource/resourceIncome.ts |
| `ultimateEquivalentCount` | ? | engine | yixuan | core/resource.ts, core/resource/helpers.ts, core/resource/resourceIncome.ts |
| `exContinuous` | ? | engine | yidhari | core/resource.ts, core/resource/helpers.ts |
| `exFinalize` | ? | engine | yidhari | core/resource/helpers.ts, core/resource/resourceIncome.ts |
| `exRefundPerPaid` | ? | engine | yidhari | core/resource/helpers.ts, core/resource/resourceIncome.ts |
| `exReservedCount` | ? | engine | yidhari | core/resource/helpers.ts, core/resource/resourceIncome.ts |
| `exReservedEnergyCost` | ? | engine | yidhari | core/resource/helpers.ts, core/resource/resourceIncome.ts |
| `exRefundFreeCap` | ? | engine | yidhari | core/resource/resourceIncome.ts |
| `healPctPerCurtainProviderUlt` | ? | agents-shared | luciaElowen, yidhari |  |
| `decibelPerCurtainTrigger` | ? | engine | luciaElowen | core/resource/assembleSlot.ts, core/resource/helpers.ts |
| `decibelShareRatio` |  | engine |  | composables/resourceCalc/helpers.ts, core/resource/assembleSlot.ts, core/resource/helpers.ts |
| `supportUltimateEnergyRegen` |  | engine | yuzuha | composables/resourceCalc/helpers.ts, core/resource/crossAgentEnergy.ts, core/resource/resourceIncome.ts |
| `timeWeight` |  | engine | luciaElowen | composables/resourceCalc/helpers.ts, core/resource.ts, core/resource/helpers.ts |
| `timeBudgetExcess` | ? | engine | yeshuguang | core/resource.ts, core/resource/foldLoop.ts, core/resource/helpers.ts, core/resource/truncationRefold.ts |
| `timePressureSeconds` | ? | engine | yeshuguang | core/resource/foldLoop.ts |
| `rowTimeLimit` | ? | engine |  | core/resource/resourceIncome.ts, core/resource/rowBuild.ts, core/resource/truncationRefold.ts |
| `tauntCancelCount` | ? | engine | banyue | composables/liveInteractions.ts, composables/resourceCalc/helpers.ts, composables/teamCompare.ts, stores/config.ts …+1 |
| `resourceUtilization` | ? | engine |  | components/AppHeader.vue, composables/resourceCalc/helpers.ts, core/resource/rowAccounting.ts, stores/config.ts …+1 |
| `teamUltimateFlashBonus` | ? | engine | yixuan | core/resource/crossAgentEnergy.ts |
| `crossAgentFlatEnergyBySource` | ? | engine | lighter | core/resource/crossAgentEnergy.ts |
| `teamStunCoverage` | ? | engine | nekomata, norma, starlightBilly | composables/resourceCalc/convergence.ts |
| `axisActionCounts` | ? | engine | nekomata | composables/resourceCalc/convergence.ts |
| `axisUltimateTotal` | ? | engine | xixifu | composables/resourceCalc/convergence.ts |
| `teamVeilCountTotal` | ? | engine | aire, qianxia, yeshuguang | composables/resourceCalc/convergence.ts, composables/resourceCalc/outerCycle.ts, composables/resourceCalc/roundThreads.ts |
| `yixuanInk2Count` | ? | engine | yixuan | stores/config.ts |
| `yixuanInk3Count` | ? | engine | yixuan | stores/config.ts |
| `yixuanPerfectBlockCount` | ? | engine | yixuan | composables/liveInteractions.ts, stores/config.ts |
| `yixuanExtremeAssistCount` | ? | engine | yixuan | stores/config.ts |
| `yixuanBackstageComboCount` | ? | engine | yixuan | stores/config.ts |
| `axisInSeconds` | ? | engine | nekomata, yixuan | composables/resourceCalc/convergence.ts |
| `battleTime` | ? | engine | aire, billy, caesar, corin, evelyn, liuyin, nangong, nekomata, nicole, norma, phoenix, piper, promia, qianxia, qingyi, soldier11, trigger, vivian, xixifu, yeshuguang, yixuan | components/charts/TimeChartsControls.vue, composables/difficultyRatio.ts, composables/resourceCalc/helpers.ts, composables/resourceCalc/roundInputs.ts …+14 |
| `invincibleTime` | ? | engine | lycaon | components/BossCard.vue, composables/difficultyRatio.ts, composables/resourceCalc/helpers.ts, composables/resourceCalc/roundInputs.ts …+17 |
| `bodySize` | ? | engine | ellen, soukaku | composables/bossRoom.ts, composables/resourceCalc/helpers.ts, stores/config.ts, types/bossPreset.ts …+1 |
| `blockCount` | ? | engine | banyue, starlightBilly | composables/agentMechanicView.ts, composables/liveInteractions.ts, composables/resourceCalc/convergence.ts, composables/resourceCalc/feasibilitySearch.ts …+10 |
| `dualCounterCount` | ? | engine | banyue | composables/agentMechanicView.ts, composables/liveInteractions.ts, composables/resourceCalc/convergence.ts, composables/resourceCalc/feasibilitySearch.ts …+9 |
