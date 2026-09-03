import { beforeEach, describe, expect, it } from 'vitest'
import { mockStaticFetch, newPinia } from '@/test/harness'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { computePanelPhases } from '@/composables/resourceCalc/helpers'
import { yanagiMechanic } from '@/mechanics/agents/yanagi'

const baseConfig = {
  wEngineId: '', wEngineModLevel: 1,
  driveDisc: { fourPieceSetId: '', twoPieceSetId: '', mainStats: {}, subStatAllocation: {} },
  parryCount: 0, dodgeCounterCount: 0, defAssistCount: 0,
  quickAssistCount: 0, chainCountPerStun: 1, basicAttackTimeWeight: 1,
}

async function setup(mateId = '1331', cinemaLevel = 0) {
  const catalog = useCatalogStore()
  await catalog.load()
  await catalog.loadTeammateBuffs()
  const config = useConfigStore()
  for (const buff of config.globalBuffs) buff.enabled = false
  // slot0 月城柳，slot1 队友（1331 薇薇安 = 以太·异常，无队友 buff → 纯专精命中）
  config.team[0] = { slot: 0, agentId: '1221', cinemaLevel, ...baseConfig } as any
  config.team[1] = { slot: 1, agentId: mateId, cinemaLevel: 0, ...baseConfig } as any
  config.team[2] = { slot: 2, agentId: '', cinemaLevel: 0, ...baseConfig } as any
  config.syncTeammateBuffsFromTeam()
  return { catalog, config }
}

describe('月城柳（1221）核心被动[紊乱]倍率与影画4[识破]穿透', () => {
  beforeEach(() => {
    newPinia()
    mockStaticFetch()
  })

  it('全队紊乱伤害倍率+250%（Lv.12）；影画4 识破穿透率+16%', async () => {
    const { catalog, config } = await setup('1331', 0)
    const withBuff = (computePanelPhases(1, config, catalog)!.inCombat as any).disorderBaseMultiplierBonus as number
    config.toggleTeammateBuff('yanagi.core_disorder_multiplier_bonus', false)
    const withoutBuff = (computePanelPhases(1, config, catalog)!.inCombat as any).disorderBaseMultiplierBonus as number
    config.toggleTeammateBuff('yanagi.core_disorder_multiplier_bonus', true)
    expect(withBuff - withoutBuff).toBeCloseTo(250, 5)

    const pen0 = (computePanelPhases(1, config, catalog)!.inCombat as any).penRatio as number
    config.team[0].cinemaLevel = 4
    config.syncTeammateBuffsFromTeam()
    const pen4 = (computePanelPhases(1, config, catalog)!.inCombat as any).penRatio as number
    expect(pen4 - pen0).toBeCloseTo(16, 5)
  })
})

describe('月城柳额外能力·月相（电属性异常积蓄值+45%）', () => {
  beforeEach(() => {
    newPinia()
    mockStaticFetch()
  })

  it('模块：按 additionalAbilityActive 门控施加', () => {
    const mk = (active: number) => ({
      slot: 0, agent: { id: '1221' } as any, cinemaLevel: 0, team: [],
      panel: { electricAnomalyBuildUpEfficiency: 0, additionalAbilityActive: active } as any,
    })
    const on = mk(1); yanagiMechanic.applyPanel!(on as any)
    expect((on.panel as any).electricAnomalyBuildUpEfficiency).toBeCloseTo(45, 5)

    const off = mk(0); yanagiMechanic.applyPanel!(off as any)
    expect((off.panel as any).electricAnomalyBuildUpEfficiency).toBeCloseTo(0, 5)
  })

  it('门控：其他[异常]或同属性（电）队友激活；强攻队友不激活', async () => {
    // 正例1：1331 薇薇安（以太·异常 → 纯专精命中）
    const pos1 = await setup('1331', 0)
    const p1 = computePanelPhases(0, pos1.config, pos1.catalog)!.inCombat as any
    expect(p1.additionalAbilityActive).toBe(1)
    expect(p1.electricAnomalyBuildUpEfficiency).toBeCloseTo(45, 5)

    // 正例2：1181 格莉丝（电属性 → 同属性命中）
    const pos2 = await setup('1181', 0)
    expect((computePanelPhases(0, pos2.config, pos2.catalog)!.inCombat as any).additionalAbilityActive).toBe(1)

    // 负例：1081 比利（物理·强攻 → 不激活）
    const neg = await setup('1081', 0)
    const pNeg = computePanelPhases(0, neg.config, neg.catalog)!.inCombat as any
    expect(pNeg.additionalAbilityActive ?? 0).toBe(0)
    expect(pNeg.electricAnomalyBuildUpEfficiency ?? 0).toBeCloseTo(0, 5)
  })
})

describe('月城柳核心被动电伤 + 影画1/2/6 面板区', () => {
  beforeEach(() => {
    newPinia()
    mockStaticFetch()
  })

  it('核心被动电伤+20% 常驻；影画1 异常精通+80；影画2 突刺电积蓄+20；影画6 强特伤害+20', async () => {
    const { catalog, config } = await setup('1331', 6)
    const p = computePanelPhases(0, config, catalog)!.inCombat as any
    expect(p.electricDmg).toBeGreaterThanOrEqual(20)
    expect(p.anomalyProficiency).toBeGreaterThanOrEqual(80)
    expect(p.electricAnomalyBuildUpEfficiency).toBeGreaterThanOrEqual(45 + 20)
    expect(p.skillDmgBonus__exSpecial).toBeGreaterThanOrEqual(20)
  })

  it('影画差分：0命 vs 6命字段变化', async () => {
    const p0 = await setup('1331', 0)
    const p0p = computePanelPhases(0, p0.config, p0.catalog)!.inCombat as any
    const p6 = await setup('1331', 6)
    const p6p = computePanelPhases(0, p6.config, p6.catalog)!.inCombat as any
    expect(p6p.anomalyProficiency - p0p.anomalyProficiency).toBe(80)
    expect(p6p.skillDmgBonus__exSpecial - (p0p.skillDmgBonus__exSpecial ?? 0)).toBe(20)
  })

  it('低命座无影画加成：0命精通/强特伤不叠加', async () => {
    const { catalog, config } = await setup('1331', 0)
    const p = computePanelPhases(0, config, catalog)!.inCombat as any
    expect(p.skillDmgBonus__exSpecial ?? 0).toBe(0)
  })

  it('影画2 追加突刺进入执行计划（0命无、2命有，倍率=突刺 327.7%）', async () => {
    const { setupHarness } = await import('@/test/harness')
    const { useResourceCalc } = await import('@/composables/useResourceCalc')
    await setupHarness([
      { agentId: '1221', cinemaLevel: 0, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
      { agentId: '1331', cinemaLevel: 0, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
    ])
    const calc = useResourceCalc()
    await new Promise(r => setTimeout(r, 50))
    const y0 = calc.resourceResult.value!.characters.find(c => c.agentId === '1221')!
    // 0命：只有融合主段（突刺+下砸=1083.9%），无追加突刺段（327.7%）
    expect(y0.executions.filter(e => e.moveId === '1221022').length).toBe(1)

    await setupHarness([
      { agentId: '1221', cinemaLevel: 2, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
      { agentId: '1331', cinemaLevel: 0, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
    ])
    const calc2 = useResourceCalc()
    await new Promise(r => setTimeout(r, 50))
    const y2 = calc2.resourceResult.value!.characters.find(c => c.agentId === '1221')!
    const thrusts = y2.executions.filter(e => e.moveId === '1221022')
    // 2命：融合主段(1083.9%) + 追加突刺段(327.7%)
    expect(thrusts.length).toBe(2)
    const extra = thrusts.find(e => (e.damageMultiplier ?? 0) < 400)
    expect(extra).toBeTruthy()
    expect(extra!.damageMultiplier).toBeCloseTo(327.7, 3)
  })

  it('追加突刺次数滑块：改滑块 → 追加突刺行次数确实变（0/1/2）', async () => {
    const { setupHarness } = await import('@/test/harness')
    const { useResourceCalc } = await import('@/composables/useResourceCalc')

    const r = await setupHarness([
      { agentId: '1221', cinemaLevel: 2, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
      { agentId: '1331', cinemaLevel: 0, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
    ])
    const calc = useResourceCalc()
    const extraRow = () => calc.resourceResult.value!.characters.find(c => c.agentId === '1221')!
      .executions.find(e => e.moveId === '1221022' && (e.damageMultiplier ?? 0) < 400)

    r.config.setMechanicSetting('yanagi.extraThrustCount', 0)
    await new Promise(r => setTimeout(r, 50))
    expect(extraRow()).toBeFalsy() // 0 次 → 无追加突刺行

    r.config.setMechanicSetting('yanagi.extraThrustCount', 2)
    await new Promise(r => setTimeout(r, 50))
    expect(extraRow()?.count).toBeGreaterThan(1) // 2 次 → 追加突刺行次数翻倍
  })

  it('突刺上限：2命钳 2 次、6命放 4 次（滑块同 4）', async () => {
    const { setupHarness } = await import('@/test/harness')
    const { useResourceCalc } = await import('@/composables/useResourceCalc')

    // 2 命：滑块 4 → 钳到 2（额外突刺行 = 强特次数 × 2）
    const r2 = await setupHarness([
      { agentId: '1221', cinemaLevel: 2, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
      { agentId: '1331', cinemaLevel: 0, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
    ])
    const calc2 = useResourceCalc()
    r2.config.setMechanicSetting('yanagi.extraThrustCount', 4)
    await new Promise(r => setTimeout(r, 50))
    const ex2 = calc2.resourceResult.value!.characters.find(c => c.agentId === '1221')!.exSpecialCount
    const row2 = calc2.resourceResult.value!.characters.find(c => c.agentId === '1221')!
      .executions.find(e => e.moveId === '1221022' && (e.damageMultiplier ?? 0) < 400)
    expect(row2!.count).toBeCloseTo(ex2 * 2, 6) // 2 命钳 2 次

    // 6 命：滑块 4 → 4 次（额外突刺行 = 强特次数 × 4）
    const r6 = await setupHarness([
      { agentId: '1221', cinemaLevel: 6, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
      { agentId: '1331', cinemaLevel: 0, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
    ])
    const calc6 = useResourceCalc()
    r6.config.setMechanicSetting('yanagi.extraThrustCount', 4)
    await new Promise(r => setTimeout(r, 50))
    const ex6 = calc6.resourceResult.value!.characters.find(c => c.agentId === '1221')!.exSpecialCount
    const row6 = calc6.resourceResult.value!.characters.find(c => c.agentId === '1221')!
      .executions.find(e => e.moveId === '1221022' && (e.damageMultiplier ?? 0) < 400)
    expect(row6!.count).toBeCloseTo(ex6 * 4, 6) // 6 命放 4 次
  })

  it('极性紊乱事件：0命 15%、2命 35%（20%+1次额外突刺15%）', async () => {
    const { setupHarness } = await import('@/test/harness')
    const { useResourceCalc } = await import('@/composables/useResourceCalc')

    await setupHarness([
      { agentId: '1221', cinemaLevel: 0, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
      { agentId: '1331', cinemaLevel: 0, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
    ])
    const calc0 = useResourceCalc()
    await new Promise(r => setTimeout(r, 50))
    const y0 = calc0.resourceResult.value!.characters.find(c => c.agentId === '1221')!
    const ev0 = y0.anomalyEventExecutions.find(e => e.eventId === 'yanagi_polar_disorder')
    expect(ev0).toBeTruthy()
    expect(ev0!.polarDisorderRatio).toBeCloseTo(0.15, 6)

    await setupHarness([
      { agentId: '1221', cinemaLevel: 2, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
      { agentId: '1331', cinemaLevel: 0, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
    ])
    const calc2 = useResourceCalc()
    await new Promise(r => setTimeout(r, 50))
    const y2 = calc2.resourceResult.value!.characters.find(c => c.agentId === '1221')!
    const ev2 = y2.anomalyEventExecutions.find(e => e.eventId === 'yanagi_polar_disorder')
    expect(ev2).toBeTruthy()
    expect(ev2!.polarDisorderRatio).toBeCloseTo(0.35, 6)
  })

  it('极性紊乱耗能减半（影画6）：2命滑块3 → 钳2次 +20 能量；6命滑块3 → 3次 +15 能量', async () => {
    const { setupHarness } = await import('@/test/harness')
    const { useResourceCalc } = await import('@/composables/useResourceCalc')

    const exEnergy = async (cinemaLevel: number) => {
      const r = await setupHarness([
        { agentId: '1221', cinemaLevel, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
        { agentId: '1331', cinemaLevel: 0, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
      ])
      const calc = useResourceCalc()
      r.config.setMechanicSetting('yanagi.extraThrustCount', 3)
      await new Promise(res => setTimeout(res, 50))
      const row = calc.resourceResult.value!.characters.find(c => c.agentId === '1221')!
      // 强特主行（월华流转 突刺+下砸 融合行）带 energyConsume = 基础 40 + 每突刺能量 × 追加次数；
      // 追加突刺行（同 moveId 1221022）energyConsume=0，以此区分。
      const exRow = row.executions.find(e => e.moveId === '1221022' && (e.energyConsume ?? 0) > 0)
      const perCast = (exRow as any)?.energyConsume
      return { perCast, row }
    }

    const c2 = await exEnergy(2)
    // 2命：滑块 3 → 钳到 2 → 40 + 10×2 = 60
    expect(c2.perCast).toBeCloseTo(60, 6)
    const c6 = await exEnergy(6)
    // 6命：滑块 3 → 3 次、前4次减半 → 40 + 5×3 = 55
    expect(c6.perCast).toBeCloseTo(55, 6)
  })
})
