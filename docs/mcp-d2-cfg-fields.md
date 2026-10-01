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

## 3. r389 留下的 14 个候选——逐个判定（r390）

| 字段 | 判定 | 依据 |
|---|---|---|
| `chainCountTotalExtra` | 保留（通用契约） | 模块写、`core/resource.ts` 按通用口径加到连携总数；名字不带角色 |
| `exRefundFreeCap` | 保留 | 「连续强特通道」通用字段族（引擎只认字段、不认 agentId） |
| `timePressureSeconds` | 保留 | 引擎写、需要退化的模块读——引擎→模块的通用信号 |
| `crossAgentFlatEnergyBySource` | 保留 | 多提供者跨角色定额能量通道（CC-32b 已泛化） |
| `axisActionCounts` / `axisUltimateTotal` | 保留 | 编排层通用注入（轴内执行计数） |
| `teamUltimateFlashBonus` | 保留，**不改名** | 机制是通用的「队友终结技 × 每次回能」，模块声明量；Flash 只是仪玄能量的叫法。为改名而改名 = 用户不要的空改动 |
| `aliceTeamAssaultCount` / `aliceDisorderCount` | **已迁**（CC-360） | `mechanics/types.ts` 那一处是 `ModuleFeedback` 里的**同名键**，不是对 cfg 字段的引用 ⇒ 判据补「`name?:` 可选声明行不算引用」 |
| `promiaNiyingCount` + 仪玄 4 项 | 保留 | `stores/config.ts` 的 `CharacterConfig` 同名字段 + `defaultCharacter` 字面量；cfg 同名字段由模块 `buildCharConfig` 从 char 拷入，正常 |

结论：剩下的公共 cfg 字段都是引擎契约。**D2 在 cfg 接口上的类型层工作到此为止。**

## 4. CC-360：同一规则推广到另外三处（r390，`859cae1e`）

规则不变：**只有一个角色模块用到的东西，声明随模块走；跨模块 / 跨层的留在公共处**。

- `ModuleFeedback`（`mechanics/types.ts`，跨轮反馈键）：16 键里 14 个是「本模块自产、下一轮本模块读回」⇒ 迁到 10 个模块的扩充块；
  公共接口只剩 `teamUltimateExtra` / `consumedTeamEnergy`，**这张表现在就是「角色↔编排层」反馈耦合的完整清单**（接口头注释已改）。
- `CharacterResourceResult`（`types/resource/agentResources.ts`）：17 个「挂在结果上的角色专属数据」字段（`aliceSwordWillSource` 等）
  只被各自模块写、再由模块自己产展示行读（视图不直接读）⇒ 迁到 17 个模块。
- **整份角色结果类型**：`agentResources.ts` 里 17 份 interface（`AliceSwordWillSource` / `NormaMechanicSource` / `YixuanExChain` …）
  各自只被一个模块引用 ⇒ 整份迁到模块末尾（保留 `export`），文件 722 → 251 行。留下的 `BurniceMechanicSource` / `BanyueRageCycle`
  仍被公共结果接口的持有字段引用（展示契约）、`CorrosionSource` 被异常池引擎用，属正常。
- 工具：`scripts/d2-migrate-private-cfg.py --target cfg|feedback|result|all`（成员级），`scripts/d2-migrate-agent-types.py`（整份类型）。
  锁 `src/types/__tests__/privateCfgFields.test.ts` 4 条（3 个目标接口 + 整份类型），迁移前源码上全红（已反证）。
- 验证：vue-tsc 净、产物 `diff -r` 逐字节相同、zd 0/0、全量 4158 例过。回滚 `git revert 859cae1e`（纯类型，无数值影响）。

## 5. 下一步

**D2 剩下的真痛点 = 编译期查不出的拼写错误**：角色模块里 `cfg as unknown as Record<string, unknown>` 共 228 处
（yeshuguang 14 / banyue 11 / starlightBilly 10 / sigrid 9 / phoenix 8 / lucy 8 / yixuan 7 / yidhari 7 …），经 `record.<键>` 读写**未声明**的键，
拼错键名 = 静默读到 `undefined`（守卫 25「无类型记录键死读」只抓「全仓零写入」的键，抓不到「写 A 读 A'」）。
现在每个模块都有自己的 `declare module` 扩充块，可以逐模块把 `record.<键>` 用到的键补成声明、把访问改回 `cfg.<键>`。
- 试点建议：`mechanics/agents/yixuan.ts`（`record.` 访问 36 处、cast 7 处，字段语义集中）。
- 步骤：① `grep -o "record\.[a-zA-Z]*" <模块> | sort | uniq -c` 列键；② 每个键查是否已声明（公共接口或本模块扩充块），没有就在扩充块里加（类型看写入点）；
  ③ 把 `record.<键>` 改回 `cfg.<键>`，删掉不再需要的 cast；④ vue-tsc + `vite build` 产物 `diff -r`（应逐字节相同；`Number(record.x ?? 0)` 之类的运行时包装**不要动**）。
- **判据**：值得做的标准是「这个模块的状态键全部有类型、拼错会编译失败」，不是「cast 计数下降」。若某模块的 record 访问是按动态键（`record[field]`）的通用逻辑，保留，记理由。

## 6. 字段矩阵（`python3 scripts/d2-cfg-field-matrix.py . --md <out>` 可重生成）

分类：private = 只有 1 个角色模块引用（可迁模块私有）；agents-shared = 只在多个角色模块间；engine = 引擎/机制公共层/视图也引用；dead = 声明后无人引用。

| 分类 | 字段数 |
|---|---|
| engine | 103 |
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
| `basicBenchmarkMoveId` | ? | engine |  | composables/resourceCalc/helpers.ts, composables/resourceCalc/skillRows.ts, core/resource/rowBuild.ts |
| `exSpecialMoveId` |  | engine | claret, ellen, koleda, luciaElowen, phoenix, severian, sigrid, yidhari | composables/resourceCalc/helpers.ts, core/resource/assembleSlot.ts, core/resource/rowBuild.ts, types/resource/agentResources.ts |
| `promiaNiyingCount` | ? | engine | promia | stores/config.ts |
| `freeExSpecialCount` | ? | engine | nangong | core/resource/helpers.ts, core/resource/rowBuild.ts |
| `parryTimeFreeCount` | ? | engine |  | composables/resourceCalc/convergence.ts, core/resource/rowBuild.ts |
| `exSpecialCostType` | ? | engine |  | composables/resourceCalc/helpers.ts, core/resource/helpers.ts |
| `exSpecialResourcePaidCount` | ? | engine |  | core/resource/helpers.ts |
| `extraExPlans` | ? | engine |  | composables/resourceCalc/helpers.ts, core/resource/rowBuild.ts |
| `inStunWindowTriggers` | ? | engine | nangong | composables/resourceCalc/convergence.ts, composables/resourceCalc/outerCycle.ts, composables/resourceCalc/roundThreads.ts |
| `exSpecialEnergyConsume` |  | engine | ben, burnice, lighter, liuyin, lycaon, norma, phoenix, pulchra, roxy, severian, sigrid, soukaku, starlightBilly, xide, yanagi, yaojiayin, yidhari, yixuan | components/ResourceResultCard.vue, composables/resourceCalc/helpers.ts, core/resource/assembleSlot.ts, core/resource/helpers.ts …+4 |
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
| `chainCountPerStun` |  | engine | anby, corin, liuyin, lycaon, sigrid, specPanelBuffs, yaojiayin | components/ResourceResultCard.vue, composables/resourceCalc/convergence.ts, composables/resourceCalc/helpers.ts, composables/resourceCalc/ultimatePromote.ts …+10 |
| `chainCountTotalOverride` | ? | engine | anby, claret, corin, liuyin, sigrid, soldier11, specPanelBuffs | composables/resourceCalc/convergence.ts, core/resource.ts, core/resource/helpers.ts |
| `chainCountTotalExtra` | ? | engine | yuzuha | core/resource.ts |
| `exSpecialComboAlignRatio` |  | engine | lycaon, phoenix, severian, sigrid, soldier11, soukaku | composables/resourceCalc/helpers.ts, core/resource/rowAccounting.ts, core/resource/rowBuild.ts |
| `ultimateComboAlignRatio` |  | engine | specPanelBuffs | composables/resourceCalc/helpers.ts, core/resource/helpers.ts, core/resource/rowBuild.ts |
| `parryCount` |  | engine | banyue, claret, corin, pulchra, qingyi, roxy, sigrid, specPanelBuffs, starlightBilly, trigger, vivian, yaojiayin, yixuan, yuzuha, zhendou, zhuYuan | composables/difficultyDescent.ts, composables/difficultyLadder.ts, composables/liveInteractions.ts, composables/resourceCalc/convergence.ts …+16 |
| `parryNoFollowUpCount` |  | engine | claret | composables/resourceCalc/convergence.ts, composables/resourceCalc/helpers.ts, core/resource/helpers.ts, core/resource/rowBuild.ts |
| `parryDecibelOnlyCount` |  | engine |  | composables/resourceCalc/convergence.ts, composables/resourceCalc/helpers.ts |
| `dodgeCounterCount` |  | engine | anby, banyue, claret, lycaon, qingyi, roxy, severian, sigrid, starlightBilly, yeshuguang, yixuan | composables/liveInteractions.ts, composables/resourceCalc/convergence.ts, composables/resourceCalc/feasibilitySearch.ts, composables/resourceCalc/helpers.ts …+12 |
| `quickAssistCount` |  | engine | corin, qingyi, starlightBilly, yaojiayin | composables/liveInteractions.ts, composables/resourceCalc/convergence.ts, composables/resourceCalc/helpers.ts, composables/teamCompare.ts …+9 |
| `perfectBlockCount` |  | engine | specPanelBuffs, yixuan | composables/liveInteractions.ts, composables/resourceCalc/helpers.ts, specs/resources.ts, specs/types.ts …+1 |
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
| `invincibleTime` | ? | engine | lycaon | components/BossCard.vue, composables/difficultyRatio.ts, composables/resourceCalc/helpers.ts, composables/resourceCalc/roundInputs.ts …+16 |
| `bodySize` | ? | engine | ellen, soukaku | composables/bossRoom.ts, composables/resourceCalc/helpers.ts, stores/config.ts, views/AttributeConfigPage.vue |
| `blockCount` | ? | engine | banyue, starlightBilly | composables/agentMechanicView.ts, composables/liveInteractions.ts, composables/resourceCalc/convergence.ts, composables/resourceCalc/feasibilitySearch.ts …+10 |
| `dualCounterCount` | ? | engine | banyue | composables/agentMechanicView.ts, composables/liveInteractions.ts, composables/resourceCalc/convergence.ts, composables/resourceCalc/feasibilitySearch.ts …+9 |
