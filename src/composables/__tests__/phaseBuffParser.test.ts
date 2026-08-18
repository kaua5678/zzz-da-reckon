import { describe, expect, it } from 'vitest'
import { parsePhaseBuff, effectLabel } from '../../../scripts/phase-buff-parser.mjs'

describe('phase buff 解析器', () => {
  it('解析无条件效果与特性限定', () => {
    const r = parsePhaseBuff('摧心', '代理人的暴击伤害提升30%。\n[强攻]特性的代理人攻击力提升10%，[普通攻击]命中时造成的伤害提升30%，并无视敌人15%的防御力。')
    expect(r.testOnly).toBe(false)
    expect(r.effects).toHaveLength(3)
    expect(r.effects[0]).toMatchObject({ stat: 'critDmg', value: 30 })
    expect(r.effects[1]).toMatchObject({ stat: 'atkPct', value: 10, cond: { specialty: '强攻' } })
    expect(r.effects[2]).toMatchObject({ stat: 'enemyDefReduction', value: 15, cond: { specialty: '强攻' } })
  })

  it('解析异常特性 2/3 名分档', () => {
    const r = parsePhaseBuff('勠力', '队伍内存在2/3名[异常]特性代理人时，全队的异常精通分别提升30点/70点，造成的属性异常伤害分别提升10%/25%。\n对敌人施加属性异常效果后，敌人的全属性伤害抗性降低15%，持续10秒，重复触发时刷新持续时间。')
    expect(r.effects).toHaveLength(3)
    expect(r.effects[0]).toMatchObject({ stat: 'anomalyProficiency', value: 70, cond: { anomalyCount: [30, 70] } })
    expect(r.effects[1]).toMatchObject({ stat: 'anomalyDmgBonus', value: 25, cond: { anomalyCount: [10, 25] } })
    expect(r.effects[2]).toMatchObject({ stat: 'enemyResReduction', value: 15 })
  })

  it('解析失衡易伤直接入 stunDmgMultiplierBonus，多招式列表展开', () => {
    const r = parsePhaseBuff('掣霜', '[强攻]特性的代理人攻击力提升25%，[普通攻击]、[强化特殊技]、[连携技]命中敌人时，无视其30%的冰属性伤害抗性。\n代理人命中处于失衡状态的敌人时，其失衡易伤提升40%，持续5秒，重复触发时刷新持续时间。')
    const stats = r.effects.map(e => e.stat)
    expect(stats).toContain('atkPct')
    expect(stats).toContain('enemyIceResReduction')
    expect(r.effects.find(e => e.stat === 'stunDmgMultiplierBonus')).toMatchObject({ value: 40 })
  })

  it('冰袭：句号分句后普攻/终结技限定不带强攻标签', () => {
    const r = parsePhaseBuff('冰袭', '代理人的[普通攻击]、[终结技]造成的伤害提升30%。[强攻]特性的代理人攻击命中敌人时，无视其20%的冰属性伤害抗性。\n代理人发动[强化特殊技]后，自身的冰属性伤害提升30%，持续15秒，重复触发时刷新持续时间。')
    const basic = r.effects.find(e => e.stat === 'skillDmgBonus' && e.targetSkillType === 'basic')
    const ult = r.effects.find(e => e.stat === 'skillDmgBonus' && e.targetSkillType === 'ultimate')
    expect(basic).toMatchObject({ value: 30 })
    expect(basic?.cond?.specialty).toBeUndefined()
    expect(ult).toMatchObject({ value: 30 })
    expect(r.effects.find(e => e.stat === 'enemyIceResReduction')?.cond?.specialty).toBe('强攻')
    expect(r.effects.find(e => e.stat === 'iceDmg')).toMatchObject({ value: 30 })
  })

  it('锐化伤害 → sharpDmgBonus（锋御），贯穿伤害 → sheerDmgBonus（命破）', () => {
    const r = parsePhaseBuff('测试', '代理人的锐化伤害提升25%，防御力提升20%。\n[命破]特性的代理人贯穿伤害提升15%。')
    expect(r.effects.find(e => e.stat === 'sharpDmgBonus')).toMatchObject({ value: 25 })
    expect(r.effects.find(e => e.stat === 'defPct')).toMatchObject({ value: 20 })
    expect(r.effects.find(e => e.stat === 'sheerDmgBonus')).toMatchObject({ value: 15, cond: { specialty: '命破' } })
  })

  it('测试服占位标记 testOnly 且保留标题', () => {
    const r = parsePhaseBuff('(Test1)TBD', '代理人的冰属性伤害提升30%，异常精通提升50点。')
    expect(r.testOnly).toBe(true)
    expect(r.title).toContain('TBD')
  })

  it('effectLabel 输出可读标签', () => {
    const r = parsePhaseBuff('异变', '队伍中存在2/3名[异常]特性的代理人时，全队造成的属性异常伤害分别提升10%/30%，全队的攻击力分别提升5%/15%。')
    expect(effectLabel(r.effects[0])).toContain('异常伤')
    expect(effectLabel(r.effects[0])).toContain('30%')
    expect(effectLabel(r.effects[0])).toContain('异常2/3名')
  })
})
