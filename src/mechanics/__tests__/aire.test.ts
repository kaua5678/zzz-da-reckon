import { describe, expect, it } from 'vitest'
import { computePanelPhases } from '@/composables/resourceCalc/helpers'
import { useResourceCalc } from '@/composables/useResourceCalc'
import {
  AIRE_C1_ETHER_ANOMALY_RES_IGNORE,
  AIRE_C2_DEF_IGNORE,
  AIRE_C2_DELUSION_DEF_IGNORE,
  AIRE_C6_DECIBEL_GIFT,
  AIRE_CORE_PROFICIENCY,
  AIRE_ABSOLUTE_PITCH_MOVE_ID,
  AIRE_RELEASE_RATIO_PER_TEN,
  AIRE_RELEASE_STUN_BONUS_PCT,
  AIRE_C4_RELEASE_ENERGY,
  AIRE_C4_RELEASE_DECIBEL,
  AIRE_C6_ETHANOL_DMG_BONUS,
  computeAireCycle,
  aireMechanic,
} from '@/mechanics/agents/aire'
import { setupHarness } from '@/test/harness'

async function setup(mateId = '1141', cinemaLevel = 0) {
  const result = await setupHarness([
    { agentId: '1501', cinemaLevel, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
    { agentId: mateId, cinemaLevel: 0, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
  ])
  for (const buff of result.config.globalBuffs) buff.enabled = false
  return result
}

function cycle(overrides: Partial<Parameters<typeof computeAireCycle>[0]> = {}) {
  return computeAireCycle({
    cinemaLevel: 6,
    additionalActive: true,
    c2DelusionCoverage: 1,
    ...overrides,
  })
}

describe('爱芮（1501）总量', () => {
  it('核心异常精通恒为90，影画门控C1/C2/C6', () => {
    expect(cycle({ cinemaLevel: 0 }).coreProficiency).toBe(AIRE_CORE_PROFICIENCY)
    expect(cycle({ cinemaLevel: 0 }).c1EtherAnomalyResIgnore).toBe(0)
    expect(cycle({ cinemaLevel: 1 }).c1EtherAnomalyResIgnore).toBe(AIRE_C1_ETHER_ANOMALY_RES_IGNORE)
    expect(cycle({ cinemaLevel: 1 }).c2DefIgnore).toBe(0)
    expect(cycle({ cinemaLevel: 2 }).c2DefIgnore).toBe(AIRE_C2_DEF_IGNORE + AIRE_C2_DELUSION_DEF_IGNORE)
    expect(cycle({ cinemaLevel: 2, c2DelusionCoverage: 0.5 }).c2DefIgnore).toBe(
      AIRE_C2_DEF_IGNORE + AIRE_C2_DELUSION_DEF_IGNORE * 0.5)
    expect(cycle({ cinemaLevel: 5 }).c6DecibelGift).toBe(0)
    expect(cycle({ cinemaLevel: 6 }).c6DecibelGift).toBe(AIRE_C6_DECIBEL_GIFT)
  })
})

describe('爱芮完整计算链', () => {
  it('额外能力由击破/支援/异常队友激活，普通异阵营队友不激活', async () => {
    for (const mateId of ['1141', '1031', '1181']) {
      const { catalog, config } = await setup(mateId)
      expect((computePanelPhases(0, config, catalog)!.inCombat as any).additionalAbilityActive).toBe(1)
    }
    const neg = await setup('1191')
    expect((computePanelPhases(0, neg.config, neg.catalog)!.inCombat as any).additionalAbilityActive ?? 0).toBe(0)
  })

  it('资源池写入爱芮循环', async () => {
    await setup('1141', 6)
    const calc = useResourceCalc()
    const aire = calc.resourceResult.value!.characters.find(row => row.agentId === '1501')!
    expect(aire.specResources?.aire_cycle).toBeTruthy()
  })

  it('面板增益进入最终面板（异常精通/影画1抗性无视/影画2无视防御）', async () => {
    await setup('1141', 2)
    const calc = useResourceCalc()
    expect(calc.resourceResult.value!.characters.find(row => row.agentId === '1501')!.specResources?.aire_cycle).toBeTruthy()
    const panel = calc.panels.value[0] as any
    expect(panel.anomalyProficiency).toBeGreaterThanOrEqual(AIRE_CORE_PROFICIENCY)
    expect(panel.enemyEtherAnomalyResReduction).toBeGreaterThanOrEqual(AIRE_C1_ETHER_ANOMALY_RES_IGNORE)
    expect(panel.enemyDefReduction).toBeGreaterThanOrEqual(AIRE_C2_DEF_IGNORE)
  })

  it('覆盖率滑块→面板重算（防守卫冻结，SOP §3.5）', async () => {
    const { catalog, config } = await setup('1141', 2)
    const defOf = () => (computePanelPhases(0, config, catalog)!.inCombat as any).enemyDefReduction ?? 0
    config.setMechanicSetting('aire.c2DelusionCoverage', 1)
    const on = defOf()
    config.setMechanicSetting('aire.c2DelusionCoverage', 0)
    const off = defOf()
    expect(on - off).toBeCloseTo(AIRE_C2_DELUSION_DEF_IGNORE, 1)
  })

  it('影画6进场喧响+1200写入角色配置', async () => {
    await setup('1141', 6)
    const calc = useResourceCalc()
    const cfgC6 = calc.resourceConfig.value!.characters.find(c => c.agentId === '1501')!
    // 6 命：基础 1000 + 影画4 异放喧响(floor(180/10)=18×70) + 影画6 进场(1200)
    expect(cfgC6.initialDecibelGift).toBe(1000 + 18 * AIRE_C4_RELEASE_DECIBEL + AIRE_C6_DECIBEL_GIFT)
  })

  it('核心异放事件：dominant 元素 + 比例模式 + 绝对音准载体', () => {
    const cfg = { 'setting:aire.absolutePitchCount': 8 } as any
    const state = { frontlineTime: 120, backstageTime: 60, ultimateCount: 2 } as any
    const events: any[] = []
    aireMechanic.buildAnomalyEvents!({ cfg, state, events, totalTime: 180 })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      eventId: 'aire_absolute_pitch_release',
      eventType: 'release',
      element: 'dominant',
      carrierMoveId: AIRE_ABSOLUTE_PITCH_MOVE_ID,
      count: 8,
    })
    expect(events[0].releaseRatio).toMatchObject({
      basis: 'anomalyMastery',
      perTenByElement: AIRE_RELEASE_RATIO_PER_TEN,
      stunBonusPct: AIRE_RELEASE_STUN_BONUS_PCT,
    })
  })

  it('核心异放进入伤害池（type=异放，次数自动推导>0）', async () => {
    await setup('1141', 0)
    const calc = useResourceCalc()
    const rows = calc.damagePoolRows.value
    const releases = rows.filter(r => r.type === '异放' && r.agentId === '1501')
    expect(releases.length).toBeGreaterThan(0)
    const totalCount = releases.reduce((s, r) => s + r.count, 0)
    expect(totalCount).toBeGreaterThan(0)
    expect(releases.every(r => r.totalDamage > 0)).toBe(true)
  })

  it('异放次数自动推导 = 应援能量/2 + 全场应援(floor(t/6))；帷幕按次数（4个/次×teamVeilCountTotal）', () => {
    const cfg = { aireCinemaLevel: 0, aireAdditionalActive: true, teamVeilCountTotal: 3 } as any
    const state = { exSpecialCount: 4, chainCountTotal: 5, ultimateCount: 2 } as any
    const events: any[] = []
    aireMechanic.buildAnomalyEvents!({ cfg, state, events, totalTime: 180 })
    // 应援能量 = 4强特×3 + 5连携×4 + 3帷幕×4 = 44；全场应援 = floor(180/6)=30 → 异放 = floor(44/2)+30 = 52
    expect(events[0].count).toBe(52)
    // 生效断言：帷幕次数翻倍 → 应援能量 +3×4 → 异放 +6
    const cfg2 = { aireCinemaLevel: 0, aireAdditionalActive: true, teamVeilCountTotal: 6 } as any
    const events2: any[] = []
    aireMechanic.buildAnomalyEvents!({ cfg: cfg2, state, events: events2, totalTime: 180 })
    expect(events2[0].count).toBe(58)
  })

  it('影画1：异放事件带 releaseCrit（基础25/25，掌控>100每点+0.5）', () => {
    const state = { frontlineTime: 120, backstageTime: 60, ultimateCount: 2 } as any
    const cfg = { 'setting:aire.absolutePitchCount': 8, aireCinemaLevel: 1 } as any
    const events: any[] = []
    aireMechanic.buildAnomalyEvents!({ cfg, state, events, totalTime: 180 })
    expect(events[0].releaseCrit).toMatchObject({
      ratePct: 25,
      dmgPct: 25,
      masteryThreshold: 100,
      masteryPerPointRatePct: 0.5,
    })
    const cfg0 = { 'setting:aire.absolutePitchCount': 8, aireCinemaLevel: 0 } as any
    const events0: any[] = []
    aireMechanic.buildAnomalyEvents!({ cfg: cfg0, state, events: events0, totalTime: 180 })
    expect(events0[0].releaseCrit).toBeUndefined()
  })

  it('影画1：异放伤害高于 0 命（releaseCrit 生效）', async () => {
    await setup('1141', 0)
    const dmg0 = useResourceCalc().damagePoolRows.value
      .filter(r => r.type === '异放' && r.agentId === '1501')
      .reduce((s, r) => s + r.totalDamage, 0)
    expect(dmg0).toBeGreaterThan(0)

    await setup('1141', 1)
    const dmg1 = useResourceCalc().damagePoolRows.value
      .filter(r => r.type === '异放' && r.agentId === '1501')
      .reduce((s, r) => s + r.totalDamage, 0)
    expect(dmg1).toBeGreaterThan(dmg0)
  })

  it('影画4：异放回能/喧响按 floor(t/10)（10s CD 上限）注入', async () => {
    await setup('1141', 4)
    const calc = useResourceCalc()
    const cfgC4 = calc.resourceConfig.value!.characters.find(c => c.agentId === '1501')!
    // 异放次数 ≥ floor(t/6)=30 > floor(180/10)=18 → triggers=18
    expect(cfgC4.initialEnergyGift).toBe(40 + 18 * AIRE_C4_RELEASE_ENERGY)
    expect(cfgC4.initialDecibelGift).toBe(1000 + 18 * AIRE_C4_RELEASE_DECIBEL)
  })

  it('影画6：终结技/强化绝对音准 +40% 以太伤害（patchExecutions，妄想时刻全覆盖）', () => {
    const cfg = { aireCinemaLevel: 6, battleTime: 180 } as any
    const state = { ultimateCount: 2 } as any
    const executions = [
      { moveId: '1501016', dmgBonus: 0, skillTableNote: '' }, // 终结技
      { moveId: '1501007', dmgBonus: 0, skillTableNote: '' }, // 绝对音准 #3（强化版）
      { moveId: '1501001', dmgBonus: 0, skillTableNote: '' }, // 甜心律动，不 boost
    ] as any[]
    aireMechanic.patchExecutions!({ cfg, state, executions, teamFrontlineSeconds: 0 })
    expect(executions[0].dmgBonus).toBe(AIRE_C6_ETHANOL_DMG_BONUS)
    expect(executions[1].dmgBonus).toBe(AIRE_C6_ETHANOL_DMG_BONUS) // 妄想时刻全覆盖 → 全占比
    expect(executions[2].dmgBonus).toBe(0)
  })
})

describe('艾莲儿滑块生效差分（防守卫冻结，SOP §3.5）', () => {
  it('aire.cheerEnergyBonus → 绝对音准#3 次数差分（应援能量额外 → pitchCount）', async () => {
    const { config } = await setupHarness([{ agentId: '1501', cinemaLevel: 0 }, { agentId: '1181' }])
    const pitchOf = () => {
      const calc = useResourceCalc()
      const aire = calc.resourceResult.value!.characters.find(c => c.agentId === '1501')!
      const evt = (aire.anomalyEventExecutions ?? []).find(e => e.eventId === 'aire_absolute_pitch_release')
      return evt?.count ?? 0
    }
    config.setMechanicSetting('aire.cheerEnergyBonus', 200)
    const on = pitchOf()
    config.setMechanicSetting('aire.cheerEnergyBonus', 0)
    const off = pitchOf()
    // +200 应援能量 → +100 次绝对音准（每次耗 2）
    expect(on - off).toBe(100)
    expect(on).toBeGreaterThan(off)
  })
})
