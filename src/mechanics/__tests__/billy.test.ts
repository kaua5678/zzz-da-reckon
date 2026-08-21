import { describe, expect, it } from 'vitest'
import { computePanelPhases } from '@/composables/resourceCalc/helpers'
import { useResourceCalc } from '@/composables/useResourceCalc'
import {
  BILLY_ADDITIONAL_ULT_PER_STACK,
  BILLY_C1_ENERGY,
  BILLY_C2_DODGE_DMG,
  BILLY_C4_EX_CRIT_MAX,
  BILLY_C6_DMG_PER_STACK,
  BILLY_CORE_CROUCH_DMG,
  BILLY_MOVE_IDS,
  computeBillyCycle,
  billyMechanic,
  resolveBillyC1TriggerCount,
} from '@/mechanics/agents/billy'
import { setupHarness } from '@/test/harness'

async function setup(mateId = '1021', cinemaLevel = 0) {
  const result = await setupHarness([
    { agentId: '1081', cinemaLevel, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
    { agentId: mateId, cinemaLevel: 0, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
  ])
  for (const buff of result.config.globalBuffs) buff.enabled = false
  return result
}

function cycle(overrides: Partial<Parameters<typeof computeBillyCycle>[0]> = {}) {
  return computeBillyCycle({
    cinemaLevel: 6,
    additionalActive: true,
    coreCrouchCoverage: 1,
    ultimateStacks: 2,
    c4ExCrit: 32,
    c6HitStacks: 5,
    battleTime: 180,
    ...overrides,
  })
}

function cfgWith(cinema: number, extra: Record<string, unknown> = {}) {
  return {
    ultimateMoveId: BILLY_MOVE_IDS.ultimate,
    dodgeCounterMoveId: BILLY_MOVE_IDS.dodgeCounter,
    exSpecialMoveId: BILLY_MOVE_IDS.exSpecial,
    billyCinemaLevel: cinema,
    billyCoreCrouchCoverage: 1,
    billyUltimateStacks: 2,
    billyC4ExCrit: 32,
    billyC6HitStacks: 5,
    billyAdditionalActive: true,
    billyBattleTime: 180,
    ...extra,
  }
}

describe('比利（1081）总量', () => {
  it('核心蹲姿增伤按覆盖率，额外能力终结增伤按层数与激活门控', () => {
    expect(cycle({}).coreCrouchDmg).toBe(BILLY_CORE_CROUCH_DMG)
    expect(cycle({ coreCrouchCoverage: 0.5 }).coreCrouchDmg).toBe(25)
    expect(cycle({ additionalActive: true, ultimateStacks: 2 }).ultimateDmg).toBe(BILLY_ADDITIONAL_ULT_PER_STACK * 2)
    expect(cycle({ additionalActive: true, ultimateStacks: 1 }).ultimateDmg).toBe(BILLY_ADDITIONAL_ULT_PER_STACK)
    expect(cycle({ additionalActive: false }).ultimateDmg).toBe(0)
  })

  it('影画2闪避反击、影画4强特暴击、影画6命中增伤按命座和输入门控', () => {
    expect(cycle({ cinemaLevel: 2 }).c2DodgeDmg).toBe(BILLY_C2_DODGE_DMG)
    expect(cycle({ cinemaLevel: 1 }).c2DodgeDmg).toBe(0)
    expect(cycle({ cinemaLevel: 4, c4ExCrit: 32 }).c4ExCritRate).toBe(BILLY_C4_EX_CRIT_MAX)
    expect(cycle({ cinemaLevel: 4, c4ExCrit: 20 }).c4ExCritRate).toBe(20)
    expect(cycle({ cinemaLevel: 3 }).c4ExCritRate).toBe(0)
    expect(cycle({ cinemaLevel: 6, c6HitStacks: 5 }).c6Dmg).toBe(BILLY_C6_DMG_PER_STACK * 5)
    expect(cycle({ cinemaLevel: 5 }).c6Dmg).toBe(0)
  })
})

describe('比利影画确定性规则', () => {
  it('C1 合并冲刺与闪反原始次数，并按5秒ICD封顶', () => {
    expect(resolveBillyC1TriggerCount(8, 20)).toBe(4)
    expect(resolveBillyC1TriggerCount(2, 20)).toBe(2)
    const value = cycle({ cinemaLevel: 1, dashAttackCount: 5, dodgeEnergyTriggerCount: 3, battleTime: 20 })
    expect(value.c1Energy).toBe(BILLY_C1_ENERGY * 4)
  })

  it('C2 成功翻滚次数才增加闪避反击与C6层数', () => {
    expect(cycle({ cinemaLevel: 6, c6HitStacks: 0, c2SuccessfulRolls: 2 }).c6Dmg).toBe(BILLY_C6_DMG_PER_STACK * 2)
    expect(cycle({ cinemaLevel: 6, c6HitStacks: 0, c2SuccessfulRolls: 0 }).c6Dmg).toBe(0)
  })
})

describe('比利执行行定向结算', () => {
  it('真实moveId：终结吃额外增伤、闪反吃C2、强特吃C4', () => {
    const ult: any = { moveId: '1081019', category: 'chain' }
    const chain: any = { moveId: '1081018', category: 'chain' }
    const dodge: any = { moveId: '1081017', category: 'dodge' }
    const ex: any = { moveId: '1081013', category: 'special' }
    const neighboring: any[] = [
      { moveId: '1081014', category: 'dodge' },
      { moveId: '1081011', category: 'special' },
    ]
    billyMechanic.patchExecutions!({ cfg: cfgWith(4), state: {} as any, executions: [ult, chain, dodge, ex, ...neighboring] } as any)
    expect(ult.dmgBonus).toBe(BILLY_ADDITIONAL_ULT_PER_STACK * 2)
    expect(chain.dmgBonus).toBeUndefined()
    expect(dodge.dmgBonus).toBe(BILLY_C2_DODGE_DMG)
    expect(ex.critRateBonus).toBe(BILLY_C4_EX_CRIT_MAX)
    for (const row of neighboring) {
      expect(row.dmgBonus).toBeUndefined()
      expect(row.critRateBonus).toBeUndefined()
    }
  })

  it('C2成功翻滚会显式增加闪避反击执行次数', () => {
    const dodge: any = { moveId: BILLY_MOVE_IDS.dodgeCounter, count: 1, actionTime: 1, comboAlignRatio: 0, decibelRecovery: 0, totalTime: 1, totalComboAlignTime: 0, totalDecibelRecovery: 0 }
    billyMechanic.patchExecutions!({ cfg: cfgWith(2, { billyC2SuccessfulRolls: 2 }), state: {} as any, executions: [dodge] } as any)
    expect(dodge.count).toBe(3)
  })

  it('核心蹲姿增伤只作用真实普通攻击行', () => {
    const basics = ['1081002', '1081003', '1081004', '1081007', '1081008'].map(moveId => ({ moveId })) as any[]
    const nonBasics: any[] = [{ moveId: '1081013' }, { moveId: '1081019' }, { moveId: 'basic_attack' }]
    billyMechanic.patchExecutions!({ cfg: cfgWith(0, { billyAdditionalActive: false }), state: {} as any, executions: [...basics, ...nonBasics] } as any)
    for (const row of basics) expect(row.dmgBonus).toBe(BILLY_CORE_CROUCH_DMG)
    for (const row of nonBasics) expect(row.dmgBonus).toBeUndefined()
  })
})

describe('比利完整计算链', () => {
  it('额外能力由同属性或同阵营队友激活，异属性异阵营不激活', async () => {
    for (const mateId of ['1021', '1011']) {
      const { catalog, config } = await setup(mateId)
      expect((computePanelPhases(0, config, catalog)!.inCombat as any).additionalAbilityActive).toBe(1)
    }
    const neg = await setup('1181')
    expect((computePanelPhases(0, neg.config, neg.catalog)!.inCombat as any).additionalAbilityActive ?? 0).toBe(0)
  })

  it('C1回能进入资源总账，C3/C5走通用技能等级', async () => {
    const { catalog, config } = await setup('1021', 1)
    config.setMechanicSetting('billy.dashAttackCount', 5)
    config.setMechanicSetting('billy.dodgeEnergyTriggerCount', 3)
    config.enemy.battleTime = 20
    const calc = useResourceCalc()
    const billy = calc.resourceResult.value!.characters.find(row => row.agentId === '1081')!
    expect(billy.energySource.billyC1Energy).toBe(BILLY_C1_ENERGY * 4)
    expect(billy.energySource.total).toBeGreaterThan(billy.energySource.autoRegen)

    config.team[0].cinemaLevel = 3
    expect(computePanelPhases(0, config, catalog)!.inCombat.skillLevelBonus).toBe(2)
    config.team[0].cinemaLevel = 5
    expect(computePanelPhases(0, config, catalog)!.inCombat.skillLevelBonus).toBe(4)
  })
})
