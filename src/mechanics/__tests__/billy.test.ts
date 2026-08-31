import { describe, expect, it } from 'vitest'
import { computePanelPhases } from '@/composables/resourceCalc/helpers'
import { useResourceCalc } from '@/composables/useResourceCalc'
import {
  BILLY_ADDITIONAL_ULT_PER_STACK,
  BILLY_C1_ENERGY,
  BILLY_C2_DODGE_DMG,
  BILLY_C4_EX_CRIT_MAX,
  BILLY_C6_DMG_PER_STACK,
  BILLY_C6_MAX_STACKS,
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
    chainCountTotal: 2,
    ultimateCount: 1,
    c4ExCrit: 32,
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
    billyC4ExCrit: 32,
    billyAdditionalActive: true,
    billyBattleTime: 180,
    ...extra,
  }
}

describe('比利（1081）总量', () => {
  it('蹲姿增伤按覆盖率，额外能力按连携总数均摊到每次终结技', () => {
    expect(cycle().coreCrouchDmg).toBe(BILLY_CORE_CROUCH_DMG)
    expect(cycle({ coreCrouchCoverage: 0.5 }).coreCrouchDmg).toBe(25)
    expect(cycle({ chainCountTotal: 4, ultimateCount: 2 }).ultimateDmg).toBe(BILLY_ADDITIONAL_ULT_PER_STACK * 2)
    expect(cycle({ chainCountTotal: 4, ultimateCount: 1 }).ultimateDmg).toBe(BILLY_ADDITIONAL_ULT_PER_STACK * 4)
    expect(cycle({ additionalActive: false }).ultimateDmg).toBe(0)
  })

  it('一影自动回能、二影闪反增伤、四影强特暴击、六影默认满覆盖', () => {
    expect(resolveBillyC1TriggerCount(20)).toBe(4)
    expect(cycle({ cinemaLevel: 1, battleTime: 20 }).c1Energy).toBe(BILLY_C1_ENERGY * 4)
    expect(cycle({ cinemaLevel: 2 }).c2DodgeDmg).toBe(BILLY_C2_DODGE_DMG)
    expect(cycle({ cinemaLevel: 1 }).c2DodgeDmg).toBe(0)
    expect(cycle({ cinemaLevel: 4, c4ExCrit: 20 }).c4ExCritRate).toBe(20)
    expect(cycle({ cinemaLevel: 3 }).c4ExCritRate).toBe(0)
    expect(cycle({ cinemaLevel: 6 }).c6Dmg).toBe(BILLY_C6_DMG_PER_STACK * BILLY_C6_MAX_STACKS)
    expect(cycle({ cinemaLevel: 5 }).c6Dmg).toBe(0)
  })
})

describe('比利执行行定向结算', () => {
  it('终结吃均摊增伤、闪反吃二影、强特吃四影', () => {
    const ult: any = { moveId: BILLY_MOVE_IDS.ultimate }
    const dodge: any = { moveId: BILLY_MOVE_IDS.dodgeCounter }
    const ex: any = { moveId: BILLY_MOVE_IDS.exSpecial }
    billyMechanic.patchExecutions!({
      cfg: cfgWith(4),
      state: { chainCountTotal: 4, ultimateCount: 2 } as any,
      executions: [ult, dodge, ex],
    } as any)
    expect(ult.dmgBonus).toBe(BILLY_ADDITIONAL_ULT_PER_STACK * 2 + BILLY_CORE_CROUCH_DMG)
    expect(dodge.dmgBonus).toBe(BILLY_C2_DODGE_DMG + BILLY_CORE_CROUCH_DMG)
    expect(ex.critRateBonus).toBe(BILLY_C4_EX_CRIT_MAX)
  })

  it('蹲姿除连携技外的所有招式默认生效', () => {
    const rows: any[] = [
      { moveId: '1081002' },
      { moveId: BILLY_MOVE_IDS.dodgeCounter },
      { moveId: BILLY_MOVE_IDS.exSpecial },
      { moveId: BILLY_MOVE_IDS.ultimate },
      { moveId: BILLY_MOVE_IDS.chain },
    ]
    billyMechanic.patchExecutions!({
      cfg: cfgWith(0, { billyAdditionalActive: false, billyC4ExCrit: 0 }),
      state: { chainCountTotal: 0, ultimateCount: 0 } as any,
      executions: rows,
    } as any)
    for (const row of rows.slice(0, 4)) expect(row.dmgBonus).toBe(BILLY_CORE_CROUCH_DMG)
    expect(rows[4].dmgBonus).toBeUndefined()
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

  it('一影自动回能进入资源总账，三影五影走通用技能等级', async () => {
    const { catalog, config } = await setup('1021', 1)
    config.enemy.battleTime = 20
    const calc = useResourceCalc()
    const billy = calc.resourceResult.value!.characters.find(row => row.agentId === '1081')!
    expect(billy.energySource.billyC1Energy).toBe(BILLY_C1_ENERGY * 4)

    config.team[0].cinemaLevel = 3
    expect(computePanelPhases(0, config, catalog)!.inCombat.skillLevelBonus).toBe(2)
    config.team[0].cinemaLevel = 5
    expect(computePanelPhases(0, config, catalog)!.inCombat.skillLevelBonus).toBe(4)
  })

  it('影画6面板增伤：6命面板 dmgBonus +30（防守卫冻结，SOP §3.5）', async () => {
    const c0 = await setup('1021', 0)
    const dmg0 = (computePanelPhases(0, c0.config, c0.catalog)!.inCombat as any).dmgBonus ?? 0
    const c6 = await setup('1021', 6)
    const dmg6 = (computePanelPhases(0, c6.config, c6.catalog)!.inCombat as any).dmgBonus ?? 0
    expect(dmg6 - dmg0).toBeCloseTo(BILLY_C6_DMG_PER_STACK * BILLY_C6_MAX_STACKS, 1)
  })
})

describe('比利滑块生效差分（防守卫冻结，SOP §3.5）', () => {
  const base = { cinemaLevel: 4, additionalActive: true, chainCountTotal: 2, ultimateCount: 1 }

  it('billy.coreCrouchCoverage → 蹲姿核心增伤差分（按覆盖率缩放）', () => {
    const on = computeBillyCycle({ ...base, coreCrouchCoverage: 1, c4ExCrit: 32 })
    const off = computeBillyCycle({ ...base, coreCrouchCoverage: 0, c4ExCrit: 32 })
    expect(on.coreCrouchDmg).toBe(BILLY_CORE_CROUCH_DMG)
    expect(off.coreCrouchDmg).toBe(0)
  })

  it('billy.c4ExCrit → 影画4强特暴击率差分（封顶上限内线性）', () => {
    const on = computeBillyCycle({ ...base, coreCrouchCoverage: 1, c4ExCrit: 32 })
    const half = computeBillyCycle({ ...base, coreCrouchCoverage: 1, c4ExCrit: 16 })
    const off = computeBillyCycle({ ...base, coreCrouchCoverage: 1, c4ExCrit: 0 })
    expect(on.c4ExCritRate).toBeCloseTo(Math.min(BILLY_C4_EX_CRIT_MAX, 32), 5)
    expect(half.c4ExCritRate).toBeCloseTo(16, 5)
    expect(off.c4ExCritRate).toBe(0)
  })
})
