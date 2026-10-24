/**
 * 普通暴击期望乘区（CC-222 单一来源）：钳制 + 溢出→爆伤转化（词条比 1:2）。
 */
import { describe, expect, it } from 'vitest'
import { clampCritRatePct, expectedCritMultiplier, CRIT_OVERFLOW_TO_CRIT_DMG_RATIO } from '@/data/critMultiplier'

describe('expectedCritMultiplier（普通暴击期望乘区）', () => {
  it('非溢出：与旧算式逐位一致（1 + rate × D/100），转化零影响', () => {
    expect(expectedCritMultiplier(0, 120)).toBe(1)
    expect(expectedCritMultiplier(50, 100)).toBe(1.5)
    expect(expectedCritMultiplier(100, 120)).toBe(2.2)
    expect(expectedCritMultiplier(-10, 120), '负暴击按 0').toBe(1)
  })

  it('★ 溢出转化：局内暴击超 100% 的部分按词条比 1:2 转爆伤', () => {
    // 120% 暴击 / 爆伤 100：溢出 20 ⇒ 爆伤等效 100 + 2×20 = 140 ⇒ 乘区 1 + 1×1.4 = 2.4
    expect(expectedCritMultiplier(120, 100)).toBe(2.4)
    // 修前口径：钳到 100 白丢溢出 ⇒ 2.0（转化后 +20% 期望伤害）
    expect(expectedCritMultiplier(120, 100)).toBeGreaterThan(2.0)
    // 恰好 100 = 零溢出边界，不受转化影响
    expect(expectedCritMultiplier(100, 100)).toBe(2.0)
    // 大额溢出：175% ⇒ 溢出 75 ⇒ 爆伤 50 + 150 = 200 ⇒ 乘区 3.0
    expect(expectedCritMultiplier(175, 50)).toBeCloseTo(3.0, 10)
  })

  it('转化比常量钉死词条步长比（2.4 vs 4.8）', () => {
    expect(CRIT_OVERFLOW_TO_CRIT_DMG_RATIO).toBe(2)
  })

  it('clampCritRatePct 语义不变（概率用途不受转化影响）', () => {
    expect(clampCritRatePct(120)).toBe(100)
    expect(clampCritRatePct(-5)).toBe(0)
  })
})
