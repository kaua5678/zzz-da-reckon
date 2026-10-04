/**
 * CC-459 锁：结果卡「时间分配」行只读引擎账本，不自造口径。
 *
 * 契约（`types/resource/execution.ts` timeBucket 注释）：Σ前台行 totalTime ≡ timeAllocation.frontlineTime。
 * 卡片此前 (a) 把后台桶行当前台（1331 后台行 11.7s ⇒「总计」191.7s），(b) 私加柏妮思搅拌/抛接行
 * （executions 已含 1171010–1171013 ⇒「总计」211.3s）。本锁用真实 harness 跑三队，断言：
 *  - Σ rows.frontlineTime == timeAllocation.frontlineTime
 *  - Σ rows.comboAlignTime == timeAllocation.comboAlignTime
 *  - Σ 时间条 time == 战斗总时长（操作 + 合轴 + 后台）
 * 并源锁卡片从 `composables/resourceCard/actionOperationRows` 取行、不再读 `burniceMechanicSource` 造行。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { buildActionOperationRows, buildTimeChartRows } from '@/composables/resourceCard/actionOperationRows'

const TEAMS: Array<Array<{ agentId: string; cinemaLevel: number }>> = [
  [{ agentId: '1541', cinemaLevel: 0 }, { agentId: '1331', cinemaLevel: 0 }, { agentId: '1411', cinemaLevel: 0 }],
  [{ agentId: '1171', cinemaLevel: 0 }, { agentId: '1191', cinemaLevel: 0 }, { agentId: '1211', cinemaLevel: 0 }],
  [{ agentId: '1471', cinemaLevel: 0 }, { agentId: '1481', cinemaLevel: 0 }, { agentId: '1451', cinemaLevel: 0 }],
]

describe('CC-459 结果卡时间分配行 == 引擎 timeAllocation', () => {
  for (const team of TEAMS) {
    const label = team.map(t => t.agentId).join('-')
    it(`${label}: Σ行前台/合轴 == 账本，Σ时间条 == 总时长`, async () => {
      await setupHarness(team, { recommendedBuild: true })
      const { resourceResult } = useResourceCalc()
      const rr = resourceResult.value!
      expect(rr.characters.length).toBe(3)
      for (const ch of rr.characters) {
        const rows = buildActionOperationRows(ch)
        const sumFront = rows.reduce((s, r) => s + r.frontlineTime, 0)
        const sumAlign = rows.reduce((s, r) => s + r.comboAlignTime, 0)
        expect(sumFront, `${ch.agentId} Σ行前台`).toBeCloseTo(ch.timeAllocation.frontlineTime, 6)
        expect(sumAlign, `${ch.agentId} Σ行合轴`).toBeCloseTo(ch.timeAllocation.comboAlignTime, 6)
        const chart = buildTimeChartRows(ch)
        const chartTotal = chart.reduce((s, r) => s + r.time, 0)
        expect(chartTotal, `${ch.agentId} Σ时间条`).toBeCloseTo(rr.totalTime, 6)
        expect(chart.at(-1)?.time, `${ch.agentId} 后台条`).toBeCloseTo(ch.timeAllocation.backstageTime, 9)
      }
    })
  }

  it('源锁：卡片从 resourceCard/actionOperationRows 取行，不再读 burniceMechanicSource 造行', () => {
    const vue = readFileSync(resolve(__dirname, '../../components/ResourceResultCard.vue'), 'utf-8')
    expect(vue).toContain("from '@/composables/resourceCard/actionOperationRows'")
    expect(vue).not.toMatch(/burniceMechanicSource/)
    expect(vue).not.toMatch(/ACTION_ROW_DEFS/)
    const mod = readFileSync(resolve(__dirname, '../resourceCard/actionOperationRows.ts'), 'utf-8')
    expect(mod).toMatch(/isFrontlineExecution\(exec\)/)
    expect(mod).not.toMatch(/burniceMechanicSource|stirringCount/)
  })
})
