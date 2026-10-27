/**
 * 副词条 A/B 对比卡 · 分数换算（用户 2026-10-27）。
 *
 * 判据要点：
 * ① 「其他都不变」= 血量随伤害同比缩放，且**非线性曲线**必须走反解 → 缩放 → 正算；
 * ② 两个配置对调（已知 A 算 B / 已知 B 算 A）结果对称；
 * ③ 伤害之比为 1 ⇒ 分数原样返回（含操作分）；
 * ④ 操作分只做加减、不进曲线（钳在 0~5000）；
 * ⑤ 普通 / 绝境两条曲线给出不同的分（绝境血多、每点血换的分更少）。
 */
import { describe, expect, it } from 'vitest'
import {
  OPERATION_SCORE_CAP,
  buildScoreConversion,
  clampOperationScore,
  splitTotalScore,
} from '@/composables/substatScoreConvert'

const base = {
  mode: 'defense' as const,
  knownSide: 'a' as const,
  // 用户 2026-10-28：填的是**总分**（默认操作分 5000 ⇒ 伤害分 25000）
  score: 30000,
  operationScore: 5000,
  aDamage: 1_000_000,
  bDamage: 1_100_000,
}

describe('substatScoreConvert · 分数换算', () => {
  it('★ 非线性：+10% 伤害 ≠ +10% 分数（先反解血量再正算，两段斜率不同）', () => {
    const r = buildScoreConversion({ ...base, operationScore: 0 })!
    expect(r.fromLabel).toBe('A')
    expect(r.toLabel).toBe('B')
    expect(r.damageRatio).toBeCloseTo(1.1, 12)
    expect(r.ratioTo).toBeCloseTo(r.ratioFrom * 1.1, 12)
    // A 打 30000 分 → 普通曲线落在「30.4…42.4 管 = 25600…36000 分」段（866.67 分/管）：
    // 35.477 管 ×1.1 = 39.025 管 ⇒ 25600 + (39.025−30.4)/12 × 10400 = 33074.67（不是线性的 33000）
    expect(r.scoreTo).toBeCloseTo(33074.67, 1)
    expect(r.scoreTo).not.toBeCloseTo(33000, 0)
    expect(r.delta).toBeCloseTo(r.scoreTo - 30000, 9)
    // 反向例子：43800 分（57.4 管）再 +10% 伤害只到 46899.6 分（+7.08%，因为该段只有 528.9 分/管）
    const high = buildScoreConversion({ ...base, score: 43800, operationScore: 0 })!
    expect(high.scoreTo).toBeCloseTo(46899.6, 1)
    expect(high.scoreTo).toBeLessThan(43800 * 1.1)
  })

  it('★ 已知 A / 已知 B 对称：互换未知后分数互换', () => {
    const ab = buildScoreConversion({ ...base, knownSide: 'a' })!
    // 用算出来的 B 总分回推 A：必须回到最初的 A（同一份操作分，来去一致）
    const ba = buildScoreConversion({ ...base, knownSide: 'b', score: ab.scoreTo })!
    expect(ba.toLabel).toBe('A')
    expect(ba.scoreTo).toBeCloseTo(base.score, 6)
    expect(ba.damageScoreFrom).toBeCloseTo(ab.damageScoreTo, 9)
  })

  it('伤害之比 = 1 ⇒ 总分原样（操作分不被曲线吞掉）', () => {
    const r = buildScoreConversion({ ...base, aDamage: 500, bDamage: 500 })!
    expect(r.scoreTo).toBeCloseTo(30000, 9)
    expect(r.delta).toBe(0)
    expect(r.operationScore).toBe(5000)
    expect(r.damageScoreFrom).toBe(25000)
  })

  it('操作分只做加减、不进曲线（曲线只吃伤害分）', () => {
    const withOp = buildScoreConversion({ ...base })!
    // 填的是总分 ⇒ 曲线输入 = 总分 − 操作分；输出 = 曲线结果 + 操作分（操作分原样返回、不给曲线加权）
    expect(withOp.damageScoreFrom).toBe(25000)
    expect(withOp.scoreFrom).toBe(30000)
    expect(withOp.scoreTo).toBeCloseTo(withOp.damageScoreTo + 5000, 9)
    // ⚠ 如实记录：操作分把「伤害分」在曲线上左移了，非线性曲线 ⇒ delta 与 0 操作分那份不同
    const without = buildScoreConversion({ ...base, operationScore: 0 })!
    expect(withOp.delta).not.toBeCloseTo(without.delta, 3)
  })

  it('普通 vs 绝境：同一总分、同一伤害比，两条曲线给出不同分数', () => {
    const normal = buildScoreConversion({ ...base })!
    const adversity = buildScoreConversion({ ...base, mode: 'critical_assault' })!
    expect(adversity.damageRatio).toBeCloseTo(normal.damageRatio, 12)
    expect(adversity.scoreTo).not.toBeCloseTo(normal.scoreTo, 3)
  })

  it('伤害读数可以是全队或该角色自身（函数只吃两个数，口径由调用方选定）', () => {
    const team = buildScoreConversion({ ...base })!
    const own = buildScoreConversion({ ...base, aDamage: 400_000, bDamage: 300_000 })!
    expect(team.damageRatio).toBeCloseTo(1.1, 12)
    expect(own.damageRatio).toBeCloseTo(0.75, 12)
    expect(own.scoreTo).toBeLessThan(own.scoreFrom)
  })

  it('打死了如实报 clamped（伤害分封顶 60000，操作分照加）', () => {
    const r = buildScoreConversion({ ...base, score: 64000, aDamage: 1, bDamage: 3 })!
    expect(r.clamped).toBe(true)
    expect(r.damageScoreTo).toBe(60000)
    expect(r.scoreTo).toBe(65000)
  })

  it('缺输入 ⇒ null（不编数）：没填分数 / 某边伤害为 0', () => {
    expect(buildScoreConversion({ ...base, score: null })).toBeNull()
    expect(buildScoreConversion({ ...base, score: Number.NaN })).toBeNull()
    expect(buildScoreConversion({ ...base, aDamage: 0 })).toBeNull()
    expect(buildScoreConversion({ ...base, bDamage: 0 })).toBeNull()
    expect(buildScoreConversion({ ...base, knownSide: 'b', bDamage: 0 })).toBeNull()
  })

  it('操作分钳在 0~5000', () => {
    expect(OPERATION_SCORE_CAP).toBe(5000)
    expect(clampOperationScore(-1)).toBe(0)
    expect(clampOperationScore(9999)).toBe(5000)
    expect(clampOperationScore(Number.NaN)).toBe(0)
    expect(clampOperationScore(null)).toBe(0)
    expect(clampOperationScore(1200)).toBe(1200)
  })
})

describe('substatScoreConvert · 总分拆成伤害分 + 操作分（用户 2026-10-28）', () => {
  it('★ 默认操作分 5000：填 65000 总分 ⇒ 伤害分 60000（满分）', () => {
    expect(splitTotalScore(65000, 5000)).toEqual({ damageScore: 60000, operationScore: 5000 })
    expect(splitTotalScore(30000, 5000)).toEqual({ damageScore: 25000, operationScore: 5000 })
  })

  it('操作分可改：填同一个总分、操作分不同 ⇒ 伤害分不同', () => {
    expect(splitTotalScore(30000, 0).damageScore).toBe(30000)
    expect(splitTotalScore(30000, 5000).damageScore).toBe(25000)
  })

  it('钳制不产生负数：总分低于操作分 ⇒ 伤害分 0；操作分钳到 0~5000', () => {
    expect(splitTotalScore(1200, 5000)).toEqual({ damageScore: 0, operationScore: 5000 })
    expect(splitTotalScore(30000, 99999)).toEqual({ damageScore: 25000, operationScore: 5000 })
    expect(splitTotalScore(70000, 0)).toEqual({ damageScore: 60000, operationScore: 0 }) // 伤害分封顶
  })

  it('缺总分 ⇒ 伤害分 0（不返回 NaN）', () => {
    expect(splitTotalScore(null, 5000)).toEqual({ damageScore: 0, operationScore: 5000 })
    expect(splitTotalScore(Number.NaN, 5000)).toEqual({ damageScore: 0, operationScore: 5000 })
  })

  it('换算是「总分 − 操作分」的同一份实现：buildScoreConversion 的入参就是总分', () => {
    const r = buildScoreConversion({ ...base, score: 65000 })!
    expect(r.damageScoreFrom).toBe(60000)
    expect(r.ratioFrom).toBeCloseTo(1, 9) // 60000 伤害分 = 100% 血 = 击杀
  })
})
