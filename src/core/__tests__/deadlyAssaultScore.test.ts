import { describe, expect, it } from 'vitest'
import {
  DEADLY_ASSAULT_SCORE_CAP,
  OPERATION_SCORE_CAP,
  SCORE_MODE_HINT,
  SCORE_MODE_LABEL,
  SCORE_MODE_OPERATION_CAP,
  SCORE_MODE_OPTIONS,
  damageRatioForScore,
  operationScoreCapOf,
  scoreForDamageRatio,
  scoreForDamageRatioOfRatio,
  scoreFromDamage,
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

/**
 * 木桩曲线（用户 2026-10-28）：「默认33亿血的其实是一个木桩本，他的曲线和绝境普通都不一样，
 * 是和分数成正比的，没有操作分」。
 */
describe('deadlyAssaultScore · 木桩（training_dummy）正比且无操作分', () => {
  it('★ 正比：分数 = 60000 × 伤害/血量（每 1% 血 = 600 分，全程一个斜率）', () => {
    for (const r of [0, 0.01, 0.1, 0.25, 0.5, 0.75, 0.999]) {
      expect(scoreForDamageRatio(r, 'training_dummy'), `ratio=${r}`).toBeCloseTo(DEADLY_ASSAULT_SCORE_CAP * r, 6)
    }
    expect(scoreForDamageRatio(1, 'training_dummy')).toBe(DEADLY_ASSAULT_SCORE_CAP)
  })

  it('★ 与危局两条曲线真不同：同一血量比例三个分数互不相等', () => {
    for (const r of [0.1, 0.25, 0.5, 0.8]) {
      const [n, c, d] = [
        scoreForDamageRatio(r, 'defense'),
        scoreForDamageRatio(r, 'critical_assault'),
        scoreForDamageRatio(r, 'training_dummy'),
      ]
      expect(new Set([n, c, d]).size, `ratio=${r} 三条曲线应有三个不同分数`).toBe(3)
    }
    // 反证「木桩 = 普通」这个最容易犯的联想：0.5 血普通 36676、木桩 30000
    expect(scoreForDamageRatio(0.5, 'training_dummy')).toBeCloseTo(30000, 6)
    expect(scoreForDamageRatio(0.5, 'defense')).not.toBeCloseTo(30000, 0)
  })

  it('★ 没有操作分：上限 0，且总分上限就是 60000', () => {
    expect(SCORE_MODE_OPERATION_CAP.training_dummy).toBe(0)
    expect(operationScoreCapOf('training_dummy')).toBe(0)
    expect(operationScoreCapOf('defense')).toBe(OPERATION_SCORE_CAP)
    expect(operationScoreCapOf('critical_assault')).toBe(OPERATION_SCORE_CAP)
  })

  it('反解互逆 + 越界钳制（木桩）', () => {
    for (const r of [0, 0.05, 0.3, 0.77, 1]) {
      expect(damageRatioForScore(scoreForDamageRatio(r, 'training_dummy'), 'training_dummy')).toBeCloseTo(r, 9)
    }
    expect(scoreForDamageRatio(1.4, 'training_dummy')).toBe(DEADLY_ASSAULT_SCORE_CAP)
    expect(scoreForDamageRatio(-1, 'training_dummy')).toBe(0)
  })

  it('配置换算在木桩上退化为「分数 × 伤害比」（等价性对拍，不是另一套公式）', () => {
    const r = scoreForDamageRatioOfRatio(24000, 1.1, 'training_dummy')
    expect(r.score).toBeCloseTo(24000 * 1.1, 6)
    expect(r.clamped).toBe(false)
  })

  it('scoreFromDamage：伤害 ÷ 血量 → 比例 + 伤害分（三条曲线都走同一入口）', () => {
    // 木桩 33.47 亿血打 6.69465 亿 = 20% 血 ⇒ 12000 分（正比）；
    // 普通同比例落在「13.27%…23.34% 血 = 8800…16000 分」段 ⇒ 13610.91（不是 12000）
    const dummy = scoreFromDamage(669_465_000, 3_347_325_000, 'training_dummy')
    expect(dummy.ratio).toBeCloseTo(0.2, 9)
    expect(dummy.damageScore).toBeCloseTo(12000, 6)
    expect(scoreFromDamage(669_465_000, 3_347_325_000, 'defense').damageScore).toBeCloseTo(13610.91, 2)
    // 血量 0 / 伤害非法 ⇒ 比例 0、不产生 NaN
    expect(scoreFromDamage(1e9, 0)).toEqual({ ratio: 0, damageScore: 0 })
    expect(scoreFromDamage(Number.NaN, 100)).toEqual({ ratio: 0, damageScore: 0 })
    expect(scoreFromDamage(-5, 100)).toEqual({ ratio: 0, damageScore: 0 })
    // 超血量 ⇒ 钳到击杀，不溢出 60000
    expect(scoreFromDamage(1000, 100, 'training_dummy')).toEqual({ ratio: 1, damageScore: DEADLY_ASSAULT_SCORE_CAP })
  })

  it('UI 口径：三个选项、标签单一来源、每个模式都有 hint', () => {
    expect(SCORE_MODE_OPTIONS.map(o => o.value)).toEqual(['defense', 'critical_assault', 'training_dummy'])
    expect(SCORE_MODE_OPTIONS.map(o => o.label)).toEqual(['普通', '绝境', '木桩'])
    expect(SCORE_MODE_OPTIONS.every(o => o.label === SCORE_MODE_LABEL[o.value])).toBe(true)
    for (const k of ['defense', 'critical_assault', 'training_dummy'] as const) {
      expect(SCORE_MODE_HINT[k].length).toBeGreaterThan(6)
    }
    // 木桩的 hint 必须点明「正比」和「没有操作分」两件事（用户原话的两条约束）
    expect(SCORE_MODE_HINT.training_dummy).toContain('正比')
    expect(SCORE_MODE_HINT.training_dummy).toContain('操作分')
  })
})
