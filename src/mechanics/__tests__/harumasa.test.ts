import { describe, expect, it } from 'vitest'
import { computePanelPhases } from '@/composables/resourceCalc/helpers'
import { useResourceCalc } from '@/composables/useResourceCalc'
import {
  HARUMASA_ADDITIONAL_DMG,
  HARUMASA_ARROW_MOVE_ID,
  HARUMASA_C2_DMG_BONUS,
  HARUMASA_C4_DECIBEL_PER_SLASH,
  HARUMASA_C6_EXPLOSION_MULTIPLIER,
  HARUMASA_C6_RES_IGNORE,
  HARUMASA_CORE_CRIT_RATE,
  HARUMASA_EDGE_CRIT_DMG_PER_STACK,
  HARUMASA_SLASH_MOVE_IDS,
  HARUMASA_THUNDER_MOVE_ID,
  HARUMASA_ULT_FOLLOW_ACTION_TIME,
  HARUMASA_ULT_FOLLOW_MOVE_ID,
  HARUMASA_ULT_MOVE_ID,
  computeHarumasaCycle,
  harumasaMechanic,
} from '@/mechanics/agents/harumasa'
import { setupHarness } from '@/test/harness'

async function setup(mateId = '1141', cinemaLevel = 0) {
  const result = await setupHarness([
    { agentId: '1201', cinemaLevel, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
    { agentId: mateId, cinemaLevel: 0, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
  ])
  for (const buff of result.config.globalBuffs) buff.enabled = false
  return result
}

function cycle(overrides: Partial<Parameters<typeof computeHarumasaCycle>[0]> = {}) {
  return computeHarumasaCycle({
    cinemaLevel: 0,
    slashCount: 6,
    activatedKettleCount: 12,
    arrowHitCount: 12,
    chainCount: 1,
    ultimateCount: 1,
    conditionCoverage: 1,
    edgeAverageStacks: 6,
    thunderCoverage: 1,
    c6ResIgnoreCoverage: 1,
    ...overrides,
  })
}

describe('悠真（1201）电囚与资源总量', () => {
  it('C1使每个电壶发射两支甲乙矢并把电囚上限提升至14层', () => {
    expect(cycle({ cinemaLevel: 0 }).prisonCap).toBe(8)
    const c1 = cycle({ cinemaLevel: 1, arrowHitCount: 24 })
    expect(c1.activatedKettleCount).toBe(12)
    expect(c1.arrowHitCount).toBe(24)
    expect(c1.prisonCap).toBe(14)
  })

  it('C2电掣最多强化实际飞弦·斩次数', () => {
    const c0 = cycle({ cinemaLevel: 0, slashCount: 20 })
    expect(c0.surgeGain).toBe(0)
    expect(c0.surgeBuffedSlashCount).toBe(0)

    const c2 = cycle({ cinemaLevel: 2, slashCount: 20, chainCount: 1, ultimateCount: 1 })
    expect(c2.surgeGain).toBe(14)
    expect(c2.surgeBuffedSlashCount).toBe(14)
    expect(c2.surgeCoverage).toBe(0.7)
  })

  it('逐雷按失衡覆盖率折算，C4按每次飞弦·斩回复30喧响', () => {
    const result = cycle({ cinemaLevel: 4, slashCount: 7, thunderCoverage: 0.5 })
    expect(result.thunderCount).toBe(4)
    expect(result.c4Decibel).toBe(7 * HARUMASA_C4_DECIBEL_PER_SLASH)
    expect(result.prisonDurationSeconds).toBe(20)
  })

  it('C6每12次甲乙矢触发一次1500%电磁爆炸', () => {
    expect(cycle({ cinemaLevel: 5, arrowHitCount: 24 }).c6ExplosionCount).toBe(0)
    expect(cycle({ cinemaLevel: 6, arrowHitCount: 11 }).c6ExplosionCount).toBe(0)
    expect(cycle({ cinemaLevel: 6, arrowHitCount: 12 }).c6ExplosionCount).toBe(1)
    expect(cycle({ cinemaLevel: 6, arrowHitCount: 24 }).c6ExplosionCount).toBe(2)
  })
})

describe('悠真招式定向机制', () => {
  it('只给飞弦·斩、逐雷和终结技核心暴击增益，不再全局加暴伤', () => {
    const slash: any = { moveId: HARUMASA_SLASH_MOVE_IDS[0], element: 'electric' }
    const thunder: any = { moveId: HARUMASA_THUNDER_MOVE_ID, element: 'electric' }
    const ultimate: any = { moveId: HARUMASA_ULT_MOVE_ID, element: 'electric' }
    const arrow: any = { moveId: HARUMASA_ARROW_MOVE_ID, element: 'electric' }
    harumasaMechanic.patchExecutions!({
      cfg: {
        panel: { additionalAbilityActive: 0 },
        harumasaCinemaLevel: 0,
        harumasaSlashCount: 3,
        harumasaArrowHitCount: 3,
        harumasaConditionCoverage: 1,
        harumasaEdgeAverageStacks: 6,
        harumasaThunderCoverage: 1,
        harumasaC6ResIgnoreCoverage: 0,
      },
      state: { exSpecialCount: 0, ultimateCount: 1, chainCountTotal: 0 },
      executions: [slash, thunder, ultimate, arrow],
    } as any)
    for (const row of [slash, thunder, ultimate]) {
      expect(row.critRateBonus).toBe(HARUMASA_CORE_CRIT_RATE)
      expect(row.critDmgBonus).toBe(6 * HARUMASA_EDGE_CRIT_DMG_PER_STACK)
    }
    expect(arrow.critRateBonus).toBeUndefined()
    expect(arrow.critDmgBonus).toBeUndefined()
  })

  it('补齐终结技自动派生的残心·散华倍率行与动作时间', () => {
    const executions: any[] = []
    harumasaMechanic.buildExecutions!({
      cfg: {
        panel: { additionalAbilityActive: 0 },
        harumasaCinemaLevel: 0,
        harumasaSlashCount: 0,
        harumasaActivatedKettleCount: 0,
        harumasaArrowHitCount: 0,
        harumasaConditionCoverage: 0,
        harumasaEdgeAverageStacks: 6,
        harumasaThunderCoverage: 0,
        harumasaC6ResIgnoreCoverage: 0,
      },
      state: { exSpecialCount: 0, ultimateCount: 2, chainCountTotal: 0 },
      executions,
    } as any)
    const follow = executions.find(row => row.moveId === HARUMASA_ULT_FOLLOW_MOVE_ID)
    expect(follow.count).toBe(2)
    expect(follow.actionTime).toBe(HARUMASA_ULT_FOLLOW_ACTION_TIME)
    expect(follow.totalTime).toBe(2 * HARUMASA_ULT_FOLLOW_ACTION_TIME)
    expect(follow.damageMultiplierOverride).toBeUndefined()
  })

  it('额外能力和C2只按正确范围与覆盖率作用', () => {
    const slash: any = { moveId: HARUMASA_SLASH_MOVE_IDS[0], element: 'electric', dmgBonus: 0 }
    const arrow: any = { moveId: HARUMASA_ARROW_MOVE_ID, element: 'electric', dmgBonus: 0 }
    harumasaMechanic.patchExecutions!({
      cfg: {
        panel: { additionalAbilityActive: 1 },
        harumasaCinemaLevel: 2,
        harumasaSlashCount: 20,
        harumasaArrowHitCount: 12,
        harumasaConditionCoverage: 0.5,
        harumasaEdgeAverageStacks: 0,
        harumasaThunderCoverage: 0,
        harumasaC6ResIgnoreCoverage: 0,
      },
      state: { exSpecialCount: 0, ultimateCount: 1, chainCountTotal: 1 },
      executions: [slash, arrow],
    } as any)
    expect(slash.dmgBonus).toBe(HARUMASA_C2_DMG_BONUS * 0.7 + HARUMASA_ADDITIONAL_DMG * 0.5)
    expect(arrow.dmgBonus).toBe(HARUMASA_ADDITIONAL_DMG * 0.5)
  })

  it('C6减抗按覆盖率作用于电伤，爆炸使用合成倍率且不占动作时间', () => {
    const executions: any[] = []
    harumasaMechanic.buildExecutions!({
      cfg: {
        panel: { additionalAbilityActive: 0 },
        harumasaCinemaLevel: 6,
        harumasaSlashCount: 0,
        harumasaActivatedKettleCount: 12,
        harumasaArrowHitCount: 24,
        harumasaConditionCoverage: 0,
        harumasaEdgeAverageStacks: 0,
        harumasaThunderCoverage: 0,
        harumasaC6ResIgnoreCoverage: 0.5,
      },
      state: { exSpecialCount: 0, ultimateCount: 0, chainCountTotal: 0 },
      executions,
    } as any)
    harumasaMechanic.patchExecutions!({
      cfg: {
        panel: { additionalAbilityActive: 0 },
        harumasaCinemaLevel: 6,
        harumasaSlashCount: 0,
        harumasaActivatedKettleCount: 12,
        harumasaArrowHitCount: 24,
        harumasaConditionCoverage: 0,
        harumasaEdgeAverageStacks: 0,
        harumasaThunderCoverage: 0,
        harumasaC6ResIgnoreCoverage: 0.5,
      },
      state: { exSpecialCount: 0, ultimateCount: 0, chainCountTotal: 0 },
      executions,
    } as any)
    const explosion = executions.find(row => row.moveId === '1201_c6_electromagnetic_explosion')
    expect(explosion.count).toBe(2)
    expect(explosion.damageMultiplier).toBe(HARUMASA_C6_EXPLOSION_MULTIPLIER)
    expect(explosion.damageMultiplierOverride).toBe(true)
    expect(explosion.actionTime).toBe(0)
    expect(explosion.resIgnore).toBe(HARUMASA_C6_RES_IGNORE * 0.5)
  })
})

describe('悠真完整计算链', () => {
  it('额外能力由击破或异常队友激活，普通队友不激活', async () => {
    for (const mateId of ['1141', '1281']) {
      const { catalog, config } = await setup(mateId)
      expect((computePanelPhases(0, config, catalog)!.inCombat as any).additionalAbilityActive).toBe(1)
    }
    const { catalog, config } = await setup('1271')
    expect((computePanelPhases(0, config, catalog)!.inCombat as any).additionalAbilityActive ?? 0).toBe(0)
  })

  it('生成正确moveId的飞弦·斩、甲乙矢与逐雷，并保留通用失衡提取', async () => {
    await setup('1141', 6)
    const calc = useResourceCalc()
    const harumasa = calc.resourceResult.value!.characters.find(row => row.agentId === '1201')!
    expect(harumasa.executions.some(row => row.moveId === HARUMASA_ARROW_MOVE_ID)).toBe(true)
    expect(HARUMASA_SLASH_MOVE_IDS.every(id => harumasa.executions.some(row => row.moveId === id))).toBe(true)
    expect(harumasa.executions.some(row => row.moveId === HARUMASA_THUNDER_MOVE_ID)).toBe(true)
    expect(harumasa.executions.find(row => row.moveId === HARUMASA_ARROW_MOVE_ID)?.moveName).toContain('甲乙矢')
    expect(calc.stunPoolResult.value!.contributions.some(row =>
      row.slot === 0 && HARUMASA_SLASH_MOVE_IDS.includes(row.moveId as any))).toBe(true)
  })
})
