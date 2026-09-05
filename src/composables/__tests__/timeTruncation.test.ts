/**
 * 时间线截断（truncateExecutionsToFrontline）生效测试。
 *
 * 钉住的口径（用户 2026-09-05）：资源允许的动作量装不进战斗时间时，**在时间线处截断**——
 * 实战 180s 到点结算，不管这一轮/这套连段打没打完；不许回退成「账本虚高 + 发呆留白」。
 * 两条硬约束：① 次数必须是整数（等比缩会产出「强特 ×2.78 次」这种不存在的动作）；
 * ② 平A是填充行、不参与截断，后台行不占前台。
 */
import { describe, it, expect } from 'vitest'
import { truncateExecutionsToFrontline } from '@/core/resource/helpers'
import type { SkillExecution } from '@/types/resource'

const row = (over: Partial<SkillExecution>): SkillExecution => ({
  moveId: 'm', moveName: '招式', category: 'special', count: 4, actionTime: 2,
  comboAlignRatio: 0, totalTime: 8, totalComboAlignTime: 0, energyConsume: 0,
  totalEnergyConsume: 0, decibelRecovery: 0, totalDecibelRecovery: 0,
  energyRecovery: 0, totalEnergyRecovery: 0, ...over,
} as SkillExecution)

const sum = (rows: SkillExecution[]) => rows.reduce((a, e) => a + (e.totalTime ?? 0), 0)

describe('时间线截断', () => {
  it('装得下 ⇒ 原样返回，不截断', () => {
    const rows = [row({ count: 4, totalTime: 8 })]
    const r = truncateExecutionsToFrontline(rows, 10)
    expect(r.cutSeconds).toBe(0)
    expect(r.executions).toBe(rows)
  })

  it('装不下 ⇒ 次数按整数砍，绝不出现小数次数', () => {
    const rows = [row({ count: 10, actionTime: 2, totalTime: 20 })]
    const r = truncateExecutionsToFrontline(rows, 13)
    expect(r.executions[0].count).toBe(6)               // floor(13/2)，不是 6.5
    expect(Number.isInteger(r.executions[0].count)).toBe(true)
    expect(sum(r.executions)).toBeLessThanOrEqual(13 + 1e-9)
    expect(r.cutSeconds).toBeCloseTo(20 - 12, 6)
    expect(r.executions[0].truncatedRatio).toBeCloseTo(0.6, 6)
  })

  it('多行时剩余时间按小数部分降序加回（同坑17 终局装包纪律）', () => {
    const rows = [
      row({ moveId: 'a', count: 3, actionTime: 2, totalTime: 6 }),   // 单位 2.0
      row({ moveId: 'b', count: 5, actionTime: 1.5, totalTime: 7.5 }), // 单位 1.5
    ]
    const r = truncateExecutionsToFrontline(rows, 10)
    expect(sum(r.executions)).toBeLessThanOrEqual(10 + 1e-9)
    for (const e of r.executions) expect(Number.isInteger(e.count)).toBe(true)
    // 10s 预算下必须真的用上（留白 < 最小单位时长）
    expect(10 - sum(r.executions)).toBeLessThan(1.5)
  })

  it('平A填充行永不截断；后台行不占前台也不参与', () => {
    const rows = [
      row({ moveId: 'basic_attack', count: 0, actionTime: 0, totalTime: 30 }),
      row({ moveId: 'm1', count: 10, actionTime: 2, totalTime: 20 }),
      row({ moveId: 'bg', count: 3, actionTime: 2, totalTime: 6, timeBucket: 'backstage' }),
    ]
    // 可用前台 40 = 平A 30 + 招式余量 10 ⇒ 招式行只能占 10s（平A是填充项，先保住）
    const r = truncateExecutionsToFrontline(rows, 40)
    const basic = r.executions.find(e => e.moveId === 'basic_attack')!
    const bg = r.executions.find(e => e.moveId === 'bg')!
    const m1 = r.executions.find(e => e.moveId === 'm1')!
    expect(basic.totalTime).toBe(30)   // 平A原样保留、不被截断
    expect(bg.totalTime).toBe(6)       // 后台行不占前台，不参与
    expect(m1.totalTime).toBeLessThanOrEqual(10 + 1e-9)
    expect(m1.count).toBe(5)           // 10s ÷ 单位 2s = 5 次（整数）
    expect(r.cutSeconds).toBeCloseTo(10, 6)
  })

  it('砍到 0 次的行整行消失（不留 count=0 的幽灵行）', () => {
    const rows = [
      row({ moveId: 'tiny', count: 1, actionTime: 9, totalTime: 9 }),
      row({ moveId: 'big', count: 2, actionTime: 1, totalTime: 2 }),
    ]
    const r = truncateExecutionsToFrontline(rows, 2)
    expect(r.executions.map(e => e.moveId)).toEqual(['big'])
    expect(r.cutSeconds).toBeCloseTo(9, 6)
  })

  it('总时长与派生量同比例缩（伤害/失衡/回能按次数线性）', () => {
    const rows = [row({
      count: 8, actionTime: 2, totalTime: 16, decibelRecovery: 100, totalDecibelRecovery: 800,
      energyConsume: 20, totalEnergyConsume: 160, anomalyBuildUp: 5, totalAnomalyBuildUp: 40,
    })]
    const r = truncateExecutionsToFrontline(rows, 8)
    const e = r.executions[0]
    expect(e.count).toBe(4)
    expect(e.totalTime).toBeCloseTo(8, 6)
    expect(e.totalDecibelRecovery).toBeCloseTo(400, 6)
    expect(e.totalEnergyConsume).toBeCloseTo(80, 6)
    expect(e.totalAnomalyBuildUp).toBeCloseTo(20, 6)
  })
})
