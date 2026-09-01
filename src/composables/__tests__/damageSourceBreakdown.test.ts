/**
 * 伤害来源分解（诊断）单元测试：computeDamageSourceBreakdown
 * 直伤/异常 × 总倍率/属性区 的口径锁——检查总伤害异常时定位倍率错还是属性区错。
 */
import { describe, expect, it } from 'vitest'
import { computeDamageSourceBreakdown, type DamagePoolRow } from '@/composables/resourceCalc/helpers'

function row(over: Partial<DamagePoolRow>): DamagePoolRow {
  return {
    id: 'r', slot: 0, agentId: 'x', agentName: 'X', type: '直伤',
    name: 'n', element: 'fire', source: 's', count: 1,
    perDamage: 100, totalDamage: 100, note: '',
    ...over,
  } as DamagePoolRow
}

describe('伤害来源分解 computeDamageSourceBreakdown', () => {
  it('直伤倍率×属性区 = 总伤害：两行直伤 100%×2 + 300%×1 → 总倍率 500，属性区 = 伤害/(500/100)', () => {
    const rows = [
      row({ count: 2, multiplier: 100, perDamage: 50, totalDamage: 100 }),
      row({ count: 1, multiplier: 300, perDamage: 150, totalDamage: 150 }),
    ]
    const out = computeDamageSourceBreakdown(rows)
    expect(out).toHaveLength(1)
    expect(out[0].direct.multiplier).toBe(2 * 100 + 1 * 300) // 500
    expect(out[0].direct.damage).toBe(250)
    expect(out[0].direct.attrRegion).toBeCloseTo(250 / (500 / 100), 6) // 50
    expect(out[0].direct.flatDamage).toBe(0)
    expect(out[0].anomaly.damage).toBe(0)
  })

  it('异常族：非直伤类型归异常；无倍率行（固定/附伤）进 flatDamage 不计倍率', () => {
    const rows = [
      row({ type: '异放', count: 3, multiplier: 350, perDamage: 700, totalDamage: 2100 }),
      row({ type: '简6命附伤', count: 2, perDamage: 1000, totalDamage: 2000 }), // 无 multiplier
    ]
    const out = computeDamageSourceBreakdown(rows)
    expect(out[0].direct.damage).toBe(0)
    expect(out[0].anomaly.multiplier).toBe(3 * 350) // 1050
    expect(out[0].anomaly.damage).toBe(4100)
    expect(out[0].anomaly.attrRegion).toBeCloseTo(2100 / (1050 / 100), 6) // 200（只算有倍率行）
    expect(out[0].anomaly.flatDamage).toBe(2000)
  })

  it('无倍率行不计倍率：属性区 = 0（无可反推）', () => {
    const out = computeDamageSourceBreakdown([row({ count: 5, perDamage: 10, totalDamage: 50 })])
    expect(out[0].direct.multiplier).toBe(0)
    expect(out[0].direct.attrRegion).toBe(0)
    expect(out[0].direct.flatDamage).toBe(50)
  })

  it('按 slot 分组 + 排序', () => {
    const rows = [
      row({ id: 'a', slot: 1, agentId: 'b', agentName: 'B', totalDamage: 1 }),
      row({ id: 'c', slot: 0, agentId: 'a', agentName: 'A', totalDamage: 2 }),
    ]
    const out = computeDamageSourceBreakdown(rows)
    expect(out.map(b => b.slot)).toEqual([0, 1])
  })
})
