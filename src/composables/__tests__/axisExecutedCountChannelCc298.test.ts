/**
 * CC-298：轴内**实际执行集合**（`convergence.ts` 的 `axisExecutedStack`）是 `cfg.axisActionCounts` / `cfg.axisUltimateTotal`
 * 的唯一来源，属计数通道 ⇒ 窗口数读 `countStun`（CC-142 同口径），不读外层计划实数 `stunCount`。
 *
 * 缺陷（修前）：physical 下 `auto-1521-1461-1311` 计划失衡 ≈0.x ⇒ 执行集合只排 1 窗 ⇒ 希希芙轴内终结 1 次，
 * 而池物理 3 次、物化行与伤害侧栈遍历都按 3 窗 ⇒ 影画2「失衡下终结 +3 毒素」只给 3（应 9）。
 * 牙测：换回旧 convergence.ts ⇒ 本条 3 ≠ 9 红。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { teamPresets } from '@/data/teamPresets'

describe('CC-298 轴内执行集合按计数通道分窗', () => {
  it('auto-1521-1461-1311 physical C2：影画2 终结毒素 = 3 × 伤害侧栈执行的终结次数', async () => {
    const p = teamPresets.find(x => x.id === 'auto-1521-1461-1311')
    expect(p, '预设缺失：换一个 physical 下计划失衡 < 物理次数的希希芙轴队').toBeTruthy()
    const { catalog, config } = await setupHarness(['', '', ''])
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    for (let i = 0; i < 3; i++) config.setAgent(i, p!.team[i])
    config.applyTeamPreset(p!.team as [string, string, string])
    config.setMechanicSetting('time.stunPlanProjection', 4)
    config.team[0].cinemaLevel = 2 as never
    const rr = calc.resourceResult.value as any
    const xixifu = rr.characters.find((c: any) => c.agentId === '1521')
    const gains = xixifu.specResources.xixifu_toxin.gains
    const c2 = gains.toxin_c2_stunned_chain_ultimate
    const ultGain = gains.toxin_ultimate
    const chainGain = gains.toxin_chain
    const ultExec = (calc.stackTraversalResult.value as any)?.executed?.['0:1521013']?.count ?? 0
    expect(calc.stunPoolResult.value?.stunCount).toBeGreaterThanOrEqual(2)
    expect(ultExec).toBeGreaterThanOrEqual(2)
    /**
     * ① CC-298 本体（本条要守的不变量）：**终结毒素与伤害侧栈执行的终结次数同源**。
     *    修前 physical 下执行集合只排 1 窗（终结 1 次）而伤害侧按 3 窗 ⇒ 这里 3 ≠ 9 红。
     */
    expect(ultGain).toBe(ultExec * 3)
    /**
     * ② 影画2 = (连携次数 + 失衡下终结次数) × 3（spec 原文「连携技/终结技命中失衡敌人额外 +3 毒素」）。
     *
     * ⚠ **2026-10-26 口径纠正（规则 10 四步）**：旧断言是 `c2 === ultExec * 3`，即把「轴态
     * `state.chainCountTotal` 迭代期恒 0 ⇒ 连携份恒收 0」这个 bug 当成了期望值（当时 c2 = 9 = 3×3）。
     * 该 bug 已在 `xixifu.ts#resolveXixifuResources`（改读 `chainCountTotalOverride ?? chainCountPerStun×失衡次数`）
     * 修掉 ⇒ c2 现在含连携份（实测该队 chain 4 + 终结 2 ⇒ 18）。断言随之按 spec 公式改写，
     * 连携次数取**同一条增益**里的 `toxin_chain / 3`（不另抄一遍计数口径）。
     */
    expect(c2).toBe((chainGain / 3 + ultExec) * 3)
  }, 60000)
})
