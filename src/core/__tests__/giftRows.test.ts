/**
 * 赠行产物契约（`core/resource/giftRows.ts`）—— 时间系统重构·阶段1 ② 的机器判据。
 *
 * 为什么要有它：诺姆赠链 / 琉音赠大原先各自手搓行对象（装配后追加、不走 enrich 回填），
 * 历史上漂过一次（缺倍率 → 伤害池按 `damageMultiplier ≤ 0` 跳过、失衡池无 daze）。
 * 本测试把「单次 → 总量」的换算与「可选字段缺席」的语义钉死。
 */
import { describe, expect, it } from 'vitest'
import { buildGiftRow } from '@/core/resource/giftRows'

describe('赠行产物契约', () => {
  it('单次 → 总量：totalTime / totalAnomalyBuildUp / totalDecibelRecovery 按次数换算', () => {
    const row = buildGiftRow({
      moveId: '1021012', moveName: '赠连携', count: 3, actionTime: 1.25,
      comboAlignRatio: 0.2, damageMultiplier: 100, anomalyBuildUp: 5, decibelRecovery: 30,
      skillTableNote: 'test',
    })
    expect(row.count).toBe(3)
    expect(row.actionTime).toBe(1.25)
    expect(row.totalTime).toBeCloseTo(3.75, 9)
    expect(row.totalComboAlignTime).toBeCloseTo(0.75, 9)
    expect(row.totalAnomalyBuildUp).toBeCloseTo(15, 9)
    expect(row.totalDecibelRecovery).toBeCloseTo(90, 9)
    expect(row.energyConsume).toBe(0)
    expect(row.totalEnergyRecovery).toBe(0)
    expect(row.source).toBe('gift')
    expect(row.category).toBe('chain')
  })

  it('轴模式小数次数（按窗口加权的期望值）如实保留，总量线性缩放', () => {
    const row = buildGiftRow({
      moveId: '1591016', moveName: '赠大', count: 0.5, actionTime: 2.416,
      damageMultiplier: 1000, skillTableNote: 'test',
    })
    expect(row.count).toBeCloseTo(0.5, 12)
    expect(row.totalTime).toBeCloseTo(1.208, 9)
  })

  it('可选字段缺席的语义：dazeMultiplier 不写 = 「不适用」，写了 0 才是显式禁用', () => {
    const absent = buildGiftRow({ moveId: 'x', moveName: 'x', count: 1, actionTime: 1, skillTableNote: 't' })
    expect('dazeMultiplier' in absent).toBe(false)
    expect('dazeMultiplierOverride' in absent).toBe(false)
    expect('skillDamageTarget' in absent).toBe(false)
    expect('normaGiftChain' in absent).toBe(false)
    const present = buildGiftRow({
      moveId: 'x', moveName: 'x', count: 1, actionTime: 1, skillTableNote: 't',
      dazeMultiplier: 0, skillDamageTarget: 'ultimate', normaGiftChain: true,
    })
    expect(present.dazeMultiplier).toBe(0)
    expect(present.dazeMultiplierOverride).toBe(false)
    expect(present.skillDamageTarget).toBe('ultimate')
    expect(present.normaGiftChain).toBe(true)
  })

  it('倍率覆盖开关：>0 才置 damageMultiplierOverride（0 = 交回填/伤害池跳过）', () => {
    expect(buildGiftRow({ moveId: 'x', moveName: 'x', count: 1, actionTime: 1, damageMultiplier: 0, skillTableNote: 't' }).damageMultiplierOverride).toBe(false)
    expect(buildGiftRow({ moveId: 'x', moveName: 'x', count: 1, actionTime: 1, damageMultiplier: 12, skillTableNote: 't' }).damageMultiplierOverride).toBe(true)
  })

  it('次数钳非负（负次数不产生负时间行）', () => {
    const row = buildGiftRow({ moveId: 'x', moveName: 'x', count: -2, actionTime: 3, skillTableNote: 't' })
    expect(row.count).toBe(0)
    expect(row.totalTime).toBe(0)
  })
})
