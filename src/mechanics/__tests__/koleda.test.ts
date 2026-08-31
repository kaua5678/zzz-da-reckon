import { describe, expect, it } from 'vitest'
import { computePanelPhases } from '@/composables/resourceCalc/helpers'
import { useResourceCalc } from '@/composables/useResourceCalc'
import {
  KOLEDA_ADDITIONAL_CHAIN_MAX_STACKS,
  KOLEDA_ADDITIONAL_CHAIN_PER_STACK,
  KOLEDA_C1_STUN,
  KOLEDA_C4_DMG_PER_CHARGE,
  KOLEDA_C6_EXPLOSION_MULT,
  KOLEDA_CORE_STUN,
  computeKoledaCycle,
  koledaMechanic,
} from '@/mechanics/agents/koleda'
import { setupHarness } from '@/test/harness'

async function setup(mateId = '1121', cinemaLevel = 0) {
  const result = await setupHarness([
    { agentId: '1101', cinemaLevel, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
    { agentId: mateId, cinemaLevel: 0, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
  ])
  for (const buff of result.config.globalBuffs) buff.enabled = false
  return result
}

function cycle(overrides: Partial<Parameters<typeof computeKoledaCycle>[0]> = {}) {
  return computeKoledaCycle({
    cinemaLevel: 6,
    additionalActive: true,
    chainStunCoverage: 1,
    c1Coverage: 1,
    c4ChargeStacks: 2,
    exSpecialCount: 3,
    chainCount: 2,
    ultimateCount: 1,
    ...overrides,
  })
}

describe('珂蕾妲（1101）总量', () => {
  it('额外能力连携增伤=35%×2层按覆盖率，未激活为0', () => {
    expect(cycle({ additionalActive: true }).additionalChainDmg).toBe(
      KOLEDA_ADDITIONAL_CHAIN_PER_STACK * KOLEDA_ADDITIONAL_CHAIN_MAX_STACKS)
    expect(cycle({ additionalActive: true, chainStunCoverage: 0.5 }).additionalChainDmg).toBe(35)
    expect(cycle({ additionalActive: false }).additionalChainDmg).toBe(0)
  })

  it('影画1衔接失衡与影画4充能增伤按命座/滑块门控', () => {
    expect(cycle({ cinemaLevel: 1 }).c1StunBonus).toBe(KOLEDA_C1_STUN)
    expect(cycle({ cinemaLevel: 0 }).c1StunBonus).toBe(0)
    expect(cycle({ cinemaLevel: 4, c4ChargeStacks: 2 }).c4DmgBonus).toBe(KOLEDA_C4_DMG_PER_CHARGE * 2)
    expect(cycle({ cinemaLevel: 4, c4ChargeStacks: 1 }).c4DmgBonus).toBe(KOLEDA_C4_DMG_PER_CHARGE)
    expect(cycle({ cinemaLevel: 3 }).c4DmgBonus).toBe(0)
  })

  it('影画6爆炸次数=强特+连携+终结次数之和', () => {
    expect(cycle({ cinemaLevel: 6, exSpecialCount: 3, chainCount: 2, ultimateCount: 1 }).c6ExplosionCount).toBe(6)
    expect(cycle({ cinemaLevel: 5, exSpecialCount: 3 }).c6ExplosionCount).toBe(0)
  })
})

describe('珂蕾妲执行行与定向结算', () => {
  const cfgWith = (cinema: number, extra: Record<string, unknown> = {}) => ({
    exSpecialMoveId: '1101105',
    chainMoveId: '1101301',
    ultimateMoveId: '1101401',
    koledaCinemaLevel: cinema,
    koledaChainStunCoverage: 1,
    koledaC1Coverage: 1,
    koledaC4ChargeStacks: 2,
    koledaAdditionalActive: true,
    ...extra,
  })

  it('核心被动强特失衡+60%并叠加影画1，特殊技只吃影画1', () => {
    const ex: any = { moveId: '1101105', category: 'special' }
    const special: any = { moveId: '1101101', category: 'special' }
    koledaMechanic.patchExecutions!({
      cfg: cfgWith(1),
      state: { exSpecialCount: 1, ultimateCount: 0, chainCountTotal: 0 },
      executions: [ex, special],
    } as any)
    expect(ex.stunBuildUpBonus).toBe(KOLEDA_CORE_STUN + KOLEDA_C1_STUN)
    expect(special.stunBuildUpBonus).toBe(KOLEDA_C1_STUN)
  })

  it('连携吃额外能力增伤与影画4，终结只吃影画4', () => {
    const chain: any = { moveId: '1101301', category: 'chain' }
    const ult: any = { moveId: '1101401', category: 'chain' }
    koledaMechanic.patchExecutions!({
      cfg: cfgWith(4),
      state: { exSpecialCount: 0, ultimateCount: 1, chainCountTotal: 1 },
      executions: [chain, ult],
    } as any)
    expect(chain.dmgBonus).toBe(70 + KOLEDA_C4_DMG_PER_CHARGE * 2)
    expect(ult.dmgBonus).toBe(KOLEDA_C4_DMG_PER_CHARGE * 2)
  })

  it('影画6生成360%火伤合成行，低命座不生成', () => {
    const execs: any[] = []
    koledaMechanic.buildExecutions!({
      cfg: cfgWith(6),
      state: { exSpecialCount: 3, ultimateCount: 1, chainCountTotal: 2 },
      executions: execs,
    } as any)
    const boom = execs.find(e => e.moveId === '1101_c6_saturation_explosion')
    expect(boom.count).toBe(6)
    expect(boom.damageMultiplier).toBe(KOLEDA_C6_EXPLOSION_MULT)
    expect(boom.element).toBe('fire')

    const execs0: any[] = []
    koledaMechanic.buildExecutions!({
      cfg: cfgWith(5),
      state: { exSpecialCount: 3, ultimateCount: 1, chainCountTotal: 2 },
      executions: execs0,
    } as any)
    expect(execs0.find(e => e.moveId === '1101_c6_saturation_explosion')).toBeUndefined()
  })
})

describe('珂蕾妲完整计算链', () => {
  it('额外能力由同阵营/命破队友激活，异阵营击破队友不激活', async () => {
    for (const mateId of ['1121', '1441']) {
      const { catalog, config } = await setup(mateId)
      expect((computePanelPhases(0, config, catalog)!.inCombat as any).additionalAbilityActive).toBe(1)
    }
    const neg = await setup('1141')
    expect((computePanelPhases(0, neg.config, neg.catalog)!.inCombat as any).additionalAbilityActive ?? 0).toBe(0)
  })

  it('资源池写入珂蕾妲循环', async () => {
    await setup('1121', 6)
    const calc = useResourceCalc()
    const koleda = calc.resourceResult.value!.characters.find(row => row.agentId === '1101')!
    expect(koleda.specResources?.koleda_cycle).toBeTruthy()
  })
})

describe('珂蕾妲滑块生效差分（防守卫冻结，SOP §3.5：改滑块→结果确实变）', () => {
  const base = {
    cinemaLevel: 6, additionalActive: true, chainStunCoverage: 1,
    c1Coverage: 1, c4ChargeStacks: 2, exSpecialCount: 3, chainCount: 2, ultimateCount: 1,
  }

  it('koleda.chainStunCoverage → 额外能力连携增伤差分（按覆盖率缩放）', () => {
    const on = computeKoledaCycle({ ...base, chainStunCoverage: 1 })
    const half = computeKoledaCycle({ ...base, chainStunCoverage: 0.5 })
    const off = computeKoledaCycle({ ...base, chainStunCoverage: 0 })
    expect(on.additionalChainDmg).toBe(KOLEDA_ADDITIONAL_CHAIN_PER_STACK * KOLEDA_ADDITIONAL_CHAIN_MAX_STACKS)
    expect(half.additionalChainDmg).toBeCloseTo(on.additionalChainDmg * 0.5, 5)
    expect(off.additionalChainDmg).toBe(0)
  })

  it('koleda.c1Coverage → 影画1失衡值差分（+15 × 覆盖率）', () => {
    const on = computeKoledaCycle({ ...base, c1Coverage: 1 })
    const off = computeKoledaCycle({ ...base, c1Coverage: 0 })
    expect(on.c1StunBonus - off.c1StunBonus).toBe(KOLEDA_C1_STUN)
    expect(off.c1StunBonus).toBe(0)
  })

  it('koleda.c4ChargeStacks → 影画4增伤差分（每层 +18，封顶 2 层）', () => {
    const on = computeKoledaCycle({ ...base, c4ChargeStacks: 2 })
    const one = computeKoledaCycle({ ...base, c4ChargeStacks: 1 })
    const off = computeKoledaCycle({ ...base, c4ChargeStacks: 0 })
    expect(on.c4DmgBonus).toBe(2 * KOLEDA_C4_DMG_PER_CHARGE)
    expect(one.c4DmgBonus).toBe(KOLEDA_C4_DMG_PER_CHARGE)
    expect(off.c4DmgBonus).toBe(0)
  })
})
