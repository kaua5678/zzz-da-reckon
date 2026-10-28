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
import { cinemaCostOf, cinemaFilmCostOf, FILM_PER_CINEMA_LEVEL, GOLD_PER_CINEMA_LEVEL } from '@/composables/cinemaUpliftCost'
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

describe('cinemaFilmCostOf（命座成本轴 · 菲林尺：价值计算口径）', () => {
  /**
   * 用户 2026-10-28：「金数…是为了直观表达一个队伍强度……做价值计算的时候可能只用万菲林均强度，准确一些。
   * 事实上 1 金本来就代表不同价格，只是社区俗语。」⇒ 价值一律用「每万菲林」，金只是展示俗语。
   */
  it('① 一级 = 一个限定命座的期望菲林（单一来源 filmEconomy），每万菲林 = 提升率 ÷ (菲林/10000)', () => {
    expect(FILM_PER_CINEMA_LEVEL).toBe(15000)
    const s = cinemaFilmCostOf(mk([10, 5, 20]), 40)
    expect(s.rows.map(r => r.film)).toEqual([15000, 15000, 15000])
    // 10% / (15000/10000) = 6.666…%每万菲林
    expect(s.rows[0]!.per10kFilmPct).toBeCloseTo(10 / 1.5, 9)
    expect(s.totalFilm).toBe(45000)
  })

  it('② 与金尺**不同分母**：同一提升率下 per10kFilm ≠ perGold（金是俗语，菲林才同尺可比）', () => {
    const gold = cinemaCostOf(mk([14.3]), 14.3)
    const film = cinemaFilmCostOf(mk([14.3]), 14.3)
    expect(gold.rows[0]!.perGoldPct).toBeCloseTo(14.3, 9)
    expect(film.rows[0]!.per10kFilmPct).toBeCloseTo(14.3 / 1.5, 9)
    expect(film.rows[0]!.per10kFilmPct).not.toBeCloseTo(gold.rows[0]!.perGoldPct, 3)
  })

  it('③ 累计每万菲林 ≠ 逐级算术平均（复利 vs 算术，与金尺同一条纪律）', () => {
    const s = cinemaFilmCostOf(mk([10, 10]), 21)
    expect(s.per10kFilmMeanPct).toBeCloseTo(10 / 1.5, 9)
    expect(s.per10kFilmTotalPct).toBeCloseTo(21 / 3, 9) // 2 级 = 30000 菲林 = 3 个万
    expect(s.per10kFilmTotalPct).not.toBeCloseTo(s.per10kFilmMeanPct!, 6)
  })

  it('④ 负值如实保留；best/worst 并列规则与金尺一致', () => {
    const s = cinemaFilmCostOf(mk([12, -8, 30]), 34)
    expect(s.rows[1]!.per10kFilmPct).toBeCloseTo(-8 / 1.5, 9)
    expect(s.worst!.level).toBe(2)
    const flat = cinemaFilmCostOf(mk([5, 5, 5]), 15)
    expect(flat.best!.level).toBe(1)
    expect(flat.worst!.level).toBe(3)
  })

  it('⑤ 空态与 NaN 输入确定性（不除零、不 NaN）', () => {
    const empty = cinemaFilmCostOf([], 0)
    expect(empty.rows).toEqual([])
    expect(empty.totalFilm).toBe(0)
    expect(empty.per10kFilmTotalPct).toBeNull()
    expect(empty.per10kFilmMeanPct).toBeNull()
    expect(empty.best).toBeNull()
    expect(empty.worst).toBeNull()

    const s = cinemaFilmCostOf(mk([10, Number.NaN, 5]), 15)
    expect(s.rows[1]!.gainPct).toBe(0)
    expect(Number.isFinite(s.per10kFilmMeanPct!)).toBe(true)
  })
})

