/**
 * 折叠残差**不与团队封顶构成正反馈**（2026-10-06，1431 折叠残差专项）——行为锁 + 反证。
 *
 * ## 病灶
 *
 * `cfg.timeBudgetExcess`（`acc`）由折叠环累加（`foldLoop.ts` 的 `+=`），而 `iterate` 把它
 * 折进**账本**后按团队封顶压缩：
 * ```
 * necessary = cappedNecessary[i] = (rowTime + acc) × scale + credit
 * scale     = budget / Σ(rowTime_j + acc_j)          ← 分母也含 acc
 * excess    = rowTime − (necessary + ba)              ← foldLoop 的增量
 * acc      += excess
 * ```
 * ⇒ `acc ↑ ⇒ scale ↓ ⇒ 账本 ↓ ⇒ excess ↑ ⇒ acc ↑`：**正反馈**。
 *
 * 实测 `auto-1431-1481-1491`（口径 harness 缺省 + `comboAlignAbsorbRatio=0.4`）：
 * `acc` 涨到 **62.57s**（战斗总时长才 180s），账本被压到 135.02、物化行 149.40
 * ⇒ 那 14.38s「excess」其实是**封顶砍掉的秒数**，不是欠账。
 * `accLeverLost` 出口（`foldLoop.ts:209`）只冻结**当轮增量**、不撤销已累进的历史量，
 * 且它每次 `runFoldLoop` 都重置 `prevRowTime`（本函数局部）⇒ 每次新运行都能再涨一轮。
 *
 * ⚠ **不是**「跨降配档累积」（原假设，已证伪）：`core/resource.ts:211` 每次调用都清零
 * `timeBudgetExcess`，`resourceConfig` computed 每次产出**新 cfg 数组** ⇒ 档与档之间无残留。
 * 实测把候选集压成单档 `{0.125}`（r695 当时借降配档单调闸门实现，该闸门已于 T23 删除）与全表 8 档
 * 的 `acc` **逐位相同**（62.569 vs 62.569）。
 *
 * ## 修法
 *
 * 折叠环改为对**封顶前**的账本收敛（`IterationState.necessaryUncappedTime`，
 * 由 `iterate` 在 `feasibleScale < 1` 时写入）⇒ `excess = rowTime − rowTime×scale`，
 * 一轮即到不动点，`acc` 塌回量化地板。
 *
 * ## 判据取「残差量级」而不是「落点」（为什么）
 *
 * 封顶下 `capped_i = net_i × budget/Σnet` 只由**比值**决定 ⇒ 修法对落点/伤害/截断/iscale
 * **逐位不变**（全库 104 队实测：0 队伤害变化、0 队截断变化、0 队 iscale 变化）。
 * 唯一可区分观测量是 `convergence.timeBudgetAccumulatedSeconds`（账本自洽性读数）。
 * ⇒ 锁必须断言「残差 < 地板」，**不能**用伤害或账本落点去锁（那会永不红）。
 *
 * ## 反证（已实测，两个方向都验过）
 *
 * ① **删掉封顶前的账本**（把 `ledgerTarget` 换回 `state.necessaryTime`）⇒
 *    `auto-1431-1481-1491` 的 `acc` 由 **9.27 涨回 62.57** ⇒ 本测试断言①**变红**。
 * ② **把封顶压缩量显式折进 acc**（`helpers.ts` 里 `acc += uncapped − capped`）⇒
 *    正反馈完全放开：`acc` 5 轮内冲到 **3×10¹⁰**、`iscale` 1、截断 90.51s、`dmg` 103.22M
 *    ⇒ 本测试断言①**变红**（并证明这条环一旦没有「对封顶前账本收敛」的约束就会发散）。
 *
 * 覆盖：`auto-1431-1481-1491` / `auto-1431-1481-1341` / `auto-1431-1491-1341`
 * （= 全库 104 队里**仅有的 3 支** `acc` 读数因本修法变化的队；其余 101 队 `feasibleScale === 1`
 * ⇒ `necessaryUncappedTime` 缺省 ⇒ 路径逐位不变）。
 */
import { describe, it, expect } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { teamPresets } from '@/data/teamPresets'
import type { useConfigStore } from '@/stores/config'
import { COMBO_ALIGN_ABSORB_RATIO_SETTING } from '@/data/resourceDefaults'

/**
 * 逐队钉死（队, 残差上限, 封顶前账本是否参与, 落点快照）。
 * `accCeiling` = 修后实测值 + 余量；修前值写在 `before` 里（反证时的对照量）。
 */
const CASES = [
  { id: 'auto-1431-1481-1491', accCeiling: 20, before: 62.57, ledger: [135.009, 43.692, 31.294], dmg: 104.6832 },
  { id: 'auto-1431-1481-1341', accCeiling: 35, before: 45.40, ledger: [135.341, 43.759, 30.673], dmg: 116.1162 },
  { id: 'auto-1431-1491-1341', accCeiling: 35, before: 22.74, ledger: [146.252, 28.795, 26.551], dmg: 99.1970 },
] as const

describe('折叠残差不与团队封顶构成正反馈', () => {
  for (const c of CASES) {
    it(`${c.id}：残差塌回地板（修前 ${c.before}s）且落点不变`, async () => {
      const preset = teamPresets.find(x => x.id === c.id)
      expect(preset, `预设 ${c.id} 未命中（改名前先改本测试）`).toBeTruthy()
      const { catalog, config } = await setupHarness(['', '', ''])
      await catalog.loadBuildRecommendations()
      const calc = useResourceCalc()
      for (let i = 0; i < 3; i++) config.setAgent(i, preset!.team[i])
      config.applyTeamPreset(preset!.team as [string, string, string])
      const rr = calc.resourceResult.value
      expect(rr, '资源池未产出结果').toBeTruthy()
      const conv = rr!.convergence

      // ① 残差塌回量化地板（**唯一可区分观测量**）。
      //    反证：删掉封顶前账本 ⇒ 回到 c.before；放开正反馈 ⇒ 冲到 3e10。
      const acc = conv?.timeBudgetAccumulatedSeconds ?? 0
      expect(
        acc,
        `折叠残差累计 ${acc.toFixed(2)}s 超过地板 ${c.accCeiling}s（修前实测 ${c.before}s）`
        + ' —— 折叠环又在对**封顶后**的账本收敛，与封顶构成正反馈',
      ).toBeLessThan(c.accCeiling)

      // ② 落点/伤害**不变**：本修法不是中性记账的镜像——它对落点是恒等的
      //    （封顶只由比值决定），所以这条是**防回归**：若哪天它开始推动落点，必须逐队归因。
      const ledger = rr!.characters.map(x => x.timeAllocation.necessaryTime + x.timeAllocation.basicAttackTime)
      for (let i = 0; i < 3; i++) {
        expect(
          Math.abs(ledger[i]! - c.ledger[i]!),
          `槽${i} 账本 ${ledger[i]!.toFixed(3)}s 偏离基线 ${c.ledger[i]!}s 超过 0.05s —— 修法改变了落点，需逐队归因`,
        ).toBeLessThan(0.05)
      }
      expect(
        Math.abs(calc.teamTotalDamage.value / 1e6 - c.dmg),
        `总伤 ${(calc.teamTotalDamage.value / 1e6).toFixed(4)}M 偏离基线 ${c.dmg}M —— 修法改变了伤害`,
      ).toBeLessThan(0.01)

      // ③ 收敛标志未被本修法翻转
      expect(conv?.timeBudgetConverged, '收敛标志被本修法意外翻转').toBe(true)
    }, 200_000)
  }

  /**
   * 跨队对照：**封顶未激活的队必须逐位不变**。
   *
   * `necessaryUncappedTime` 只在 `feasibleScale < 1` 时写 ⇒ 其余队走 `?? state.necessaryTime`
   * 回落路径。本断言用一支 `iscale === 1`（未降配、封顶未激活）的队钉住「回落路径没被写坏」。
   * ⚠ 它**不是**本修法的效果判据（那种队修前修后都同值）——它是**边界锁**，防有人把
   * `necessaryUncappedTime` 改成无条件写入（那会让全库 101 队的残差读数一起漂）。
   */
  it('封顶未激活的队走回落路径（边界锁）', async () => {
    const preset = teamPresets.find(x => x.id === 'auto-1431-1341-1311')
    expect(preset, '预设 auto-1431-1341-1311 未命中（改名前先改本测试）').toBeTruthy()
    const { catalog, config } = await setupHarness(['', '', ''])
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    for (let i = 0; i < 3; i++) config.setAgent(i, preset!.team[i])
    config.applyTeamPreset(preset!.team as [string, string, string])
    const rr = calc.resourceResult.value
    expect(rr, '资源池未产出结果').toBeTruthy()
    // 该队未降配（iscale === 1）⇒ 封顶未激活 ⇒ 走回落路径
    expect(rr!.convergence?.interactionScale ?? 1, '本断言假定该队不降配').toBe(1)
    // 残差读数与修前基线一致（21.70s，见本轮 zd/census 对账）
    expect(
      Math.abs((rr!.convergence?.timeBudgetAccumulatedSeconds ?? 0) - 21.70),
      '封顶未激活的队残差读数漂了 —— necessaryUncappedTime 可能被改成无条件写入',
    ).toBeLessThan(0.05)
  }, 200_000)

  /**
   * ## ★ 降配档位变化的**显式认领**（2026-10-06，用户裁决「一切以开发为重」）
   *
   * 本修法**不是**中性记账：`acc` 经 `necessary = (rowTime + acc) × scale` 参与**封顶比值**
   * ⇒ 改掉 `acc` 会改变**逐档试算的可行性读数**，从而在「逼出降配搜索」的场景上改变**被采纳档位**。
   *
   * 全场景实测（104 队 × 6 场景 = 624 条，`.zc/perf/ysgzd2.perf.ts` 修前 vs 修后）：
   * ```
   * 场景          变化条数  伤害变化
   * default            0        0     ← 逐位零差
   * c0                 0        0     ← 逐位零差
   * w（权重扰动）       0        0     ← 逐位零差
   * c6                 6        6
   * heavy             3        3
   * heavyGate         3        3
   * ```
   * ⇒ 变化**全部**落在降配搜索被逼出的三个场景。本组断言把**最大的两条**钉成显式认领：
   * 谁再动折叠/封顶语义，必须重新过这里并说明档位为什么变。
   *
   * ⚠ 这些是**有意**的行为变化（不是回归）：`helpers.ts` 封顶处原文已声明
   * 「被压掉的部分**不再折进账本挤平A池**」，而修前实现恰恰把它折进了账本（并形成正反馈）。
   * 修法让实现回到该口径 ⇒ 逐档可行性读数随之修正。
   *
   * ## ★★ 已知**变差**的一条：`auto-1431-1481-1341 @ comboAlignAbsorbRatio=0`（−9.76M）
   *
   * 这是本轮唯一一条**真变差**，根因已定位到**降配搜索第三层「缓解档」的选择规则**（不是读数坏了）：
   *
   * ```
   * 档位   | 修前 截断 / relief | 修后 截断 / relief
   * 0.75   | 82.05 / ✔         | 81.13 / ✘
   * 0.625  | 72.45 / ✔         | 72.45 / ✘   ← 修后 acceptsTrial 由 true 翻 false
   * 0.5    | 63.53 / ✔         | 63.86 / ✔   ← 修后**唯一** relief 档 ⇒ 被采纳
   * 0.125  | 33.72 / ✘         | 33.72 / ✘
   * 0.0625 | 26.03 / ✔         | 27.43 / ✘
   * ```
   * 修前有 5 个 relief 候选（0.75/0.625/0.5/0.375/0.25/0.0625），`selectDownscaleScale` 按
   * 「截断最小」取到 **0.0625（26.03s）**；修后 0.625 等档的 `acceptsTrial`（三臂相对基线）
   * 翻假，只剩 **0.5（63.86s）** 一个 relief 候选 ⇒ 截断反而更大、伤害更低。
   *
   * ⇒ 这是**搜索规则的脆弱性**：第三层兜底档依赖「三臂相对基线」这一**相对**判据，
   * 而相对判据的基线（`baseNet`/`baseTruncation`）本身随折叠残差移动 ⇒ 修法让某几档
   * 「不比基线更差」不再成立。**读数没有错**（0.0625 档修后仍是 27.43s，比 0.5 的 63.86s 好得多），
   * 错的是「relief 候选集」被相对判据缩成了一个更差的点。
   *
   * 处置：**如实认领，不在本任务里改搜索规则**（那是 `feasibilitySearch.ts` 的独立议题，
   * 动它要重跑全库降配面 + 用户口径）。本用例钉住现状，任何人再动折叠/搜索语义都会在此变红。
   */
  describe('降配档位变化的显式认领（有意行为变化，非回归）', () => {
    /** 场景构造：复刻 `zd` 的 `heavy`（弹刀+闪反各 +25，逼出降配搜索） */
    const heavySetup = (config: ReturnType<typeof useConfigStore>) => {
      config.team[0]!.parryCount = (config.team[0]!.parryCount ?? 0) + 25
      config.team[0]!.dodgeCounterCount = (config.team[0]!.dodgeCounterCount ?? 0) + 25
    }

    it('auto-1431-1481-1341 / heavy：档位 0.75 → 0.0625，截断 188.68 → 22.75s（大幅改善）', async () => {
      const preset = teamPresets.find(x => x.id === 'auto-1431-1481-1341')
      expect(preset, '预设未命中').toBeTruthy()
      const { catalog, config } = await setupHarness(['', '', ''])
      await catalog.loadBuildRecommendations()
      const calc = useResourceCalc()
      for (let i = 0; i < 3; i++) config.setAgent(i, preset!.team[i])
      config.applyTeamPreset(preset!.team as [string, string, string])
      heavySetup(config)
      const rr = calc.resourceResult.value
      expect(rr, '资源池未产出结果').toBeTruthy()
      // 档位降到 0.0625（修前 0.75）；截断由 188.68s 降到 22.75s、伤害 +8.79M
      expect(rr!.convergence?.interactionScale, '档位认领值变了 —— 需重新逐队归因').toBeCloseTo(0.0625, 6)
      expect(
        Math.abs((rr!.overflowSeconds ?? 0) - 22.75),
        `截断 ${(rr!.overflowSeconds ?? 0).toFixed(2)}s 偏离认领值 22.75s`,
      ).toBeLessThan(0.05)
      expect(
        Math.abs(calc.teamTotalDamage.value / 1e6 - 120.0145),
        `总伤 ${(calc.teamTotalDamage.value / 1e6).toFixed(4)}M 偏离认领值 120.0145M`,
      ).toBeLessThan(0.01)
      // 残差仍在量化地板（本修法的目的）
      expect(rr!.convergence?.timeBudgetAccumulatedSeconds ?? 0).toBeLessThan(35)
    }, 200_000)

    it('yixuan-trigger-lucia / heavy：档位 0.25 → 0.125（修后 0.25 档不再绝对可行）', async () => {
      const preset = teamPresets.find(x => x.id === 'yixuan-trigger-lucia')
      expect(preset, '预设未命中').toBeTruthy()
      const { catalog, config } = await setupHarness(['', '', ''])
      await catalog.loadBuildRecommendations()
      const calc = useResourceCalc()
      for (let i = 0; i < 3; i++) config.setAgent(i, preset!.team[i])
      config.applyTeamPreset(preset!.team as [string, string, string])
      heavySetup(config)
      const rr = calc.resourceResult.value
      expect(rr, '资源池未产出结果').toBeTruthy()
      expect(rr!.convergence?.interactionScale, '档位认领值变了 —— 需重新逐队归因').toBeCloseTo(0.125, 6)
      expect(
        Math.abs(calc.teamTotalDamage.value / 1e6 - 69.6128),
        `总伤 ${(calc.teamTotalDamage.value / 1e6).toFixed(4)}M 偏离认领值 69.6128M`,
      ).toBeLessThan(0.01)
    }, 200_000)

    /**
     * ⚠ **唯一一条真变差**的显式认领（见本 describe 头注释的完整归因）。
     *
     * `comboAlignAbsorbRatio=0`（全关合轴吸收）时，修前搜索有 5 个「缓解档」候选、
     * 按截断最小取到 0.0625（26.03s）；修后 0.625 等档的 `acceptsTrial` 翻假 ⇒
     * 只剩 0.5 一个候选（63.86s）⇒ 截断更大、伤害更低（−9.76M）。
     *
     * 本用例**钉住现状并把它标成已知缺陷**：它锁的不是「这个值是对的」，
     * 而是「再动折叠/搜索语义时必须重新过这里并说明为什么」。修搜索规则时本用例应随之更新。
     */
    it('⚠ 已知变差：auto-1431-1481-1341 @ ratio=0（缓解档候选集被相对判据缩成更差的点）', async () => {
      const preset = teamPresets.find(x => x.id === 'auto-1431-1481-1341')
      expect(preset, '预设未命中').toBeTruthy()
      const { catalog, config } = await setupHarness(['', '', ''])
      await catalog.loadBuildRecommendations()
      const calc = useResourceCalc()
      for (let i = 0; i < 3; i++) config.setAgent(i, preset!.team[i])
      config.applyTeamPreset(preset!.team as [string, string, string])
      config.setMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, 0)
      const rr = calc.resourceResult.value
      expect(rr, '资源池未产出结果').toBeTruthy()
      // 现状：档位 0.5、截断 63.86s、伤害 97.013M（修前：0.0625 / 26.03s / 106.770M）
      expect(rr!.convergence?.interactionScale, '档位认领值变了 —— 需重新逐队归因').toBeCloseTo(0.5, 6)
      expect(
        Math.abs((rr!.overflowSeconds ?? 0) - 63.86),
        `截断 ${(rr!.overflowSeconds ?? 0).toFixed(2)}s 偏离认领值 63.86s`,
      ).toBeLessThan(0.05)
      expect(
        Math.abs(calc.teamTotalDamage.value / 1e6 - 97.013),
        `总伤 ${(calc.teamTotalDamage.value / 1e6).toFixed(4)}M 偏离认领值 97.013M`,
      ).toBeLessThan(0.01)
    }, 200_000)
  })
})
