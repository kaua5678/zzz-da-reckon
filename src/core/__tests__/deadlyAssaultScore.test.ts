import { describe, expect, it } from 'vitest'
import {
  DEADLY_ASSAULT_SCORE_CAP,
  damageRatioForScore,
  scoreForDamageRatio,
  scoreForDamageRatioOfRatio,
} from '@/data/deadlyAssaultScore'

describe('deadlyAssaultScore · 普通（defense）伤害血量% → 伤害分', () => {
  it('段边界精确命中：伤害血量比例 → 分数', () => {
    expect(scoreForDamageRatio(0)).toBe(0)
    expect(scoreForDamageRatio(4.8 / 87.4)).toBe(4000)
    expect(scoreForDamageRatio(11.6 / 87.4)).toBe(8800)
    expect(scoreForDamageRatio(20.4 / 87.4)).toBe(16000)
    expect(scoreForDamageRatio(30.4 / 87.4)).toBe(25600)
    expect(scoreForDamageRatio(42.4 / 87.4)).toBe(36000)
    expect(scoreForDamageRatio(57.4 / 87.4)).toBe(43800)
    expect(scoreForDamageRatio(1)).toBe(DEADLY_ASSAULT_SCORE_CAP)
  })

  it('段内线性插值：25% / 50% 血量不是线性 15000/30000', () => {
    expect(scoreForDamageRatio(0.25)).toBeCloseTo(17392, 5)
    expect(scoreForDamageRatio(0.5)).toBeCloseTo(36676, 5)
    expect(scoreForDamageRatio(0.99)).toBeCloseTo(59528.04, 2)
  })

  it('越界钳制', () => {
    expect(scoreForDamageRatio(1.5)).toBe(DEADLY_ASSAULT_SCORE_CAP)
    expect(scoreForDamageRatio(-0.5)).toBe(0)
  })
})

describe('deadlyAssaultScore · 困难（critical_assault）伤害血量% → 伤害分', () => {
  it('段边界精确命中：14.4/28.8/36/60/68/138/158 血量', () => {
    expect(scoreForDamageRatio(0, 'critical_assault')).toBe(0)
    expect(scoreForDamageRatio(14.4 / 158, 'critical_assault')).toBe(3000)
    expect(scoreForDamageRatio(28.8 / 158, 'critical_assault')).toBe(7000)
    expect(scoreForDamageRatio(36.0 / 158, 'critical_assault')).toBe(10000)
    expect(scoreForDamageRatio(60.0 / 158, 'critical_assault')).toBe(24000)
    expect(scoreForDamageRatio(68.0 / 158, 'critical_assault')).toBe(27500)
    expect(scoreForDamageRatio(138.0 / 158, 'critical_assault')).toBe(52000)
    expect(scoreForDamageRatio(1, 'critical_assault')).toBe(DEADLY_ASSAULT_SCORE_CAP)
  })

  it('段内线性插值：50% 血量 → 31350（普通同血量是 36676，两曲线不同）', () => {
    expect(scoreForDamageRatio(0.5, 'critical_assault')).toBeCloseTo(31350, 5)
    expect(scoreForDamageRatio(0.5, 'critical_assault')).not.toBe(scoreForDamageRatio(0.5))
  })

  it('越界钳制（困难同普通）', () => {
    expect(scoreForDamageRatio(2, 'critical_assault')).toBe(DEADLY_ASSAULT_SCORE_CAP)
    expect(scoreForDamageRatio(-1, 'critical_assault')).toBe(0)
  })
})

describe('deadlyAssaultScore · 反解（分数 → 伤害血量%）', () => {
  it('与正算逐段互逆：段边界与段内取样都能反解回原比例', () => {
    for (const mode of ['defense', 'critical_assault'] as const) {
      for (const ratio of [0, 0.01, 0.05, 0.1234, 0.25, 0.5, 0.8, 0.95, 1]) {
        const score = scoreForDamageRatio(ratio, mode)
        expect(damageRatioForScore(score, mode), `${mode} @ ${ratio}`).toBeCloseTo(ratio, 9)
      }
    }
  })

  it('段边界精确命中（不会落到相邻段上）', () => {
    expect(damageRatioForScore(4000)).toBeCloseTo(4.8 / 87.4, 12)
    expect(damageRatioForScore(43800)).toBeCloseTo(57.4 / 87.4, 12)
    expect(damageRatioForScore(52000, 'critical_assault')).toBeCloseTo(138.0 / 158, 12)
  })

  it('越界钳制：0 分 → 0% 血；满伤分 → 100%（击杀）', () => {
    expect(damageRatioForScore(0)).toBe(0)
    expect(damageRatioForScore(DEADLY_ASSAULT_SCORE_CAP)).toBe(1)
    expect(damageRatioForScore(1e9)).toBe(1)
    expect(damageRatioForScore(-100)).toBe(0)
  })
})

describe('deadlyAssaultScore · 配置换算（A 打分 → B 会打多少）', () => {
  it('同一套伤害（比值 1）⇒ 分数不变（两条曲线都成立）', () => {
    for (const mode of ['defense', 'critical_assault'] as const) {
      for (const score of [0, 3000, 17392, 36000, 60000]) {
        const r = scoreForDamageRatioOfRatio(score, 1, mode)
        expect(r.score, `${mode} @ ${score}`).toBeCloseTo(score, 6)
        expect(r.clamped).toBe(false)
      }
    }
  })

  it('★ 非线性：不能拿分数直接乘伤害比（实测反例）', () => {
    // A 打 36000 分（普通 = 42.4/87.4 血），伤害 ×1.1 ⇒ 血量 46.64/87.4 ⇒ 落在
    // 「42.4→57.4 血 = 36000→43800 分」这一段：36000 + (4.24/15)×7800 = 38204.8，不是 39600
    const r = scoreForDamageRatioOfRatio(36000, 1.1)
    expect(r.score).toBeCloseTo(38204.8, 1)
    expect(36000 * 1.1).toBe(39600)
    expect(Math.abs(r.score - 39600)).toBeGreaterThan(1000)
    // 反向（伤害变低）同理：不能直接乘
    const down = scoreForDamageRatioOfRatio(36000, 0.9)
    expect(down.score).toBeLessThan(36000 * 0.9)
  })

  it('结算方向单调：伤害比越大分越高；且 = 正算(反解(A分) × 伤害比)', () => {
    let prev = -1
    for (const k of [0.5, 0.8, 1, 1.2, 1.5, 2]) {
      const r = scoreForDamageRatioOfRatio(24000, k, 'critical_assault')
      expect(r.score).toBeGreaterThan(prev)
      prev = r.score
      expect(r.score).toBeCloseTo(scoreForDamageRatio(damageRatioForScore(24000, 'critical_assault') * k, 'critical_assault'), 9)
    }
  })

  it('打死了要如实报钳制（clamped = true，分数 = 60000）', () => {
    const r = scoreForDamageRatioOfRatio(50000, 2)
    expect(r.clamped).toBe(true)
    expect(r.ratioB).toBe(1)
    expect(r.score).toBe(DEADLY_ASSAULT_SCORE_CAP)
  })

  it('非法伤害比（NaN）按 1 处理，不产生 NaN 分数', () => {
    const r = scoreForDamageRatioOfRatio(12345, Number.NaN)
    expect(Number.isFinite(r.score)).toBe(true)
    expect(r.score).toBeCloseTo(12345, 6)
  })
})
