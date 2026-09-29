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
    const c2 = xixifu.specResources.xixifu_toxin.gains.toxin_c2_stunned_chain_ultimate
    const ultExec = (calc.stackTraversalResult.value as any)?.executed?.['0:1521013']?.count ?? 0
    expect(calc.stunPoolResult.value?.stunCount).toBeGreaterThanOrEqual(2)
    expect(ultExec).toBeGreaterThanOrEqual(2)
    expect(c2).toBe(ultExec * 3)
  }, 60000)
})
