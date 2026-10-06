# 音擎叠层自动覆盖率的读取时序缺陷（嵌合编译器）

> lane arena-G（第 700 轮创建），2026-10-06。本轮只有实测与设计，无代码提交；半截补丁不入库（§5）。· lane arena-G（第 701 轮，2026-10-07）：第③④步已实施，`c93319f8` / `221611eb`（§7）。
> 代码：`src/composables/useResourceCalc.ts`（`wEngineStackAutoCoverages` + 回填 watch）、`src/data/wEngineStackCoverage.ts`、`src/core/anomalyPool.ts`。关联：队列 §3 T10 卡（开工条件已触发）。

## 0. 结论

- **状态（r701）**：第③④步已合入，同步读与回填后读的伤害现在逐位一致，队伍对比、难度曲线与主页口径相同；只剩第⑥步（去掉 store 回填，属于简化，不再影响正确性），见 §6、§7。
- 同一份配置，算出的伤害取决于读之前有没有让出过一次执行权。自动覆盖率只经 `flush:'post'` 的 watch 回填进 store；同步读（中间不让出执行权）拿到的是回填前的表，表里没有条目时按满层 100 算。
- 队伍对比（`teamCompare.ts` 全文件没有 await）和难度曲线（`difficultyCurve.ts:161-173` 在 `applyTeamToStore` 后同步读）都是同步读 ⇒ 105 支预设里带嵌合编译器（14118）的 7 支被高估 1.8–5.8%。这正是 `wEngineStackCoverage.ts` 要消除的「满层高估」。主页（回填之后）是对的。
- T10 卡原先只把它当性能问题（创建即两遍管线），开工条件「锁变红或成为性能瓶颈」都没触发。现在有了正确性理由 ⇒ **T10 开工条件视为已触发**，按 §6 做。
- 只改结算侧不够：资源侧异常池在池内用面板算紊乱 / 乱流伤害（§5）。正解是「资源侧只出次数，所有面板相关的伤害都在结算侧算」：紊乱 / 乱流照 CC-D2（DoT）的先例搬到结算侧，再拆面板。这也让 T10 的「执行次数不依赖面板量」从巧合变成结构保证。

## 1. 证据（r700 实测，HEAD `8cfb0e64`）

探针：每队新建 harness → `useResourceCalc()` → `applyTeamToStore(预设)` → 同步读 `teamTotalDamage` 与 `wEngineEffectCoverages['effect_wiki_214_self_ap']` → 3 次 `await nextTick()` 后再读；再让出 3 次，确认不再变化。探针在 worktree 的 `.zc/perf/g700cov.perf.ts`（不入库）。

| 预设 | 同步读覆盖率 | 回填后覆盖率 | 同步读伤害 | 回填后伤害 | 回填后相对同步读 |
|---|---|---|---|---|---|
| auto-1091-1511-1211 | 无条目（按 100） | 19.26 | 55,536,649 | 54,161,866 | −2.48% |
| auto-1181-1511-1411 | 无条目（按 100） | 26.67 | 74,046,486 | 70,221,020 | −5.17% |
| auto-1181-1561-1411 | 无条目（按 100） | 17.78 | 50,305,555 | 48,530,896 | −3.53% |
| auto-1181-1561-1581 | 无条目（按 100） | 11.85 | 84,554,215 | 81,818,205 | −3.24% |
| auto-1221-1511-1211 | 无条目（按 100） | 35.56 | 92,598,094 | 87,558,702 | −5.44% |
| auto-1221-1561-1411 | 无条目（按 100） | 32.59 | 50,752,355 | 49,149,834 | −3.16% |
| auto-1561-1171-1411 | 无条目（按 100） | 40.03 | 57,110,545 | 56,113,010 | −1.75% |
| 对照 3 队（不带 14118） | — | — | — | — | 0 |

回填一次即收敛（第二次让出后数值不再变化）。

## 2. 机制

- `useResourceCalc.ts`：`wEngineStackAutoCoverages`（computed，按执行行次数 × 每层 8 秒 / 战斗时长折算）→ `watch(…, applyWEngineEffectCoverageAuto, { immediate: true, flush: 'post' })` 写 store 表 `wEngineEffectCoverages`。面板经 `panelPhases.ts` 的 `resolveSlotPanelBuffInputs`（:483）与 `selfEffectCoverageMap`（:677）读这张表，缺省 100（`getWEngineEffectCoverage`）。
- Vue 的 `immediate` 首次回调是同步执行的（创建时当场回填一次）；之后的变化要等 post 队列，也就是微任务。同步循环里换队或改档后立刻读，回填根本来不及执行。
- `withAnalysisScenario` 是 `return await fn(scenario)`，建场景和执行回调之间不让出执行权。场景从 UI store 克隆，表里只有用户当前队伍的自动值。
- 登记了折算器的效果目前只有一个：`effect_wiki_214_self_ap`（嵌合编译器，异常精通 25 × 3 层 / 8 秒）。月城柳、柏妮思、格莉丝有专属折算器，其余角色按强特次数折算。今后新登记的效果会扩大影响面。

## 3. 影响面

（r701 起本节所列影响已消除，见 §7；以下保留修复前的记录。）

- 队伍对比散点、难度曲线（各档与归因表）：7 支带 14118 的预设按满层算。难度曲线各档的自动值本应随该档的次数变化，同步读下全部停在场景创建时的表。
- 测试与 zd：凡是换队或改配置后不 await 就读伤害的，锁定的都是满层口径（本探针的同步读即是一例）。修好后这些值会变，而且只应在带 14118 的队上变。
- 主页：回填后正确。配装页的覆盖率滑块（`TeamConfigPage.vue:386/394`）读 store 表，显示的是回填值。
- 用户会话的 `.claude/PROMPT-merge-difficulty-curves.md`（删除结果页重复的曲线面板）不受影响。核对对比页曲线时，这 7 队与主页的差是本缺陷造成的，不是合并引入的。

## 4. 已核查，不是问题

- 难度曲线场景继承 `interactionsLocked`（`analysisScenario.ts:76-78` 克隆全部 state 键，`difficultyLadder.ts` 不覆盖）：这是用户口径。`.claude/PROMPT-lock-interactions.md` §1 原话：「勾选后用户填写的会固定，其他内容自动，用于算**用户口径下的难度曲线**」。不要改。

## 5. 试过的半截方案（r700，未提交）

做法：结算侧面板（伤害、异常、进场快照，以及结算用的那份 `globalAnomalyMultiplier`）改用「store 表 ⊕ 自动折算增量」同步求值；资源侧继续读 store 表，包括注入 `createConvergenceRoundInputs` 和 `createRunCalcRound` 的 `panels` / `globalAnomalyMultiplier`，以及 `computeWindowDuration`。

- 已实测确认这个切点不成环。第一版漏了 `createConvergenceRoundInputs({ …, panels, …, globalAnomalyMultiplier })`（`useResourceCalc.ts:217`，对象简写，只匹配行首的 grep 搜不到），当场报错 `Cannot convert undefined or null to object`，原因是 computed 递归读到了 undefined。改正后 T10 原有 3 例照常通过。
- 但这只补上了 37% 的差距：auto-1221-1511-1211 同步读从 92,598,094 降到 90,717,918，目标是 87,558,702。剩下的 3,159,216 **全在紊乱行**，次数相同，只有单次伤害不同：
  - 「紊乱（覆盖电）」13 次，单次 2,443,612 → 2,216,917（差 2,947,030）；
  - 「月城柳·极性紊乱」12 次，单次 267,118 → 249,436（差 212,186；yanagi.ts 的钩子就是「原紊乱 × 倍率」）。
- 原因：`core/anomalyPool.ts:314-386` 在池内用面板算 `disorderDamage`（`calcDisorderDamage`，:379）和 `turbulenceDamage`，结果原样进入伤害表。T10 注释说的「执行次数不依赖面板量」只对次数成立，calcOutput 里还带着这两项伤害。
- 为什么不提交：同步读时会得到混合态，直伤和 DoT 用自动值，紊乱和乱流用满层，比「全部用旧值」更难解释；而且金值要改两遍。
- 补丁存在 `/home/kaua/calc-arch/g700/r700-partial.diff`（324 行）。内容包括：store 的 `wEngineEffectCoverageAutoDelta`；`panelPhases.ts` 里可选参数 `wEngineCoverages` 的透传；`useResourceCalc.ts` 拆成 `resourcePanels` 和 `panels`；T10 新锁。calc-arch 不入库，不是权威版本，以本节的描述为准。

## 6. 下一步（可直接开工）

（r701 状态：第 1–5 步已完成，见 §7；只剩第 6 步，其细化方案在本节末尾。）

1. **认领**以下文件：`useResourceCalc.ts`、`panelPhases.ts`、`stores/config.ts`、`core/anomalyPool.ts`、`types/resource/pools.ts`、`composables/resourceCalc/damagePoolAnomaly.ts`、`mechanics/agents/{yanagi,nangong}.ts`、`composables/freeCompare/metrics.ts`。开工前看一眼 LANE-CLAIMS 和 `.claude/PROMPT-*.md`，确认没人在动异常伤害路径。
2. **先上锁**：把附录里的用例加进 `src/composables/__tests__/wEngineCoverageFixpointT10.test.ts`，在未改的代码上确认它是红的（92,598,094 vs 87,558,702）。
3. **紊乱 / 乱流伤害搬到结算侧**，这一步是纯重构，目标 zd 为 0。先例是 CC-D2：DoT 唯一的实现在 `damagePoolAnomaly.ts`，用的是结算面板。
   - 池只输出次数和结算所需的非面板输入：元素序列、`disorderCount` / `turbulenceCount`、`dmgConfig` 的非面板部分；
   - 结算侧用结算面板调用 `calcDisorderDamage`，乱流同理；
   - 改 `AnomalyPoolResult.disorderDamage` / `turbulenceDamage` 的读者：yanagi、nangong 的极性紊乱钩子，`freeCompare/metrics.ts:224`，以及相关测试；
   - 先读清池内 `damagePanels` 是怎么来的，要和结算侧现有的 `damagePanels`（会叠加霜寒、风化）对齐，否则 zd 不会为 0。
4. **结算侧面板改用「store 表 ⊕ 自动增量」**，按 §5 的切点做（可以先 `git apply` 补丁再核对）。资源侧是指：注入 `createConvergenceRoundInputs` 和 `createRunCalcRound` 的全部依赖，加上 `computeWindowDuration`。做完这步锁应转绿，zd 只应在带 14118 的队上变化。**④ 不能先于 ③ 合入**，否则就是 §5 的混合态。
5. **验收**：锁转绿；`vue-tsc -b --force`；check-guards；全量 vitest 分片（基线 529 / 4534）；zd 逐队归因后按规则 10 重新生成金值。
6. **之后做 T10 ①**：去掉 store 回填，读表的界面消费点（滑块、FinalPanel 等）改读有效覆盖率。T10 原有 3 例随之改写，因为不会再有两遍管线。（r701 细化见下）

回退点：③、④、⑥ 各自单独提交；③ 若触点超出上面的清单，就停在 ③ 之前，重新评估。

**第 6 步细化（r701 写，下一轮可直接开工）**
- 现状：结算侧已不读回填值。回填还剩两个作用：① calc 之外读 store 表的界面显示自动值；② 资源侧 `resourcePanels` 读它，形成 T10 锁住的隐藏不动点（创建即两遍管线）。
- 做法：
  1. 删掉 `useResourceCalc.ts` 的回填 watch 和 `config.ts` 的 `applyWEngineEffectCoverageAuto`；calc 的返回值里暴露有效覆盖率（store 表 ⊕ 自动值，非 null 版本）。
  2. store 表从此只放用户手调值，`wEngineEffectCoverageManual` 随之多余，可删；`wEngineEffectCoverageAutoDelta` 的「跳过手调」改为「跳过表里已有的键」。注意本地存档迁移：旧存档里有不带手调标记的自动值，加载时只保留带标记的条目。
  3. calc 之外的消费点改读有效覆盖率：配装页滑块（`TeamConfigPage.vue` 读 `getWEngineEffectCoverage`）以及按 store 表算局内面板的界面（r700 统计 `computePanel` 系调用点 25 个：FinalPanel、hpSourceBreakdown、cinemaUplift、outOfCombatPanel、DebugPage、substatOptimizer、TeamConfigPage）。先查这些组件拿 calc 的方式（provide / inject 还是各自创建），再决定是传参还是由 calc 提供现成面板。
  4. T10 测试改写：创建只产生 1 次 calcOutput miss；删掉「重折算 == store」那条；保留「同步读 == 回填后读」。
- 验收：zd 期望 0（资源侧读的表少了自动值；r701 已证明结算侧与回填无关，资源结果哈希在 r701 两步中都未变，但这一步改变的是资源侧读到的表，仍要用 zd 确认）；全量 vitest；build；界面上 14118 角色的覆盖率滑块显示的仍是自动值。
- 价值与优先级：去掉计算图里的 store 副作用、创建成本减半（仅对带自动效果的队）、删掉手调标记表，属于「架构更简单」；当前正确性已无问题，优先级中低。动手前查 LANE-CLAIMS 与 `.claude/PROMPT-merge-difficulty-curves.md` 是否已执行完（第 3 条会碰结果页附近的组件）。

## 7. r701 实施记录（`c93319f8` 第③步、`221611eb` 第④步）

**第③步：异常池只出次数（纯重构）**
- `calcAnomalyPool` 不再算伤害，改为返回 `damageInputs`（元素序列、次数、敌方与失衡参数、霜寒加成）；新导出 `calcAnomalyPoolDamage(inputs, panels, { globalAnomalyMultiplier, teamMechanics })`。`useResourceCalc#anomalyPoolResult` 用结算面板补齐。
- 比 r700 的清单多了一项：池内还有**畏缩 DoT**（`calcCoweringDot`，爱丽丝）也用面板算伤害，一并搬到结算侧。
- 比清单少了四项：yanagi、nangong 的极性紊乱、`freeCompare/metrics.ts`、`ResultPage.vue` 都经 calc 暴露的 `anomalyPoolResult` 读字段，结算侧补齐后无需改动。
- 全队异常乘区（蕾米埃尔异化度，来自面板）只在结算侧用：从池输入和 `createConvergenceRoundInputs` 依赖里删掉（5 个测试里的同名注入随之删除）。这样第④步不必再为资源侧造第二份乘区（r700 半截补丁里的 `resourceGlobalAnomalyMultiplier` 作废）。
- `DamageCalcConfig` / `CoweringConfig` 移入 `types/resource/pools.ts`（池结果要携带结算输入，而 types 层不依赖 core），`core/anomalyPool/helpers.ts` 转导出，原导入路径不变。
- 验证：zd DUMP / ROWS DIFF 0；vitest 529 / 4534；vue-tsc 0；verify 第一段与 build 通过。

**第④步：拆分面板（修复本身）**
- `resourcePanels`（store 表）只喂轮次输入、runCalcRound、失衡窗口时长；`panels`（store 表 ⊕ 自动增量，`effectiveWEngineCoverages`）供结算侧使用，增量为空时直接复用资源侧那份。
- 锁转绿；r700 探针复测：7 支队同步读 = 回填后读（相对差 0），数值等于 r700 的回填后值；3 支对照队不变。
- zd 逐键归因：DUMP 42 键、ROWS 44 键，全部是 7 支带 14118 的预设 × 变体，只有总伤害和伤害行变化，资源结果、失衡池、交互上限的哈希逐位不变；降幅 1.43–7.74%。
- timeGolden 3 条（时间账零变化），按规则 10 归因后重新生成：auto-1181-1511-1411 87,002,090 → 82,671,236；auto-1181-1561-1411 54,688,846 → 52,762,372；auto-1181-1561-1581 84,554,215 → 81,818,205。timeGolden 按推荐配装配队，推荐音擎为 14118 的只有格莉丝（1181），所以恰好是含格莉丝的这 3 支变化；另外 4 支的 14118 来自预设自身的配装，推荐配装里没有。
- 新基线：vitest 529 文件 / 4535 例（+1 为新锁）。

## 附录：锁（r700 已验证在未改的代码上是红的；r701 已加入 `wEngineCoverageFixpointT10.test.ts`）

```ts
import { teamPresets } from '@/data/teamPresets'
import { applyTeamToStore } from '@/composables/teamCompare'

describe('结算侧同步读不依赖回填时序', () => {
  it('auto-1221-1511-1211：套预设后同步读的伤害 == 回填落 store 后再读', async () => {
    const { catalog, config } = await setupHarness(['', '', ''])
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    applyTeamToStore(config, teamPresets.find(p => p.id === 'auto-1221-1511-1211')!)
    const syncRead = calc.teamTotalDamage.value
    expect(config.wEngineEffectCoverages[EFFECT_ID]).toBeUndefined() // 回填尚未落 store（分析循环的处境）
    await nextTick(); await nextTick(); await nextTick()
    expect(config.getWEngineEffectCoverage(EFFECT_ID)).toBeLessThan(100) // 自动折算确实生效，否则本例空转
    expect(calc.teamTotalDamage.value).toBe(syncRead)
  })
})
```
