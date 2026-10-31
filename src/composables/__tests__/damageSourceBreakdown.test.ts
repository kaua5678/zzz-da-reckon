/**
 * 伤害来源分解（诊断）单元测试：computeDamageSourceBreakdown
 * 直伤/异常 × 总倍率/属性区 的口径锁——检查总伤害异常时定位倍率错还是属性区错。
 */
import { describe, expect, it } from 'vitest'
import { computeDamageSourceBreakdown, computeDamageSourceTotals, type DamagePoolRow } from '@/composables/resourceCalc/helpers'

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

/**
 * 有/无失衡两个属性区 + 失衡期贡献率 + 失衡爆发效率（用户口径 2026-10-28）。
 *
 * 反事实口径 = 行伤害 × 常驻易伤(always) / 实生效(applied)：
 * 「无失衡属性区」只抹 Boss 失衡窗，**非失衡期也生效的常驻易伤（扳机 35%/55%）保留**。
 * 这里用夹具直接给三个盖章字段（真实值由建池侧 \`damagePool.ts\` 按同一套算式写）。
 */
describe('含/无失衡属性区与失衡爆发效率', () => {
  it('无常驻易伤：无失衡属性区 = 全抹掉，贡献率 = (1 − 1/1.5)/1 = 33.3%', () => {
    const rows = [
      // 单行满覆盖：倍率 100、伤害 150（= 100 × 1.5）
      row({ count: 1, multiplier: 100, totalDamage: 150, stunWindowCoverage: 1, stunAppliedMult: 1.5, stunAlwaysMult: 1 }),
    ]
    const fam = computeDamageSourceBreakdown(rows)[0].direct
    expect(fam.attrRegion).toBeCloseTo(150, 6)
    expect(fam.attrRegionNoStun).toBeCloseTo(100, 6) // 150 × 1 / 1.5
    expect(fam.stunContributionRate).toBeCloseTo(1 / 3, 6)
    expect(fam.burstEfficiency).toBeCloseTo(1, 6)
  })

  it('★ 扳机常驻易伤不被抹：always 1.35 / applied 1.85 ⇒ 无失衡属性区停在 1.35 那一档', () => {
    const rows = [
      row({ count: 1, multiplier: 100, totalDamage: 185, stunWindowCoverage: 1, stunAppliedMult: 1.85, stunAlwaysMult: 1.35 }),
      // 零覆盖行（轴外）：常驻易伤照吃，比值恒 1 ⇒ 反事实 = 原值
      row({ count: 1, multiplier: 100, totalDamage: 135, stunWindowCoverage: 0, stunAppliedMult: 1.35, stunAlwaysMult: 1.35 }),
    ]
    const fam = computeDamageSourceBreakdown(rows)[0].direct
    // 有失衡：185（满窗 1.85×）+ 135（轴外只剩常驻 1.35×）⇒ 160
    expect(fam.attrRegion).toBeCloseTo((185 + 135) / (200 / 100), 6)
    // 无失衡：满窗行按 1.35/1.85 折回 = 135（**不是** 100 —— 扳机的 35% 是常驻的，不能抹）
    expect(fam.attrRegionNoStun).toBeCloseTo(135, 6)
    // 贡献率 = 1 − 135/160 = 15.625%；若错把 Always 通道一并抹掉，这里会得到 37.5%
    expect(fam.stunContributionRate).toBeCloseTo(1 - 135 / 160, 6)
    expect(fam.stunContributionRate).toBeLessThan(1 - 100 / 160)
    // 只有一半伤害落在窗内
    expect(fam.burstEfficiency).toBeCloseTo(185 / 320, 6)
  })

  it('异常行也计窗内伤害（burstEfficiency 按全族伤害加权，不只直伤）', () => {
    const rows = [
      row({ count: 1, multiplier: 100, totalDamage: 100, stunWindowCoverage: 0, stunAppliedMult: 1, stunAlwaysMult: 1 }),
      row({ type: '异放', count: 1, multiplier: 100, totalDamage: 100, stunWindowCoverage: 1, stunAppliedMult: 1.5, stunAlwaysMult: 1 }),
    ]
    const [b] = computeDamageSourceBreakdown(rows)
    expect(b.direct.burstEfficiency).toBe(0)
    expect(b.anomaly.burstEfficiency).toBe(1)
    const t = computeDamageSourceTotals([b])
    expect(t.burstEfficiency).toBeCloseTo(0.5, 9)
  })

  it('无盖章字段（夹具/旧数据）⇒ 视为与失衡无关：无失衡属性区 = 有失衡属性区、贡献率 0', () => {
    const rows = [row({ count: 2, multiplier: 100, totalDamage: 300 })]
    const fam = computeDamageSourceBreakdown(rows)[0].direct
    expect(fam.attrRegionNoStun).toBe(fam.attrRegion)
    expect(fam.stunContributionRate).toBe(0)
  })

  it('队伍合计按族合并后再算（不把两个属性区相加），无倍率行仍单列', () => {
    const rows = [
      row({ count: 1, multiplier: 100, totalDamage: 150, stunWindowCoverage: 1, stunAppliedMult: 1.5, stunAlwaysMult: 1 }),
      row({ type: '异放', count: 1, multiplier: 300, totalDamage: 450, stunWindowCoverage: 1, stunAppliedMult: 1.5, stunAlwaysMult: 1 }),
      row({ type: '简6命附伤', count: 1, totalDamage: 50, stunWindowCoverage: 0, stunAppliedMult: 1, stunAlwaysMult: 1 }),
    ]
    const t = computeDamageSourceTotals(computeDamageSourceBreakdown(rows))
    expect(t.multiplier).toBe(400)
    expect(t.attrRegion).toBeCloseTo(600 / 4, 6) // (150+450) / (400/100) = 150
    expect(t.attrRegionNoStun).toBeCloseTo(400 / 4, 6) // 100
    expect(t.stunContributionRate).toBeCloseTo(1 / 3, 6)
    expect(t.flatDamage).toBe(50)
    expect(t.damage).toBe(650)
    expect(t.burstEfficiency).toBeCloseTo(600 / 650, 6)
  })
})
