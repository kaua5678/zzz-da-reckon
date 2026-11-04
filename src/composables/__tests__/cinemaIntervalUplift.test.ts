/**
 * 区间提升口径的行为锁（用户 2026-11-04「命座 × 难度曲线」专项）。
 * 口径全文见 `docs/mcp-cinema-interval-uplift.md`；实现头注释写明了「为什么两点必出负值」。
 *
 * 锁四件事：
 *   ① **域外必须 null**（不是 0、不是负）——采样没覆盖 ≠ 命座没收益；
 *   ② **上包络**：同一 x 上的低点不能污染「`x' ≤ x` 内的最高 y」；
 *   ③ 两种读法**各自独立成立**（同难度比伤害 / 同伤害比难度）；
 *   ④ 不提供「端点比端点」——负值如实计数（`negativeCount`），区间读数只是**度量**，不是洗白。
 */
import { describe, expect, it } from 'vitest'
import {
  compareFrontiers,
  damageAtNoMoreDifficulty,
  difficultyForDamage,
  upperFrontier,
  type FrontierPoint,
} from '@/composables/cinemaIntervalUplift'

const F = (pairs: Array<[number, number]>): FrontierPoint[] => pairs.map(([x, y]) => ({ x, y }))

describe('upperFrontier：上包络', () => {
  it('★ 同一 x 上只留最高者，且被支配的点整条丢掉', () => {
    const out = upperFrontier(F([[0, 10], [0, 12], [5, 11], [5, 20], [9, 15]]))
    expect(out).toEqual([{ x: 0, y: 12 }, { x: 5, y: 20 }])
  })

  it('★ 输入顺序无关（排序稳定，不依赖同级项的先后）', () => {
    const a = upperFrontier(F([[9, 15], [5, 20], [0, 12], [5, 11]]))
    const b = upperFrontier(F([[0, 12], [5, 11], [5, 20], [9, 15]]))
    expect(a).toEqual(b)
  })

  it('反空洞：非有限 / 非正的 y 被剔除（不会因为 NaN 把包络清空或穿透）', () => {
    const out = upperFrontier([
      { x: 0, y: Number.NaN },
      { x: 1, y: 0 },
      { x: 2, y: 5 },
    ] as FrontierPoint[])
    expect(out).toEqual([{ x: 2, y: 5 }])
  })
})

describe('同难度比伤害：域外必须是 null', () => {
  const hi = upperFrontier(F([[2, 20], [6, 30]]))

  it('★ x 低于 C_hi 最低采样点 ⇒ null（够不到，不是 0）', () => {
    expect(damageAtNoMoreDifficulty(hi, 1)).toBeNull()
  })

  it('★ 域内取 x\' ≤ x 的最高 y', () => {
    expect(damageAtNoMoreDifficulty(hi, 2)).toBe(20)
    expect(damageAtNoMoreDifficulty(hi, 4)).toBe(20) // 4 落在 [2,6) 里面 ⇒ 只能用 x=2 那个点
    expect(damageAtNoMoreDifficulty(hi, 6)).toBe(30)
    expect(damageAtNoMoreDifficulty(hi, 99)).toBe(30)
  })

  it('反空洞：空前沿 ⇒ null（不是 0）', () => {
    expect(damageAtNoMoreDifficulty([], 5)).toBeNull()
  })
})

describe('同伤害比难度', () => {
  const hi = upperFrontier(F([[2, 20], [6, 30]]))

  it('★ 达到该伤害的最小 x', () => {
    expect(difficultyForDamage(hi, 15)).toBe(2)
    expect(difficultyForDamage(hi, 25)).toBe(6)
  })

  it('★ 够不到的伤害 ⇒ null（不是 0 难度）', () => {
    expect(difficultyForDamage(hi, 999)).toBeNull()
  })
})

describe('compareFrontiers：区间读数', () => {
  it('★ 域外参考点不计入统计；domainComplete=false 如实报', () => {
    const cmp = compareFrontiers(F([[0, 10], [4, 20]]), F([[2, 12], [6, 24]]))
    // x=0 低于 C_hi 最低采样点 2 ⇒ 域外（null，不是 0）；x=4 在域内 ⇒ 取 2..4 的最高 y = 12
    expect(cmp.atSameDifficulty[0]).toMatchObject({ x: 0, hiY: null, deltaPct: null })
    expect(cmp.atSameDifficulty[1]).toMatchObject({ x: 4, hiY: 12, deltaPct: -40 })
    expect(cmp.summary.comparableCount).toBe(1)
    expect(cmp.summary.domainComplete).toBe(false)
    expect(cmp.summary.minPct).toBe(-40)
  })

  it('★ 负提升**如实计数**（区间口径不是洗白工具）', () => {
    const cmp = compareFrontiers(F([[0, 10], [5, 20]]), F([[0, 11], [5, 18]]))
    expect(cmp.summary.negativeCount).toBe(1)
    expect(cmp.summary.minPct).toBeCloseTo(-10, 10)
    expect(cmp.summary.maxPct).toBeCloseTo(10, 10)
    expect(cmp.summary.meanPct).toBeCloseTo(0, 10)
  })

  it('★ C_lo 的点全部低于 C_hi 的最低采样点 ⇒ 一个可比的点都没有，读数是 null 不是 0', () => {
    const cmp = compareFrontiers(F([[0, 10], [1, 11]]), F([[5, 20], [6, 22]]))
    expect(cmp.summary.comparableCount).toBe(0)
    expect(cmp.summary.minPct).toBeNull()
    expect(cmp.summary.maxPct).toBeNull()
    expect(cmp.summary.meanPct).toBeNull()
    expect(cmp.summary.domainComplete).toBe(false)
  })

  it('★ 参考难度高于 C_hi 的最高采样点 ⇒ 仍按「x\' ≤ x 的最高 y」给**下界**（前沿单调不减，不是 null）', () => {
    // C_hi 只采到 x=1，但它在 x=5 处至少不会低于 x=1 的值 ⇒ 返回 12 是保守下界，不是「够不到」
    const cmp = compareFrontiers(F([[5, 10]]), F([[0, 10], [1, 12]]))
    expect(cmp.atSameDifficulty[0]).toMatchObject({ x: 5, hiY: 12, deltaPct: 20 })
    expect(cmp.summary.comparableCount).toBe(1)
  })

  it('★ 同伤害比难度：savedX 正 = 省下来的难度', () => {
    const cmp = compareFrontiers(F([[5, 20]]), F([[0, 15], [3, 20]]))
    expect(cmp.atSameDamage[0]).toMatchObject({ loY: 20, loX: 5, hiX: 3 })
    expect(cmp.atSameDamage[0].savedX).toBeCloseTo(2, 10)
  })
})
