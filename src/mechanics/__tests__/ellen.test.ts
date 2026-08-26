import { describe, expect, it } from 'vitest'
import { computePanelPhases } from '@/composables/resourceCalc/helpers'
import { useResourceCalc } from '@/composables/useResourceCalc'
import {
  ELLEN_C1_CRIT_RATE_PER_STACK,
  ELLEN_C2_CRIT_DMG_MAX,
  ELLEN_C2_CRIT_DMG_PER_CHARGE,
  ELLEN_C4_CHARGE_PER_TRIGGER,
  ELLEN_C4_ENERGY_PER_TRIGGER,
  ELLEN_C6_FEAST_DMG,
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
    basicAttackTime: 60,
    exSpecialCount: 2,
    freezeCount: 0,
    stunCount: 0,
    c4CdRate: 1,
    additionalActive: true,
    c1CritStacks: 6,
    c2AvgCharge: 3,
    stormSurgeStacks: 10,
    c6PenCoverage: 1,
    c6FeastCoverage: 1,
    ...overrides,
  })
}

/** patchExecutions 测试用的最小 cfg（cycle 数值不影响暴伤/增伤定向） */
function patchCfg(extra: Record<string, unknown> = {}) {
  return {
    ellenCinemaLevel: 0,
    ellenPotentialLevel: 6,
    ellenC1CritStacks: 0,
    ellenC2AvgCharge: 0,
    ellenStormSurgeStacks: 0,
    ellenC6PenCoverage: 0,
    ellenC6FeastCoverage: 0,
    ellenC4CdRate: 1,
    ellenFreezeCount: 0,
    ellenStunCount: 0,
    ellenAdditionalActive: false,
    ...extra,
  }
}

describe('艾莲（1191）急冻充能总量（平A池时间驱动）', () => {
  it('蓄力剪击数由平A池时间驱动，冰刃浪:第三段=1:1', () => {
    const c = cycle({ cinemaLevel: 0, exSpecialCount: 0, basicAttackTime: 60 })
    // C0：chargedPer=3，每蓄力=回旋+蓄力(1.119s)+1轮burst(4.393s)=5.512s → floor(60/5.512)=10
    expect(c.dashChargedCount).toBe(10)
    expect(c.totalChargeGain).toBe(30)
    expect(c.iceWaveCount).toBe(10)
    expect(c.frostTrimSegments).toBe(10)
    expect(c.iceWaveCount).toBe(c.frostTrimSegments)
  })

  it('强特提供免费burst并挤掉蓄力剪击；影画1提高每蓄力产出', () => {
    // 无强特：60s → 10 蓄力
    const noEx = cycle({ cinemaLevel: 0, exSpecialCount: 0, basicAttackTime: 60 })
    expect(noEx.dashChargedCount).toBe(10)
    // 3 强特（+3 充能 = 1 免费 burst + 3 鲨卷风霜锋时间）→ 蓄力被挤掉
    const withEx = cycle({ cinemaLevel: 0, exSpecialCount: 3, basicAttackTime: 60 })
    expect(withEx.extraBursts).toBe(1)
    expect(withEx.dashChargedCount).toBe(9)
    expect(withEx.dashChargedCount).toBeLessThan(noEx.dashChargedCount)
    // 影画1：chargedPer 3→6，同样时间更多充能 → 更多 burst
    const c1 = cycle({ cinemaLevel: 1, exSpecialCount: 0, basicAttackTime: 60 })
    expect(c1.dashChargedCount).toBe(6)
    expect(c1.iceWaveCount).toBe(12)
  })

  it('影画4冻结/失衡按冻结+失衡次数计数：+6充能、+4回能×CD率', () => {
    expect(cycle({ cinemaLevel: 3, freezeCount: 2, stunCount: 3 }).c4ChargeGain).toBe(0)
    const c4 = cycle({ cinemaLevel: 4, freezeCount: 2, stunCount: 3, exSpecialCount: 0 })
    expect(c4.c4TriggerCount).toBe(5)
    expect(c4.c4ChargeGain).toBe(5 * ELLEN_C4_CHARGE_PER_TRIGGER)
    expect(c4.c4EnergyTotal).toBe(5 * ELLEN_C4_ENERGY_PER_TRIGGER)
    expect(c4.extraBursts).toBe(10) // 30 充能 / 3
    const c4cd = cycle({ cinemaLevel: 4, freezeCount: 2, stunCount: 3, exSpecialCount: 0, c4CdRate: 0.5 })
    expect(c4cd.c4EnergyTotal).toBe(5 * ELLEN_C4_ENERGY_PER_TRIGGER * 0.5)
    expect(c4cd.c4ChargeGain).toBe(5 * ELLEN_C4_CHARGE_PER_TRIGGER) // 充能不吃CD
  })

  it('影画2强特暴伤按持有充能折算并封顶60%', () => {
    expect(cycle({ cinemaLevel: 1, c2AvgCharge: 3 }).c2CritDmg).toBe(0)
    expect(cycle({ cinemaLevel: 2, c2AvgCharge: 2 }).c2CritDmg).toBe(2 * ELLEN_C2_CRIT_DMG_PER_CHARGE)
    expect(cycle({ cinemaLevel: 2, c2AvgCharge: 3 }).c2CritDmg).toBe(ELLEN_C2_CRIT_DMG_MAX)
  })

  it('影画1暴击率与风暴潮/影画6穿透/盛宴按层数/覆盖率结算', () => {
    const c = cycle({ cinemaLevel: 6, c1CritStacks: 4, stormSurgeStacks: 5, c6PenCoverage: 0.5, c6FeastCoverage: 0.5 })
    expect(c.c1CritRate).toBe(4 * ELLEN_C1_CRIT_RATE_PER_STACK)
    expect(c.stormSurgeIceDmg).toBe(5 * ELLEN_STORM_SURGE_PER_STACK)
    expect(c.c6PenRatio).toBe(10)
    expect(c.c6FeastDmg).toBe(ELLEN_C6_FEAST_DMG * 0.5)
    expect(cycle({ cinemaLevel: 0 }).c1CritRate).toBe(0)
    expect(cycle({ cinemaLevel: 0 }).c6PenRatio).toBe(0)
    expect(cycle({ cinemaLevel: 0 }).c6FeastDmg).toBe(0)
    expect(cycle({ additionalActive: false }).stormSurgeIceDmg).toBe(0)
  })

  it('潜能极冰带按潜能等级结算：每层暴伤 + 满10层无视冰抗，潜能I无觉醒', () => {
    const c6 = cycle({ potentialLevel: 6, stormSurgeStacks: 10 })
    expect(c6.potentialCritDmg).toBeCloseTo(10 * 4.8)
    expect(c6.potentialIceResIgnore).toBeCloseTo(10)
    const c3 = cycle({ potentialLevel: 3, stormSurgeStacks: 10 })
    expect(c3.potentialCritDmg).toBeCloseTo(10 * 2.4)
    expect(c3.potentialIceResIgnore).toBeCloseTo(5)
    const c1 = cycle({ potentialLevel: 1, stormSurgeStacks: 10 })
    expect(c1.potentialCritDmg).toBe(0)
    expect(c1.potentialIceResIgnore).toBe(0)
    const c9 = cycle({ potentialLevel: 6, stormSurgeStacks: 9 })
    expect(c9.potentialCritDmg).toBeCloseTo(9 * 4.8)
    expect(c9.potentialIceResIgnore).toBe(0)
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
      cfg: patchCfg({ ellenCinemaLevel: 2, ellenC2AvgCharge: 3 }),
      state: { exSpecialCount: 1, ultimateCount: 1, chainCountTotal: 0, basicAttackTime: 0 },
      executions: [trim, dash, ult, ex],
    } as any)
    expect(trim.critDmgBonus).toBe(ELLEN_CORE_CRIT_DMG)
    expect(dash.critDmgBonus).toBe(ELLEN_CORE_CRIT_DMG)
    expect(ult.critDmgBonus).toBe(ELLEN_CORE_CRIT_DMG)
    expect(ex.critDmgBonus).toBe(ELLEN_C2_CRIT_DMG_MAX)
  })

  it('影画6盛宴给蓄力剪击(1191009)挂+250%增伤，回旋斩击不挂', () => {
    const charged: any = { moveId: ELLEN_DASH_MOVE_IDS[1], element: 'ice' }
    const spin: any = { moveId: ELLEN_DASH_MOVE_IDS[0], element: 'ice' }
    ellenMechanic.patchExecutions!({
      cfg: patchCfg({ ellenCinemaLevel: 6, ellenPotentialLevel: 1, ellenC6FeastCoverage: 1 }),
      state: { exSpecialCount: 0, ultimateCount: 0, chainCountTotal: 0, basicAttackTime: 0 },
      executions: [charged, spin],
    } as any)
    expect(charged.dmgBonus).toBe(ELLEN_C6_FEAST_DMG)
    expect(spin.dmgBonus ?? 0).toBe(0)
  })

  it('核心被动受益招式按潜能门控：潜能I不给连携/终结/霜锋/冰刃浪挂暴伤', () => {
    const trim: any = { moveId: ELLEN_FROST_TRIM_MOVE_IDS[0], element: 'ice' }
    const ult: any = { moveId: ELLEN_ULT_MOVE_ID, element: 'ice' }
    ellenMechanic.patchExecutions!({
      cfg: patchCfg({ ellenPotentialLevel: 1 }),
      state: { exSpecialCount: 0, ultimateCount: 0, chainCountTotal: 0, basicAttackTime: 0 },
      executions: [trim, ult],
    } as any)
    expect(trim.critDmgBonus).toBe(ELLEN_CORE_CRIT_DMG)
    expect(ult.critDmgBonus ?? 0).toBe(0)
  })

  it('蓄力剪击生成1191007+1191009各一次，急冻修剪法只打第三段，冰刃浪:第三段=1:1', () => {
    const executions: any[] = []
    ellenMechanic.buildExecutions!({
      cfg: patchCfg({ ellenCinemaLevel: 0 }),
      state: { exSpecialCount: 0, ultimateCount: 0, chainCountTotal: 0, basicAttackTime: 30 },
      executions,
    } as any)
    // C0：60s→10 蓄力；30s → floor(30/5.512)=5 蓄力 → 5 冰刃浪 + 5 第三段
    expect(executions.find(r => r.moveId === '1191006')?.count).toBe(5)
    expect(executions.find(r => r.moveId === '1191007')?.count).toBe(5)
    expect(executions.find(r => r.moveId === '1191009')?.count).toBe(5)
    // 快蓄：蓄力剪击 actionTime 减半 = 0.553
    expect(executions.find(r => r.moveId === '1191009')?.actionTime).toBeCloseTo(0.553)
    expect(executions.find(r => r.moveId === '1191029')?.count).toBe(5)
    expect(executions.find(r => r.moveId === '1191030')?.count).toBe(5)
    expect(executions.find(r => r.moveId === '1191004')).toBeUndefined()
    expect(executions.find(r => r.moveId === '1191005')).toBeUndefined()
    for (const row of executions) {
      expect(row.element).toBe('ice')
      expect(row.totalTime).toBe(row.count * row.actionTime)
    }
  })

  it('强化特殊技：0命横扫+鲨卷风、影画2全鲨卷风；霜锋免费自动派生', () => {
    const ex0: any[] = []
    ellenMechanic.buildExecutions!({
      cfg: patchCfg({ ellenCinemaLevel: 0 }),
      state: { exSpecialCount: 2, ultimateCount: 0, chainCountTotal: 0, basicAttackTime: 0 },
      executions: ex0,
    } as any)
    const sweep0 = ex0.filter(r => r.moveId === '1191011').reduce((s, r) => s + (r.count ?? 0), 0)
    expect(sweep0).toBe(2)
    const blade0 = ex0.filter(r => r.moveId === '1191027').reduce((s, r) => s + (r.count ?? 0), 0)
    const qi0 = ex0.filter(r => r.moveId === '1191028').reduce((s, r) => s + (r.count ?? 0), 0)
    expect(blade0).toBe(6)  // 3 × 触发2（第三段0 + 鲨卷风2）
    expect(qi0).toBe(12)    // 6 × 触发2（大体型）
    expect(ex0.filter(r => r.moveId === '1191029' || r.moveId === '1191030').reduce((s, r) => s + (r.count ?? 0), 0)).toBe(0)

    const ex2: any[] = []
    ellenMechanic.buildExecutions!({
      cfg: patchCfg({ ellenCinemaLevel: 2 }),
      state: { exSpecialCount: 2, ultimateCount: 0, chainCountTotal: 0, basicAttackTime: 0 },
      executions: ex2,
    } as any)
    const sweep2 = ex2.filter(r => r.moveId === '1191011').reduce((s, r) => s + (r.count ?? 0), 0)
    expect(sweep2).toBe(0)
    const sharkExtra2 = ex2.filter(r => r.moveId === '1191012').reduce((s, r) => s + (r.count ?? 0), 0)
    expect(sharkExtra2).toBe(2)
    const blade2 = ex2.filter(r => r.moveId === '1191027').reduce((s, r) => s + (r.count ?? 0), 0)
    expect(blade2).toBe(12) // 3 × 触发4（全鲨卷风）
  })

  it('霜锋剑气按敌方体型：小0/中3/大6 段', () => {
    const run = (bodySize: string) => {
      const ex: any[] = []
      ellenMechanic.buildExecutions!({
        cfg: patchCfg({ ellenCinemaLevel: 0, bodySize }),
        state: { exSpecialCount: 1, ultimateCount: 0, chainCountTotal: 0, basicAttackTime: 0 },
        executions: ex,
      } as any)
      return ex.filter(r => r.moveId === '1191028').reduce((s, r) => s + (r.count ?? 0), 0)
    }
    expect(run('small')).toBe(0)
    expect(run('medium')).toBe(3)
    expect(run('large')).toBe(6)
  })

  it('影画4回能经applyTeamConfig幂等并入initialEnergyGift（冻结读异常池注入的ellenFreezeCount）', () => {
    const characters: any[] = [
      { slot: 0, agentId: '1191', initialEnergyGift: 40, ellenFreezeCount: 2, ellenC4CdRate: 1 },
    ]
    const input: any = { slot: 0, cinemaLevel: 4, characters, phase: 'converge', stunCount: 3 }
    ellenMechanic.applyTeamConfig!(input)
    expect(characters[0].initialEnergyGift).toBe(60)
    expect(characters[0].ellenC4EnergyTotal).toBe(20)
    expect(characters[0].ellenStunCount).toBe(3)
    ellenMechanic.applyTeamConfig!(input)
    expect(characters[0].initialEnergyGift).toBe(60)
    ellenMechanic.applyTeamConfig!({ ...input, phase: 'build' })
    expect(characters[0].initialEnergyGift).toBe(60)
    const c0: any[] = [{ slot: 0, agentId: '1191', initialEnergyGift: 40 }]
    ellenMechanic.applyTeamConfig!({ slot: 0, cinemaLevel: 0, characters: c0, phase: 'converge', stunCount: 3 } as any)
    expect(c0[0].initialEnergyGift).toBe(40)
  })
})

describe('艾莲完整计算链', () => {
  it('额外能力由同属性/同阵营/击破队友激活，普通异属性队友不激活', async () => {
    for (const mateId of ['1341', '1141']) {
      const { catalog, config } = await setup(mateId)
      expect((computePanelPhases(0, config, catalog)!.inCombat as any).additionalAbilityActive).toBe(1)
    }
    const neg = await setup('1221')
    expect((computePanelPhases(0, neg.config, neg.catalog)!.inCombat as any).additionalAbilityActive ?? 0).toBe(0)
  })

  it('资源池生成急冻修剪法/冰刃浪行并保留通用失衡提取', async () => {
    await setup('1141', 6)
    const calc = useResourceCalc()
    const ellen = calc.resourceResult.value!.characters.find(row => row.agentId === '1191')!
    // 充能循环核心（冰刃浪+第三段）必然生成；蓄力剪击在时间紧张（强特/影画4挤占）时可能为0
    expect(ELLEN_FROST_TRIM_MOVE_IDS.some(id => ellen.executions.some(row => row.moveId === id))).toBe(true)
    expect(ELLEN_ICE_WAVE_MOVE_IDS.some(id => ellen.executions.some(row => row.moveId === id))).toBe(true)
    expect(calc.stunPoolResult.value!.contributions.some(row =>
      row.slot === 0 && [...ELLEN_FROST_TRIM_MOVE_IDS, ...ELLEN_ICE_WAVE_MOVE_IDS, ...ELLEN_DASH_MOVE_IDS].includes(row.moveId as any))).toBe(true)
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
    expect(panel.critRate).toBeGreaterThanOrEqual(12)
    expect(panel.iceDmg).toBeGreaterThanOrEqual(30)
    expect(panel.penRatio).toBeGreaterThanOrEqual(20)
    expect(panel.critDmg).toBeGreaterThanOrEqual(50 + 48)
    expect(panel.enemyIceResReduction).toBeGreaterThanOrEqual(10)
  })

  it('覆盖率滑块→面板重算（防守卫冻结，SOP §3.5）', async () => {
    const { catalog, config } = await setup('1141', 6)
    const penOf = () => (computePanelPhases(0, config, catalog)!.inCombat as any).penRatio ?? 0
    config.setMechanicSetting('ellen.c6PenCoverage', 1)
    const on = penOf()
    config.setMechanicSetting('ellen.c6PenCoverage', 0)
    const off = penOf()
    expect(on - off).toBeCloseTo(20, 1) // ELLEN_C6_PEN_RATIO
  })

  it('潜能I无极冰带：暴伤与无视冰抗不叠加（潜能VI 有 +48% 暴伤 +10% 无视冰抗）', async () => {
    await setup('1141', 6, 1)
    const calc = useResourceCalc()
    const panel = calc.panels.value[0] as any
    expect(panel.critDmg).toBeLessThan(98)
    expect((panel.enemyIceResReduction ?? 0)).toBeLessThan(10 + 25 - 5)
  })
})
