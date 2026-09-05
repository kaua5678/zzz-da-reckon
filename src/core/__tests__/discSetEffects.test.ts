/**
 * 驱动盘套装 2pc/4pc 生效测试（2026-09 审计修复配套）
 *
 * 覆盖：震星迪斯科/极地重金属/自由蓝调 4pc 补录、啄木鸟 3 层、摇摆爵士 teamBuff、
 * 如影相随/山大王 2pc 补录、requirement 门槛（def/AM/critRate/specialty/attribute）、
 * {attribute} stat 模板、teamBuff 装备者门槛（山大王/月光骑士颂/雪兔）。
 * 数据：scripts/patch-disc-sets.mjs 写入 catalog.json；消费端：buff.ts collectDriveDiscBuffs
 * + inCombatBuffs.ts discTeamRequirementMet。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { calcPanel, emptyPanel } from '@/core/panel'
import { buildTeammateBuffSourceContext } from '@/core/teammateBuffSource'
import { getStunBuildUpBonus, getTargetedStat } from '@/core/buff'
import { getElementEnemyAnomalyResReduction, resolveStatElement, getElementDmgKey } from '@/core/anomalyPool/helpers'
import { normalizeResourceSkillType } from '@/composables/resourceCalc/helpers'
import { calcDirectDamage } from '@/core/damage'
import { setupHarness } from '@/test/harness'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'

function loadCatalog() {
  return JSON.parse(readFileSync(new URL('../../../public/static/catalog.json', import.meta.url), 'utf8'))
}

const cat = loadCatalog() as any
const setsMap = new Map<string, any>(cat.driveDiscSets.map((s: any) => [String(s.id), s]))
const statRules = cat.statRules
const getAgent = (id: string) => cat.agents.find((a: any) => a.id === id || a.teammateBuffId === id)

function disc(overrides: Record<string, any> = {}): any {
  return {
    fourPieceSetId: '',
    twoPieceSetId: '',
    mainStats: {},
    subStatAllocation: {},
    ...overrides,
  }
}

function panelFor(agentId: string, d: any) {
  const agent = getAgent(agentId)
  return calcPanel(agent, undefined, d, setsMap, [], statRules, { cinemaLevel: 0, wEngineModLevel: 1 })
}

/** 队友面板增量：owner 穿 fourPiece 后，target/owner 面板相对 owner 空盘基线的变化 */
function teammatePanels(ownerId: string, ownerIdDisc: any) {
  const targetAgent = getAgent('1241')
  const ownerAgent = getAgent(ownerId)
  const run = (ownerDisc: any) => {
    const team = [
      { agentId: ownerId, driveDisc: ownerDisc, cinemaLevel: 0, wEngineModLevel: 1 },
      { agentId: '1241', driveDisc: disc(), cinemaLevel: 0, wEngineModLevel: 1 },
    ]
    const ctx = buildTeammateBuffSourceContext(team, {
      teammateBuffGroups: [],
      driveDiscSetsMap: setsMap,
      statRules,
      getAgent,
      getWEngine: () => undefined,
      isTeammateBuffEnabled: () => false,
    })
    const target = calcPanel(targetAgent, undefined, disc(), setsMap, ctx.enabledTeammateBuffs, statRules, {
      cinemaLevel: 0,
      wEngineModLevel: 1,
      sourcePanelsByOwner: ctx.sourcePanelsByOwner,
    })
    // owner 自己也带队友 buff 计算（includeOwner 语义：驱动盘 teamBuff 装备者同样生效）
    const owner = calcPanel(ownerAgent, undefined, ownerDisc, setsMap, ctx.enabledTeammateBuffs, statRules, {
      cinemaLevel: 0,
      wEngineModLevel: 1,
      sourcePanelsByOwner: ctx.sourcePanelsByOwner,
    })
    return { target, owner }
  }
  const baseline = run(disc())
  const withSet = run(ownerIdDisc)
  return { target: withSet.target, owner: withSet.owner, baseline }
}

const EMPTY = disc()

describe('驱动盘 4pc 补录', () => {
  it('震星迪斯科 4pc：普攻/冲刺/闪避反击失衡值+20，其他招式不生效', () => {
    const p = panelFor('1481', disc({ fourPieceSetId: '31200', mainStats: { 6: 'impact' } })).inCombat
    const base = panelFor('1481', disc({ mainStats: { 6: 'impact' } })).inCombat
    expect(getStunBuildUpBonus(p, 'basic') - getStunBuildUpBonus(base, 'basic')).toBe(20)
    expect(getStunBuildUpBonus(p, 'dashAttack') - getStunBuildUpBonus(base, 'dashAttack')).toBe(20)
    expect(getStunBuildUpBonus(p, 'dodgeCounter') - getStunBuildUpBonus(base, 'dodgeCounter')).toBe(20)
    expect(getStunBuildUpBonus(p, 'ultimate') - getStunBuildUpBonus(base, 'ultimate')).toBe(0)
  })

  it('极地重金属 4pc：普攻/冲刺伤害+40（基础20+冻结段20），其他招式不生效', () => {
    const p = panelFor('1341', disc({ fourPieceSetId: '32500' })).inCombat
    expect(getTargetedStat(p, 'dmgBonus', 'basic')).toBe(40)
    expect(getTargetedStat(p, 'dmgBonus', 'dashAttack')).toBe(40)
    expect(getTargetedStat(p, 'dmgBonus', 'ultimate')).toBe(0)
    expect(p.dmgBonus).toBe(0)
  })

  it('自由蓝调 4pc：挂敌人 8s，全队同属性积蓄受益（teamBuff 按装备者属性落键）', () => {
    // 苍角(1131·冰)装备 → 队友(朱鸢·以太)面板拿到的是【冰】减抗（按装备者属性，不是受益者属性）
    const r = teammatePanels('1131', disc({ fourPieceSetId: '31300' }))
    expect(r.target.inCombat.enemyIceAnomalyResReduction).toBe(20)
    expect(r.target.inCombat.enemyEtherAnomalyResReduction ?? 0).toBe(0)
    // 装备者自己同样吃到（includeOwner）
    expect(r.owner.inCombat.enemyIceAnomalyResReduction).toBe(20)
    // 雅的烈霜(frostfire) 属性数值口径全按冰（用户口径 2026-09-05）：
    // 积蓄减抗、敌方积蓄抗性、增伤键都读冰
    expect(getElementEnemyAnomalyResReduction(r.target.inCombat, 'frostfire')).toBe(20)
    expect(resolveStatElement('frostfire')).toBe('ice')
    expect(getElementDmgKey('frostfire')).toBe('iceDmg')
  })
})

describe('招式类型定向接线（字段对应）', () => {
  it('normalizeResourceSkillType：冲刺招式按名称归类 dashAttack（catalog skillType 误标 dodge 的纠正）', () => {
    const skills = cat.agentSkills.find((s: any) => String(s.agentId) === '1131')
    const move = skills.categories.flatMap((c: any) => c.moves).find((m: any) => m.id === '1131016')
    expect(move.skillType).toBe('dodge')
    expect(normalizeResourceSkillType(move, '1131016')).toBe('dashAttack')
    expect(normalizeResourceSkillType(move, '1131016')).not.toBe('dodgeCounter')
  })

  it('烈霜(frostfire) 伤害按冰族读增伤与敌方冰抗（雅吃冰伤冰抗）', () => {
    const p = emptyPanel()
    p.atk = 1000
    p.iceDmg = 50
    const baseInput = {
      panel: p,
      skillMultiplier: 100,
      damageBasis: 'atk',
      enemyDefense: 1000,
      enemyDefReduction: 0,
      enemyDefFlatReduction: 0,
      enemyLevel: 70,
      enemyResReduction: 0,
      stunMultiplier: 1,
      stunned: false,
      critMode: 'nonCrit' as const,
      count: 1,
    }
    const withIce = calcDirectDamage({ ...baseInput, damageElement: 'frostfire' as any, enemyResistance: 0 }).damage
    const noIceEl = calcDirectDamage({ ...baseInput, damageElement: 'physical', enemyResistance: 0 }).damage
    // frostfire 行吃到 iceDmg+50%（physical 行不吃）
    expect(withIce).toBeGreaterThan(noIceEl * 1.4)
    // 敌方冰抗 20% 生效在 frostfire 行上
    const withRes = calcDirectDamage({ ...baseInput, damageElement: 'frostfire' as any, enemyResistance: 20 }).damage
    expect(withRes).toBeLessThan(withIce)
  })

  it('元素暴伤族接入暴击乘区（焰心桂冠 iceCritDmg/fireCritDmg 此前纯死数据）', () => {
    const p = emptyPanel()
    p.atk = 1000
    p.critRate = 100
    const baseInput = {
      panel: p,
      skillMultiplier: 100,
      damageBasis: 'atk',
      enemyDefense: 1000,
      enemyDefReduction: 0,
      enemyDefFlatReduction: 0,
      enemyLevel: 70,
      enemyResistance: 0,
      enemyResReduction: 0,
      stunMultiplier: 1,
      stunned: false,
      count: 1,
    }
    const noBuff = calcDirectDamage({ ...baseInput, damageElement: 'fire', critMode: 'crit' }).damage
    const withBuff = calcDirectDamage({ ...baseInput, damageElement: 'fire', critMode: 'crit', panel: { ...p, fireCritDmg: 30 } }).damage
    expect(withBuff).toBeCloseTo(noBuff * 1.2, 6)
    // 其它元素行不吃火元素暴伤
    const otherEl = calcDirectDamage({ ...baseInput, damageElement: 'electric', critMode: 'crit', panel: { ...p, fireCritDmg: 30 } }).damage
    expect(otherEl).toBe(noBuff)
    // 烈霜行按冰读 iceCritDmg
    const frost = calcDirectDamage({ ...baseInput, damageElement: 'frostfire' as any, critMode: 'crit', panel: { ...p, iceCritDmg: 30 } }).damage
    const frostNone = calcDirectDamage({ ...baseInput, damageElement: 'frostfire' as any, critMode: 'crit' }).damage
    expect(frost).toBeCloseTo(frostNone * 1.2, 6)
  })

  it('标准 exec 行携带 skillDamageTarget；极地重金属 4pc 普攻/冲刺限定增伤在伤害行生效', async () => {
    const run = async (fourPieceSetId: string, twoPieceSetId: string) => {
      await setupHarness(['', '', ''])
      const config = useConfigStore()
      config.setAgent(0, '1131')
      config.team[0].driveDisc.fourPieceSetId = fourPieceSetId
      config.team[0].driveDisc.twoPieceSetId = twoPieceSetId
      const calc = useResourceCalc()
      return { rr: calc.resourceResult.value!, rows: calc.damagePoolRows.value }
    }
    // 两臂都带 2pc（冰伤+10%），只差 4pc 的普攻/冲刺定向段 → 冲刺/普攻行变强，强特行不变
    const base = await run('', '32500')
    const with4 = await run('32500', '32500')
    const execs = with4.rr.characters[0].executions
    const dashExec = execs.find(e => e.moveId === '1131016')
    expect(dashExec?.skillDamageTarget).toBe('dashAttack')
    const basicExec = execs.find(e => e.moveId === '1131006' || e.moveId === 'basic_attack')
    expect(basicExec?.skillDamageTarget).toBe('basic')
    const rowOf = (rows: ReturnType<typeof useResourceCalc>['damagePoolRows']['value'], moveId: string) =>
      rows.find(r => r.moveId === moveId)
    const dashBase = rowOf(base.rows, '1131016')
    const dashWith = rowOf(with4.rows, '1131016')
    expect(dashBase && dashWith).toBeTruthy()
    expect(dashWith!.totalDamage).toBeGreaterThan(dashBase!.totalDamage)
    const basicWith = with4.rows.filter(r => r.moveId === '1131006' || r.moveId === 'basic_attack')
    const basicBase = base.rows.filter(r => r.moveId === '1131006' || r.moveId === 'basic_attack')
    expect(basicWith.reduce((s, r) => s + r.totalDamage, 0)).toBeGreaterThan(basicBase.reduce((s, r) => s + r.totalDamage, 0))
    // 强特行不吃 4pc 定向段（两臂 2pc 相同 → 逐位相等）
    const exBase = rowOf(base.rows, '1131011')
    const exWith = rowOf(with4.rows, '1131011')
    expect(exWith!.totalDamage).toBe(exBase!.totalDamage)
  })
})

describe('驱动盘 4pc 口径修正', () => {
  it('啄木鸟电音 4pc：3 层×9%=27% 攻击力（原只录单层）', () => {
    const withSet = panelFor('1131', disc({ fourPieceSetId: '31000', twoPieceSetId: '31000' }))
    const without = panelFor('1131', EMPTY)
    // 局内攻击增量 = 局外攻击 × 27%（2pc 暴击率不叠攻击）
    expect(withSet.inCombat.atk - without.inCombat.atk).toBeCloseTo(withSet.outOfCombat.atk * 0.27, 4)
    expect(withSet.inCombat.critRate - without.inCombat.critRate).toBe(8)
  })

  it('摇摆爵士 4pc：全队 +15% 只录 teamBuff——装备者恰好吃一份（15），不得双计 30', () => {
    const team = teammatePanels('1411', disc({ fourPieceSetId: '31600' }))
    expect(team.target.inCombat.dmgBonus - team.baseline.target.inCombat.dmgBonus).toBe(15)
    expect(team.owner.inCombat.dmgBonus - team.baseline.owner.inCombat.dmgBonus).toBe(15)
  })
})

describe('驱动盘 2pc 补录', () => {
  it('如影相随 2pc：追加/冲刺伤害+15%（定向），不进全局增伤', () => {
    const p = panelFor('1131', disc({ twoPieceSetId: '32900' })).inCombat
    expect(getTargetedStat(p, 'dmgBonus', 'dashAttack')).toBe(15)
    expect(getTargetedStat(p, 'dmgBonus', 'additionalAttack')).toBe(15)
    expect(getTargetedStat(p, 'dmgBonus', 'basic')).toBe(0)
  })

  it('山大王 2pc：攻击失衡值+6%', () => {
    const p = panelFor('1481', disc({ twoPieceSetId: '33200' })).inCombat
    const base = panelFor('1481', EMPTY).inCombat
    expect(getStunBuildUpBonus(p, 'all') - getStunBuildUpBonus(base, 'all')).toBe(6)
  })
})

describe('requirement 门槛', () => {
  it('棘刺玫瑰 4pc：防御<1000 零档，双防主词条+副词条过 1800 双档', () => {
    // 凯撒 defBase=754：无防主词条 → 粗算 def=754 <1000 → 两档都不给
    const none = panelFor('1071', disc({ fourPieceSetId: '34200' })).inCombat
    const baseNone = panelFor('1071', EMPTY).inCombat
    expect(none.critRate - baseNone.critRate).toBe(0)
    // 双防%主词条 + 防%副词条 → ≥1800 → 两档 +16
    const both = panelFor('1071', disc({
      fourPieceSetId: '34200',
      mainStats: { 4: 'defPct', 5: 'defPct' },
      subStatAllocation: { defPct: 20 },
    })).inCombat
    const baseBoth = panelFor('1071', disc({
      mainStats: { 4: 'defPct', 5: 'defPct' },
      subStatAllocation: { defPct: 20 },
    })).inCombat
    expect(both.critRate - baseBoth.critRate).toBe(16)
  })

  it('折枝剑歌 4pc：异常掌控≥115 才给暴伤+30（6号位掌控主词条达标）', () => {
    const withAm = panelFor('1481', disc({ fourPieceSetId: '32700', mainStats: { 6: 'anomalyMastery' } })).inCombat
    const baseWithAm = panelFor('1481', disc({ mainStats: { 6: 'anomalyMastery' } })).inCombat
    // 1481 琉音 AM=94 + 30 主词条 = 124 ≥115 → 生效（2pc 暴伤16 + 4pc 暴伤30）
    expect(withAm.critDmg - baseWithAm.critDmg).toBe(30 + 16)
    const noAm = panelFor('1481', disc({ fourPieceSetId: '32700' })).inCombat
    const baseNoAm = panelFor('1481', EMPTY).inCombat
    // 94 < 115 → 4pc 暴伤段不生效（2pc 暴伤16 照常）；暴击率段无门槛照常
    expect(noAm.critDmg - baseNoAm.critDmg).toBe(16)
    expect(noAm.critRate - baseNoAm.critRate).toBe(12)
  })

  it('拂晓生花 4pc：非强攻角色只拿第一段（要求 specialty=attack）', () => {
    const attack = panelFor('1521', disc({ fourPieceSetId: '33300' })).inCombat
    expect(getTargetedStat(attack, 'dmgBonus', 'basic')).toBe(15 + 40)
    const support = panelFor('1411', disc({ fourPieceSetId: '33300' })).inCombat
    expect(getTargetedStat(support, 'dmgBonus', 'basic')).toBe(15 + 20)
  })

  it('拂晓行纪 4pc：以太属性才给暴伤+30（要求 attribute=ether）', () => {
    const ether = panelFor('1311', disc({ fourPieceSetId: '34000' })).inCombat
    const base = panelFor('1311', EMPTY).inCombat
    expect(ether.critDmg - base.critDmg).toBe(30)
    const nonEther = panelFor('1411', disc({ fourPieceSetId: '34000' })).inCombat
    const baseNon = panelFor('1411', EMPTY).inCombat
    expect(nonEther.critDmg - baseNon.critDmg).toBe(0)
  })

  it('谶羽之誓 4pc：流明属性额外+15% 属性异常伤害', () => {
    const lum = panelFor('1581', disc({ fourPieceSetId: '34100' })).inCombat
    const baseLum = panelFor('1581', EMPTY).inCombat
    expect(lum.anomalyProficiency - baseLum.anomalyProficiency).toBe(30 + 50)
    expect(lum.anomalyDmgBonus - baseLum.anomalyDmgBonus).toBe(15)
    const ether = panelFor('1311', disc({ fourPieceSetId: '34100' })).inCombat
    const baseEther = panelFor('1311', EMPTY).inCombat
    expect(ether.anomalyProficiency - baseEther.anomalyProficiency).toBe(30 + 50)
    expect(ether.anomalyDmgBonus - baseEther.anomalyDmgBonus).toBe(0)
  })
})

describe('teamBuff 装备者门槛', () => {
  it('山大王 4pc：击破位传播全队暴伤；装备者暴击率≥50% 第二段才生效', () => {
    // 1481 琉音(击破) 无暴击配置 → 5+24(4号位主)=29 <50 → 只有第一段 15
    const low = teammatePanels('1481', disc({ fourPieceSetId: '33200', mainStats: { 4: 'critRate' } }))
    expect(low.target.inCombat.critDmg - low.baseline.target.inCombat.critDmg).toBe(15)
    // 4号位主24 + 17条×2.4=40.8 + 5 = 69.8 ≥50 → 两段 30
    const high = teammatePanels('1481', disc({
      fourPieceSetId: '33200',
      mainStats: { 4: 'critRate' },
      subStatAllocation: { critRate: 17 },
    }))
    expect(high.target.inCombat.critDmg - high.baseline.target.inCombat.critDmg).toBe(30)
  })

  it('山大王 4pc：非击破位装备者不传播', () => {
    const r = teammatePanels('1521', disc({ fourPieceSetId: '33200' }))
    expect(r.target.inCombat.critDmg - r.baseline.target.inCombat.critDmg).toBe(0)
  })

  it('月光骑士颂 4pc：支援位传播全队伤害+18%，强攻位不传播', () => {
    const support = teammatePanels('1411', disc({ fourPieceSetId: '33400' }))
    expect(support.target.inCombat.dmgBonus - support.baseline.target.inCombat.dmgBonus).toBe(18)
    const attack = teammatePanels('1521', disc({ fourPieceSetId: '33400' }))
    expect(attack.target.inCombat.dmgBonus - attack.baseline.target.inCombat.dmgBonus).toBe(0)
  })

  it('雪兔梦游仙境 4pc：防护位传播全队伤害+18%（6%×3 层），强攻位不传播', () => {
    const defense = teammatePanels('1071', disc({ fourPieceSetId: '33700' }))
    expect(defense.target.inCombat.dmgBonus - defense.baseline.target.inCombat.dmgBonus).toBe(18)
    const attack = teammatePanels('1521', disc({ fourPieceSetId: '33700' }))
    expect(attack.target.inCombat.dmgBonus - attack.baseline.target.inCombat.dmgBonus).toBe(0)
  })
})
