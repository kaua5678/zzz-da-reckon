/**
 * 时间账跨路径不变量（护栏）—— 2026-09-08「同一物理量被拆成几份分别叠加」审计的机器判据。
 *
 * 背景：资源卡的时间、引擎的账本、物化执行行、赠送行（诺姆赠链/琉音赠大，装配后追加）分属不同代码路径。
 * 用户实测「诺姆入队后主C时间 = 180s + 诺姆连携秒数」就是这条链上的一次漂移；125 队审计（修复前）
 * 同类违反 49 条（最大差 -14.24s），修复后 0 条。
 *
 * 本测试对**全预设库**断言三条跨路径恒等式（每条都是「同一个量只能有一个口径」）：
 *  ① 展示不变量：`frontlineTime + backstageTime = 战斗时间`（逐槽）——资源卡「总计」恒等于战斗时间；
 *  ② 展示 = 行：`frontlineTime = Σ前台执行行 totalTime`（逐槽）——展示口径由**最终行**派生
 *     （`normalizeDisplayTime`），装配后追加的赠送行也在此计入；
 *  ③ 行 ≤ 账本：`Σ前台执行行 ≤ necessaryTime + basicAttackTime`（逐槽）——物化不得超账本
 *     （赠送行的时间已在账本内预留，见 ENGINE_PIPELINE_GUIDE 坑 28）。
 *
 * 不含「净占用 ≤ 预算」：那条由 `timeFillRatchet` 的绝对不变量按既有容差口径管（含 1 队 1.9s 残差）。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { teamPresets } from '@/data/teamPresets'
import { isFrontlineExecution } from '@/types/resource'

/** 量化残差容差（秒）：与坑 12/19 同口径，不追求精确 0 */
const TOL = 0.05

describe('时间账跨路径不变量（全预设库）', () => {
  it('展示 = 行 = 账本：前台+后台=战斗时间、前台=Σ行、行≤账本', async () => {
    const { catalog } = await setupHarness(['', '', ''])
    await catalog.loadBuildRecommendations()
    const config = useConfigStore()
    const calc = useResourceCalc()
    const presets = teamPresets.filter(p => Array.isArray(p.team) && p.team.length === 3)
    const bad: string[] = []

    for (const p of presets) {
      for (let i = 0; i < 3; i++) config.setAgent(i, p.team[i])
      config.applyTeamPreset(p.team as [string, string, string])
      const rr = calc.resourceResult.value
      if (!rr) { bad.push(`${p.id}: 无结果`); continue }
      for (const c of rr.characters) {
        const front = c.timeAllocation.frontlineTime ?? 0
        const back = c.timeAllocation.backstageTime ?? 0
        const rows = (c.executions ?? []).reduce(
          (s, e) => s + (isFrontlineExecution(e) ? (e.totalTime ?? 0) : 0), 0)
        const ledger = (c.timeAllocation.necessaryTime ?? 0) + (c.timeAllocation.basicAttackTime ?? 0)
        if (Math.abs(front + back - rr.totalTime) > TOL) {
          bad.push(`${p.id} 槽${c.slot}(${c.agentId})：前台 ${front.toFixed(2)} + 后台 ${back.toFixed(2)} ≠ 战斗时间 ${rr.totalTime}`)
        }
        if (Math.abs(front - rows) > TOL) {
          bad.push(`${p.id} 槽${c.slot}(${c.agentId})：展示前台 ${front.toFixed(2)} ≠ 物化行 ${rows.toFixed(2)}（差 ${(front - rows).toFixed(2)}）`)
        }
        if (rows > ledger + TOL) {
          bad.push(`${p.id} 槽${c.slot}(${c.agentId})：物化行 ${rows.toFixed(2)} > 账本 ${ledger.toFixed(2)}（超 ${(rows - ledger).toFixed(2)}）`)
        }
      }
    }

    expect(bad, `时间账跨路径不变量被破（${bad.length}/${presets.length} 队）：\n${bad.join('\n')}`).toEqual([])
  }, 600_000)
})
