import { describe, expect, it } from 'vitest'
import { computePanelPhases } from '@/composables/resourceCalc/helpers'
import { useResourceCalc } from '@/composables/useResourceCalc'
import {
  ELLEN_C1_CRIT_RATE_PER_STACK,
  ELLEN_C2_CRIT_DMG_MAX,
  ELLEN_C2_CRIT_DMG_PER_CHARGE,
  ELLEN_CORE_CRIT_DMG,
  ELLEN_DASH_MOVE_IDS,
  ELLEN_EX_MOVE_IDS,
  ELLEN_FROST_TRIM_MOVE_IDS,
  ELLEN_STORM_SURGE_PER_STACK,
  ELLEN_ULT_MOVE_ID,
  computeEllenCycle,
  ellenMechanic,
} from '@/mechanics/agents/ellen'
import { setupHarness } from '@/test/harness'

async function setup(mateId = '1191', cinemaLevel = 0) {
  const result = await setupHarness([
    { agentId: '1191', cinemaLevel, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
    { agentId: mateId, cinemaLevel: 0, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
  ])
  for (const buff of result.config.globalBuffs) buff.enabled = false
  return result
}

function cycle(overrides: Partial<Parameters<typeof computeEllenCycle>[0]> = {}) {
  return computeEllenCycle({
    cinemaLevel: 0,
    dashQuickCount: 6,
    dashChargedCount: 3,
    exSpecialCount: 2,
    chainCount: 0,
    additionalActive: true,
    c1CritStacks: 6,
    c2AvgCharge: 3,
    stormSurgeStacks: 10,
    c6PenCoverage: 1,
    ...overrides,
  })
}

describe('艾莲（1191）急冻充能总量', () => {
  it('充能获取按原文拆分，影画1提升剪击获取，终结技不获取充能', () => {
    const c0 = cycle({ cinemaLevel: 0, exSpecialCount: 2 })
    // 快速6×1 + 蓄力3×3 + 强特2×1 = 17
    expect(c0.totalChargeGain).toBe(6 * 1 + 3 * 3 + 2)
    expect(c0.frostTrimSegments).toBe(c0.totalChargeGain)

    const c1 = cycle({ cinemaLevel: 1, exSpecialCount: 2 })
    // 快速6×3 + 蓄力3×6 + 强特2×1 = 38
    expect(c1.totalChargeGain).toBe(6 * 3 + 3 * 6 + 2)
  })

  it('影画4冻结/失衡按连携次数近似每次+6', () => {
    expect(cycle({ cinemaLevel: 3, chainCount: 2 }).c4ChargeGain).toBe(0)
    expect(cycle({ cinemaLevel: 4, chainCount: 2 }).c4ChargeGain).toBe(12)
  })

  it('影画2强特暴伤按持有充能折算并封顶60%', () => {
    expect(cycle({ cinemaLevel: 1, c2AvgCharge: 3 }).c2CritDmg).toBe(0)
    expect(cycle({ cinemaLevel: 2, c2AvgCharge: 2 }).c2CritDmg).toBe(2 * ELLEN_C2_CRIT_DMG_PER_CHARGE)
    expect(cycle({ cinemaLevel: 2, c2AvgCharge: 3 }).c2CritDmg).toBe(ELLEN_C2_CRIT_DMG_MAX)
  })

  it('影画1暴击率与风暴潮/影画6面板增益按层数/覆盖率结算', () => {
    const c = cycle({ cinemaLevel: 6, c1CritStacks: 4, stormSurgeStacks: 5, c6PenCoverage: 0.5 })
    expect(c.c1CritRate).toBe(4 * ELLEN_C1_CRIT_RATE_PER_STACK)
    expect(c.stormSurgeIceDmg).toBe(5 * ELLEN_STORM_SURGE_PER_STACK)
    expect(c.c6PenRatio).toBe(10)
    expect(cycle({ cinemaLevel: 0 }).c1CritRate).toBe(0)
    expect(cycle({ cinemaLevel: 0 }).c6PenRatio).toBe(0)
    expect(cycle({ additionalActive: false }).stormSurgeIceDmg).toBe(0)
  })
})

describe('艾莲招式定向与执行行', () => {
  it('核心被动只给受益招式挂+100%暴伤，并给强特叠加影画2暴伤', () => {
    const trim: any = { moveId: ELLEN_FROST_TRIM_MOVE_IDS[0], element: 'ice' }
    const dash: any = { moveId: ELLEN_DASH_MOVE_IDS[0], element: 'ice' }
    const ult: any = { moveId: ELLEN_ULT_MOVE_ID, element: 'ice' }
    const ex: any = { moveId: ELLEN_EX_MOVE_IDS[0], element: 'ice' }
    ellenMechanic.patchExecutions!({
      cfg: {
        ellenCinemaLevel: 2,
        ellenDashQuickCount: 0,
        ellenDashChargedCount: 0,
        ellenC1CritStacks: 0,
        ellenC2AvgCharge: 3,
        ellenStormSurgeStacks: 0,
        ellenC6PenCoverage: 0,
        ellenAdditionalActive: false,
      },
      state: { exSpecialCount: 1, ultimateCount: 1, chainCountTotal: 0 },
      executions: [trim, dash, ult, ex],
    } as any)
    expect(trim.critDmgBonus).toBe(ELLEN_CORE_CRIT_DMG)
    expect(dash.critDmgBonus).toBe(ELLEN_CORE_CRIT_DMG)
    expect(ult.critDmgBonus).toBe(ELLEN_CORE_CRIT_DMG)
    // 强特不是核心被动目标，但吃影画2暴伤
    expect(ex.critDmgBonus).toBe(ELLEN_C2_CRIT_DMG_MAX)
  })

  it('按充能消耗生成真实moveId的急冻修剪法与冰渊潜袭执行行', () => {
    const executions: any[] = []
    ellenMechanic.buildExecutions!({
      cfg: {
        ellenCinemaLevel: 0,
        ellenDashQuickCount: 4,
        ellenDashChargedCount: 2,
        ellenC1CritStacks: 0,
        ellenC2AvgCharge: 0,
        ellenStormSurgeStacks: 0,
        ellenC6PenCoverage: 0,
        ellenAdditionalActive: false,
      },
      state: { exSpecialCount: 0, ultimateCount: 0, chainCountTotal: 0 },
      executions,
    } as any)
    // 充能 = 4×1 + 2×3 = 10 → 急冻修剪法 10 段
    const trimTotal = ELLEN_FROST_TRIM_MOVE_IDS.reduce(
      (sum, id) => sum + (executions.find(row => row.moveId === id)?.count ?? 0), 0)
    expect(trimTotal).toBe(10)
    const dashTotal = ELLEN_DASH_MOVE_IDS.reduce(
      (sum, id) => sum + (executions.find(row => row.moveId === id)?.count ?? 0), 0)
    expect(dashTotal).toBe(6)
    for (const row of executions) {
      expect(row.element).toBe('ice')
      expect(row.totalTime).toBe(row.count * row.actionTime)
    }
  })
})

describe('艾莲完整计算链', () => {
  it('额外能力由同属性/同阵营/击破队友激活，普通异属性队友不激活', async () => {
    // 同属性冰（1341 照）与同阵营+击破（1141）均触发
    for (const mateId of ['1341', '1141']) {
      const { catalog, config } = await setup(mateId)
      expect((computePanelPhases(0, config, catalog)!.inCombat as any).additionalAbilityActive).toBe(1)
    }
    // 异属性、异阵营、非击破（1221 月城柳·电·异常）不触发
    const neg = await setup('1221')
    expect((computePanelPhases(0, neg.config, neg.catalog)!.inCombat as any).additionalAbilityActive ?? 0).toBe(0)
  })

  it('资源池生成急冻修剪法/冰渊潜袭行并保留通用失衡提取', async () => {
    await setup('1141', 6)
    const calc = useResourceCalc()
    const ellen = calc.resourceResult.value!.characters.find(row => row.agentId === '1191')!
    expect(ELLEN_FROST_TRIM_MOVE_IDS.some(id => ellen.executions.some(row => row.moveId === id))).toBe(true)
    expect(ELLEN_DASH_MOVE_IDS.some(id => ellen.executions.some(row => row.moveId === id))).toBe(true)
    expect(calc.stunPoolResult.value!.contributions.some(row =>
      row.slot === 0 && [...ELLEN_FROST_TRIM_MOVE_IDS, ...ELLEN_DASH_MOVE_IDS].includes(row.moveId as any))).toBe(true)
  })

  it('面板增益进入最终面板（影画1暴击率/风暴潮冰伤/影画6穿透率）', async () => {
    await setup('1141', 6)
    const calc = useResourceCalc()
    const ellen = calc.resourceResult.value!.characters.find(row => row.agentId === '1191')!
    const cycleRes = ellen.specResources?.ellen_cycle as any
    expect(cycleRes).toBeTruthy()
    expect(cycleRes.c1CritRate).toBe(12)
    expect(cycleRes.stormSurgeIceDmg).toBe(30)
    expect(cycleRes.c6PenRatio).toBe(20)
    const panel = calc.panels.value[0] as any
    expect(panel.__ellenPanelApplied).toBe(true)
    expect(panel.critRate).toBeGreaterThanOrEqual(12)
    expect(panel.iceDmg).toBeGreaterThanOrEqual(30)
    expect(panel.penRatio).toBeGreaterThanOrEqual(20)
  })
})
