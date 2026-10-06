# 音擎叠层自动覆盖率的读取时序缺陷（嵌合编译器）

> lane arena-G（第 700 轮创建），2026-10-06。本轮只有实测与设计，无代码提交；半截补丁不入库（§5）。
> 代码：`src/composables/useResourceCalc.ts`（`wEngineStackAutoCoverages` + 回填 watch）、`src/data/wEngineStackCoverage.ts`、`src/core/anomalyPool.ts`。关联：队列 §3 T10 卡（开工条件已触发）。

## 0. 结论

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

1. **认领**以下文件：`useResourceCalc.ts`、`panelPhases.ts`、`stores/config.ts`、`core/anomalyPool.ts`、`types/resource/pools.ts`、`composables/resourceCalc/damagePoolAnomaly.ts`、`mechanics/agents/{yanagi,nangong}.ts`、`composables/freeCompare/metrics.ts`。开工前看一眼 LANE-CLAIMS 和 `.claude/PROMPT-*.md`，确认没人在动异常伤害路径。
2. **先上锁**：把附录里的用例加进 `src/composables/__tests__/wEngineCoverageFixpointT10.test.ts`，在未改的代码上确认它是红的（92,598,094 vs 87,558,702）。
3. **紊乱 / 乱流伤害搬到结算侧**，这一步是纯重构，目标 zd 为 0。先例是 CC-D2：DoT 唯一的实现在 `damagePoolAnomaly.ts`，用的是结算面板。
   - 池只输出次数和结算所需的非面板输入：元素序列、`disorderCount` / `turbulenceCount`、`dmgConfig` 的非面板部分；
   - 结算侧用结算面板调用 `calcDisorderDamage`，乱流同理；
   - 改 `AnomalyPoolResult.disorderDamage` / `turbulenceDamage` 的读者：yanagi、nangong 的极性紊乱钩子，`freeCompare/metrics.ts:224`，以及相关测试；
   - 先读清池内 `damagePanels` 是怎么来的，要和结算侧现有的 `damagePanels`（会叠加霜寒、风化）对齐，否则 zd 不会为 0。
4. **结算侧面板改用「store 表 ⊕ 自动增量」**，按 §5 的切点做（可以先 `git apply` 补丁再核对）。资源侧是指：注入 `createConvergenceRoundInputs` 和 `createRunCalcRound` 的全部依赖，加上 `computeWindowDuration`。做完这步锁应转绿，zd 只应在带 14118 的队上变化。**④ 不能先于 ③ 合入**，否则就是 §5 的混合态。
5. **验收**：锁转绿；`vue-tsc -b --force`；check-guards；全量 vitest 分片（基线 529 / 4534）；zd 逐队归因后按规则 10 重新生成金值。
6. **之后做 T10 ①**：去掉 store 回填，读表的界面消费点（滑块、FinalPanel 等）改读有效覆盖率。T10 原有 3 例随之改写，因为不会再有两遍管线。

回退点：③、④、⑥ 各自单独提交；③ 若触点超出上面的清单，就停在 ③ 之前，重新评估。

## 附录：锁（r700 已验证在未改的代码上是红的）

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
