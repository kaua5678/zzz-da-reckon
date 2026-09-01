import { describe, expect, it } from 'vitest'
import { emptyPanel } from '@/core/panel'
import { calcStunPool } from '@/core/stunPool'
import { stunWindowDuration, stunWindowFraction } from '@/core/effectiveTime'

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

describe('时间守恒：窗口时间不攒条（用户口径 2026-09-01，负反馈的来源）', () => {
  const panel = emptyPanel()
  panel.impact = 100
  const execs = [{ moveId: 'm', moveName: 'M', slot: 0, count: 10, baseDaze: 120, element: 'physical' }]
  const run = (windowTimeFraction: number) => calcStunPool({
    executions: execs as never, panels: [panel], bossStunValue: 100, chainCountPerStun: 0,
    enemyStunResistances: { physical: 0 }, windowTimeFraction,
  })

  it('窗口占比越大，有效攒条越少（这就是让次数自己收敛的负反馈）', () => {
    const none = run(0)
    const half = run(0.5)
    const all = run(1)
    expect(half.totalStunBuildUp).toBeCloseTo(none.totalStunBuildUp * 0.5, 6)
    expect(all.totalStunBuildUp).toBe(0)
    expect(half.stunCount).toBeLessThan(none.stunCount)
  })

  it('越界钳制：负数按 0、超 1 按 1', () => {
    expect(run(-1).totalStunBuildUp).toBeCloseTo(run(0).totalStunBuildUp, 6)
    expect(run(5).totalStunBuildUp).toBe(0)
  })

  it('与逐招 inAxisFraction 取较大者，不叠加（轴模式不被双重折算）', () => {
    const both = calcStunPool({
      executions: execs as never, panels: [panel], bossStunValue: 100, chainCountPerStun: 0,
      enemyStunResistances: { physical: 0 },
      inAxisStunFractionByKey: { '0:m': 0.8 },
      windowTimeFraction: 0.5,
    })
    // 取 max(0.8, 0.5) = 0.8 → 剩 20%，而不是 (1-0.8)×(1-0.5) = 10%
    expect(both.totalStunBuildUp).toBeCloseTo(run(0).totalStunBuildUp * 0.2, 6)
  })
})

describe('stunWindowFraction / stunWindowDuration（单一来源）', () => {
  it('窗口时长 = boss 失衡时间 + 4 + 全队延时', () => {
    expect(stunWindowDuration(12)).toBe(16)
    expect(stunWindowDuration(14, 4)).toBe(22)
    expect(stunWindowDuration(undefined)).toBe(16)
  })

  it('占比 = 次数 × 窗口 / 有效时间，钳在 [0,1]；边界为 0 不炸', () => {
    expect(stunWindowFraction(4, 18, 180)).toBeCloseTo(0.4, 9)
    expect(stunWindowFraction(20, 18, 180)).toBe(1)
    expect(stunWindowFraction(0, 18, 180)).toBe(0)
    expect(stunWindowFraction(4, 18, 0)).toBe(0)
  })
})
