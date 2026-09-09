import { describe, expect, it } from 'vitest'
import { emptyPanel } from '@/core/panel'
import {
  calcAnomalyBuildUp,
  calcAnomalyDamage,
  calcDirectDamage,
  sharpCritMultiplier,
  type SpecialDamageProfile,
} from '@/core/damage'

describe('calcAnomalyBuildUp', () => {
  it('applies mastery, efficiency, and anomaly resistance', () => {
    const panel = emptyPanel()
    panel.anomalyMastery = 100
    panel.anomalyBuildUpEfficiency = 10
    panel.electricAnomalyBuildUpEfficiency = 5
    panel.enemyElectricAnomalyResReduction = 5

    const result = calcAnomalyBuildUp({
      panel,
      buildUpValue: 100,
      element: 'electric',
      enemyAnomalyResistance: 20,
    })

    expect(result.value).toBeCloseTo(100 * 1.15 * 0.85)
  })
})

describe('calcDirectDamage', () => {
  it('computes a clean no-defense hit with 100% crit expectation', () => {
    const panel = emptyPanel()
    panel.atk = 1000
    panel.critRate = 100
    panel.critDmg = 150

    const result = calcDirectDamage({
      panel,
      skillMultiplier: 100,
      damageElement: 'physical',
      damageBasis: 'atk',
      enemyDefense: 0,
      enemyDefReduction: 0,
      enemyDefFlatReduction: 0,
      enemyLevel: 60,
      enemyResistance: 0,
      enemyResReduction: 0,
      stunMultiplier: 1,
      stunned: false,
      critMode: 'expect',
      count: 1,
    })

    expect(result.damage).toBeCloseTo(2500)
  })

  it('adds frost enemy crit damage bonus into the crit expectation', () => {
    const panel = emptyPanel()
    panel.atk = 1000
    panel.critRate = 100
    panel.critDmg = 150
    panel.enemyCritDmgTakenBonus = 10

    const result = calcDirectDamage({
      panel,
      skillMultiplier: 100,
      damageElement: 'physical',
      damageBasis: 'atk',
      enemyDefense: 0,
      enemyDefReduction: 0,
      enemyDefFlatReduction: 0,
      enemyLevel: 60,
      enemyResistance: 0,
      enemyResReduction: 0,
      stunMultiplier: 1,
      stunned: false,
      critMode: 'expect',
      count: 1,
    })

    expect(result.damage).toBeCloseTo(2600)
  })

  it('applies the wind infection zone to wind and dyed-element direct damage only', () => {
    const base = emptyPanel()
    base.atk = 1000
    base.critRate = 0
    base.infectionZoneBonus = 10

    const opts = {
      panel: base,
      skillMultiplier: 100,
      damageBasis: 'atk' as const,
      enemyDefense: 0,
      enemyDefReduction: 0,
      enemyDefFlatReduction: 0,
      enemyLevel: 60,
      enemyResistance: 0,
      enemyResReduction: 0,
      stunMultiplier: 1,
      stunned: false,
      critMode: 'expect' as const,
      count: 1,
      infectionElement: 'fire',
    }

    const wind = calcDirectDamage({ ...opts, damageElement: 'wind' })
    const dyed = calcDirectDamage({ ...opts, damageElement: 'fire' })
    const other = calcDirectDamage({ ...opts, damageElement: 'physical' })
    expect(wind.damage).toBeCloseTo(1100)
    expect(dyed.damage).toBeCloseTo(1100)
    expect(other.damage).toBeCloseTo(1000)
  })

  it('applies sharp damage bonus multiplier for sharpen profile', () => {
    const panel = emptyPanel()
    panel.def = 1000
    panel.critRate = 0
    panel.sharpDmgBonus = 15
    panel.electricSharpDmg = 12

    const sharpenProfile: SpecialDamageProfile = {
      kind: 'sharpen',
      label: '锋御测试',
      basisLabel: '防御力区',
      basisFormula: () => 'def',
      calcBasisValue: (p: any) => p.def,
      usesSharpDmgBonus: true,
      critModel: 'sharp',
    }

    const result = calcDirectDamage({
      panel,
      skillMultiplier: 100,
      damageElement: 'electric',
      damageBasis: 'def',
      enemyDefense: 0,
      enemyDefReduction: 0,
      enemyDefFlatReduction: 0,
      enemyLevel: 60,
      enemyResistance: 0,
      enemyResReduction: 0,
      stunMultiplier: 1,
      stunned: false,
      critMode: 'nonCrit',
      count: 1,
      specialDamageProfile: sharpenProfile,
    })

    // basis = 1000, skillMult = 1.0, basisDamage = 1000
    // dmgBonus = 0, elementDmg = 0, skillDmgBonus = 0 → afterDmgBonus = 1000
    // sharpDmgBonus = 15 + electricSharpDmg = 12 = 27% → afterSharpDmg = 1000 * 1.27 = 1270
    // no penDmgBonus → afterPenDmg = 1270
    // no defense → afterDef = 1270
    // no resistance → afterRes = 1270
    // no dmgTaken → afterDmgTaken = 1270
    // no stun → afterStun = 1270
    // no infection → afterInfection = 1270
    // no crit → afterCrit = 1270
    expect(result.damage).toBeCloseTo(1270)
  })
})

describe('sharpCritMultiplier · 锋御锐暴（200% 封顶 + 额外锐暴乘算）', () => {
  it('100% 以内：与普通暴击同式 1 + r×d', () => {
    expect(sharpCritMultiplier(0, 150)).toBeCloseTo(1)
    expect(sharpCritMultiplier(50, 150)).toBeCloseTo(1.75)
    expect(sharpCritMultiplier(100, 150)).toBeCloseTo(2.5)
  })

  it('100% 以上：保证一次锐暴后再按溢出率做第二次（乘算，不是加算）', () => {
    // 用户口径：锐暴伤害 150% → 爆一次 ×2.5、爆两次 ×6.25；150% 暴击率 = 0.5 概率爆两次
    expect(sharpCritMultiplier(150, 150)).toBeCloseTo(0.5 * 2.5 + 0.5 * 6.25) // 4.375
    expect(sharpCritMultiplier(150, 150)).toBeCloseTo(2.5 * 1.75)
    expect(sharpCritMultiplier(200, 150)).toBeCloseTo(6.25)
    // 200% 以上按封顶处理（不再叠第三次）
    expect(sharpCritMultiplier(260, 150)).toBeCloseTo(6.25)
  })

  it('走直伤管线：critMode=expect 用同一乘区值', () => {
    const panel = emptyPanel()
    panel.def = 1000
    panel.critRate = 150
    panel.sharpCritDmg = 150
    const profile: SpecialDamageProfile = {
      kind: 'sharpen',
      label: '锋御测试',
      basisLabel: '防御力区',
      basisFormula: () => 'def',
      calcBasisValue: (p: any) => p.def,
      usesSharpDmgBonus: true,
      critModel: 'sharp',
    }
    const result = calcDirectDamage({
      panel,
      skillMultiplier: 100,
      damageElement: 'electric',
      damageBasis: 'def',
      enemyDefense: 0,
      enemyDefReduction: 0,
      enemyDefFlatReduction: 0,
      enemyLevel: 60,
      enemyResistance: 0,
      enemyResReduction: 0,
      stunMultiplier: 1,
      stunned: false,
      critMode: 'expect',
      count: 1,
      specialDamageProfile: profile,
    })
    // basis 1000 × 倍率 1.0 = 1000，暴击乘区 4.375
    expect(result.damage).toBeCloseTo(4375)
  })
})

describe('calcAnomalyDamage', () => {
  it('applies the 60-level coefficient and proficiency zone', () => {
    const panel = emptyPanel()
    panel.atk = 1000
    panel.anomalyProficiency = 100

    const result = calcAnomalyDamage({
      panel,
      baseMultiplier: 450,
      element: 'physical',
      enemyDefense: 0,
      enemyDefReduction: 0,
      enemyDefFlatReduction: 0,
      enemyLevel: 60,
      enemyResistance: 0,
      enemyResReduction: 0,
      stunned: false,
      damageKind: 'disorder',
    })

    expect(result.damage).toBeCloseTo(4500 * 2)
  })
})
