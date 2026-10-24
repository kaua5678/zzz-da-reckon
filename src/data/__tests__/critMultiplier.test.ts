/**
 * 普通暴击期望乘区（CC-222 单一来源）：钳制 + 溢出整条转化（词条步长 2.4/4.8）。
 */
import { describe, expect, it } from 'vitest'
import { clampCritRatePct, expectedCritMultiplier, CRIT_RATE_STEP, CRIT_DMG_STEP } from '@/data/critMultiplier'

describe('expectedCritMultiplier（普通暴击期望乘区）', () => {
  it('非溢出：与旧算式逐位一致（1 + rate × D/100），转化零影响', () => {
    expect(expectedCritMultiplier(0, 120)).toBe(1)
    expect(expectedCritMultiplier(50, 100)).toBe(1.5)
    expect(expectedCritMultiplier(100, 120)).toBe(2.2)
    expect(expectedCritMultiplier(-10, 120), '负暴击按 0').toBe(1)
  })

  it('★ 溢出整条转化：k = ceil(E/2.4) 条暴击换爆伤，暴击回落到 (97.6, 100]', () => {
    // 120% 暴击 / 爆伤 100：E=20 ⇒ k=ceil(20/2.4)=9 条 ⇒ 暴击 120−21.6=98.4、爆伤 100+43.2=143.2
    expect(expectedCritMultiplier(120, 100)).toBeCloseTo(1 + 0.984 * 1.432, 10)
    // 修前口径：钳到 100 白丢溢出 ⇒ 2.0（整条转化后 +20% 期望）
    expect(expectedCritMultiplier(120, 100)).toBeGreaterThan(2.0)
    // 恰好 100 = 零溢出边界，不受转化影响
    expect(expectedCritMultiplier(100, 100)).toBe(2.0)
    // 大额溢出：175% / 爆伤 50 ⇒ E=75 ⇒ k=32 ⇒ 暴击 98.2、爆伤 203.6
    expect(expectedCritMultiplier(175, 50)).toBeCloseTo(1 + 0.982 * 2.036, 10)
  })

  it('★ 微溢出（<1 条，配平器合法终态）：整条交换计——把那条词条从暴击改成爆伤的完整交换', () => {
    // 100.4% / D=146：E=0.4 ⇒ k=1 ⇒ 暴击 98、爆伤 150.8 ⇒ 乘区 1+0.98×1.508 = 2.47784
    // （用户口径：98% 再来一条变 100.4%，该词条值 2% 暴击；转化语义 = 该词条整条改爆伤，乘区自比大小）
    expect(expectedCritMultiplier(100.4, 146)).toBeCloseTo(1 + 0.98 * 1.508, 10)
    // 交换须划算：D < 235% 时 1 条交换恒赚（2.47784 > 钳掉口径 2.46）
    expect(expectedCritMultiplier(100.4, 146)).toBeGreaterThan(2.46)
  })

  it('词条步长常量钉死（2.4 / 4.8，S 级副词条）', () => {
    expect(CRIT_RATE_STEP).toBe(2.4)
    expect(CRIT_DMG_STEP).toBe(4.8)
  })

  it('clampCritRatePct 语义不变（概率用途不受转化影响）', () => {
    expect(clampCritRatePct(120)).toBe(100)
    expect(clampCritRatePct(-5)).toBe(0)
  })
})
