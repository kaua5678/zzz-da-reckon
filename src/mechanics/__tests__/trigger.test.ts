import { describe, expect, it } from 'vitest'
import { computePanelPhases } from '@/composables/resourceCalc/helpers'
import { setupHarness } from '@/test/harness'
import {
  TRIGGER_ADDITIONAL_MOVE_IDS,
  TRIGGER_C4_DAMAGE_MULTIPLIER,
  TRIGGER_C4_DAZE_MULTIPLIER,
  TRIGGER_C6_DAMAGE_MULTIPLIER,
  TRIGGER_C6_DMG_BONUS,
  computeTriggerCycle,
  triggerMechanic,
} from '@/mechanics/agents/trigger'

async function setup(mateId = '1081', cinemaLevel = 0) {
  const result = await setupHarness([
    { agentId: '1361', cinemaLevel, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
    { agentId: mateId, cinemaLevel: 0, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
    '',
  ])
  for (const buff of result.config.globalBuffs) buff.enabled = false
  return result
}

describe('「扳机」（1361）失衡易伤拐与命座差分', () => {
  it('核心被动失衡易伤+35%；影画1再+20%、影画2全队暴伤+24%', async () => {
    const { catalog, config } = await setup('1081', 0)
    const p0 = computePanelPhases(0, config, catalog)!.inCombat as any
    expect(p0.stunDmgMultiplierBonusAlways).toBeCloseTo(35, 5)

    config.team[0].cinemaLevel = 1
    config.syncTeammateBuffsFromTeam()
    const p1 = computePanelPhases(0, config, catalog)!.inCombat as any
    expect(p1.stunDmgMultiplierBonusAlways - p0.stunDmgMultiplierBonusAlways).toBeCloseTo(20, 5)

    config.team[0].cinemaLevel = 2
    config.syncTeammateBuffsFromTeam()
    const p2 = computePanelPhases(0, config, catalog)!.inCombat as any
    expect(p2.critDmg - p1.critDmg).toBeCloseTo(24, 5)
  })
})

describe('「扳机」额外能力·灵目银灯', () => {
  it('公式有阈值和上限，并且只修正三条追加攻击', () => {
    const panel = { critRate: 80, additionalAbilityActive: 1 } as any
    triggerMechanic.applyPanel!({ panel } as any)
    expect(panel.triggerAdditionalStunBuildUp).toBe(60)
    expect(panel.stunBuildUpBonus ?? 0).toBe(0)

    const target = [...TRIGGER_ADDITIONAL_MOVE_IDS].map(moveId => ({ moveId, stunBuildUpBonus: 0 }))
    const other = [{ moveId: '1361010', stunBuildUpBonus: 0 }, { moveId: '1361014', stunBuildUpBonus: 0 }]
    triggerMechanic.patchExecutions!({ cfg: { panel }, executions: [...target, ...other], state: {} } as any)
    for (const exec of target) expect(exec.stunBuildUpBonus).toBe(60)
    for (const exec of other) expect(exec.stunBuildUpBonus).toBe(0)

    const capped = { critRate: 120, additionalAbilityActive: 1 } as any
    triggerMechanic.applyPanel!({ panel: capped } as any)
    expect(capped.triggerAdditionalStunBuildUp).toBe(75)
    const off = { critRate: 120, additionalAbilityActive: 0 } as any
    triggerMechanic.applyPanel!({ panel: off } as any)
    expect(off.triggerAdditionalStunBuildUp ?? 0).toBe(0)
  })

  it('门控：强攻或同属性队友激活，火属性防护队友不激活', async () => {
    const attack = await setup('1081')
    expect((computePanelPhases(0, attack.config, attack.catalog)!.inCombat as any).additionalAbilityActive).toBe(1)
    const electric = await setup('1181')
    expect((computePanelPhases(0, electric.config, electric.catalog)!.inCombat as any).additionalAbilityActive).toBe(1)
    const defense = await setup('1121')
    expect((computePanelPhases(0, defense.config, defense.catalog)!.inCombat as any).additionalAbilityActive ?? 0).toBe(0)
  })
})

describe('「扳机」绝意、协奏与影画伤害行', () => {
  it('影画1将单次绝意获取提高25%并把上限提高到125', () => {
    const c0 = computeTriggerCycle({ cinemaLevel: 0, sniperHitCount: 5, normalCount: 0, hellCount: 0, exSpecialCount: 0, ultimateCount: 0 })
    const c1 = computeTriggerCycle({ cinemaLevel: 1, sniperHitCount: 5, normalCount: 0, hellCount: 0, exSpecialCount: 0, ultimateCount: 0 })
    expect(c0.resolveGainPerSniperHit).toBe(25)
    expect(c0.resolveGain).toBe(100)
    expect(c1.resolveGainPerSniperHit).toBe(31.25)
    expect(c1.resolveGain).toBe(125)
  })

  it('协战免费次数与付费绝意共同形成协奏总量', () => {
    const cycle = computeTriggerCycle({ cinemaLevel: 4, sniperHitCount: 4, normalCount: 4, hellCount: 2, exSpecialCount: 1, ultimateCount: 1 })
    expect(cycle.resolveSpent).toBe(22)
    expect(cycle.freeCoordinatedCount).toBe(10)
    expect(cycle.coordinatedCount).toBe(16)
    expect(cycle.c4DuanliCount).toBe(2)
  })

  it('影画4生成200%攻击伤害和120%冲击失衡的断离行', () => {
    const executions: any[] = []
    triggerMechanic.buildExecutions!({
      cfg: { triggerCinemaLevel: 4, triggerSniperHitCount: 4, triggerNormalCount: 4, triggerHellCount: 2 },
      state: { exSpecialCount: 1, ultimateCount: 1 }, executions,
    } as any)
    const row = executions.find(e => e.moveId === '1361_c4_duanli')
    expect(row.count).toBe(2)
    expect(row.damageMultiplier).toBe(TRIGGER_C4_DAMAGE_MULTIPLIER)
    expect(row.dazeMultiplier).toBe(TRIGGER_C4_DAZE_MULTIPLIER)
  })

  it('影画6按狙击命中与弹药总量生成1200%电伤、行级增伤50%', () => {
    const cycle = computeTriggerCycle({ cinemaLevel: 6, sniperHitCount: 8, normalCount: 10, hellCount: 0, exSpecialCount: 0, ultimateCount: 0 })
    expect(cycle.c6BulletGainFromSpend).toBe(1)
    expect(cycle.c6BulletCount).toBe(6)

    const executions: any[] = []
    triggerMechanic.buildExecutions!({
      cfg: { triggerCinemaLevel: 6, triggerSniperHitCount: 8, triggerNormalCount: 10, triggerHellCount: 0 },
      state: { exSpecialCount: 0, ultimateCount: 0 }, executions,
    } as any)
    const row = executions.find(e => e.moveId === '1361_c6_armor_piercing')
    expect(row.count).toBe(6)
    expect(row.damageMultiplier).toBe(TRIGGER_C6_DAMAGE_MULTIPLIER)
    expect(row.dmgBonus).toBe(TRIGGER_C6_DMG_BONUS)
    expect(row.element).toBe('electric')
  })
})
