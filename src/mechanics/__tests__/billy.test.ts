import { describe, expect, it } from 'vitest'
import { computePanelPhases } from '@/composables/resourceCalc/helpers'
import { useResourceCalc } from '@/composables/useResourceCalc'
import {
  BILLY_ADDITIONAL_ULT_PER_STACK,
  BILLY_C2_DODGE_DMG,
  BILLY_C4_EX_CRIT_MAX,
  BILLY_C6_DMG_PER_STACK,
  BILLY_CORE_CROUCH_DMG,
  computeBillyCycle,
  billyMechanic,
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
    ...overrides,
  })
}

describe('比利（1081）总量', () => {
  it('核心蹲姿增伤按覆盖率，额外能力终结增伤按层数与激活门控', () => {
    expect(cycle({}).coreCrouchDmg).toBe(BILLY_CORE_CROUCH_DMG)
    expect(cycle({ coreCrouchCoverage: 0.5 }).coreCrouchDmg).toBe(25)
    expect(cycle({ additionalActive: true, ultimateStacks: 2 }).ultimateDmg).toBe(BILLY_ADDITIONAL_ULT_PER_STACK * 2)
    expect(cycle({ additionalActive: true, ultimateStacks: 1 }).ultimateDmg).toBe(BILLY_ADDITIONAL_ULT_PER_STACK)
    expect(cycle({ additionalActive: false }).ultimateDmg).toBe(0)
  })

  it('影画2闪避反击、影画4强特暴击、影画6命中增伤按命座/滑块门控', () => {
    expect(cycle({ cinemaLevel: 2 }).c2DodgeDmg).toBe(BILLY_C2_DODGE_DMG)
    expect(cycle({ cinemaLevel: 1 }).c2DodgeDmg).toBe(0)
    expect(cycle({ cinemaLevel: 4, c4ExCrit: 32 }).c4ExCritRate).toBe(BILLY_C4_EX_CRIT_MAX)
    expect(cycle({ cinemaLevel: 4, c4ExCrit: 20 }).c4ExCritRate).toBe(20)
    expect(cycle({ cinemaLevel: 3 }).c4ExCritRate).toBe(0)
    expect(cycle({ cinemaLevel: 6, c6HitStacks: 5 }).c6Dmg).toBe(BILLY_C6_DMG_PER_STACK * 5)
    expect(cycle({ cinemaLevel: 5 }).c6Dmg).toBe(0)
  })
})

describe('比利执行行定向结算', () => {
  const cfgWith = (cinema: number, extra: Record<string, unknown> = {}) => ({
    ultimateMoveId: '1081014',
    dodgeCounterMoveId: '1081013',
    exSpecialMoveId: '1081011',
    billyCinemaLevel: cinema,
    billyCoreCrouchCoverage: 1,
    billyUltimateStacks: 2,
    billyC4ExCrit: 32,
    billyC6HitStacks: 5,
    billyAdditionalActive: true,
    ...extra,
  })

  it('终结吃额外能力增伤、闪避反击吃影画2、强特吃影画4暴击', () => {
    const ult: any = { moveId: '1081014', category: 'chain' }
    const dodge: any = { moveId: '1081013', category: 'dodge' }
    const ex: any = { moveId: '1081011', category: 'special' }
    billyMechanic.patchExecutions!({
      cfg: cfgWith(4),
      state: { exSpecialCount: 1, ultimateCount: 1, chainCountTotal: 1 },
      executions: [ult, dodge, ex],
    } as any)
    expect(ult.dmgBonus).toBe(BILLY_ADDITIONAL_ULT_PER_STACK * 2)
    expect(dodge.dmgBonus).toBe(BILLY_C2_DODGE_DMG)
    expect(ex.critRateBonus).toBe(BILLY_C4_EX_CRIT_MAX)
  })

  it('低命座不应用影画2/4', () => {
    const dodge: any = { moveId: '1081013', category: 'dodge' }
    const ex: any = { moveId: '1081011', category: 'special' }
    billyMechanic.patchExecutions!({
      cfg: cfgWith(1),
      state: { exSpecialCount: 1, ultimateCount: 0, chainCountTotal: 0 },
      executions: [dodge, ex],
    } as any)
    expect(dodge.dmgBonus).toBeUndefined()
    expect(ex.critRateBonus).toBeUndefined()
  })
})

describe('比利完整计算链', () => {
  it('额外能力由同属性/同阵营队友激活，异属性异阵营队友不激活', async () => {
    for (const mateId of ['1021', '1011']) {
      const { catalog, config } = await setup(mateId)
      expect((computePanelPhases(0, config, catalog)!.inCombat as any).additionalAbilityActive).toBe(1)
    }
    const neg = await setup('1181')
    expect((computePanelPhases(0, neg.config, neg.catalog)!.inCombat as any).additionalAbilityActive ?? 0).toBe(0)
  })

  it('资源池写入比利循环，面板进入蹲姿+影画6增伤', async () => {
    await setup('1021', 6)
    const calc = useResourceCalc()
    const billy = calc.resourceResult.value!.characters.find(row => row.agentId === '1081')!
    expect(billy.specResources?.billy_cycle).toBeTruthy()
    expect(calc.resourceResult.value!.characters.find(row => row.agentId === '1081')!.specResources?.billy_cycle).toBeTruthy()
    const panel = calc.panels.value[0] as any
    expect(panel.__billyPanelApplied).toBe(true)
    expect(panel.dmgBonus).toBeGreaterThanOrEqual(BILLY_CORE_CROUCH_DMG + BILLY_C6_DMG_PER_STACK * 5)
  })
})
