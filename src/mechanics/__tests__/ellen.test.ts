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
  ELLEN_ICE_WAVE_MOVE_IDS,
  ELLEN_STORM_SURGE_PER_STACK,
  ELLEN_ULT_MOVE_ID,
  computeEllenCycle,
  ellenMechanic,
} from '@/mechanics/agents/ellen'
import { setupHarness } from '@/test/harness'

async function setup(mateId = '1191', cinemaLevel = 0, potentialLevel = 6) {
  const result = await setupHarness([
    { agentId: '1191', cinemaLevel, potentialLevel, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
    { agentId: mateId, cinemaLevel: 0, potentialLevel: 6, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
  ])
  for (const buff of result.config.globalBuffs) buff.enabled = false
  return result
}

function cycle(overrides: Partial<Parameters<typeof computeEllenCycle>[0]> = {}) {
  return computeEllenCycle({
    cinemaLevel: 0,
    potentialLevel: 6,
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
    // 快速6×1 + 蓄力3×3 + 强特2×1 = 17 → 冰刃浪 3 轮(15充能) + 急冻 3段+2段余量
    expect(c0.totalChargeGain).toBe(6 * 1 + 3 * 3 + 2)
    expect(c0.iceWaveCount).toBe(3)
    expect(c0.frostTrimSegments).toBe(3 * 3 + 2)

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

  it('潜能极冰带按潜能等级结算：每层暴伤 + 满10层无视冰抗，潜能I无觉醒', () => {
    // 潜能 VI（6）：10 层 → 每层 4.8% × 10 = 48% 暴伤，无视 10% 冰抗
    const c6 = cycle({ potentialLevel: 6, stormSurgeStacks: 10 })
    expect(c6.potentialCritDmg).toBeCloseTo(10 * 4.8)
    expect(c6.potentialIceResIgnore).toBeCloseTo(10)
    // 潜能 III（3）：每层 2.4% → 24% 暴伤，无视 5% 冰抗
    const c3 = cycle({ potentialLevel: 3, stormSurgeStacks: 10 })
    expect(c3.potentialCritDmg).toBeCloseTo(10 * 2.4)
    expect(c3.potentialIceResIgnore).toBeCloseTo(5)
    // 潜能 I（1）：无觉醒 → 0
    const c1 = cycle({ potentialLevel: 1, stormSurgeStacks: 10 })
    expect(c1.potentialCritDmg).toBe(0)
    expect(c1.potentialIceResIgnore).toBe(0)
    // 未叠满 10 层：只有每层暴伤，不触发无视冰抗
    const c9 = cycle({ potentialLevel: 6, stormSurgeStacks: 9 })
    expect(c9.potentialCritDmg).toBeCloseTo(9 * 4.8)
    expect(c9.potentialIceResIgnore).toBe(0)
    // 额外能力未激活：全部为 0
    const off = cycle({ potentialLevel: 6, additionalActive: false })
    expect(off.potentialCritDmg).toBe(0)
    expect(off.potentialIceResIgnore).toBe(0)
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

  it('核心被动受益招式按潜能门控：潜能I不给连携/终结/霜锋/冰刃浪挂暴伤', () => {
    const trim: any = { moveId: ELLEN_FROST_TRIM_MOVE_IDS[0], element: 'ice' }
    const ult: any = { moveId: ELLEN_ULT_MOVE_ID, element: 'ice' }
    const baseCfg = {
      ellenCinemaLevel: 0,
      ellenPotentialLevel: 1,
      ellenDashQuickCount: 0,
      ellenDashChargedCount: 0,
      ellenC1CritStacks: 0,
      ellenC2AvgCharge: 0,
      ellenStormSurgeStacks: 0,
      ellenC6PenCoverage: 0,
      ellenAdditionalActive: false,
    }
    ellenMechanic.patchExecutions!({
      cfg: baseCfg,
      state: { exSpecialCount: 0, ultimateCount: 0, chainCountTotal: 0 },
      executions: [trim, ult],
    } as any)
    // 潜能 I：急冻修剪法吃暴伤，终结技不吃
    expect(trim.critDmgBonus).toBe(ELLEN_CORE_CRIT_DMG)
    expect(ult.critDmgBonus ?? 0).toBe(0)
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
    // 充能 = 4×1 + 2×3 = 10 → 冰刃浪 2 轮（floor(10/5)=2，耗4充能）+ 急冻修剪法 6 段（10-4）
    const trimTotal = ELLEN_FROST_TRIM_MOVE_IDS.reduce(
      (sum, id) => sum + (executions.find(row => row.moveId === id)?.count ?? 0), 0)
    expect(trimTotal).toBe(6)
    const iceWaveTotal = ELLEN_ICE_WAVE_MOVE_IDS.reduce(
      (sum, id) => sum + (executions.find(row => row.moveId === id)?.count ?? 0), 0)
    expect(iceWaveTotal).toBe(2)
    const dashTotal = ELLEN_DASH_MOVE_IDS.reduce(
      (sum, id) => sum + (executions.find(row => row.moveId === id)?.count ?? 0), 0)
    expect(dashTotal).toBe(6)
    for (const row of executions) {
      expect(row.element).toBe('ice')
      expect(row.totalTime).toBe(row.count * row.actionTime)
    }
  })

  it('强化特殊技：0命横扫+鲨卷风、影画2全鲨卷风；霜锋免费自动派生', () => {
    // 0命：模块显式补横扫；通用生成鲨卷风（此处只测模块推的横扫/霜锋）
    const ex0: any[] = []
    ellenMechanic.buildExecutions!({
      cfg: {
        ellenCinemaLevel: 0, ellenPotentialLevel: 6,
        ellenDashQuickCount: 0, ellenDashChargedCount: 0,
        ellenC1CritStacks: 0, ellenC2AvgCharge: 0, ellenStormSurgeStacks: 0, ellenC6PenCoverage: 0,
        ellenAdditionalActive: false,
      },
      state: { exSpecialCount: 2, ultimateCount: 0, chainCountTotal: 0 },
      executions: ex0,
    } as any)
    const sweep0 = ex0.filter(r => r.moveId === '1191011').reduce((s, r) => s + (r.count ?? 0), 0)
    expect(sweep0).toBe(2) // 横扫 = 强特次数
    // 霜锋（倍率表融合，默认大体型 qi=6）：挥刀 1191027×3、剑气 1191028×6 每触发
    const blade0 = ex0.filter(r => r.moveId === '1191027').reduce((s, r) => s + (r.count ?? 0), 0)
    const qi0 = ex0.filter(r => r.moveId === '1191028').reduce((s, r) => s + (r.count ?? 0), 0)
    expect(blade0).toBe(6)  // 3 × 触发2
    expect(qi0).toBe(12)    // 6 × 触发2（大体型）
    // 冰刃浪：充能2 → 无完整轮（floor(2/5)=0）
    expect(ex0.filter(r => r.moveId === '1191029' || r.moveId === '1191030').reduce((s, r) => s + (r.count ?? 0), 0)).toBe(0)

    // 影画2：横扫 0、追加鲨卷风=强特次数
    const ex2: any[] = []
    ellenMechanic.buildExecutions!({
      cfg: {
        ellenCinemaLevel: 2, ellenPotentialLevel: 6,
        ellenDashQuickCount: 0, ellenDashChargedCount: 0,
        ellenC1CritStacks: 0, ellenC2AvgCharge: 0, ellenStormSurgeStacks: 0, ellenC6PenCoverage: 0,
        ellenAdditionalActive: false,
      },
      state: { exSpecialCount: 2, ultimateCount: 0, chainCountTotal: 0 },
      executions: ex2,
    } as any)
    const sweep2 = ex2.filter(r => r.moveId === '1191011').reduce((s, r) => s + (r.count ?? 0), 0)
    expect(sweep2).toBe(0)
    const sharkExtra2 = ex2.filter(r => r.moveId === '1191012').reduce((s, r) => s + (r.count ?? 0), 0)
    expect(sharkExtra2).toBe(2) // 影画2 追加鲨卷风 = 强特次数（配合通用 = 2×鲨卷风）
    const blade2 = ex2.filter(r => r.moveId === '1191027').reduce((s, r) => s + (r.count ?? 0), 0)
    expect(blade2).toBe(12) // 3 × 触发4（全鲨卷风）
  })

  it('霜锋剑气按敌方体型：小0/中3/大6 段', () => {
    const run = (bodySize: string) => {
      const ex: any[] = []
      ellenMechanic.buildExecutions!({
        cfg: {
          ellenCinemaLevel: 0, ellenPotentialLevel: 6, bodySize,
          ellenDashQuickCount: 0, ellenDashChargedCount: 0,
          ellenC1CritStacks: 0, ellenC2AvgCharge: 0, ellenStormSurgeStacks: 0, ellenC6PenCoverage: 0,
          ellenAdditionalActive: false,
        },
        state: { exSpecialCount: 1, ultimateCount: 0, chainCountTotal: 0 },
        executions: ex,
      } as any)
      return ex.filter(r => r.moveId === '1191028').reduce((s, r) => s + (r.count ?? 0), 0)
    }
    expect(run('small')).toBe(0)
    expect(run('medium')).toBe(3)  // 1 触发 × 3 剑气
    expect(run('large')).toBe(6)
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
    expect(cycleRes.potentialCritDmg).toBeCloseTo(48)
    expect(cycleRes.potentialIceResIgnore).toBeCloseTo(10)
    const panel = calc.panels.value[0] as any
    expect(panel.__ellenPanelApplied).toBe(true)
    expect(panel.critRate).toBeGreaterThanOrEqual(12)
    expect(panel.iceDmg).toBeGreaterThanOrEqual(30)
    expect(panel.penRatio).toBeGreaterThanOrEqual(20)
    expect(panel.critDmg).toBeGreaterThanOrEqual(50 + 48)
    expect(panel.enemyIceResReduction).toBeGreaterThanOrEqual(10)
  })

  it('潜能I无极冰带：暴伤与无视冰抗不叠加（潜能VI 有 +48% 暴伤 +10% 无视冰抗）', async () => {
    await setup('1141', 6, 1)
    const calc = useResourceCalc()
    const panel = calc.panels.value[0] as any
    // 基准暴伤 50 + 无极冰带增量（应远低于潜能VI的 98）
    expect(panel.critDmg).toBeLessThan(98)
    expect((panel.enemyIceResReduction ?? 0)).toBeLessThan(10 + 25 - 5)
  })
})
