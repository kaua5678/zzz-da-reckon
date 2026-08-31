import { describe, expect, it } from 'vitest'
import { computePanelPhases } from '@/composables/resourceCalc/helpers'
import { useResourceCalc } from '@/composables/useResourceCalc'
import {
  SETH_ADDITIONAL_RES_REDUCTION,
  SETH_C2_ELECTRIC_BUILDUP,
  SETH_C4_DEFENSIVE_DAZE_BONUS,
  SETH_C6_CRIT_DMG,
  SETH_C6_FINISH_MULT,
  SETH_SHIELD_PROFICIENCY,
  computeSethCycle,
  sethMechanic,
} from '@/mechanics/agents/seth'
import { setupHarness } from '@/test/harness'

async function setup(mateId = '1241', cinemaLevel = 0) {
  const result = await setupHarness([
    { agentId: '1271', cinemaLevel, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
    { agentId: mateId, cinemaLevel: 0, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
  ])
  for (const buff of result.config.globalBuffs) buff.enabled = false
  return result
}

function cycle(overrides: Partial<Parameters<typeof computeSethCycle>[0]> = {}) {
  return computeSethCycle({
    cinemaLevel: 6,
    additionalActive: true,
    shieldCoverage: 1,
    additionalResCoverage: 1,
    c6FinishCount: 6,
    ...overrides,
  })
}

describe('赛斯（1271）总量', () => {
  it('匪石之盾异常精通按持盾覆盖率', () => {
    expect(cycle({ shieldCoverage: 1 }).shieldProficiency).toBe(SETH_SHIELD_PROFICIENCY)
    expect(cycle({ shieldCoverage: 0.5 }).shieldProficiency).toBe(50)
  })

  it('额外能力积蓄减抗按覆盖率与激活门控', () => {
    expect(cycle({ additionalActive: true }).additionalResReduction).toBe(SETH_ADDITIONAL_RES_REDUCTION)
    expect(cycle({ additionalActive: true, additionalResCoverage: 0.5 }).additionalResReduction).toBe(10)
    expect(cycle({ additionalActive: false }).additionalResReduction).toBe(0)
  })

  it('影画2电积蓄与影画6终结一击按命座门控', () => {
    expect(cycle({ cinemaLevel: 2 }).c2ElectricBuildup).toBe(SETH_C2_ELECTRIC_BUILDUP)
    expect(cycle({ cinemaLevel: 1 }).c2ElectricBuildup).toBe(0)
    expect(cycle({ cinemaLevel: 6, c6FinishCount: 6 }).c6FinishCount).toBe(6)
    expect(cycle({ cinemaLevel: 5, c6FinishCount: 6 }).c6FinishCount).toBe(0)
  })
})

describe('赛斯执行行', () => {
  it('影画6生成500%必暴合成行，低命座不生成', () => {
    const execs: any[] = []
    sethMechanic.buildExecutions!({
      cfg: { sethCinemaLevel: 6, sethShieldCoverage: 1, sethAdditionalResCoverage: 1, sethC6FinishCount: 6, sethAdditionalActive: true },
      state: { exSpecialCount: 0, ultimateCount: 0, chainCountTotal: 0 },
      executions: execs,
    } as any)
    const finish = execs.find(e => e.moveId === '1271_c6_finish_strike')
    expect(finish.count).toBe(6)
    expect(finish.damageMultiplier).toBe(SETH_C6_FINISH_MULT)
    expect(finish.critRateBonus).toBe(100)
    expect(finish.critDmgBonus).toBe(SETH_C6_CRIT_DMG)
    expect(finish.element).toBe('electric')

    const execs0: any[] = []
    sethMechanic.buildExecutions!({
      cfg: { sethCinemaLevel: 5, sethShieldCoverage: 1, sethAdditionalResCoverage: 1, sethC6FinishCount: 6, sethAdditionalActive: true },
      state: { exSpecialCount: 0, ultimateCount: 0, chainCountTotal: 0 },
      executions: execs0,
    } as any)
    expect(execs0.find(e => e.moveId === '1271_c6_finish_strike')).toBeUndefined()
  })
})

describe('影画4 招架支援失衡+25%', () => {
  const skills: any = { categories: [{ moves: [{ id: '1271016', rows: [{ id: 'daze', values: [371] }] }] }] }
  const getRowValue = (move: any, rowId: string) =>
    rowId === 'daze' ? (move?.rows?.find((r: any) => r.id === 'daze')?.values[0] ?? 0) : 0

  it('buildCharConfig 预缩招架支援 daze ×1.25，供 patchExecutions 精确覆盖', () => {
    const cfg: any = { defensiveAssistMoveId: '1271016' }
    sethMechanic.buildCharConfig!({
      cinemaLevel: 4, cfg, panel: {} as any, skills, getRowValue,
    } as any)
    expect(cfg.sethC4DefensiveDaze).toBeCloseTo(371 * (1 + SETH_C4_DEFENSIVE_DAZE_BONUS / 100), 2)
  })

  it('patchExecutions 只对招架支援行挂 dazeMultiplierOverride；低命座不挂', () => {
    const execs: any[] = [
      { moveId: '1271016', dazeMultiplier: undefined, dazeMultiplierOverride: undefined },
      { moveId: '1271008', dazeMultiplier: undefined, dazeMultiplierOverride: undefined },
    ]
    sethMechanic.patchExecutions!({
      cfg: { sethCinemaLevel: 4, sethC4DefensiveDaze: 371 * 1.25, defensiveAssistMoveId: '1271016' },
      state: {} as any,
      executions: execs,
    } as any)
    expect(execs[0].dazeMultiplier).toBeCloseTo(371 * 1.25, 2)
    expect(execs[0].dazeMultiplierOverride).toBe(true)
    expect(execs[1].dazeMultiplierOverride).toBeUndefined() // 强特行不吃

    const execs0: any[] = [{ moveId: '1271016' }]
    sethMechanic.patchExecutions!({
      cfg: { sethCinemaLevel: 3, sethC4DefensiveDaze: 371 * 1.25, defensiveAssistMoveId: '1271016' },
      state: {} as any,
      executions: execs0,
    } as any)
    expect(execs0[0].dazeMultiplierOverride).toBeUndefined() // 低命座不挂
  })
})

describe('赛斯完整计算链', () => {
  it('额外能力由同属性/同阵营队友激活，异属性异阵营队友不激活', async () => {
    const pos = await setup('1241')
    expect((computePanelPhases(0, pos.config, pos.catalog)!.inCombat as any).additionalAbilityActive).toBe(1)
    const neg = await setup('1031')
    expect((computePanelPhases(0, neg.config, neg.catalog)!.inCombat as any).additionalAbilityActive ?? 0).toBe(0)
  })

  it('资源池写入赛斯循环，面板进入精通/积蓄减抗/影画2电积蓄', async () => {
    await setup('1241', 2)
    const calc = useResourceCalc()
    const seth = calc.resourceResult.value!.characters.find(row => row.agentId === '1271')!
    expect(seth.specResources?.seth_cycle).toBeTruthy()
    const panel = calc.panels.value[0] as any
    expect(panel.anomalyProficiency).toBeGreaterThanOrEqual(SETH_SHIELD_PROFICIENCY)
    expect(panel.enemyAnomalyResReduction).toBeGreaterThanOrEqual(SETH_ADDITIONAL_RES_REDUCTION)
    expect(panel.electricAnomalyBuildUpEfficiency).toBeGreaterThanOrEqual(SETH_C2_ELECTRIC_BUILDUP)
  })

  it('覆盖率滑块→面板重算（防守卫冻结，SOP §3.5）', async () => {
    const { catalog, config } = await setup('1241', 2)
    const profOf = () => (computePanelPhases(0, config, catalog)!.inCombat as any).anomalyProficiency ?? 0
    config.setMechanicSetting('seth.shieldCoverage', 1)
    const on = profOf()
    config.setMechanicSetting('seth.shieldCoverage', 0)
    const off = profOf()
    expect(on - off).toBeCloseTo(SETH_SHIELD_PROFICIENCY, 1)
  })
})

describe('赛斯滑块生效差分（防守卫冻结，SOP §3.5）', () => {
  const base = { cinemaLevel: 6, additionalActive: true, shieldCoverage: 1 }

  it('seth.additionalResCoverage → 额外能力减抗差分（按覆盖率缩放）', () => {
    const on = computeSethCycle({ ...base, additionalResCoverage: 1, c6FinishCount: 6 })
    const half = computeSethCycle({ ...base, additionalResCoverage: 0.5, c6FinishCount: 6 })
    const off = computeSethCycle({ ...base, additionalResCoverage: 0, c6FinishCount: 6 })
    expect(on.additionalResReduction).toBe(SETH_ADDITIONAL_RES_REDUCTION)
    expect(half.additionalResReduction).toBeCloseTo(SETH_ADDITIONAL_RES_REDUCTION * 0.5, 5)
    expect(off.additionalResReduction).toBe(0)
  })

  it('seth.c6FinishCount → 影画6终结差分（次数入账本）', () => {
    const on = computeSethCycle({ ...base, additionalResCoverage: 1, c6FinishCount: 6 })
    const off = computeSethCycle({ ...base, additionalResCoverage: 1, c6FinishCount: 0 })
    expect(on.c6FinishCount - off.c6FinishCount).toBe(6)
  })
})
