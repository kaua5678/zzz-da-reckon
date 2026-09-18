import { describe, expect, it } from 'vitest'
import { emptyPanel } from '@/core/panel'
import { calcPerHitBuildUp } from '@/core/anomalyPool/helpers'
import {
  calcAnomalyDamage,
  calcDirectDamage,
  sharpCritMultiplier,
  type SpecialDamageProfile,
} from '@/core/damage'

/**
 * ★ R33（2026-09-18）：本条原先是 `describe('calcAnomalyBuildUp')`，测的是 `damage.ts` 里
 * 那个**零引用的同名死函数**——它与异常积蓄的**唯一活实现** `calcPerHitBuildUp`
 * （`core/anomalyPool/helpers.ts`）口径已**分叉**（活实现多 rowEfficiencyBonusPct、
 * `Math.floor(mastery)`）。⇒ 那条测试**看着像覆盖了异常积蓄口径，实际测的是一份没人跑的副本**。
 * 死函数已删；本用例改为调用**活实现**，期望值口径不变（两者在本输入下同值：
 * `floor(100)/100 × (1+(10+5)/100) × (1-(20-5)/100)`）。⚠ 改前此处是活实现的**零直接覆盖**。
 */
describe('calcPerHitBuildUp（异常积蓄唯一活实现）', () => {
  it('applies mastery, efficiency, and anomaly resistance', () => {
    const panel = emptyPanel()
    panel.anomalyMastery = 100
    panel.anomalyBuildUpEfficiency = 10
    panel.electricAnomalyBuildUpEfficiency = 5
    panel.enemyElectricAnomalyResReduction = 5

    const value = calcPerHitBuildUp(100, panel, 20, 'electric')

    expect(value).toBeCloseTo(100 * 1.15 * 0.85)
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

describe('calcDirectDamage · 乘区顺序（行为面 + 形状面成对）', () => {
  /**
   * 背景（round 32 假绿扫描，可复现的结构性证明）：
   * `@fact engine:damage/乘区顺序` 声称「调换 breakdown.push 顺序即改口径」，
   * 并把 `damage.test.ts` 写成它的「验」。但实测——**把抗性/易伤两个乘区的 push 块
   * 纯换序（damage 逐位不变）后，全库 2981 例 0 红**（真隔离 worktree @ 7496ad5）。
   * 根因：断言的出口全是 `result.damage`（可交换的乘法），而 `breakdown` 顺序**零断言**。
   *
   * 两条判据缺一不可（R30 §2.3 / R31 §2.3 的第四次验证）：
   * - 行为面钉「每个乘区的**数值**是前序乘区的累积」（顺序错了数值就错）；
   * - 形状面钉「每个乘区的**位次**」——行为面对**可交换换序**（抗性 ↔ 易伤）天生全盲。
   */
  const zonePanel = () => {
    const p = emptyPanel()
    p.atk = 1000
    p.critRate = 100
    p.critDmg = 150
    p.dmgBonus = 25
    p.enemyDamageTakenBonus = 20
    return p
  }
  const baseInput = (p: ReturnType<typeof emptyPanel>) => ({
    panel: p,
    skillMultiplier: 200,
    damageElement: 'physical' as const,
    damageBasis: 'atk' as const,
    enemyDefense: 500,
    enemyDefReduction: 0,
    enemyDefFlatReduction: 0,
    enemyLevel: 60,
    enemyResistance: 20,
    enemyResReduction: 0,
    stunMultiplier: 1.5,
    stunned: true,
    critMode: 'expect' as const,
    count: 3,
    flatDamageBonus: 100,
  })

  it('行为面：每个乘区 label 的 value = 前序乘区累积（顺序错了数值就错）', () => {
    const p = zonePanel()
    const { breakdown } = calcDirectDamage(baseInput(p))
    const byLabel = new Map(breakdown.map(b => [b.label, b.value]))

    // 基底 → ×倍率 → +固定附加（固定附加在**各乘区之前**进基础区，不是最后加）
    expect(byLabel.get('攻击力区')).toBeCloseTo(1000)
    expect(byLabel.get('技能倍率区')).toBeCloseTo(2000)
    expect(byLabel.get('固定附加伤害')).toBeCloseTo(100)
    // 增伤区：2000 + 100 = 2100，×1.25
    expect(byLabel.get('增伤乘区')).toBeCloseTo(2100 * 1.25)

    // 逐段递推：抗性区吃在防御区之后、易伤区吃在抗性区之后、失衡区吃在易伤区之后
    const afterDef = byLabel.get('防御乘区')!
    const afterRes = byLabel.get('抗性乘区')!
    const afterDmgTaken = byLabel.get('易伤乘区')!
    const afterStun = byLabel.get('失衡乘区')!
    expect(afterRes / afterDef).toBeCloseTo(1 - 0.2, 6) // 抗性 20% ⇒ ×0.8
    expect(afterDmgTaken / afterRes).toBeCloseTo(1.2, 6) // 易伤 +20% ⇒ ×1.2
    expect(afterStun / afterDmgTaken).toBeCloseTo(1.5, 6) // 失衡 ×1.5

    // 终值 = 失衡累积 × 暴击区 × 次数
    expect(byLabel.get('暴击乘区')! / afterStun).toBeCloseTo(2.5, 6)
    expect(byLabel.get('次数')).toBeCloseTo(byLabel.get('暴击乘区')! * 3, 6)
    expect(breakdown[breakdown.length - 1].value).toBeCloseTo(byLabel.get('次数')!)
  })

  it('★ 形状面：乘区位次 = 代码顺序（可交换换序对本条全盲的行为面是不可见的）', () => {
    const { breakdown } = calcDirectDamage(baseInput(zonePanel()))
    const labels = breakdown.map(b => b.label)
    // 声明里的顺序：基底→倍率→固定附加→增伤→(锐化)→(贯穿)→防御→抗性→易伤→失衡→(侵染)→暴击/锐暴→次数
    // 本输入的 profile=普通伤害（无锐化/贯穿）、元素=物理（无侵染）⇒ 这些区不出现，属正常
    expect(labels).toEqual([
      '攻击力区', '技能倍率区', '固定附加伤害', '增伤乘区',
      '防御乘区', '抗性乘区', '易伤乘区', '失衡乘区',
      '暴击乘区', '次数',
    ])
    // 反例锁死：抗性必须在易伤**之前**（round 32 注入的正是这两者互换 ⇒ 旧网 0 红）
    expect(labels.indexOf('抗性乘区')).toBeLessThan(labels.indexOf('易伤乘区'))
    expect(labels.indexOf('防御乘区')).toBeLessThan(labels.indexOf('抗性乘区'))
    expect(labels.indexOf('失衡乘区')).toBeLessThan(labels.indexOf('暴击乘区'))
    // 固定附加必须在增伤**之前**（放在最后加会少乘增伤/防御/抗性/易伤/失衡/暴击）
    expect(labels.indexOf('固定附加伤害')).toBeLessThan(labels.indexOf('增伤乘区'))
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
