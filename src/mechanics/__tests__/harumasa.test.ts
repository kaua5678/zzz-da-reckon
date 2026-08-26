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
    a5Count: 2,
    chainCount: 1,
    ultimateCount: 1,
    exSpecialCount: 1,
    conditionCoverage: 1,
    edgeAverageStacks: 6,
    thunderCoverage: 1,
    c6ResIgnoreCoverage: 1,
    ...overrides,
  })
}

describe('悠真（1201）电壶→电囚→飞弦·斩资源循环', () => {
  it('电壶(开局6+A5+连携+强特)→甲乙矢→电囚→飞弦·斩(每刀耗2电囚)', () => {
    const c0 = cycle({ cinemaLevel: 0, ultimateCount: 0 })
    // 电壶 = 6 + 2×2 + 1×6 + 1×6 = 22 → 甲乙矢 22 → 电囚 24 → 飞弦 12
    expect(c0.kettleTotal).toBe(22)
    expect(c0.arrowHitCount).toBe(22)
    expect(c0.prisonTotal).toBe(24)
    expect(c0.slashCount).toBe(12)
    expect(c0.prisonCap).toBe(8)

    // 影画1：每壶2支甲乙矢，电囚上限14
    const c1 = cycle({ cinemaLevel: 1, ultimateCount: 0 })
    expect(c1.arrowHitCount).toBe(44)
    expect(c1.prisonTotal).toBe(46)
    expect(c1.slashCount).toBe(23)
    expect(c1.prisonCap).toBe(14)
  })

  it('影画4终结技满层电囚（+14计入资源总量）', () => {
    const c4 = cycle({ cinemaLevel: 4, ultimateCount: 1 })
    // 甲乙矢44（影画1翻倍）+ 落羽2 + 满层14 = 60 → 飞弦30
    expect(c4.prisonTotal).toBe(60)
    expect(c4.slashCount).toBe(30)
    expect(c4.prisonDurationSeconds).toBe(20)
  })

  it('C2电掣最多强化实际飞弦·斩次数', () => {
    const c0 = cycle({ cinemaLevel: 0 })
    expect(c0.surgeGain).toBe(0)

    const c2 = cycle({ cinemaLevel: 2, chainCount: 1, ultimateCount: 1 })
    expect(c2.surgeGain).toBe(14)
    expect(c2.surgeBuffedSlashCount).toBe(Math.min(c2.slashCount, 14))
  })

  it('逐雷按失衡覆盖率折算，C4按每次飞弦·斩回复30喧响', () => {
    const result = cycle({ cinemaLevel: 4, thunderCoverage: 0.5 })
    expect(result.thunderCount).toBe(Math.round(result.slashCount * 0.5))
    expect(result.c4Decibel).toBe(result.slashCount * HARUMASA_C4_DECIBEL_PER_SLASH)
  })

  it('C6每12次甲乙矢触发一次1500%电磁爆炸', () => {
    const big = cycle({ cinemaLevel: 6, a5Count: 4, chainCount: 1, ultimateCount: 0, exSpecialCount: 1 })
    expect(big.arrowHitCount).toBeGreaterThanOrEqual(24)
    expect(big.c6ExplosionCount).toBe(Math.floor(big.arrowHitCount / 12))
  })
})

describe('悠真招式定向机制', () => {
  it('飞弦·斩第一段只打一次(0.6s)，后续二/三段轮转', () => {
    const executions: any[] = []
    harumasaMechanic.buildExecutions!({
      cfg: {
        panel: { additionalAbilityActive: 0 },
        harumasaCinemaLevel: 0,
        harumasaA5Count: 2,
        harumasaConditionCoverage: 1,
        harumasaEdgeAverageStacks: 6,
        harumasaThunderCoverage: 1,
        harumasaC6ResIgnoreCoverage: 0,
      },
      state: { exSpecialCount: 1, ultimateCount: 0, chainCountTotal: 1 },
      executions,
    } as any)
    // slashCount = 12 → #1=1, #2=6, #3=5
    expect(executions.find(r => r.moveId === '1201020')!.count).toBe(1)
    expect(executions.find(r => r.moveId === '1201020')!.actionTime).toBe(0.6)
    expect(executions.find(r => r.moveId === '1201021')!.count).toBe(6)
    expect(executions.find(r => r.moveId === '1201022')!.count).toBe(5)
  })

  it('只给飞弦·斩、逐雷和终结技核心暴击增益，不再全局加暴伤', () => {
    const slash: any = { moveId: HARUMASA_SLASH_MOVE_IDS[0], element: 'electric' }
    const thunder: any = { moveId: HARUMASA_THUNDER_MOVE_ID, element: 'electric' }
    const ultimate: any = { moveId: HARUMASA_ULT_MOVE_ID, element: 'electric' }
    const arrow: any = { moveId: HARUMASA_ARROW_MOVE_ID, element: 'electric' }
    harumasaMechanic.patchExecutions!({
      cfg: {
        panel: { additionalAbilityActive: 0 },
        harumasaCinemaLevel: 0,
        harumasaA5Count: 2,
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
        harumasaA5Count: 0,
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
    expect(follow.damageMultiplierOverride).toBeUndefined()
  })

  it('额外能力和C2只按正确范围与覆盖率作用', () => {
    const slash: any = { moveId: HARUMASA_SLASH_MOVE_IDS[0], element: 'electric', dmgBonus: 0 }
    const arrow: any = { moveId: HARUMASA_ARROW_MOVE_ID, element: 'electric', dmgBonus: 0 }
    const cfg: any = {
      panel: { additionalAbilityActive: 1 },
      harumasaCinemaLevel: 2,
      harumasaA5Count: 2,
      harumasaConditionCoverage: 0.5,
      harumasaEdgeAverageStacks: 0,
      harumasaThunderCoverage: 0,
      harumasaC6ResIgnoreCoverage: 0,
    }
    const state: any = { exSpecialCount: 0, ultimateCount: 1, chainCountTotal: 1 }
    harumasaMechanic.patchExecutions!({ cfg, state, executions: [slash, arrow] } as any)
    const cycleRes = computeHarumasaCycle({ cinemaLevel: 2, a5Count: 2, chainCount: 1, ultimateCount: 1, exSpecialCount: 0, conditionCoverage: 0.5, edgeAverageStacks: 0, thunderCoverage: 0, c6ResIgnoreCoverage: 0 })
    expect(slash.dmgBonus).toBe(HARUMASA_C2_DMG_BONUS * cycleRes.surgeCoverage + HARUMASA_ADDITIONAL_DMG * 0.5)
    expect(arrow.dmgBonus).toBe(HARUMASA_ADDITIONAL_DMG * 0.5)
  })

  it('C6减抗按覆盖率作用于电伤，爆炸使用合成倍率且不占动作时间', () => {
    const executions: any[] = []
    const cfg: any = {
      panel: { additionalAbilityActive: 0 },
      harumasaCinemaLevel: 6,
      harumasaA5Count: 4,
      harumasaConditionCoverage: 0,
      harumasaEdgeAverageStacks: 0,
      harumasaThunderCoverage: 0,
      harumasaC6ResIgnoreCoverage: 0.5,
    }
    const state: any = { exSpecialCount: 0, ultimateCount: 0, chainCountTotal: 0 }
    harumasaMechanic.buildExecutions!({ cfg, state, executions } as any)
    harumasaMechanic.patchExecutions!({ cfg, state, executions } as any)
    const explosion = executions.find(row => row.moveId === '1201_c6_electromagnetic_explosion')
    expect(explosion).toBeTruthy()
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
    const neg = await setup('1271')
    expect((computePanelPhases(0, neg.config, neg.catalog)!.inCombat as any).additionalAbilityActive ?? 0).toBe(0)
  })

  it('资源池生成飞弦·斩/甲乙矢行并保留通用失衡提取', async () => {
    await setup('1141', 6)
    const calc = useResourceCalc()
    const harumasa = calc.resourceResult.value!.characters.find(row => row.agentId === '1201')!
    expect(HARUMASA_SLASH_MOVE_IDS.some(id => harumasa.executions.some(row => row.moveId === id))).toBe(true)
    expect(harumasa.executions.some(row => row.moveId === HARUMASA_ARROW_MOVE_ID)).toBe(true)
  })
})
