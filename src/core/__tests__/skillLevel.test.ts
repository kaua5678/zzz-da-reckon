import { describe, expect, it } from 'vitest'
import { getSkillLevelCoef } from '@/core/skillLevel'

describe('getSkillLevelCoef', () => {
  it('uses level 12 coefficients without cinema bonus', () => {
    const coef = getSkillLevelCoef(0)
    expect(coef.skillLevel).toBe(12)
    expect(coef.damageCoef).toBeCloseTo(1)
    expect(coef.dazeCoef).toBeCloseTo(1)
  })

  it('scales damage and daze for cinema 3/5 bonuses', () => {
    const c3 = getSkillLevelCoef(2)
    expect(c3.skillLevel).toBe(14)
    expect(c3.damageCoef).toBeCloseTo(24 / 22)
    expect(c3.dazeCoef).toBeCloseTo(35 / 33)

    const c5 = getSkillLevelCoef(4)
    expect(c5.skillLevel).toBe(16)
    expect(c5.damageCoef).toBeCloseTo(26 / 22)
    expect(c5.dazeCoef).toBeCloseTo(37 / 33)
  })
})
