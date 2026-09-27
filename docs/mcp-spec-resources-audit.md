# spec resources / events 与手写模块对账（全景 §6.4，CC-120，第 147 轮）

> 用途：以后动这 10 个角色的模块或 spec 时，先查本表有没有分叉。本文只描述，不作为运行时依据。

## 1. 结论

- **这 10 份 spec 的 `resources`（1121、1171、1261、1281、1291、1411、1471、1511、1571、1581）和 3 份 spec 的 `events`（1081、1331、1471）不参与任何计算**，只进 `MechanicsTablePage` 和逻辑编辑器（`src/logicEditor/defaults.ts`）展示。真实行为全部在手写模块里。
- 所以全景 §6.4 说的「重复」，风险只在**展示口径与引擎分叉**，不影响伤害。
- **决定：不把模块迁到从 spec resources 读常数**（与 R6 C7 attributeConversions 归一不同）。依据：
  1. spec resources 是「状态机描述」（countSource、gain/spend 规则），而模块大多按覆盖率滑块或恒满建模（见 §3「模块中找不到对应」34 条）。两者结构不同，强行对接要么改模块模型（改数值），要么在 spec 里造只为对接的字段；
  2. 81 条可对照的数值里 81 条一致，只有 1 条确实是错；
  3. R6 硬约束：禁止只为降计数的改动。
- **做**：修掉唯一确认的错（1581 `luminizeMasteryRatio` 0.1 → 0.2），并加单测把它钉住（`src/mechanics/__tests__/remielle.test.ts`「CC-120」例）。
- **回退点**：1581.json 改回 0.1、删单测；数值不受影响（resources 不被执行）。

## 2. 怎么证明「不参与计算」（可复跑）

- **变异法**：临时把目标 spec 某键下的所有数值改为 `v × 1.37 + 1`（脚本 `/home/kaua/calc-arch/mut147.py <ids,逗号分隔> [键名，默认 resources]`，不在仓库），跑 `bash .zc/perf/zd.sh <tag>`，看 DUMP / ROWS 是否为 DIFF 0；结束后执行 `git checkout -- src/specs/agents/` 恢复。
  - 10 份 resources：DIFF 0；3 份 events：DIFF 0。
  - **阳性对照**：对确实调用 `computeSpecResources` 的 1091 星见雅做同样变异，DUMP DIFF 30，说明方法能检出差异。
- **预设覆盖盲区**：1121 本、1281 派派、1291 雨果、1081 比利不在任何预设里，zd 看不到。补跑定向探针（`.zc/perf/res147probe.perf.ts` 写法：`setupHarness(ids.map(agentId => ({ agentId })), { recommendedBuild: true })`，三槽 0 命 / 6 命，打印 teamTotalDamage 与 resourceResult 哈希；`TEAMS=1121-1281-1291,...` 环境变量选队），变异前后输出逐字一致。
  - 注意：`setupHarness` 收到裸字符串 id 会直接抛错，必须传对象。

## 3. 4 条「不一致」的复核结论（lead 逐条读源码）

| id | 字段 | spec | 模块 | 结论 |
|---|---|---|---|---|
| 1581 | `remielle_voidflare.properties.luminizeMasteryRatio` | 0.1 | `remielle.ts` `LUMINIZE_MULTIPLIER_PER_AP = 0.2` | **spec 错，已改为 0.2**。模块 @fact 有四源核对（原文、nanoka、账本 Q10、catalog 公式 x*0.2），0.1 是旧的转写错误；伤害管线一直走 catalog 公式 0.2 |
| 1581 | `remielle_voidflare.initialValue` | 0 | `VOIDFLARE_INITIAL = 3` | **语义不同，不改**。spec 描述开局 0 个；模块展示的是稳态满储存（资源卡「最多储存 3 个」） |
| 1471 | `banyue_fury.initialValue` | 0 | `INITIAL_FURY = 115` | **语义不同，不改**。115 是用户确认的操作假设（开局场外烧血攒到 115，不满 120 避免自动入怒相）；spec 描述游戏开局 |
| 1471 | `banyue_fury_from_block.amountPerCount` | 4 | `FURY_BLOCK = 6`（另有 `FURY_PARRY = 4`） | **✅ 第 149 轮已结（CC-122）：模块正确，spec 已订正为 `blockCount × 6`**。catalog 原文：「通过[闪避：不动如山]成功招架敌人攻击时，回复4点[嗔火]，若触发完美格挡，则改为回复6点[嗔火]，每1秒最多触发一次」；模块的 blockCount 就是金身弹刀（完美格挡）次数，普通弹刀走 parryCount × 4。以下为原判：**未决，不改**。spec 把普通格挡 4 / 完美格挡 6 合并为平均 4（自注「猜测·中」）；模块拆开，金身弹刀（完美格挡）按 6。没有证据说明哪边错；要改需先查原文或实测 |

## 4. 原始对照表（dsh 子代理只读盘点，第 147 轮，模块行号基于 d2b270c）

判定口径：一致 / 不一致 / 模块中找不到对应（括号内是模块的实际处理方式）。「不一致」4 条以 §3 为准。

| id | resource.id | 字段 | spec 值 | 模块出处(文件:行号) | 模块值 | 判定 |
|---|---|---|---|---|---|---|
| 1121 | ben_guard_shield | initialValue | 0 | — | — | 模块中找不到对应（模块不建护盾资源；仅按 exSpecialCount 生成强特连招行） |
| 1121 | ben_guard_shield | maxValue | 1 | — | — | 模块中找不到对应（护盾吸收量不进伤害，未建模） |
| 1121 | ben_guard_shield | gainRules[ben_ex_shield_gain].amountPerCount | 1 | src/mechanics/agents/ben.ts:130 | comboCount=floor(state.exSpecialCount) | 模块中找不到对应（模块只生成强特连招执行行，不记录护盾层数） |
| 1121 | ben_guard_shield | properties.shieldBase | 550 | — | — | 模块中找不到对应（仅注释 ben.ts:6；无护盾吸收量建模） |
| 1121 | ben_guard_shield | properties.shieldDefPct | 30 | — | — | 模块中找不到对应（仅注释 ben.ts:6；无护盾吸收量建模） |
| 1121 | ben_guard_shield | properties.shieldCritRateBonus | 16 | — | — | 模块中找不到对应（由 catalog teammate-buffs.json `ben_additional_shield_crit_rate`=16 承载，非模块） |
| 1171 | burnice_ignition | initialValue | 100 | src/mechanics/agents/burnice.ts:22 | 100 | 一致 |
| 1171 | burnice_ignition | maxValue | null | src/mechanics/agents/burnice.ts:24 | Infinity | 一致 |
| 1171 | burnice_ignition | gainRules[ignition_from_energy].amountPerCount | 1.4 | src/mechanics/agents/burnice.ts:25 | 1.4 | 一致 |
| 1171 | burnice_ignition | gainRules[ignition_from_ultimate].amountPerCount | 50 | src/mechanics/agents/burnice.ts:26 | 50 | 一致 |
| 1171 | burnice_ignition | spendRules[ignition_ember].cost | 8 | src/mechanics/agents/burnice.ts:28 | 8 | 一致 |
| 1171 | burnice_ignition | properties.threshold | 50 | src/mechanics/agents/burnice.ts:27 | 50 | 一致 |
| 1171 | burnice_ignition | properties.emberDamageRatio | 350 | src/mechanics/agents/burnice.ts:30 | 3.5（×100=350） | 一致 |
| 1171 | burnice_ignition | properties.emberBuildUp | 60 | src/mechanics/agents/burnice.ts:32 | 60 | 一致 |
| 1171 | burnice_ignition | properties.emberDamageRatioC1Bonus | 100 | src/mechanics/agents/burnice.ts:31 | 1（×100=100） | 一致 |
| 1171 | burnice_ignition | properties.emberBuildUpEfficiencyC1BonusPct | 25 | src/mechanics/agents/burnice.ts:33 | 25 | 一致 |
| 1171 | burnice_ignition | properties.emberCooldownSeconds | 1.5 | src/mechanics/agents/burnice.ts:29 | 1.5 | 一致 |
| 1171 | burnice_ignition | properties.cinema1InitialIgnitionBonus | 40 | src/mechanics/agents/burnice.ts:23 | 40 | 一致 |
| 1171 | burnice_ignition | properties.cinema2TeamPenRatio | 20 | src/mechanics/agents/burnice.ts:34 | 20 | 一致 |
| 1171 | burnice_ignition | properties.cinema4CritRateBonus | 30 | src/mechanics/agents/burnice.ts:35 | 30 | 一致 |
| 1171 | burnice_ignition | properties.cinema4DoubleSprayExtraSeconds | 1 | src/mechanics/agents/burnice.ts:36 | 1 | 一致 |
| 1171 | burnice_ignition | properties.cinema6SpecialEmberRatio | 60 | src/mechanics/agents/burnice.ts:37 | 0.6（×100=60） | 一致 |
| 1171 | burnice_ignition | properties.cinema6SpecialEmberCooldownSeconds | 0.5 | src/mechanics/agents/burnice.ts:38 | 0.5 | 一致 |
| 1171 | burnice_ignition | properties.cinema6FireResIgnore | 25 | src/mechanics/agents/burnice.ts:39 | 25 | 一致 |
| 1171 | burnice_ignition | properties.burnBaseMultiplier | 50 | src/mechanics/agents/burnice.ts:40 | 50 | 一致 |
| 1171 | burnice_ignition | properties.cinema6BurnBurstMultiplier | 1800 | src/mechanics/agents/burnice.ts:41 | 1800 | 一致 |
| 1171 | burnice_ignition | properties.cinema6BurnBurstDamageRatio | 900 | src/mechanics/agents/burnice.ts:194 | 50×1800/100=900 | 一致 |
| 1171 | burnice_ignition | properties.cinema6BurnBurstCooldownSeconds | 20 | src/mechanics/agents/burnice.ts:42 | 20 | 一致 |
| 1171 | burnice_flow_fire | initialValue | 0 | src/mechanics/agents/burnice.ts:204 | flowCountRaw 由余烬计数起算（无初始项） | 一致 |
| 1171 | burnice_flow_fire | maxValue | null | — | 无上限 | 一致 |
| 1171 | burnice_flow_fire | gainRules[flow_count_ember].amountPerCount | 1 | src/mechanics/agents/burnice.ts:204 | emberTriggerCount×1 | 一致 |
| 1171 | burnice_flow_fire | gainRules[flow_count_stirring].amountPerCount | 2 | src/mechanics/agents/burnice.ts:45 | 2 | 一致 |
| 1171 | burnice_flow_fire | spendRules[flow_fire_tossing].cost | 1 | src/mechanics/agents/burnice.ts:206-207 | flowFireCount→tossingCount 1:1 | 一致 |
| 1171 | burnice_flow_fire | properties.threshold | 12 | src/mechanics/agents/burnice.ts:44 | 12 | 一致 |
| 1171 | burnice_flow_fire | properties.releaseMultiplier | 300 | src/mechanics/agents/burnice.ts:51 | 300 | 一致 |
| 1261 | jane_bite | initialValue | 0 | — | — | 模块中找不到对应（不建啮咬状态资源） |
| 1261 | jane_bite | maxValue | null | — | — | 模块中找不到对应（不建啮咬状态资源） |
| 1261 | jane_bite | gainRules[bite_on_hit].amount | 1 | — | — | 模块中找不到对应（啮咬按默认满覆盖近似，无逐次施加计数） |
| 1261 | jane_bite | properties.durationSeconds | 10 | — | — | 模块中找不到对应（仅注释 jane.ts:90；无持续秒数常数，biteSeconds=frontlineTime） |
| 1261 | jane_frenzy | initialValue | 0 | — | — | 模块中找不到对应（狂热按布尔/覆盖率，不建层数） |
| 1261 | jane_frenzy | maxValue | null | — | — | 模块中找不到对应（狂热按布尔/覆盖率，不建层数） |
| 1261 | jane_frenzy | gainRules[frenzy_from_assault].amount | 1 | — | — | 模块中找不到对应（狂热按布尔/覆盖率，不建层数） |
| 1261 | jane_frenzy | properties.assaultCritBase | 20 | src/mechanics/agents/jane.ts:24 | 20 | 一致 |
| 1261 | jane_frenzy | properties.assaultCritPerMastery | 0.1 | src/mechanics/agents/jane.ts:25 | 0.1 | 一致 |
| 1281 | piper_momentum | initialValue | 0 | — | — | 模块中找不到对应（动力按恒满处理，不建初始值） |
| 1281 | piper_momentum | maxValue | 20 | src/mechanics/agents/piper.ts:77 | C0=20（C1=30） | 一致 |
| 1281 | piper_momentum | gainRules[piper_ex_momentum_gain].amountPerCount | 5 | — | — | 模块中找不到对应（用户口径：动力恒满，旋转命中次数不建模） |
| 1281 | piper_momentum | gainRules[piper_ult_momentum_gain].amountPerCount | 8 | — | — | 模块中找不到对应（用户口径：动力恒满，旋转命中次数不建模） |
| 1281 | piper_momentum | properties.physicalBuildupEfficiencyPerStack | 4 | src/mechanics/agents/piper.ts:126 | ×4 | 一致 |
| 1281 | piper_momentum | properties.teamDmgBonusAt20Stacks | 18 | — | — | 模块中找不到对应（由 spec teamBuffs `piper_extra_team_damage`=18 经 catalog 承载；门控 panelPhases.ts:420） |
| 1291 | hugo_abyss_echo | initialValue | 0 | — | — | 模块中找不到对应（不建回响层数） |
| 1291 | hugo_abyss_echo | maxValue | 1 | — | — | 模块中找不到对应（改用 echoCoverage 覆盖率） |
| 1291 | hugo_abyss_echo | gainRules[hugo_chain_echo_gain].amountPerCount | 1 | — | — | 模块中找不到对应（改用 echoCoverage 覆盖率） |
| 1291 | hugo_abyss_echo | gainRules[hugo_stun_echo_gain].amountPerCount | 1 | — | — | 模块中找不到对应（改用 echoCoverage 覆盖率） |
| 1291 | hugo_abyss_echo | properties.durationSeconds | 6 | — | — | 模块中找不到对应（仅注释 hugo.ts:150；无 6s 常数，用覆盖率滑块） |
| 1291 | hugo_abyss_echo | properties.critRateBonus | 12 | src/mechanics/agents/hugo.ts:65 | 12 | 一致 |
| 1291 | hugo_abyss_echo | properties.critDmgBonus | 25 | src/mechanics/agents/hugo.ts:66 | 25 | 一致 |
| 1411 | yuzuha_sweetness | initialValue | 3 | src/mechanics/agents/yuzuha.ts:13 | 3 | 一致 |
| 1411 | yuzuha_sweetness | maxValue | 6 | src/mechanics/agents/yuzuha.ts:14 | 6 | 一致 |
| 1411 | yuzuha_sweetness | gainRules[sweetness_from_chain_entry].amount | 1 | src/mechanics/agents/yuzuha.ts:65 | chainEntryCount×1 | 一致 |
| 1411 | yuzuha_sweetness | spendRules[sweetness_hard_candy].cost | 1 | src/mechanics/agents/yuzuha.ts:74 | 每次硬糖消耗 1（sweetnessBudget 钳制） | 一致 |
| 1411 | yuzuha_sweetness | properties.initial | 3 | src/mechanics/agents/yuzuha.ts:13 | 3 | 一致 |
| 1411 | yuzuha_sweetness | properties.max | 6 | src/mechanics/agents/yuzuha.ts:14 | 6 | 一致 |
| 1471 | banyue_fury | initialValue | 0 | src/mechanics/agents/banyue.ts:75 | 115 | 不一致 |
| 1471 | banyue_fury | maxValue | 150 | — | — | 模块中找不到对应（嗔火无 150 上限常数，furyCap 未消费） |
| 1471 | banyue_fury | gainRules[banyue_fury_from_flash_energy].amountPerCount | 0.5 | src/mechanics/agents/banyue.ts:81 | 0.5 | 一致 |
| 1471 | banyue_fury | gainRules[banyue_fury_from_parry].amountPerCount | 4 | src/mechanics/agents/banyue.ts:78 | 4 | 一致 |
| 1471 | banyue_fury | gainRules[banyue_fury_from_block].amountPerCount | 4 | src/mechanics/agents/banyue.ts:79 | 6 | 不一致 |
| 1471 | banyue_fury | gainRules[banyue_fury_from_dodge].amountPerCount | 4 | src/mechanics/agents/banyue.ts:77 | 4 | 一致 |
| 1471 | banyue_fury | spendRules[banyue_fury_enter_rage].cost | 120 | src/mechanics/agents/banyue.ts:76 | 120 | 一致 |
| 1471 | banyue_fury | properties.rageEnterThreshold | 120 | src/mechanics/agents/banyue.ts:76 | 120 | 一致 |
| 1471 | banyue_fury | properties.furyCap | 150 | — | — | 模块中找不到对应（嗔火无上限常数） |
| 1471 | banyue_mountain_sway | initialValue | 0 | — | — | 模块中找不到对应（山威由 rage×RAGE_SWAY 派生，无初始项） |
| 1471 | banyue_mountain_sway | maxValue | 4 | src/mechanics/agents/banyue.ts:82 | 4 | 一致 |
| 1471 | banyue_mountain_sway | gainRules[banyue_mountain_sway_from_rage].amountPerCount | 4 | src/mechanics/agents/banyue.ts:82 | 4 | 一致 |
| 1471 | banyue_mountain_sway | spendRules[banyue_mountain_sway_spend_ex].cost | 1 | src/mechanics/agents/banyue.ts:270-276 | swayExCount=rage×4（每次免费强特消耗 1 山威，隐含） | 一致 |
| 1471 | banyue_mountain_sway | properties.flashRefundPerSway | 10 | src/mechanics/agents/banyue.ts:83 | 10 | 一致 |
| 1511 | nangong_beat | initialValue | 30 | src/mechanics/agents/nangong.ts:46 | 30 | 一致 |
| 1511 | nangong_beat | maxValue | 100 | src/mechanics/agents/nangong.ts:47 | 100 | 一致 |
| 1511 | nangong_beat | gainRules[beat_regen_per_second].amountPerCount | 3.8 | src/mechanics/agents/nangong.ts:48 | 3.8 | 一致 |
| 1511 | nangong_beat | gainRules[beat_from_anomaly].amount | 12 | src/mechanics/agents/nangong.ts:49 | 12 | 一致 |
| 1511 | nangong_beat | properties.initial | 30 | src/mechanics/agents/nangong.ts:46 | 30 | 一致 |
| 1511 | nangong_beat | properties.max | 100 | src/mechanics/agents/nangong.ts:47 | 100 | 一致 |
| 1511 | nangong_vibrato | initialValue | 0 | — | — | 模块中找不到对应（层数按滑块/系统触发近似） |
| 1511 | nangong_vibrato | maxValue | 4 | src/mechanics/agents/nangong.ts:62 | 4 | 一致 |
| 1511 | nangong_vibrato | gainRules[vibrato_on_stunned_anomaly].amount | 1 | — | — | 模块中找不到对应（不建逐事件 +1，层数由滑块/系统触发数给定） |
| 1511 | nangong_vibrato | spendRules[vibrato_clear].cost | 4 | src/mechanics/agents/nangong.ts:62 | 满层 4 清除（VIBRATO_MAX，隐含） | 一致 |
| 1511 | nangong_vibrato | properties.maxStacks | 4 | src/mechanics/agents/nangong.ts:62 | 4 | 一致 |
| 1511 | nangong_vibrato | properties.perStackBonusPct | 25 | src/mechanics/agents/nangong.ts:63 | 25 | 一致 |
| 1571 | norma_heat | initialValue | 60 | src/mechanics/agents/norma.ts:20 | 60 | 一致 |
| 1571 | norma_heat | maxValue | null | — | heatTotal 无上限 | 一致 |
| 1571 | norma_heat | gainRules[norma_heat_frontline].amountPerCount | 1.5 | src/mechanics/agents/norma.ts:21 | 1.5 | 一致 |
| 1571 | norma_heat | gainRules[norma_heat_ex_special].amountPerCount | 16 | src/mechanics/agents/norma.ts:22 | 16 | 一致 |
| 1571 | norma_heat | gainRules[norma_heat_hold].amountPerCount | 8 | src/mechanics/agents/norma.ts:23 | 8 | 一致 |
| 1571 | norma_heat | gainRules[norma_heat_ultimate].amountPerCount | 30 | src/mechanics/agents/norma.ts:24 | 30 | 一致 |
| 1571 | norma_heat | spendRules[norma_hat_to_chain].cost | 80 | src/mechanics/agents/norma.ts:27 | 80 | 一致 |
| 1571 | norma_heat | properties.initialHeat | 60 | src/mechanics/agents/norma.ts:20 | 60 | 一致 |
| 1571 | norma_heat | properties.heatPerSec | 1.5 | src/mechanics/agents/norma.ts:21 | 1.5 | 一致 |
| 1571 | norma_heat | properties.heatPerExSpecial | 16 | src/mechanics/agents/norma.ts:22 | 16 | 一致 |
| 1571 | norma_heat | properties.heatPerHoldSec | 8 | src/mechanics/agents/norma.ts:23 | 8 | 一致 |
| 1571 | norma_heat | properties.heatPerUltimate | 30 | src/mechanics/agents/norma.ts:24 | 30 | 一致 |
| 1571 | norma_heat | properties.heatPerEnergy | 0.4 | src/mechanics/agents/norma.ts:25 | 0.4 | 一致 |
| 1571 | norma_heat | properties.hatToChainThreshold | 80 | src/mechanics/agents/norma.ts:26 | 80 | 一致 |
| 1571 | norma_heat | properties.c2EnergyPerTrigger | 25 | src/mechanics/agents/norma.ts:67 | 25 | 一致 |
| 1571 | norma_heat | properties.c2TriggerInterval | 20 | src/mechanics/agents/norma.ts:68 | 20 | 一致 |
| 1571 | norma_barrage | initialValue | 0 | — | — | 模块中找不到对应（弹幕按满覆盖硬编码，不建状态值） |
| 1571 | norma_barrage | maxValue | null | — | — | 模块中找不到对应（弹幕按满覆盖硬编码，不建状态值） |
| 1571 | norma_barrage | gainRules[norma_barrage_from_ex].amountPerCount | 1 | src/mechanics/agents/norma.ts:362 | exCount 驱动弹幕行（1 次强特 1 轮） | 一致 |
| 1571 | norma_barrage | properties.durationSeconds | 32 | — | — | 模块中找不到对应（barrageCoverage=1 硬编码，无 32s 常数） |
| 1571 | norma_barrage | properties.teamDmgBonusDuringBarrage | 20 | src/mechanics/agents/norma.ts:40 | 20 | 一致 |
| 1571 | norma_barrage | properties.towerCount | 2 | src/mechanics/agents/norma.ts:179 | exCount×2 | 一致 |
| 1581 | remielle_voidflare | initialValue | 0 | src/mechanics/agents/remielle.ts:39 | 3 | 不一致 |
| 1581 | remielle_voidflare | maxValue | 3 | src/mechanics/agents/remielle.ts:38 | 3 | 一致 |
| 1581 | remielle_voidflare | gainRules[voidflare_from_teammate_reaction].amount | 1 | — | — | 模块中找不到对应（虚曜总数由异常池 perSlotAnomalyTriggers 汇总，不建逐次 +1） |
| 1581 | remielle_voidflare | spendRules[voidflare_luminize].cost | 3 | src/mechanics/agents/remielle.ts:375,528 | 3 | 一致 |
| 1581 | remielle_voidflare | properties.luminizeMasteryRatio | 0.1 | src/mechanics/agents/remielle.ts:42 | 0.2 | 不一致 |

## 5. 「原文写全队、实现只作用于本人」扫描（第 149 轮，CC-122；CC-121 的推广）

**抽句脚本**（可复跑，输出不进仓库）：对 `src/specs/agents/*.json`，把 `\\n` 替换成句号后，用正则 `[^。；"]*(全队|队伍中所有角色|队伍中全部角色|所有队友|队伍内所有)[^。；"]*` 抽句，按（id，前 60 字）去重。第 149 轮共抽出 145 句 / 40 个角色（包含实现注记里的重复）。

**已完成的两类**：

| 类别 | 方法 | 结果 |
|---|---|---|
| A. spec teamBuff `target: team` 但 `effects` 为空 | python 遍历 teamBuffs | 4 条，全部有承载者：1181 格莉丝 C1 全队回能（模块 applyTeamConfig）；1381 零号安比潜能（并入 formula 通道）；1541 核心 0.35%（formula teamBuff，第 146 轮）；1541 C1 减防（releaseModifier team，CC-121；note 已订正） |
| B. 模块或 spec 注释自认「近似为自身 / 仅自身」 | `git grep -E '(近似为?自身\|仅作用(于)?自身\|只作用(于)?自身\|近似自身\|按自身.*近似\|仅自身)'` | 1611 克拉蕾残锋「全队[锋御]」：catalog 中锋御（specialty=sharpen）只有克拉蕾 ⇒ 自身实现与原文等价，零影响；加绊线测试（`claretSmoke.test.ts`「CC-122 绊线」），新增锋御角色时变红。1641 phoenix 影画1 +20 暴伤：注释过时，实际由 spec 全队 teamBuff 承载、模块常量只喂展示，没有双计；注释已订正。1121 本：旧注释，已由 teammate-buffs 全队承载 |

**（第 151 轮已完成，见下方「C 类」）原剩余**：C 类，即 145 句中其余由模块 applyPanel 直接写自身面板、但注释没有自认近似的机制。做法：逐句找承载者（spec teamBuff / catalog teammate-buffs / 模块 applyTeamConfig / releaseModifierScope），找不到的用面板探针实测队友字段（写法见第 146 轮 `cc119probe`：遍历预设，`panelAt(calc.panels.value, slot)`）。适合派 dsh 做第一遍只读分类，lead 复核后再落盘。

**C 类（第 151 轮完成）**：材料脚本对 146 句逐角色列出承载条目（spec teamBuffs / teammate-buffs.json / 专武 catalog teamBuff / 模块文件），dsh 逐句分 A 已覆盖 / B 非全队数值增益（注记、重复、对敌减益已承载、防御向）/ C 找不到承载。粗筛先确认：40 个角色每个都至少有一个全队通道（唯一「零通道」的 1621 那句讲的是专武 14162，由 catalog `teamBuff` nanoka_14162_team_dmg 承载）。dsh 结论 C 只有 2 句，lead 逐条复核：
- S1611-2 克拉蕾残锋：已知等价（锋御仅 1 人），CC-122 绊线已守护。
- S1491-4 千夏影画6「全队触发[猫的凝视]伤害+50%」：**不缺**。`qianxia.ts` buildExecutions 把全部凝视触发物化为千夏名下的触发行并带 `dmgBonus: 50`，所以全队触发都吃到；过时的是 spec 注记（写「未建模」），第 151 轮已订正（零差）。按千夏面板结算属于近似（原文属触发代理人伤害），记为已知近似，不开卡。

**结论**：「原文写全队、实现只作用于本人」扫描 A / B / C 三类全部结案，没有新的数值差异。复跑：抽句正则见上；材料脚本思路 = 每个 spec 抽句 + 同 id 的四类承载条目并排，一页一个角色。dsh 跑 146 句约 25 分钟，结果文件没来得及写出就到了超时，结论取自其 log，已在此处落盘。
