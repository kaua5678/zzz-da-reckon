import { describe, expect, it } from 'vitest'
import { computePanelPhases } from '@/composables/resourceCalc/helpers'
import { useResourceCalc } from '@/composables/useResourceCalc'
import {
  CORIN_ADDITIONAL_DMG,
  CORIN_C1_DMG,
  CORIN_C2_MAX_STACKS,
  CORIN_C2_RES_PER_STACK,
  CORIN_C6_DMG_PER_CHARGE,
  CORIN_CORE_SAW_DMG,
  computeCorinCycle,
  corinMechanic,
} from '@/mechanics/agents/corin'
import { setupHarness } from '@/test/harness'

async function setup(mateId = '1021', cinemaLevel = 0) {
  const result = await setupHarness([
    { agentId: '1061', cinemaLevel, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
    { agentId: mateId, cinemaLevel: 0, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
  ])
  for (const buff of result.config.globalBuffs) buff.enabled = false
  return result
}

function cycle(overrides: Partial<Parameters<typeof computeCorinCycle>[0]> = {}) {
  return computeCorinCycle({
    cinemaLevel: 6,
    additionalActive: true,
    coreSawCoverage: 1,
    additionalStunCoverage: 1,
    c1Coverage: 1,
    c2ResCoverage: 1,
    c6DetonationCount: 8,
    c6ChargeStacks: 40,
    ...overrides,
  })
}

describe('可琳（1061）总量', () => {
  it('核心电锯增伤/额外能力失衡增伤/影画1按覆盖率与激活门控', () => {
    expect(cycle({}).coreSawDmg).toBe(CORIN_CORE_SAW_DMG)
    expect(cycle({ coreSawCoverage: 0.5 }).coreSawDmg).toBe(CORIN_CORE_SAW_DMG * 0.5)
    expect(cycle({ additionalActive: true }).additionalDmg).toBe(CORIN_ADDITIONAL_DMG)
    expect(cycle({ additionalActive: false }).additionalDmg).toBe(0)
    expect(cycle({ cinemaLevel: 1 }).c1Dmg).toBe(CORIN_C1_DMG)
    expect(cycle({ cinemaLevel: 0 }).c1Dmg).toBe(0)
  })

  it('影画2物理减抗=0.5%×20层，影画6引爆伤害=层数×3%', () => {
    expect(cycle({ cinemaLevel: 2 }).c2ResReduction).toBe(CORIN_C2_RES_PER_STACK * CORIN_C2_MAX_STACKS)
    expect(cycle({ cinemaLevel: 1 }).c2ResReduction).toBe(0)
    expect(cycle({ cinemaLevel: 6, c6ChargeStacks: 40 }).c6DamagePerDetonation).toBe(CORIN_C6_DMG_PER_CHARGE * 40)
    expect(cycle({ cinemaLevel: 6, c6ChargeStacks: 10 }).c6DamagePerDetonation).toBe(CORIN_C6_DMG_PER_CHARGE * 10)
    expect(cycle({ cinemaLevel: 5 }).c6DamagePerDetonation).toBe(0)
    expect(cycle({ cinemaLevel: 5, c6DetonationCount: 8 }).c6DetonationCount).toBe(0)
  })
})

describe('可琳执行行与定向结算', () => {
  it('核心被动电锯增伤只挂普攻聚合行', () => {
    const basic: any = { moveId: 'basic_attack' }
    const ex: any = { moveId: '1061010', category: 'special' }
    corinMechanic.patchExecutions!({
      cfg: { corinCinemaLevel: 0, corinCoreSawCoverage: 1, corinAdditionalStunCoverage: 1, corinC1Coverage: 1, corinC2ResCoverage: 1, corinC6DetonationCount: 0, corinC6ChargeStacks: 0, corinAdditionalActive: true },
      state: { exSpecialCount: 0, ultimateCount: 0, chainCountTotal: 0 },
      executions: [basic, ex],
    } as any)
    expect(basic.dmgBonus).toBe(CORIN_CORE_SAW_DMG)
    expect(ex.dmgBonus).toBeUndefined()
  })

  it('影画6生成物理引爆合成行，低命座不生成', () => {
    const execs: any[] = []
    corinMechanic.buildExecutions!({
      cfg: { corinCinemaLevel: 6, corinCoreSawCoverage: 1, corinAdditionalStunCoverage: 1, corinC1Coverage: 1, corinC2ResCoverage: 1, corinC6DetonationCount: 8, corinC6ChargeStacks: 40, corinAdditionalActive: true },
      state: { exSpecialCount: 0, ultimateCount: 0, chainCountTotal: 0 },
      executions: execs,
    } as any)
    const boom = execs.find(e => e.moveId === '1061_c6_chainsaw_detonation')
    expect(boom.count).toBe(8)
    expect(boom.damageMultiplier).toBe(CORIN_C6_DMG_PER_CHARGE * 40)
    expect(boom.element).toBe('physical')

    const execs0: any[] = []
    corinMechanic.buildExecutions!({
      cfg: { corinCinemaLevel: 5, corinCoreSawCoverage: 1, corinAdditionalStunCoverage: 1, corinC1Coverage: 1, corinC2ResCoverage: 1, corinC6DetonationCount: 8, corinC6ChargeStacks: 40, corinAdditionalActive: true },
      state: { exSpecialCount: 0, ultimateCount: 0, chainCountTotal: 0 },
      executions: execs0,
    } as any)
    expect(execs0.find(e => e.moveId === '1061_c6_chainsaw_detonation')).toBeUndefined()
  })
})

describe('可琳完整计算链', () => {
  it('额外能力由同属性/同阵营队友激活，异属性异阵营队友不激活', async () => {
    for (const mateId of ['1021', '1141']) {
      const { catalog, config } = await setup(mateId)
      expect((computePanelPhases(0, config, catalog)!.inCombat as any).additionalAbilityActive).toBe(1)
    }
    const neg = await setup('1181')
    expect((computePanelPhases(0, neg.config, neg.catalog)!.inCombat as any).additionalAbilityActive ?? 0).toBe(0)
  })

  it('资源池写入可琳循环', async () => {
    await setup('1021', 6)
    const calc = useResourceCalc()
    const corin = calc.resourceResult.value!.characters.find(row => row.agentId === '1061')!
    expect(corin.specResources?.corin_cycle).toBeTruthy()
  })

  it('面板增益进入最终面板（额外能力+影画1增伤、影画2物理减抗）', async () => {
    await setup('1021', 2)
    const calc = useResourceCalc()
    expect(calc.resourceResult.value!.characters.find(row => row.agentId === '1061')!.specResources?.corin_cycle).toBeTruthy()
    const panel = calc.panels.value[0] as any
    expect(panel.__corinPanelApplied).toBe(true)
    expect(panel.dmgBonus).toBeGreaterThanOrEqual(CORIN_ADDITIONAL_DMG + CORIN_C1_DMG)
    expect(panel.enemyPhysicalResReduction).toBeGreaterThanOrEqual(CORIN_C2_RES_PER_STACK * CORIN_C2_MAX_STACKS)
  })
})
