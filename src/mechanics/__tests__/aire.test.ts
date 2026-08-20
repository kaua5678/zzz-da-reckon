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
    expect(panel.__airePanelApplied).toBe(true)
    expect(panel.anomalyProficiency).toBeGreaterThanOrEqual(AIRE_CORE_PROFICIENCY)
    expect(panel.enemyEtherAnomalyResReduction).toBeGreaterThanOrEqual(AIRE_C1_ETHER_ANOMALY_RES_IGNORE)
    expect(panel.enemyDefReduction).toBeGreaterThanOrEqual(AIRE_C2_DEF_IGNORE)
  })

  it('影画6进场喧响+1200写入角色配置', async () => {
    await setup('1141', 6)
    const calc = useResourceCalc()
    const cfgC6 = calc.resourceConfig.value!.characters.find(c => c.agentId === '1501')!
    expect(cfgC6.initialDecibelGift).toBe(1000 + AIRE_C6_DECIBEL_GIFT)
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

  it('核心异放进入伤害池（type=异放，次数=绝对音准次数）', async () => {
    await setup('1141', 0)
    const calc = useResourceCalc()
    const rows = calc.damagePoolRows.value
    const releases = rows.filter(r => r.type === '异放' && r.agentId === '1501')
    expect(releases.length).toBeGreaterThan(0)
    const totalCount = releases.reduce((s, r) => s + r.count, 0)
    expect(totalCount).toBe(8)
    expect(releases.every(r => r.totalDamage > 0)).toBe(true)
  })
})
