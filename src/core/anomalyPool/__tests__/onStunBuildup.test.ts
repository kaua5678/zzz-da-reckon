/** 失衡内积蓄（南宫羽天使队长）：池侧按失衡覆盖折算 + 连携限定 golden 值 */
import { describe, expect, it } from 'vitest'
import { calcAnomalyPool } from '../../anomalyPool'
import type { PanelValues } from '@/types/catalog'

const panel = (over: Partial<PanelValues> = {}): PanelValues =>
  ({ anomalyMastery: 100, anomalyBuildUpEfficiency: 0, enemyAnomalyResReduction: 0, ...over }) as PanelValues

describe('calcAnomalyPool 失衡内积蓄效率（OnStunBonus）', () => {
  const execs = [
    { moveId: 'm1', moveName: '普攻', slot: 0, count: 1, baseBuildUp: 100, element: 'ether', skillType: 'basic' },
    { moveId: 'm2', moveName: '连携', slot: 0, count: 1, baseBuildUp: 100, element: 'ether', skillType: 'chain' },
  ]

  it('覆盖 0.5 + 全招式30/连携再30 → 普攻 ×1.15、连携 ×1.30', () => {
    const r = calcAnomalyPool({
      executions: execs,
      panels: [panel({
        anomalyBuildUpEfficiencyOnStunBonus: 30,
        anomalyBuildUpEfficiencyOnStunChainBonus: 30,
      })],
      stunned: 0.5,
      totalTime: 180,
    })
    const byMove = new Map(r.perElement.flatMap(p => p.contributions).map(c => [c.moveId, c.perHitBuildUp]))
    expect(byMove.get('m1')).toBeCloseTo(115)  // 100×(1+30×0.5/100)
    expect(byMove.get('m2')).toBeCloseTo(130)  // 100×(1+60×0.5/100)
  })

  it('零覆盖不加成；面板未设字段不产生 NaN', () => {
    const r = calcAnomalyPool({ executions: execs, panels: [panel()], stunned: true, totalTime: 180 })
    const byMove = new Map(r.perElement.flatMap(p => p.contributions).map(c => [c.moveId, c.perHitBuildUp]))
    expect(byMove.get('m1')).toBeCloseTo(100)
    expect(byMove.get('m2')).toBeCloseTo(100)
  })
})
