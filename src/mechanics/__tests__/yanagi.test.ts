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
})
