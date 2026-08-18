import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { computePanelPhases, getTeamAnomalyDurationBonus } from '@/composables/resourceCalc/helpers'
import { calcRinaUltEnergy } from '@/core/resource/helpers'
import {
  applyRinaTeamEnergyFlags,
  assignRinaUltNeighborEnergy,
  computeRinaCorePenRatio,
} from '@/mechanics/agents/rina'

const catalogText = readFileSync(new URL('../../../public/static/catalog.json', import.meta.url), 'utf8')
const buffsText = readFileSync(new URL('../../../public/static/teammate-buffs.json', import.meta.url), 'utf8')
const recsText = readFileSync(new URL('../../../public/static/build-recommendations.json', import.meta.url), 'utf8')

const baseConfig = {
  wEngineId: '', wEngineModLevel: 1,
  driveDisc: { fourPieceSetId: '', twoPieceSetId: '', mainStats: {}, subStatAllocation: {} },
  parryCount: 0, dodgeCounterCount: 0, defAssistCount: 0,
  quickAssistCount: 0, chainCountPerStun: 1, basicAttackTimeWeight: 1,
}

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
    const value = String(url)
    if (value.includes('/static/catalog.json')) return { ok: true, json: async () => JSON.parse(catalogText) }
    if (value.includes('/static/teammate-buffs.json')) return { ok: true, json: async () => JSON.parse(buffsText) }
    if (value.includes('/static/build-recommendations.json')) return { ok: true, json: async () => JSON.parse(recsText) }
    return { ok: false, json: async () => ({}) }
  }))
}

async function setup(cinemaLevel = 0, mateId = '1081') {
  const catalog = useCatalogStore()
  await catalog.load()
  await catalog.loadTeammateBuffs()
  const config = useConfigStore()
  config.team[0] = { slot: 0, agentId: mateId, cinemaLevel: 0, ...baseConfig } as any
  config.team[1] = { slot: 1, agentId: '1211', cinemaLevel, ...baseConfig } as any
  config.team[2] = { slot: 2, agentId: '', cinemaLevel: 0, ...baseConfig } as any
  config.syncTeammateBuffsFromTeam()
  return { catalog, config }
}

describe('丽娜纯函数', () => {
  it('核心穿透封顶且影画1提升到130%', () => {
    expect(computeRinaCorePenRatio(40, 0)).toBe(22)
    expect(computeRinaCorePenRatio(72, 0)).toBe(30)
    expect(computeRinaCorePenRatio(72, 1)).toBe(39)
  })

  it('终结技邻位回能按30/10分配', () => {
    expect(assignRinaUltNeighborEnergy([0, 1, 2], 1)).toEqual({ 0: 10, 2: 30 })
    expect(assignRinaUltNeighborEnergy([0, 1], 1)).toEqual({ 0: 30 })
  })
})

describe('丽娜面板与资源接线', () => {
  beforeEach(() => { setActivePinia(createPinia()); stubFetch() })

  it('核心穿透只作用队友，影画1产生30%差分', async () => {
    const { catalog, config } = await setup(0)
    const teammateC0 = computePanelPhases(0, config, catalog)!.inCombat
    const rinaC0 = computePanelPhases(1, config, catalog)!.inCombat
    const rinaOut = computePanelPhases(1, config, catalog)!.outOfCombat
    const expected = Math.min(30, rinaOut.penRatio * 0.25 + 12)
    expect(teammateC0.penRatio).toBeCloseTo(expected)
    expect(rinaC0.penRatio).toBeCloseTo(rinaOut.penRatio)

    config.team[1].cinemaLevel = 1
    config.syncTeammateBuffsFromTeam()
    const teammateC1 = computePanelPhases(0, config, catalog)!.inCombat
    expect(teammateC1.penRatio).toBeCloseTo(expected * 1.3)
  })

  it('额外能力只在同属性或同阵营队友存在时生效', async () => {
    const inactive = await setup(0, '1081')
    expect(computePanelPhases(0, inactive.config, inactive.catalog)!.inCombat.electricDmg).toBe(0)
    expect(getTeamAnomalyDurationBonus(inactive.config, inactive.catalog, 'electric')).toBe(0)

    setActivePinia(createPinia()); stubFetch()
    const active = await setup(0, '1011')
    expect(computePanelPhases(0, active.config, active.catalog)!.inCombat.electricDmg).toBe(10)
    expect(getTeamAnomalyDurationBonus(active.config, active.catalog, 'electric')).toBe(3)
  })

  it('影画2、4、6均有命座差分，且覆盖率可调', async () => {
    const { catalog, config } = await setup(1, '1011')
    const c1 = computePanelPhases(1, config, catalog)!.inCombat
    config.team[1].cinemaLevel = 2
    config.syncTeammateBuffsFromTeam()
    const c2 = computePanelPhases(1, config, catalog)!.inCombat
    expect(c2.dmgBonus - c1.dmgBonus).toBeCloseTo(10)

    config.team[1].cinemaLevel = 4
    config.setMechanicSetting('rina.c4DoubleBangbooCoverage', 0.5)
    config.syncTeammateBuffsFromTeam()
    const c4 = computePanelPhases(1, config, catalog)!.inCombat
    expect(c4.energyRegenBonusFlat - c2.energyRegenBonusFlat).toBeCloseTo(0.25)

    const mateC4 = computePanelPhases(0, config, catalog)!.inCombat
    config.team[1].cinemaLevel = 6
    config.setTeammateBuffCoverage('rina.cinema_6.electric_damage_bonus', 50)
    config.syncTeammateBuffsFromTeam()
    const mateC6 = computePanelPhases(0, config, catalog)!.inCombat
    expect(mateC6.electricDmg - mateC4.electricDmg).toBeCloseTo(7.5)
  })

  it('丽娜终结技次数进入队友能量收敛', () => {
    const configs: any[] = [
      { slot: 0, agentId: '1081' },
      { slot: 1, agentId: '1211' },
      { slot: 2, agentId: '1011' },
    ]
    applyRinaTeamEnergyFlags(configs)
    expect(configs[0].rinaEnergyPerRinaUlt).toBe(10)
    expect(configs[2].rinaEnergyPerRinaUlt).toBe(30)

    const states: any[] = configs.map((_, index) => ({ ultimateCount: index === 1 ? 1 : 0 }))
    expect(calcRinaUltEnergy(configs as any, states, configs[0] as any)).toBe(10)
    expect(calcRinaUltEnergy(configs as any, states, configs[2] as any)).toBe(30)
  })
})
