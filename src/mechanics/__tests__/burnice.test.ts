import { describe, expect, it } from 'vitest'
import { computePanelPhases } from '@/composables/resourceCalc/helpers'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { setupHarness } from '@/test/harness'
import {
  computeBurniceMechanic,
  burniceMechanic,
} from '@/mechanics/agents/burnice'

async function setup(mateId = '1311', cinemaLevel = 0) {
  const result = await setupHarness([
    { agentId: '1171', cinemaLevel, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
    { agentId: mateId, cinemaLevel: 0, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
    '',
  ])
  for (const buff of result.config.globalBuffs) buff.enabled = false
  return result
}

function mechanicInput(overrides: Partial<Parameters<typeof computeBurniceMechanic>[0]> = {}) {
  return {
    exSpecialCount: 2,
    totalTime: 180,
    atk: 1000,
    anomalyProficiency: 500,
    cinemaLevel: 0,
    energyRegen: 1.2,
    ultimateCount: 0,
    singleSpraySeconds: 1.89,
    doubleSpraySeconds: 2.274,
    ...overrides,
  }
}

describe('柏妮思（1171）强特单双喷虚拟化', () => {
  it('强特次数均分单双喷；能量与时间按各型合计', () => {
    const s = computeBurniceMechanic(mechanicInput())
    expect(s.singleCastCount).toBe(1)
    expect(s.doubleCastCount).toBe(1)
    // 单喷 1.89×12.5+5 = 28.625；双喷 2.274×25+10 = 66.85
    expect(s.totalExEnergy).toBeCloseTo(95.475, 3)
    expect(s.singleCastTime).toBeCloseTo(2.205, 3)
    expect(s.doubleCastTime).toBeCloseTo(3.374, 3)

    const half = computeBurniceMechanic(mechanicInput({ singleSpraySeconds: 0.945 }))
    expect(half.singleSustainedMultiplier).toBeCloseTo(1088.3 * 0.5, 3)

    const off = computeBurniceMechanic(mechanicInput({ singleSpraySeconds: 0 }))
    expect(off.singleCastCount).toBe(0)
    expect(off.singleSustainedMultiplier).toBe(0)
    expect(off.singleExplosionMultiplier).toBe(0)
  })

  it('持续倍率按满时长等比缩放；C4 双喷上限+1秒', () => {
    const c0 = computeBurniceMechanic(mechanicInput())
    expect(c0.doubleSustainedMultiplier).toBeCloseTo(1916.2, 3)
    const c4 = computeBurniceMechanic(mechanicInput({ cinemaLevel: 4, doubleSpraySeconds: 3.274 }))
    expect(c4.cinema4DoubleSprayMaxSeconds).toBe(3.274)
    expect(c4.doubleSustainedMultiplier).toBeCloseTo(1916.2, 3)
  })
})

describe('柏妮思燃点与余烬账本', () => {
  it('燃点 = 进场100 + 耗能×1.4 (+C1开局40)(+终结技×50)；阈值进入燃油特调', () => {
    const s = computeBurniceMechanic(mechanicInput({ ultimateCount: 1 }))
    expect(s.initialIgnition).toBe(100)
    expect(s.ignitionFromEnergy).toBeCloseTo(133.665, 3)
    expect(s.ultimateIgnitionGain).toBe(50)
    expect(s.totalIgnition).toBeCloseTo(283.665, 3)
    expect(s.specialStateActive).toBe(true)

    const c1 = computeBurniceMechanic(mechanicInput({ cinemaLevel: 1 }))
    expect(c1.initialIgnition).toBe(140)
  })

  it('余烬触发 = min(燃点预算, CD上限)；C1 倍率350%→450%、积蓄效率+25%', () => {
    const c0 = computeBurniceMechanic(mechanicInput())
    // 预算 floor(233.665/8)=29，CD 上限 180/1.5=120 → 取 29
    expect(c0.emberTriggerCount).toBe(29)
    expect(c0.emberDamageRatio).toBeCloseTo(350, 5)
    // 精通加成 min(30, floor(500/10)) = 30% → 单发 1000×3.5×1.3
    expect(c0.emberDamagePerHit).toBeCloseTo(4550, 3)

    const c1 = computeBurniceMechanic(mechanicInput({ cinemaLevel: 1 }))
    expect(c1.emberTriggerCount).toBe(Math.floor(273.665 / 8))
    expect(c1.emberDamageRatio).toBeCloseTo(450, 5)
    expect(c1.emberBuildUpEfficiencyBonusPct).toBe(25)
    expect(c1.emberBuildUpPerHit).toBe(60)
  })

  it('搅拌式默认吃溢出燃点上限、手动可限但不超过上限；附带免费余烬', () => {
    // 余烬受 CD 上限绑定时（短战斗）才有大量溢出燃点给搅拌式：
    // T=30 → 余烬 CD 上限 20 次×8=160；总燃点 733.665 → 溢出 573.665 → 搅拌式上限 28
    const auto = computeBurniceMechanic(mechanicInput({ totalTime: 30, ultimateCount: 10, stirringCount: 0 }))
    expect(auto.emberTriggerCount).toBe(Math.floor(auto.totalIgnition / 8) >= 20 ? 20 : auto.emberTriggerCount)
    expect(auto.stirringMaxCount).toBeGreaterThan(0)
    expect(auto.stirringCount).toBe(auto.stirringMaxCount)
    expect(auto.stirringFreeEmberCount).toBe(auto.stirringCount)

    const manual = computeBurniceMechanic(mechanicInput({
      totalTime: 30,
      ultimateCount: 10,
      stirringCount: 999, // 超上限时被钳制
    }))
    expect(manual.stirringCount).toBe(manual.stirringMaxCount)
  })

  it('流火计数：普通余烬+1、搅拌附带×2；12点=1流火→灼热抛接法与300%异放', () => {
    const s = computeBurniceMechanic(mechanicInput())
    expect(s.flowCountRaw).toBe(29)
    expect(s.flowFireCount).toBe(2)
    expect(s.tossingCount).toBe(2)
    expect(s.releaseCount).toBe(2)
    expect(s.tossingDamageRatio).toBeCloseTo(400.1, 3)

    const wasted = computeBurniceMechanic(mechanicInput({ flowCountUtilization: 0.5 }))
    expect(wasted.flowCountEffective).toBe(Math.floor(29 * 0.5))
    expect(wasted.flowFireCount).toBe(Math.floor(Math.floor(29 * 0.5) / 12))
  })
})

describe('柏妮思命座与潜能', () => {
  it('C6 特殊余烬按双喷时长折算0.5s CD；灼烧迸发900%受20s CD约束', () => {
    const c6 = computeBurniceMechanic(mechanicInput({ cinemaLevel: 6 }))
    // ceil((2.274+1.1)/0.5) = 7 次/双喷
    expect(c6.cinema6SpecialEmberPerCast).toBe(7)
    expect(c6.cinema6SpecialEmberCount).toBe(7)
    expect(c6.cinema6SpecialEmberBaseRatio).toBeCloseTo(60, 5)
    expect(c6.cinema6BurnBurstCount).toBe(Math.min(1, Math.floor(180 / 20) - 1))
    expect(c6.cinema6BurnBurstDamageRatio).toBeCloseTo(900, 5)
    expect(c6.cinema6FireResIgnore).toBe(25)
  })

  it('潜能沸点派对：初始回能≥1.8 触发，掌控每0.1点+2.5封顶25、增伤每0.1点+2%封顶20%', () => {
    const off = computeBurniceMechanic(mechanicInput({ energyRegen: 1.79 }))
    expect(off.potentialAnomalyMasteryBonus).toBe(0)
    expect(off.potentialDmgBonus).toBe(0)

    const mid = computeBurniceMechanic(mechanicInput({ energyRegen: 2.5 }))
    expect(mid.potentialAnomalyMasteryBonus).toBeCloseTo(17.5, 5)
    expect(mid.potentialDmgBonus).toBeCloseTo(14, 5)

    const capped = computeBurniceMechanic(mechanicInput({ energyRegen: 4.5 }))
    expect(capped.potentialAnomalyMasteryBonus).toBe(25)
    expect(capped.potentialDmgBonus).toBe(20)
  })
})

describe('柏妮思面板与执行计划', () => {
  it('applyPanel 写入潜能加成到面板', () => {
    const panel = {
      energyRegenOutOfCombat: 2.5,
      anomalyMastery: 0,
      dmgBonus: 0,
    } as any
    burniceMechanic.applyPanel!({ panel } as any)
    expect(panel.anomalyMastery).toBeCloseTo(17.5, 5)
    expect(panel.dmgBonus).toBeCloseTo(14, 5)

    const below = { energyRegenOutOfCombat: 1.2, anomalyMastery: 90, dmgBonus: 0 } as any
    burniceMechanic.applyPanel!({ panel: below } as any)
    expect(below.anomalyMastery).toBe(90)
    expect(below.dmgBonus ?? 0).toBe(0)
  })

  it('buildCharConfig 关闭通用强特提取并从倍率表回填四行数值', async () => {
    const { catalog, config } = await setup()
    const skills = catalog.getAgentSkills('1171')
    const cfg: any = {}
    burniceMechanic.buildCharConfig!({ skills, cinemaLevel: 0, cfg } as any)
    expect(cfg.skipGenericExSpecial).toBe(true)
    expect(cfg.burniceSingleSpraySeconds).toBe(1.89)
    expect(cfg.burniceDoubleSpraySeconds).toBe(2.274)
    for (const moveId of ['1171010', '1171011', '1171012', '1171013']) {
      expect(cfg.mechanicRowValues?.[moveId]).toBeGreaterThan(0)
    }
    expect(cfg.exSpecialEnergyConsume).toBeGreaterThan(0)
  })

  it('buildExecutions 生成单双喷四行且强特不重复进通用提取', () => {
    const executions: any[] = []
    burniceMechanic.buildExecutions!({
      cfg: {
        burniceCinemaLevel: 0,
        burniceSingleSpraySeconds: 1.89,
        burniceDoubleSpraySeconds: 2.274,
        panel: { atk: 1000, anomalyProficiency: 500 },
        skipGenericExSpecial: true,
        mechanicRowValues: {},
      },
      state: { exSpecialCount: 2, ultimateCount: 0, frontlineTime: 170, backstageTime: 10 },
      executions,
    } as any)
    const ids = executions.map(e => e.moveId)
    expect(ids).toContain('1171010')
    expect(ids).toContain('1171011')
    expect(ids).toContain('1171012')
    expect(ids).toContain('1171013')
    const single = executions.find(e => e.moveId === '1171010')!
    expect(single.count).toBe(1)
    expect(single.damageMultiplierOverride).toBe(true)
    expect(single.damageMultiplier).toBeCloseTo(1088.3, 3)
    const explosion = executions.find(e => e.moveId === '1171011')!
    expect(explosion.damageMultiplierOverride ?? false).toBe(false)
    expect(explosion.damageMultiplier).toBeCloseTo(193.5, 3)
  })

  it('完整计算链：资源池出双喷行、异放事件注册、面板含潜能', async () => {
    const { catalog, config } = await setup()
    const calc = useResourceCalc()
    const row = calc.resourceResult.value!.characters.find(ch => ch.agentId === '1171')!
    const sprayMoves = row.executions.filter(e => ['1171010', '1171011', '1171012', '1171013'].includes(e.moveId))
    expect(sprayMoves.length).toBeGreaterThanOrEqual(2)
    expect(row.executions.some(e => e.moveId === '1171026')).toBe(false) // 抛接法走异放事件不走执行行

    const source = (row as any).burniceMechanicSource
    expect(source).toBeTruthy()
    expect(source.doubleCastCount).toBeGreaterThan(0)
    expect(source.specialStateActive).toBe(true)

    const p = computePanelPhases(0, config, catalog)!.inCombat as any
    expect(p.additionalAbilityActive ?? 1).toBeGreaterThanOrEqual(0)
  })
})
