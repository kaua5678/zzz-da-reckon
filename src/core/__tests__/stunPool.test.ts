import { describe, expect, it } from 'vitest'
import { emptyPanel } from '@/core/panel'
import { calcStunPool } from '@/core/stunPool'

describe('calcStunPool', () => {
  it('counts stuns and chain attacks from accumulated daze', () => {
    const panel = emptyPanel()
    panel.impact = 100

    const result = calcStunPool({
      executions: [{
        moveId: 'test_move',
        moveName: 'Test Move',
        slot: 0,
        count: 2,
        baseDaze: 120,
        element: 'physical',
      }],
      panels: [panel],
      bossStunValue: 100,
      chainCountPerStun: 3,
      enemyStunResistances: { physical: 20 },
    })

    expect(result.totalStunBuildUp).toBeCloseTo(192)
    expect(result.stunCount).toBe(1)
    expect(result.chainCountTotal).toBe(3)
    expect(result.decibelBonus).toBe(20 + 3 * 10)
  })

  it('deducts in-axis stun as ineffective (失衡窗口内失衡值无效)', () => {
    const panel = emptyPanel()
    panel.impact = 100

    const result = calcStunPool({
      executions: [{
        moveId: 'test_move',
        moveName: 'Test Move',
        slot: 0,
        count: 2,
        baseDaze: 120,
        element: 'physical',
      }],
      panels: [panel],
      bossStunValue: 100,
      chainCountPerStun: 3,
      enemyStunResistances: { physical: 20 },
      inAxisStunFractionByKey: { '0:test_move': 0.5 },
    })

    expect(result.grossStunBuildUp).toBeCloseTo(192)
    expect(result.inAxisStunTotal).toBeCloseTo(96)
    expect(result.totalStunBuildUp).toBeCloseTo(96)
    expect(result.contributions[0].inAxisStun).toBeCloseTo(96)
    expect(result.contributions[0].effectiveStun).toBeCloseTo(96)
    expect(result.stunCount).toBe(0)
  })
})
