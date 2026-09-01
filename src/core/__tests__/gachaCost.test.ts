/**
 * 保底定价模块（core/gachaCost.ts）的护栏。
 *
 * 三层价值：
 * ① 与 filmEconomy 的既有金价在 pity=0 处**恒等**——新模块不许悄悄改动既有经济口径（规则 11）；
 * ② 单调性/边界（垫得越多越便宜、大保底比非大保底便宜、硬保底前一抽必出）——这些是规划器
 *    将来把常量价换成价格函数时唯一能依赖的性质；
 * ③ 反解出率的自洽（solveBaseRate → truncatedGeomMean 往返）。
 */
import { describe, expect, it } from 'vitest'
import { CINEMA_GOLD_FILM, WEAPON_GOLD_FILM } from '@/data/filmEconomy'
import {
  CHAR_POOL,
  WENGINE_POOL,
  baseRateOf,
  expectedFilmToLimited,
  expectedPullsToLimited,
  expectedPullsToS,
  goldPerLimited,
  pityDiscount,
  solveBaseRate,
  truncatedGeomMean,
} from '../gachaCost'

describe('反解出率（把既有均值口径展开成逐抽 hazard，不引入新数据）', () => {
  it('solveBaseRate 往返：反解出的 p 代回截断几何均值 = 目标均值', () => {
    for (const [mean, pity] of [[62.5, 90], [50, 80], [30, 90]] as const) {
      const p = solveBaseRate(mean, pity)
      expect(truncatedGeomMean(p, pity)).toBeCloseTo(mean, 6)
    }
  })

  it('角色池基础出率落在合理区间（0.6% 公示基础值 ~ 1.6% 综合值之间）', () => {
    const p = baseRateOf(CHAR_POOL)
    expect(p).toBeGreaterThan(0.006)
    expect(p).toBeLessThan(0.016)
  })

  it('均值 ≥ 硬保底时退化为 0（不会解出负出率）', () => {
    expect(solveBaseRate(90, 90)).toBe(0)
    expect(truncatedGeomMean(0, 90)).toBe(90)
  })
})

describe('与 filmEconomy 恒等（单一事实源，pity=0 处不许有第二套口径）', () => {
  it('角色池零进度非大保底 = CINEMA_GOLD_FILM', () => {
    expect(expectedPullsToLimited(CHAR_POOL, 0, false)).toBeCloseTo(93.75, 6)
    expect(expectedFilmToLimited(CHAR_POOL, 0, false)).toBeCloseTo(CINEMA_GOLD_FILM, 6)
  })

  it('音擎池零进度非大保底 = WEAPON_GOLD_FILM', () => {
    expect(expectedPullsToLimited(WENGINE_POOL, 0, false)).toBeCloseTo(62.5, 6)
    expect(expectedFilmToLimited(WENGINE_POOL, 0, false)).toBeCloseTo(WEAPON_GOLD_FILM, 6)
  })

  it('歪的期望次数：50/50 → 1.5 次金，75/25 → 1.25 次金', () => {
    expect(goldPerLimited(CHAR_POOL)).toBeCloseTo(1.5, 9)
    expect(goldPerLimited(WENGINE_POOL)).toBeCloseTo(1.25, 9)
  })
})

describe('保底进度是资产（常量价看不见、价格函数才有的信息）', () => {
  it('垫得越多越便宜（严格单调递减）', () => {
    const costs = [0, 20, 40, 60, 80, 89].map(p => expectedPullsToLimited(CHAR_POOL, p, false))
    for (let i = 1; i < costs.length; i++) expect(costs[i]).toBeLessThan(costs[i - 1])
  })

  it('大保底比非大保底便宜，且差额 = 歪掉那一半的期望重来成本', () => {
    const guar = expectedPullsToLimited(CHAR_POOL, 0, true)
    const not = expectedPullsToLimited(CHAR_POOL, 0, false)
    expect(guar).toBeLessThan(not)
    expect(not - guar).toBeCloseTo((1 - CHAR_POOL.upRate) * expectedPullsToS(CHAR_POOL, 0), 6)
  })

  it('硬保底前一抽：还差 1 抽必出 S；已达/超过硬保底记为 0', () => {
    expect(expectedPullsToS(CHAR_POOL, CHAR_POOL.hardPity - 1)).toBeCloseTo(1, 9)
    expect(expectedPullsToS(CHAR_POOL, CHAR_POOL.hardPity)).toBe(0)
    expect(expectedPullsToS(CHAR_POOL, 999)).toBe(0)
  })

  it('折扣率：零状态 = 0；垫满 + 大保底 = 1（白拿）', () => {
    expect(pityDiscount(CHAR_POOL, 0, false)).toBeCloseTo(0, 9)
    expect(pityDiscount(CHAR_POOL, CHAR_POOL.hardPity, true)).toBeCloseTo(1, 9)
  })

  it('规划器最该看见的那档：垫 70 抽 + 大保底，成本不到满价三成', () => {
    const discount = pityDiscount(CHAR_POOL, 70, true)
    expect(discount).toBeGreaterThan(0.7)
    // 同一状态若没有大保底，折扣显著缩水（歪一半的风险要付钱）
    expect(pityDiscount(CHAR_POOL, 70, false)).toBeLessThan(discount)
  })
})
