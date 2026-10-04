/**
 * 折叠残差累加器出口（2026-10-04）——行为锁 + 反证。
 *
 * 病灶：`cfg.timeBudgetExcess`（acc）是累加器（`foldLoop.ts` 的 `+=`），其唯一杠杆是
 * 「残差累加 ⇒ 账本变大 ⇒ 挤小平A池 ⇒ 模块少产行 ⇒ `rowTime` 下降」。当某槽平A池已空
 * （`basicAttackTime == 0`）**且** `rowTime` 已连续多轮不降时，杠杆失效——继续累加只是记账噪声。
 *
 * 实测（`auto-1431-1481-1491` 被接受那次）：`acc` 无出口时涨到 `[163.0/32.0/32.2]`，
 * 而 `rowTime` 恒定、账本落点不变 ⇒ 账本虚高（`necessary` 300s vs 预算 180s），
 * `timeBudgetConverged` 仍报 `true`（自洽性缺陷）。
 *
 * **为什么判据必须是「平A池空 ∧ rowTime 停滞」的合取**（v1 的教训，实测数字）：
 * 只判「团队 Σbasic == 0」会在「池被挤空但行仍在缩」的过渡轮就冻结 ⇒ 全库
 * **−32.5M / 失衡 −3 / `timeFillRatchet` 6 红**（`over 0→1.1`、`stun 2→1`、`stable→cycle`）。
 * 带上 rowTime 停滞条件后：全库仅 **2/104** 队落点变化、总伤 **−0.68M**、失衡与超预算**零变化**、
 * 绝对不变量（不发呆/不超预算/不掉 0 失衡盆/外层不耗尽）通过。
 *
 * **本出口不是中性记账**：封顶下 `capped_i = net_i × budget/Σnet` 只由比值决定
 * ⇒ 冻结 acc 会改**份额**（实测主C `+3.10s` 量级）。故锁的判据取「账本落点不变 + acc 显著下降」，
 * 而不是「数值逐位不变」。
 *
 * **反证（已实测）**：删掉出口（把 `accLeverLost ? … : …+excess` 恢复为无条件 `+=`）⇒
 * `timeBudgetAccumulatedSeconds` 由 `62.2` 涨到 `163.0` ⇒ 本测试的 `< 120` 断言**变红**。
 *
 * ⚠ **别用伤害或账本落点去锁本出口**：实测有/无出口的落点与伤害**逐位相同**
 * （`ledger=[135.01/43.69/31.29]`、`dmg=104.68M`），因为封顶把 acc 归一化掉了
 * （`capped_i = net_i × budget/Σnet` 只由比值决定）。本出口的价值是**账本自洽性**
 * （`necessary = estimate + acc` 不再被线性累加污染），其唯一观测量是
 * `timeBudgetAccumulatedSeconds`。第一版锁断言 `frozen===true` —— 反证时它**不红**
 * （该旗标由判据置位、与是否真的抑制累加无关），已据此改掉。
 */
import { describe, it, expect } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { teamPresets } from '@/data/teamPresets'

describe('折叠残差累加器出口', () => {
  it('平A池空且 rowTime 停滞 ⇒ 停止累加（账本虚高量级显著下降、落点不变）', async () => {
    const preset = teamPresets.find(x => x.id === 'auto-1431-1481-1491')
    expect(preset, '预设 auto-1431-1481-1491 未命中（改名前先改本测试）').toBeTruthy()
    const { catalog, config } = await setupHarness(['', '', ''])
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    for (let i = 0; i < 3; i++) config.setAgent(i, preset!.team[i])
    config.applyTeamPreset(preset!.team as [string, string, string])
    const rr = calc.resourceResult.value
    expect(rr, '资源池未产出结果').toBeTruthy()
    const conv = rr!.convergence

    // ① 账本虚高量级显著下降（**唯一可区分观测量**）。
    //    无出口实测 163.0（线性累加），有出口实测 62.2。门槛 120 两边都留余量。
    const acc = conv?.timeBudgetAccumulatedSeconds ?? 0
    expect(
      acc,
      `折叠残差累计 ${acc.toFixed(1)}s 仍过大 —— 累加器出口失效（无出口时实测 163.0s）`,
    ).toBeLessThan(120)

    // ② 出口确实在本次运行中生效（判据成立且真的抑制了累加）
    expect(conv?.timeBudgetAccumulatorFrozen, '累加器出口未触发').toBe(true)

    // ③ 账本落点保持：本出口**不是**中性记账（封顶下 acc 经比值影响份额），但对这条队
    //    实测落点逐位不变（基线 135.01 / 带出口 135.02）⇒ 容差 1s（量化地板）。
    //    这条断言是**防回归**用的：若哪天出口开始推动这条队的落点，必须逐队归因后再改。
    const ledger = rr!.characters.map(c => c.timeAllocation.necessaryTime + c.timeAllocation.basicAttackTime)
    expect(
      Math.abs(ledger[0]! - 135.01),
      `主C 账本 ${ledger[0]!.toFixed(2)}s 偏离基线 135.01s 超过 1s —— 出口改变了落点，需逐队归因`,
    ).toBeLessThan(1)

    // ④ 收敛标志语义未被本出口改动（仍是残差达标/停滞判据那一套）
    expect(conv?.timeBudgetConverged, '收敛标志被本出口意外翻转').toBe(true)
  }, 200_000)
})
