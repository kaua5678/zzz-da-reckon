import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'

const catalogText = readFileSync(new URL('../../../public/static/catalog.json', import.meta.url), 'utf8')
const buffsText = readFileSync(new URL('../../../public/static/teammate-buffs.json', import.meta.url), 'utf8')
const recsText = readFileSync(new URL('../../../public/static/build-recommendations.json', import.meta.url), 'utf8')

const baseConfig = {
  wEngineId: '', wEngineModLevel: 5,
  driveDisc: { fourPieceSetId: '', twoPieceSetId: '', mainStats: { 4: 'atkPct' as any, 5: 'physicalDmg' as any, 6: 'critRate' as any }, subStatAllocation: {} },
  parryCount: 10, dodgeCounterCount: 6, blockCount: 20,
  quickAssistCount: 0, chainCountPerStun: 0, basicAttackTimeWeight: 1,
}

describe('安比（1011）影画1 快充模式：能量获得效率 +12% × 覆盖率', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.stubGlobal('fetch', vi.fn(async (url: any) => {
      const u = String(url)
      if (u.includes('/static/catalog.json')) return { ok: true, json: async () => JSON.parse(catalogText) }
      if (u.includes('/static/teammate-buffs.json')) return { ok: true, json: async () => JSON.parse(buffsText) }
      if (u.includes('/static/build-recommendations.json')) return { ok: true, json: async () => JSON.parse(recsText) }
      return { ok: false, json: async () => ({}) }
    }))
  })

  async function setup(cinemaLevel: number) {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs()
    const config = useConfigStore()
    config.team[0] = { slot: 0, agentId: '1011', cinemaLevel, ...baseConfig } as any
    config.team[1] = { slot: 1, agentId: '', cinemaLevel: 0, ...baseConfig } as any
    config.team[2] = { slot: 2, agentId: '', cinemaLevel: 0, ...baseConfig } as any
    config.syncTeammateBuffsFromTeam()
    return { catalog, config }
  }

  it('命座差分：0命 → 1命，能量获得效率 +12（覆盖率默认 100%）', async () => {
    const { catalog, config } = await setup(0)
    const { computePanelPhases } = await import('@/composables/resourceCalc/helpers')
    const p0 = computePanelPhases(0, config, catalog)!.inCombat as any
    config.team[0].cinemaLevel = 1
    const p1 = computePanelPhases(0, config, catalog)!.inCombat as any
    expect(p1.energyGainEfficiency - p0.energyGainEfficiency).toBe(12)
  })

  it('覆盖率滑块 50%：1命增益折算为 +6', async () => {
    const { catalog, config } = await setup(1)
    config.setMechanicSetting('anby.fastChargeCoverage', 0.5)
    const { computePanelPhases } = await import('@/composables/resourceCalc/helpers')
    const p1 = computePanelPhases(0, config, catalog)!.inCombat as any
    config.team[0].cinemaLevel = 0
    const p0 = computePanelPhases(0, config, catalog)!.inCombat as any
    expect(p1.energyGainEfficiency - p0.energyGainEfficiency).toBe(6)
  })

  it('防死数据：0命时覆盖率滑块不产生任何面板变化', async () => {
    const { catalog, config } = await setup(0)
    const { computePanelPhases } = await import('@/composables/resourceCalc/helpers')
    const before = computePanelPhases(0, config, catalog)!.inCombat as any
    config.setMechanicSetting('anby.fastChargeCoverage', 1)
    const after = computePanelPhases(0, config, catalog)!.inCombat as any
    expect(after.energyGainEfficiency).toBe(before.energyGainEfficiency)
  })
})
