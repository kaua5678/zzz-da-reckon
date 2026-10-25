/**
 * 命座提升率**成本轴**判据（B7）。
 *
 * ## 锁什么
 *
 * 1. **每金 = 逐级提升率 ÷ 1**（金数是常数 1，不许偷偷加权重）；
 * 2. **累计每金 ≠ 逐级算术平均**——因为累计提升率是**复利拼接**的。这条是本模块存在的理由：
 *    拿 `lockedTotalPct / 级数` 当「平均每金」会与逐级平均给出不同答案，读者必须知道用哪个；
 * 3. **负值如实保留**（命座让伤害变低是可能的），不许 clamp 到 0；
 * 4. **确定性空态**：空数组 ⇒ 全 null / 空行，不除零、不 NaN；单级 ⇒ best === worst。
 *
 * ## 负控
 *
 * - 把 `GOLD_PER_CINEMA_LEVEL` 改成 2 ⇒ 用例 ① / ② 红（每金被无形折半）；
 * - 把负数 clamp 成 0 ⇒ 用例 ③ 红；
 * - 把 `perGoldTotalPct` 改成 `perGoldMeanPct`（或反之）⇒ 用例 ② / ④ 红。
 */
import { describe, expect, it } from 'vitest'
import { cinemaCostOf, GOLD_PER_CINEMA_LEVEL } from '@/composables/cinemaUpliftCost'
import type { CinemaUpliftEntry } from '@/composables/cinemaUplift'

/** 只造 `cinemaCostOf` 真正读的字段（结构类型，不需要整条 entry） */
const mk = (gains: number[]): CinemaUpliftEntry[] =>
  gains.map(g => ({ gainPct: g } as CinemaUpliftEntry))

describe('cinemaCostOf（命座成本轴）', () => {
  it('① 每金 = 逐级提升率 ÷ 1（金数是常数，不许加隐藏权重）', () => {
    expect(GOLD_PER_CINEMA_LEVEL).toBe(1)
    const s = cinemaCostOf(mk([10, 5, 20]), 40)
    expect(s.rows.map(r => r.gold)).toEqual([1, 1, 1])
    expect(s.rows.map(r => r.perGoldPct)).toEqual([10, 5, 20])
    expect(s.totalGold).toBe(3)
  })

  it('② 累计每金 ≠ 逐级算术平均（复利 vs 算术：这就是不能拿累计算平均的理由）', () => {
    // 逐级 +10%/+10%：复利累计 21%，算术平均是 10，累计每金 21/2 = 10.5 ≠ 10
    const s = cinemaCostOf(mk([10, 10]), 21)
    expect(s.perGoldMeanPct).toBeCloseTo(10, 9)
    expect(s.perGoldTotalPct).toBeCloseTo(10.5, 9)
    expect(s.perGoldTotalPct).not.toBeCloseTo(s.perGoldMeanPct!, 6)
  })

  it('③ 负值如实保留（命座让伤害变低是可能的，不许 clamp 到 0）', () => {
    const s = cinemaCostOf(mk([12, -8, 30]), 34)
    expect(s.rows[1]!.perGoldPct).toBe(-8)
    expect(s.worst!.level).toBe(2)
    expect(s.worst!.perGoldPct).toBe(-8)
  })

  it('④ best / worst 的并列规则（best 取低命座、worst 取高命座）', () => {
    // 全相同 ⇒ best 取第 1 级、worst 取最后一级
    const flat = cinemaCostOf(mk([5, 5, 5]), 15)
    expect(flat.best!.level).toBe(1)
    expect(flat.worst!.level).toBe(3)
    // 有明显高低 ⇒ 各自命中
    const s = cinemaCostOf(mk([3, 25, 1]), 29)
    expect(s.best!.level).toBe(2)
    expect(s.worst!.level).toBe(3)
  })

  it('⑤ 空数组与单级的确定性（不除零、不 NaN）', () => {
    const empty = cinemaCostOf([], 0)
    expect(empty.rows).toEqual([])
    expect(empty.totalGold).toBe(0)
    expect(empty.perGoldTotalPct).toBeNull()
    expect(empty.perGoldMeanPct).toBeNull()
    expect(empty.best).toBeNull()
    expect(empty.worst).toBeNull()

    const one = cinemaCostOf(mk([7]), 7)
    expect(one.best!.level).toBe(1)
    expect(one.worst!.level).toBe(1)
    expect(one.perGoldTotalPct).toBeCloseTo(7, 9)
  })

  it('⑥ 非有限输入不污染结果（NaN/Infinity ⇒ 该级按 0 计，totalGold 仍确定）', () => {
    const s = cinemaCostOf(mk([10, Number.NaN, 5]), 15)
    expect(s.rows[1]!.gainPct).toBe(0)
    expect(s.totalGold).toBe(3)
    expect(Number.isFinite(s.perGoldMeanPct!)).toBe(true)
  })
})
