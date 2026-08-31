import { beforeEach, describe, expect, it } from 'vitest'
import { mockStaticFetch, newPinia } from '@/test/harness'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { computePanelPhases } from '@/composables/resourceCalc/helpers'

const baseConfig = {
  wEngineId: '', wEngineModLevel: 1,
  driveDisc: { fourPieceSetId: '', twoPieceSetId: '', mainStats: {}, subStatAllocation: {} },
  parryCount: 0, dodgeCounterCount: 0, defAssistCount: 0,
  quickAssistCount: 0, chainCountPerStun: 1, basicAttackTimeWeight: 1,
}

async function setup(mateId = '1621', cinemaLevel = 0) {
  const catalog = useCatalogStore()
  await catalog.load()
  await catalog.loadTeammateBuffs()
  const config = useConfigStore()
  for (const buff of config.globalBuffs) buff.enabled = false
  // slot0 奥菲丝，slot1 队友（1621 洛克茜 = 风·击破 → 触发额外能力）
  config.team[0] = { slot: 0, agentId: '1301', cinemaLevel, ...baseConfig } as any
  config.team[1] = { slot: 1, agentId: mateId, cinemaLevel: 0, ...baseConfig } as any
  config.team[2] = { slot: 2, agentId: '', cinemaLevel: 0, ...baseConfig } as any
  config.syncTeammateBuffsFromTeam()
  return { catalog, config }
}

/** 核心被动[准星聚焦]攻击公式（Lv.12）：clamp(floor((回能-1.6)/0.1)*20+280, 280, 700) */
function focusAtkExpected(regen: number): number {
  return Math.min(700, Math.max(280, Math.floor((regen - 1.6) / 0.1) * 20 + 280))
}

describe('奥菲丝（1301）核心被动[准星聚焦]与影画1', () => {
  beforeEach(() => {
    newPinia()
    mockStaticFetch()
  })

  it('全队攻击按奥菲丝局外回能取公式值；影画1 准星聚焦代理人伤害+20%', async () => {
    const { catalog, config } = await setup('1621', 0)
    const phases0 = computePanelPhases(0, config, catalog)!
    const out = phases0.outOfCombat as any
    const regen = out.energyRegen * (1 + (out.energyRegenBonusPct ?? 0) / 100) + (out.energyRegenBonusFlat ?? 0)
    const expected0 = focusAtkExpected(regen)

    const withBuff = (computePanelPhases(1, config, catalog)!.inCombat as any).atk as number
    config.toggleTeammateBuff('orphie.core_crosshair_focus_atk', false)
    const withoutBuff = (computePanelPhases(1, config, catalog)!.inCombat as any).atk as number
    config.toggleTeammateBuff('orphie.core_crosshair_focus_atk', true)
    expect(withBuff - withoutBuff).toBeCloseTo(expected0, 0)
    expect(expected0).toBeGreaterThanOrEqual(280)

    config.team[0].cinemaLevel = 1
    config.syncTeammateBuffsFromTeam()
    const dmg0 = (computePanelPhases(1, config, catalog)!.inCombat as any).dmgBonus as number
    config.toggleTeammateBuff('orphie.cinema_1_crosshair_focus_dmg', false)
    const dmgOff = (computePanelPhases(1, config, catalog)!.inCombat as any).dmgBonus as number
    config.toggleTeammateBuff('orphie.cinema_1_crosshair_focus_dmg', true)
    expect(dmg0 - dmgOff).toBeCloseTo(20, 5)
  })
})

describe('奥菲丝额外能力·熔炉所铸（追加攻击无视25%防御门控）', () => {
  beforeEach(() => {
    newPinia()
    mockStaticFetch()
  })

  it('[击破]或[支援]队友激活 → 防御无视25%；命破/强攻不激活', async () => {
    // 正例1：1621 洛克茜（风·击破=stun，无队友 buff → 纯专精命中）
    const pos1 = await setup('1621', 0)
    expect((computePanelPhases(0, pos1.config, pos1.catalog)!.inCombat as any).additionalAbilityActive).toBe(1)
    const on1 = (computePanelPhases(1, pos1.config, pos1.catalog)!.inCombat as any).enemyDefReduction as number
    pos1.config.toggleTeammateBuff('orphie.additional_def_ignore', false)
    const off1 = (computePanelPhases(1, pos1.config, pos1.catalog)!.inCombat as any).enemyDefReduction as number
    pos1.config.toggleTeammateBuff('orphie.additional_def_ignore', true)
    expect(on1 - off1).toBeCloseTo(25, 5)

    // 正例2：1211 丽娜（电·支援 → 支援命中；其 buff 只涉 penRatio/电伤，不干扰本断言）
    const pos2 = await setup('1211', 0)
    expect((computePanelPhases(0, pos2.config, pos2.catalog)!.inCombat as any).additionalAbilityActive).toBe(1)

    // 负例1：1441 真斗（命破=rupture，原文不触发——击破≠命破，最易混淆项）
    const neg1 = await setup('1441', 0)
    const pNeg1 = computePanelPhases(1, neg1.config, neg1.catalog)!.inCombat as any
    neg1.config.toggleTeammateBuff('orphie.additional_def_ignore', false)
    const pNeg1Off = computePanelPhases(1, neg1.config, neg1.catalog)!.inCombat as any
    neg1.config.toggleTeammateBuff('orphie.additional_def_ignore', true)
    expect((computePanelPhases(0, neg1.config, neg1.catalog)!.inCombat as any).additionalAbilityActive ?? 0).toBe(0)
    expect(pNeg1.enemyDefReduction).toBeCloseTo(pNeg1Off.enemyDefReduction, 5)

    // 负例2：1081 比利（物理·强攻 → 不激活）
    const neg2 = await setup('1081', 0)
    expect((computePanelPhases(0, neg2.config, neg2.catalog)!.inCombat as any).additionalAbilityActive ?? 0).toBe(0)
  })
})
