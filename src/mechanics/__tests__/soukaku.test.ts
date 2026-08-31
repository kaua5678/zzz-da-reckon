import { beforeEach, describe, expect, it } from 'vitest'
import { mockStaticFetch, newPinia } from '@/test/harness'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { computePanelPhases } from '@/composables/resourceCalc/helpers'
import { calcSoukakuUltEnergy } from '@/core/resource/helpers'
import {
  applySoukakuTeamEnergyFlags,
  assignSoukakuUltNeighborEnergy,
  SOUKAKU_C6_DMG_BONUS,
  soukakuMechanic,
} from '@/mechanics/agents/soukaku'

const baseConfig = {
  wEngineId: '', wEngineModLevel: 1,
  driveDisc: { fourPieceSetId: '', twoPieceSetId: '', mainStats: {}, subStatAllocation: {} },
  parryCount: 0, dodgeCounterCount: 0, defAssistCount: 0,
  quickAssistCount: 0, chainCountPerStun: 1, basicAttackTimeWeight: 1,
}

async function setup(cinemaLevel = 0, mateId = '1091') {
  const catalog = useCatalogStore()
  await catalog.load()
  await catalog.loadTeammateBuffs()
  const config = useConfigStore()
  for (const buff of config.globalBuffs) buff.enabled = false
  // 1091 雅 冰异常 第六课 → 同属性同阵营
  config.team[0] = { slot: 0, agentId: mateId, cinemaLevel: 0, ...baseConfig } as any
  config.team[1] = { slot: 1, agentId: '1131', cinemaLevel, ...baseConfig } as any
  config.team[2] = { slot: 2, agentId: '', cinemaLevel: 0, ...baseConfig } as any
  config.syncTeammateBuffsFromTeam()
  return { catalog, config }
}

describe('苍角纯函数', () => {
  it('终结邻位回能 30/10', () => {
    expect(assignSoukakuUltNeighborEnergy([0, 1, 2], 1)).toEqual({ 0: 10, 2: 30 })
    expect(assignSoukakuUltNeighborEnergy([0, 1], 1)).toEqual({ 0: 30 })
  })

  it('applyTeamEnergyFlags 写入邻位', () => {
    const configs: any[] = [
      { slot: 0, agentId: '1091' },
      { slot: 1, agentId: '1131' },
      { slot: 2, agentId: '1011' },
    ]
    applySoukakuTeamEnergyFlags(configs)
    expect(configs[0].soukakuEnergyPerSoukakuUlt).toBe(10)
    expect(configs[2].soukakuEnergyPerSoukakuUlt).toBe(30)
    expect(configs[1].soukakuEnergyPerSoukakuUlt).toBe(0)
  })

  it('calcSoukakuUltEnergy 按终结次数结算', () => {
    const configs: any[] = [
      { slot: 0, agentId: '1091', soukakuEnergyPerSoukakuUlt: 30 },
      { slot: 1, agentId: '1131', soukakuEnergyPerSoukakuUlt: 0 },
    ]
    const states: any[] = [{ ultimateCount: 2 }, { ultimateCount: 2 }]
    expect(calcSoukakuUltEnergy(configs, states, configs[0])).toBe(60)
  })

  it('影画6 霜染段 dmgBonus+45', () => {
    const cfg: any = { soukakuCinemaLevel: 6 }
    const executions: any[] = [
      { moveId: '1131004', dmgBonus: 0, skillTableNote: '' },
      { moveId: '1131001', dmgBonus: 0, skillTableNote: '' },
    ]
    soukakuMechanic.patchExecutions!({ cfg, state: {} as any, executions } as any)
    expect(executions[0].dmgBonus).toBe(SOUKAKU_C6_DMG_BONUS)
    expect(executions[1].dmgBonus).toBe(0)
  })

  it('影画2 满层回能：1.2×触发次数注入 initialEnergyGift（默认5）；低命不注入', () => {
    const cfg: any = { initialEnergyGift: 40, 'setting:soukaku.c2RefundCount': 5 }
    soukakuMechanic.buildCharConfig!({ cinemaLevel: 2, cfg } as any)
    expect(cfg.initialEnergyGift).toBeCloseTo(40 + 1.2 * 5)

    const cfg0: any = { initialEnergyGift: 40, 'setting:soukaku.c2RefundCount': 5 }
    soukakuMechanic.buildCharConfig!({ cinemaLevel: 1, cfg: cfg0 } as any)
    expect(cfg0.initialEnergyGift).toBeCloseTo(40)
  })
})

describe('苍角面板', () => {
  beforeEach(() => { newPinia(); mockStaticFetch() })

  it('核心攻拐与同属性冰伤20；影画4冰抗-10', async () => {
    const { catalog, config } = await setup(0, '1091')
    const mateOut = computePanelPhases(0, config, catalog)!.outOfCombat
    const mate = computePanelPhases(0, config, catalog)!.inCombat
    const skOut = computePanelPhases(1, config, catalog)!.outOfCombat
    const expectedAtk = Math.min(1000, skOut.atk * 0.4)
    expect(mate.atk).toBeGreaterThan(mateOut.atk + expectedAtk * 0.5)
    expect(mate.iceDmg - (mateOut.iceDmg ?? 0)).toBeCloseTo(20)

    config.team[1].cinemaLevel = 4
    config.syncTeammateBuffsFromTeam()
    const c4 = computePanelPhases(0, config, catalog)!.inCombat
    expect(c4.enemyIceResReduction - mate.enemyIceResReduction).toBeCloseTo(10)
  })

  it('无同属性/同阵营时额外冰伤不生效', async () => {
    // 11号 1041 火强攻 卡吕冬
    const { catalog, config } = await setup(0, '1041')
    const mateOut = computePanelPhases(0, config, catalog)!.outOfCombat
    const mate = computePanelPhases(0, config, catalog)!.inCombat
    expect(mate.atk).toBeGreaterThan(mateOut.atk) // 核心攻仍在
    expect(mate.iceDmg - (mateOut.iceDmg ?? 0)).toBe(0)
  })
})
