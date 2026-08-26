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

  it('雨果失衡值返还：第1次满额、之后按 (1-返还比例) 折算失衡次数', () => {
    const panel = emptyPanel()
    panel.impact = 100
    const mk = (count: number, refund: number) => calcStunPool({
      executions: [{ moveId: 'm', moveName: 'M', slot: 0, count, baseDaze: 100, element: 'physical' }],
      panels: [panel], bossStunValue: 1000, chainCountPerStun: 3, enemyStunResistances: {},
      refundStunRatio: refund,
    })
    // 无返还：3500 失衡值 → 3 次
    expect(mk(35, 0).stunCount).toBe(3)
    // 返还 25%：3500 = 1000（首满）+ 750×3.33 → 4 次（1000 + 750×3 = 3250 ≤ 3500）
    expect(mk(35, 0.25).stunCount).toBe(4)
    expect(mk(35, 0.25).stunRefundValue).toBeCloseTo(3 * 0.25 * 1000)
    // 返还 25%：3000 = 1000 + 750×2.67 → 3 次
    expect(mk(30, 0.25).stunCount).toBe(3)
    // 返还比例封顶 0.25：传 0.5 仍按 0.25 计
    expect(mk(35, 0.5).stunCount).toBe(4)
  })
})
