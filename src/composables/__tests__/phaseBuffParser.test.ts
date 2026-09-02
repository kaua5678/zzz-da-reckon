import { describe, expect, it } from 'vitest'
import { parsePhaseBuff, effectLabel } from '../../../scripts/phase-buff-parser.mjs'

describe('phase buff 解析器', () => {
  it('解析无条件效果与特性限定（含「命中时」的招式限定）', () => {
    const r = parsePhaseBuff('摧心', '代理人的暴击伤害提升30%。\n[强攻]特性的代理人攻击力提升10%，[普通攻击]命中时造成的伤害提升30%，并无视敌人15%的防御力。')
    expect(r.testOnly).toBe(false)
    expect(r.effects).toHaveLength(4)
    expect(r.effects.find(e => e.stat === 'critDmg')).toMatchObject({ value: 30 })
    expect(r.effects.find(e => e.stat === 'atkPct')).toMatchObject({ value: 10, cond: { specialty: '强攻' } })
    expect(r.effects.find(e => e.stat === 'skillDmgBonus')).toMatchObject({ value: 30, targetSkillType: 'basic', cond: { specialty: '强攻' } })
    expect(r.effects.find(e => e.stat === 'enemyDefReduction')).toMatchObject({ value: 15, cond: { specialty: '强攻' } })
  })

  it('叠层 buff 满覆盖：每层 X% × 最多叠加 N 层', () => {
    const r = parsePhaseBuff('动摇', '彷徨猎手处于[秽浊流界]中时，基础防御提高40%；代理人发动[支援突击]或[闪避反击]命中彷徨猎手时，将对其施加1层[动摇]。[动摇]最多叠加5层，持续15秒，重复触发时刷新持续时间。\n· 代理人攻击命中彷徨猎手时，对方每有1层[动摇]，代理人的贯穿伤害提升7%。')
    expect(r.effects.find(e => e.stat === 'sheerDmgBonus')).toMatchObject({ value: 35 })
    const r2 = parsePhaseBuff('心无旁骛', '对首领敌人施加属性异常或[紊乱]效果时，全队获得1层[心无旁骛]，最多叠加6层，每层[心无旁骛]会使代理人的攻击力提升8%。')
    expect(r2.effects.find(e => e.stat === 'atkPct')).toMatchObject({ value: 48 })
  })

  it('叠层拆分：最多叠加 N 层按触发器拆，前段 flat 不乘（朔风）；boss 自身增伤跳过（愈战愈勇）', () => {
    const r = parsePhaseBuff('朔风', '代理人攻击力提升10%，对敌人施加[乱流]后，全队攻击力提升5%，异常精通提升10点，持续15秒，最多可叠加3层，重复触发时刷新持续时间。')
    const atk = r.effects.filter(e => e.stat === 'atkPct').sort((a, b) => a.value - b.value)
    expect(atk[0]).toMatchObject({ value: 10 }) // 无条件 flat
    expect(atk[1]).toMatchObject({ value: 15 }) // 乱流后 5% × 3
    expect(r.effects.find(e => e.stat === 'anomalyProficiency')).toMatchObject({ value: 30 })
    const r2 = parsePhaseBuff('愈战愈勇', '首领敌人每10秒获得1层[愈战愈勇]，使自身造成伤害提升20%，最多叠加3层；队伍中任意代理人对敌人施加属性异常效果时，将移除1层[愈战愈勇]并削弱目标，使其受到伤害提升15%，持续20秒。')
    expect(r2.effects).toHaveLength(1)
    expect(r2.effects[0]).toMatchObject({ stat: 'enemyDamageTakenBonus', value: 15 })
  })

  it('解析异常特性 2/3 名分档 → countTier', () => {
    const r = parsePhaseBuff('勠力', '队伍内存在2/3名[异常]特性代理人时，全队的异常精通分别提升30点/70点，造成的属性异常伤害分别提升10%/25%。\n对敌人施加属性异常效果后，敌人的全属性伤害抗性降低15%，持续10秒，重复触发时刷新持续时间。')
    expect(r.effects).toHaveLength(3)
    expect(r.effects[0]).toMatchObject({ stat: 'anomalyProficiency', value: 70, cond: { countTier: { specialty: '异常', thresholds: [2, 3], values: [30, 70] } } })
    expect(r.effects[1]).toMatchObject({ stat: 'anomalyDmgBonus', value: 25, cond: { countTier: { specialty: '异常', thresholds: [2, 3], values: [10, 25] } } })
    expect(r.effects[2]).toMatchObject({ stat: 'enemyResReduction', value: 15 })
  })

  it('解析强攻 1 名/2 名分档 → countTier（「提升A%/B%」无「分别」）', () => {
    const r = parsePhaseBuff('驰闪', '队伍内存在1名/2名[强攻]特性的代理人时，全队攻击力提升10%/25%。')
    expect(r.effects[0]).toMatchObject({ stat: 'atkPct', value: 25, cond: { countTier: { specialty: '强攻', thresholds: [1, 2], values: [10, 25] } } })
  })

  it('多元素并列伤害（和/、）各出效果', () => {
    const r = parsePhaseBuff('强袭', '[强攻]特性代理人的以太属性伤害和冰属性伤害提升35%。')
    expect(r.effects.find(e => e.stat === 'etherDmg')).toMatchObject({ value: 35, cond: { specialty: '强攻' } })
    expect(r.effects.find(e => e.stat === 'iceDmg')).toMatchObject({ value: 35, cond: { specialty: '强攻' } })
    const r2 = parsePhaseBuff('凛息', '代理人的风属性伤害、冰属性伤害提升20%，异常精通提升20点。')
    expect(r2.effects.find(e => e.stat === 'windDmg')).toMatchObject({ value: 20 })
    expect(r2.effects.find(e => e.stat === 'iceDmg')).toMatchObject({ value: 20 })
  })

  it('无视其 N% 的 X抗性和 Y抗性（各自值）各出减抗', () => {
    const r = parsePhaseBuff('锐裂', '代理人的穿透率提升10%，攻击命中敌人时无视其20%的电属性伤害抗性和20%的火属性伤害抗性。')
    expect(r.effects.find(e => e.stat === 'enemyElectricResReduction')).toMatchObject({ value: 20 })
    expect(r.effects.find(e => e.stat === 'enemyFireResReduction')).toMatchObject({ value: 20 })
    expect(r.effects.find(e => e.stat === 'penRatio')).toMatchObject({ value: 10 })
  })

  it('无视其 N% 的 X抗性和 Y抗性（共享值）各出减抗', () => {
    const r = parsePhaseBuff('掣霜', '[强攻]特性的代理人攻击力提升25%，[普通攻击]、[强化特殊技]、[连携技]命中敌人时，无视其30%的冰属性伤害抗性和以太属性伤害抗性。')
    expect(r.effects.find(e => e.stat === 'enemyIceResReduction')).toMatchObject({ value: 30 })
    expect(r.effects.find(e => e.stat === 'enemyEtherResReduction')).toMatchObject({ value: 30 })
  })

  it('紊乱/异放伤害分别入 disorderDamageBonus / anomalyReleaseDmgBonus', () => {
    const r = parsePhaseBuff('诛心', '代理人的属性异常积蓄效率提升30%，[紊乱]效果造成的伤害提升40%。\n对敌人施加[紊乱]效果时，全队回复10点能量，代理人的攻击力提升25%，持续30秒。')
    expect(r.effects.find(e => e.stat === 'disorderDamageBonus')).toMatchObject({ value: 40 })
    expect(r.effects.find(e => e.stat === 'anomalyBuildUpEfficiency')).toMatchObject({ value: 30 })
    expect(r.effects.find(e => e.stat === 'atkPct')).toMatchObject({ value: 25 })
    const r2 = parsePhaseBuff('掠火', '代理人造成的属性异常伤害提升15%，异放伤害提升15%。')
    expect(r2.effects.find(e => e.stat === 'anomalyReleaseDmgBonus')).toMatchObject({ value: 15 })
  })

  it('受到伤害/受到的暴击伤害入敌方易伤/受暴伤，boss 自身增伤被跳过', () => {
    const r = parsePhaseBuff('愈战愈勇', '首领敌人每10秒获得1层[愈战愈勇]，使自身造成伤害提升20%，最多叠加3层；队伍中任意代理人对敌人施加属性异常效果时，将移除1层[愈战愈勇]并削弱目标，使其受到伤害提升15%，持续20秒。')
    expect(r.effects).toHaveLength(1)
    expect(r.effects[0]).toMatchObject({ stat: 'enemyDamageTakenBonus', value: 15 })
    const r2 = parsePhaseBuff('魇缚者', '魇缚者进入失衡状态时，受到暴击伤害提升50%。')
    expect(r2.effects[0]).toMatchObject({ stat: 'enemyCritDmgTakenBonus', value: 50 })
  })

  it('失衡易伤「额外提升」与「命中时造成的伤害」都被解析', () => {
    const r = parsePhaseBuff('曜霜', '代理人的暴击伤害提升30%，攻击处于失衡状态的敌人时，该敌人的失衡易伤倍率额外提升20%，持续20秒。')
    expect(r.effects.find(e => e.stat === 'stunDmgMultiplierBonus')).toMatchObject({ value: 20 })
    expect(r.effects.find(e => e.stat === 'critDmg')).toMatchObject({ value: 30 })
  })

  it('失衡易伤直接入 stunDmgMultiplierBonus，多招式列表展开', () => {
    const r = parsePhaseBuff('掣霜', '[强攻]特性的代理人攻击力提升25%，[普通攻击]、[强化特殊技]、[连携技]命中敌人时，无视其30%的冰属性伤害抗性。\n代理人命中处于失衡状态的敌人时，其失衡易伤提升40%，持续5秒，重复触发时刷新持续时间。')
    const stats = r.effects.map(e => e.stat)
    expect(stats).toContain('atkPct')
    expect(stats).toContain('enemyIceResReduction')
    expect(r.effects.find(e => e.stat === 'stunDmgMultiplierBonus')).toMatchObject({ value: 40 })
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
