import { describe, expect, it } from 'vitest'
import { computePanelPhases } from '@/composables/resourceCalc/helpers'
import { useResourceCalc } from '@/composables/useResourceCalc'
import {
  PROMIA_ADDITIONAL_BUILDUP_EFF,
  PROMIA_C1_DEF_IGNORE,
  PROMIA_C2_PROFICIENCY,
  PROMIA_GUILTY_DEF_IGNORE,
  PROMIA_MASTERY_THRESHOLD,
  PROMIA_PROF_PER_MASTERY,
  PROMIA_TEAM_RELEASE_PER_MASTERY,
  computePromiaCycle,
  promiaMechanic,
} from '@/mechanics/agents/promia'
import { setupHarness } from '@/test/harness'

async function setup(mateId = '1181', cinemaLevel = 0) {
  const result = await setupHarness([
    { agentId: '1541', cinemaLevel, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
    { agentId: mateId, cinemaLevel: 0, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
  ])
  for (const buff of result.config.globalBuffs) buff.enabled = false
  return result
}

function cycle(overrides: Partial<Parameters<typeof computePromiaCycle>[0]> = {}) {
  return computePromiaCycle({
    cinemaLevel: 2,
    anomalyMastery: 200,
    additionalActive: true,
    ...overrides,
  })
}

describe('普罗米娅（1541）总量', () => {
  it('掌控>150每超1点转1.5精通，并折算全队异放增伤', () => {
    const c = cycle({ anomalyMastery: 200 })
    expect(c.masteryExcess).toBe(200 - PROMIA_MASTERY_THRESHOLD)
    expect(c.proficiencyFromMastery).toBe((200 - PROMIA_MASTERY_THRESHOLD) * PROMIA_PROF_PER_MASTERY)
    expect(c.teamReleaseDmg).toBe((200 - PROMIA_MASTERY_THRESHOLD) * PROMIA_TEAM_RELEASE_PER_MASTERY)
    expect(cycle({ anomalyMastery: 120 }).masteryExcess).toBe(0)
    expect(cycle({ anomalyMastery: 120 }).proficiencyFromMastery).toBe(0)
  })

  it('影画2精通+40与总精通叠加', () => {
    expect(cycle({ cinemaLevel: 2, anomalyMastery: 150 }).c2Proficiency).toBe(PROMIA_C2_PROFICIENCY)
    expect(cycle({ cinemaLevel: 2, anomalyMastery: 150 }).totalProficiency).toBe(PROMIA_C2_PROFICIENCY)
    expect(cycle({ cinemaLevel: 0, anomalyMastery: 150 }).c2Proficiency).toBe(0)
    expect(cycle({ cinemaLevel: 1, anomalyMastery: 160 }).totalProficiency).toBe(
      10 * PROMIA_PROF_PER_MASTERY)
  })

  it('额外能力门控冰异常积蓄效率与有罪推定无视防御', () => {
    expect(cycle({ additionalActive: true }).additionalBuildUpEff).toBe(PROMIA_ADDITIONAL_BUILDUP_EFF)
    expect(cycle({ additionalActive: true }).guiltyDefIgnore).toBe(PROMIA_GUILTY_DEF_IGNORE)
    expect(cycle({ additionalActive: false }).additionalBuildUpEff).toBe(0)
    expect(cycle({ additionalActive: false }).guiltyDefIgnore).toBe(0)
  })
})

describe('普罗米娅完整计算链', () => {
  it('额外能力由异常/支援队友激活，普通异阵营队友不激活', async () => {
    for (const mateId of ['1181', '1031']) {
      const { catalog, config } = await setup(mateId)
      expect((computePanelPhases(0, config, catalog)!.inCombat as any).additionalAbilityActive).toBe(1)
    }
    const neg = await setup('1191')
    expect((computePanelPhases(0, neg.config, neg.catalog)!.inCombat as any).additionalAbilityActive ?? 0).toBe(0)
  })

  it('资源池写入普罗米娅循环', async () => {
    await setup('1181', 2)
    const calc = useResourceCalc()
    const promia = calc.resourceResult.value!.characters.find(row => row.agentId === '1541')!
    expect(promia.specResources?.promia_cycle).toBeTruthy()
  })

  it('面板增益进入最终面板（影画2精通/积蓄效率；有罪推定减防改走 releaseModifier）', async () => {
    await setup('1181', 2)
    const calc = useResourceCalc()
    expect(calc.resourceResult.value!.characters.find(row => row.agentId === '1541')!.specResources?.promia_cycle).toBeTruthy()
    const panel = calc.panels.value[0] as any
    // 影画2精通+40（面板层 applyPanel）
    expect(panel.anomalyProficiency).toBeGreaterThanOrEqual(PROMIA_C2_PROFICIENCY)
    // 额外能力积蓄效率+30（提取层，需先触发完整计算）
    expect(panel.anomalyBuildUpEfficiency).toBeGreaterThanOrEqual(PROMIA_ADDITIONAL_BUILDUP_EFF)
    // 有罪推定 40% 不再挂面板（改走 releaseModifier 异放限定），面板减防应低于 40
    expect(panel.enemyDefReduction ?? 0).toBeLessThan(PROMIA_GUILTY_DEF_IGNORE)
  })

  it('releaseModifier：有罪推定 40% + 影画1 20% 只作用于异放结算（异放限定减防）', async () => {
    await setup('1181', 1)
    const calc = useResourceCalc()
    const mod = promiaMechanic.releaseModifier!({ panels: calc.panels.value })
    // 额外能力激活（格莉丝1181=异常）+ 影画1 → 40 + 20
    expect(mod.enemyDefReduction).toBe(PROMIA_GUILTY_DEF_IGNORE + PROMIA_C1_DEF_IGNORE)
    expect(mod.enemyResReduction).toBe(0)
  })
})
