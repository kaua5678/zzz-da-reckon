/**
 * 菲林经济常量 = **期望值推导**，不是常量价（用户口径 2026-09-01：宏观期望足够，模拟抽卡运气已删）。
 *
 * 本文件锁的是「成本 / 收入这两个数字**从哪来**」，不是再抄一遍数值：
 * - 成本两条必须是**期望抽数 × 单抽价**的推导（93.75 / 62.5 × 160），且音擎金严格便宜于角色金；
 * - 购买阶梯必须由这两条常量**差分派生**（pullPlanner#tierCost），一旦有人改成「档位硬编码均价」，
 *   这里立刻红——那正是「常量价」这一历史形态的复现；
 * - 收入是**输入**：两个消费方各有默认值，不合并成一条常量；
 * - 充值汇率固定、且按「月卡 → 大月卡 → 直充」的性价比顺序分配（用户口径「都是先充月卡」）。
 *
 * ## 负控（改哪里这里会红）
 * - 把 CINEMA_GOLD_FILM 改成「62.5 × 160」（拿音擎池期望当角色池）⇒ 用例 ①② 红；
 * - 把阶梯改成写死 15000 / 10000 / 130000 的常量表 ⇒ 用例 ③④ 红（差分式对不上）；
 * - 把 WEAPON_GOLD_FILM 提到与角色金同价（「都是 1 金所以同价」的误读）⇒ 用例 ② 红；
 * - 把充值分配改成「先大月卡」⇒ 用例 ⑦ 红。
 */
import { describe, expect, it } from 'vitest'
import {
  CINEMA_GOLD_FILM,
  PERIODS_PER_VERSION,
  PLANNER_FILM_PER_VERSION,
  TOP_UP_TIERS,
  WEAPON_GOLD_FILM,
  allocateTopUpFilm,
  topUpPlanOf,
} from '@/data/filmEconomy'
import { PURCHASE_LADDER, tierCost } from '@/composables/pullPlanner'

/** 单抽价（菲林）。与 filmEconomy 的 PULL_FILM 同口径；测试里独立写常量，让推导式可读 */
const FILM_PER_PULL = 160
/** 角色池：综合出率含保底 1.6% ⇒ 62.5 抽/S；50/50 + 歪后必 UP ⇒ ×1.5 = 93.75 抽 */
const CINEMA_PULLS = 93.75
/** 音擎池：综合出率 2% ⇒ 50 抽/S；75/25 + 歪后必 UP ⇒ ×1.25 = 62.5 抽 */
const WENGINE_PULLS = 62.5

describe('抽卡成本：期望值推导（不是常量价、不是保底上限）', () => {
  it('① 角色金 = 93.75 抽 × 160（含保底与歪后必 UP 的期望，ceil 只抹零）', () => {
    expect(CINEMA_GOLD_FILM).toBe(Math.ceil(CINEMA_PULLS * FILM_PER_PULL))
    expect(CINEMA_GOLD_FILM).toBe(15000)
  })

  it('② 音擎金 = 62.5 抽 × 160，且严格便宜于角色金（同为 1 金但期望抽数更低）', () => {
    expect(WEAPON_GOLD_FILM).toBe(Math.ceil(WENGINE_PULLS * FILM_PER_PULL))
    expect(WEAPON_GOLD_FILM).toBe(10000)
    expect(WEAPON_GOLD_FILM).toBeLessThan(CINEMA_GOLD_FILM)
    // 比值必须等于两条期望抽数之比——任一被单独改数，这里先红
    expect(CINEMA_GOLD_FILM / WEAPON_GOLD_FILM).toBeCloseTo(CINEMA_PULLS / WENGINE_PULLS, 6)
  })
})

describe('购买阶梯：由两条常量差分派生（禁止档位硬编码均价）', () => {
  /** 档位 i 相对 i−1 的增量（首档额外含角色本体） */
  const deltas = PURCHASE_LADDER.map((rung, i) => {
    const from = i === 0 ? { cinema: 0, refine: 0 } : PURCHASE_LADDER[i - 1]
    return { tier: i + 1, body: i === 0 ? 1 : 0, cinema: rung.cinema - from.cinema, refine: rung.refine - from.refine }
  })

  it('③ 每一档价 = 本体 + Δ影画 × 角色金 + Δ精炼 × 音擎金（与常量逐位同源）', () => {
    for (const d of deltas) {
      const want = (d.body + d.cinema) * CINEMA_GOLD_FILM + d.refine * WEAPON_GOLD_FILM
      expect(tierCost(d.tier), 'tier ' + d.tier).toBe(want)
    }
  })

  it('④ 满配累计 = (1 + 影画数) × 角色金 + 精炼数 × 音擎金（不是 12 × 15000）', () => {
    const top = PURCHASE_LADDER[PURCHASE_LADDER.length - 1]
    const total = deltas.reduce((s, d) => s + tierCost(d.tier), 0)
    expect(total).toBe((1 + top.cinema) * CINEMA_GOLD_FILM + top.refine * WEAPON_GOLD_FILM)
    // 金数 12，但菲林不是 12 × 15000：专武本体与精炼那条更便宜，混算会高估
    const goldCount = 2 + top.cinema + (top.refine - 1)
    expect(goldCount).toBe(12)
    expect(total).toBeLessThan(goldCount * CINEMA_GOLD_FILM)
  })

  it('⑤ 阶梯内容 = 用户口径（本体 → 专武 → 满配）；改内容等于改口径，这里先红', () => {
    expect(PURCHASE_LADDER.map(r => [r.cinema, r.refine])).toEqual([[0, 0], [0, 1], [6, 5]])
  })
})

describe('收入与充值：是输入，不是隐藏常量', () => {
  it('⑥ 规划器默认收入与「一期 = 1/3 版本」口径各自成立', () => {
    expect(PLANNER_FILM_PER_VERSION).toBe(25000)
    expect(PERIODS_PER_VERSION).toBe(3)
    // 默认收入 ≈ 1.67 金：独立输入，别把「1 金 = 15000」干脆当成收入
    expect(PLANNER_FILM_PER_VERSION / CINEMA_GOLD_FILM).toBeCloseTo(25000 / 15000, 6)
    expect(PLANNER_FILM_PER_VERSION).not.toBe(CINEMA_GOLD_FILM)
  })

  it('⑦ 充值**档位化**：先买固定档（小月卡 30→3300 ×2、大月卡 68→2600 ×1），零头不折', () => {
    expect(allocateTopUpFilm(0)).toBe(0)
    expect(allocateTopUpFilm(30)).toBe(3300) // 1 小月卡 = 110 菲林/元（全档最高）
    expect(allocateTopUpFilm(60)).toBe(6600) // 2 小月卡（每版本上限）
    // 68 元 = 2 小月卡(60) + 余 8 元：大月卡要 68 元，买不起 ⇒ 8 元**不折菲林**（只给档位）
    expect(allocateTopUpFilm(68)).toBe(6600)
    expect(allocateTopUpFilm(98)).toBe(6600) // 同上，余 38 元也不折
    let prev = -1
    for (let yuan = 0; yuan <= 400; yuan++) {
      const film = allocateTopUpFilm(yuan)
      expect(film, 'yuan=' + yuan).toBeGreaterThanOrEqual(prev) // 单调不减
      prev = film
    }
    // 128 元 = 2 小月卡 + 大月卡（固定档全部买满）⇒ 之后才启用自由额度
    expect(allocateTopUpFilm(128)).toBe(2 * 3300 + 2600)
    // 160 元 = 128 + 余 32 元 × 10（买满后才换算）
    expect(allocateTopUpFilm(160)).toBe(2 * 3300 + 2600 + 32 * 10)
  })

  it('⑧ 明细可读：买满前后 leftoverYuan / freeFilm 的分界（页面据此提示「还差多少」）', () => {
    const before = topUpPlanOf(98)
    expect(before.allTiersMaxed).toBe(false)
    expect(before.purchases.map(p => [p.tier.id, p.count])).toEqual([['monthly', 2]])
    expect(before.freeYuan).toBe(0) // 没买满 ⇒ 不启用自由额度
    expect(before.freeFilm).toBe(0)
    expect(before.leftoverYuan).toBe(38) // 零头原样留着，不折
    expect(before.totalFilm).toBe(6600)

    const after = topUpPlanOf(160)
    expect(after.allTiersMaxed).toBe(true)
    expect(after.purchases.map(p => [p.tier.id, p.count])).toEqual([['monthly', 2], ['battlePass', 1]])
    expect(after.freeYuan).toBe(32)
    expect(after.freeFilm).toBe(320)
    expect(after.leftoverYuan).toBe(0)

    // 档位表本身：顺序 = 性价比降序（买之前不需要再排序）
    const ratios = TOP_UP_TIERS.map(t => t.film / t.yuan)
    expect(ratios).toEqual([...ratios].sort((a, b) => b - a))
  })
})
