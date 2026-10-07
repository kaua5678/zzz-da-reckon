import { describe, expect, it } from 'vitest'
import { DEADLY_ASSAULT_SCORE_CAP, scoreForDamageRatio } from '@/data/deadlyAssaultScore'

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
