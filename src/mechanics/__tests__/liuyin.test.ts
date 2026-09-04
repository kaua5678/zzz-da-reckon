import { describe, expect, it } from 'vitest'
import { computeLiuyinSource, computeLiuyinHugCounts } from '@/mechanics/agents/liuyin'

describe('琉音好评/等效规则（用户确认）', () => {
  it('好评 = 60 + 0.6×接战秒 + 7.5×强特数（无命座）', () => {
    const s = computeLiuyinSource({
      exSpecialCount: 10,
      ultimateCount: 3,
      combatTime: 100,
      cinemaLevel: 0,
      extraAbilityActive: true,
      previousTeammateSlot: 1,
    })
    expect(s.goodReviewInitial).toBe(60)
    expect(s.goodReviewGainTotal).toBeCloseTo(100 * 0.6 + 10 * 7.5, 6)
    expect(s.goodReviewTotal).toBeCloseTo(60 + 60 + 75, 6)
    expect(s.goodReviewC1Multiplier).toBe(1)
  })

  it('1命好评回复 ×1.16（乘算到每秒与强特重击）', () => {
    const s = computeLiuyinSource({
      exSpecialCount: 10,
      ultimateCount: 0,
      combatTime: 100,
      cinemaLevel: 1,
      extraAbilityActive: true,
      previousTeammateSlot: 1,
    })
    expect(s.goodReviewPerSec).toBeCloseTo(0.6 * 1.16, 6)
    expect(s.goodReviewPerEx).toBeCloseTo(7.5 * 1.16, 6)
    expect(s.goodReviewTotal).toBeCloseTo(60 + (100 * 0.6 + 10 * 7.5) * 1.16, 6)
  })

  it('等效规则：转大次数=floor(好评/90)，抱拳次数=转大+终结技次数', () => {
    const s = computeLiuyinSource({
      exSpecialCount: 10,
      ultimateCount: 4,
      combatTime: 120,
      cinemaLevel: 0,
      extraAbilityActive: true,
      previousTeammateSlot: 1,
    })
    // 好评 = 60 + 72 + 75 = 207 → 转大 2 次
    expect(s.promoteWindows).toBe(2)
    // 抱拳 = 2 + 4 = 6
    expect(s.farewellCount).toBe(6)
  })

  it('60/90 分配：60 受开窗次数与连携窗口夹紧，剩余走 90', () => {
    // 好评 207 → 开窗 2 次
    const h1 = computeLiuyinHugCounts(207, 5, -1, 8)
    expect(h1.hug60).toBe(2) // min(开窗2, 失衡5, 连携8)
    expect(h1.hug90).toBe(0)

    // 好评 207、无连携窗口 → 全走 90
    const h2 = computeLiuyinHugCounts(207, 5, -1, 0)
    expect(h2.hug60).toBe(0)
    expect(h2.hug90).toBe(2)

    // 好评 87（不满 90）→ 开窗 0 次，无法转大
    const h3 = computeLiuyinHugCounts(87, 5, -1, 8)
    expect(h3.hug60).toBe(0)
    expect(h3.hug90).toBe(0)

    // 好评 450 → 开窗 5；连携窗口 3 → 60 转大 3 次（有轴：连携窗口决定），剩余 2 走 90
    const h4 = computeLiuyinHugCounts(450, 2, -1, 3)
    expect(h4.hug60).toBe(3)
    expect(h4.hug90).toBe(2)

    // 上限：每次失衡最多 2 次 60 转大（用户口径 2026-09）——连携 10、失衡 2 → 60 转大被 2×2 封顶到 4
    const h5 = computeLiuyinHugCounts(450, 2, -1, 10)
    expect(h5.hug60).toBe(4)
    expect(h5.hug90).toBe(1)
  })
})
