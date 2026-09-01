/**
 * 探针（PROBE_STUN_TIME=1）：失衡次数与时间守恒的自洽性检查。
 *
 * 用户 2026-09-01 指出的账：计算器用**整段有效时间**去攒失衡条，算出 N 次失衡后，
 * 又把 N × 窗口时长 加回资源轴/时间轴，却**没有从攒条时间里倒扣**——于是
 * 「攒条时间 + 窗口时间」可以超过有效战斗时间，失衡次数被算高（实测过 7 次）。
 * 本探针把这笔账逐项打出来，供实现时间守恒收敛前后对照。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useConfigStore } from '@/stores/config'
import { useCatalogStore } from '@/stores/catalog'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { isFrontlineExecution } from '@/types/resource'

const TEAMS: Array<{ label: string; team: string[] }> = [
  { label: '般琉卢（自动轴命中预设）', team: ['1471', '1481', '1451'] },
  { label: '白毛千夏照（叶瞬光队）', team: ['1431', '1491', '1341'] },
  { label: '星徽比利琉音卢西娅', team: ['1531', '1481', '1451'] },
]

describe('探针：失衡次数 × 时间守恒', () => {
  it.runIf(process.env.PROBE_STUN_TIME)('逐队打印「攒条时间 + 窗口时间 vs 有效时间」', async () => {
    for (const { label, team } of TEAMS) {
      await setupHarness(team.map(agentId => ({ agentId })))
      const config = useConfigStore()
      const catalog = useCatalogStore()
      await catalog.loadBuildRecommendations()
      config.applyTeamPreset(team as [string, string, string])
      const calc = useResourceCalc()
      const rr = calc.resourceResult.value
      const sp = calc.stunPoolResult.value
      if (!rr || !sp) { console.log(label, '→ 无结果'); continue }
      const battleTime = config.enemy.battleTime ?? 180
      const inv = config.enemy.invincibleTime ?? 0
      const effective = Math.max(0, battleTime - inv)
      const windowDur = calc.windowDuration.value
      const stunCount = sp.stunCount ?? 0
      const windowTotal = stunCount * windowDur
      let frontline = 0
      for (const ch of rr.characters) {
        for (const exec of ch.executions) {
          if (!isFrontlineExecution(exec)) continue
          frontline += exec.totalTime ?? 0
        }
      }
      const nonStunAvailable = effective - windowTotal
      console.log(
        label.padEnd(24),
        '失衡', stunCount.toFixed(2).padStart(6),
        '| 窗口', windowDur.toFixed(1) + 's ×' + stunCount.toFixed(2), '=', windowTotal.toFixed(1).padStart(6) + 's',
        '| 前台合计', frontline.toFixed(1).padStart(6) + 's',
        '| 有效', effective.toFixed(0) + 's',
        '| 非失衡可用 =', nonStunAvailable.toFixed(1).padStart(6) + 's',
        nonStunAvailable < 0 ? '← 窗口就已超时' : (frontline > effective ? '← 前台超有效时间' : ''),
      )
    }
    expect(true).toBe(true)
  }, 600000)
})
