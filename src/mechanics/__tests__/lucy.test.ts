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
  driveDisc: { fourPieceSetId: '', twoPieceSetId: '', mainStats: { 4: 'atkPct' as any, 5: 'fireDmg' as any, 6: 'atk' as any }, subStatAllocation: {} },
  parryCount: 0, dodgeCounterCount: 0, defAssistCount: 0,
  quickAssistCount: 0, chainCountPerStun: 0, basicAttackTimeWeight: 1,
}

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async (url: any) => {
    const u = String(url)
    if (u.includes('/static/catalog.json')) return { ok: true, json: async () => JSON.parse(catalogText) }
    if (u.includes('/static/teammate-buffs.json')) return { ok: true, json: async () => JSON.parse(buffsText) }
    if (u.includes('/static/build-recommendations.json')) return { ok: true, json: async () => JSON.parse(recsText) }
    return { ok: false, json: async () => ({}) }
  }))
}

describe('露西（1151）加油拐力', () => {
  beforeEach(() => { setActivePinia(createPinia()); stubFetch() })

  it('spec 合并后加油 buff 带 formula（非死固定 600）', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs()
    const group = catalog.getTeammateBuffGroup('1151')
    const cheer = group?.buffs.find((b: any) => b.id === 'lucy.ex_special_cheer_on')
    expect(cheer).toBeTruthy()
    const eff = cheer!.effects[0] as any
    expect(eff.type).toBe('formula')
    expect(eff.formula?.expression).toContain('0.258')
    expect(eff.sourceStat).toBe('atk')
    expect(eff.sourcePanelPhase).toBe('outOfCombat')
  })

  it('影画4 门控：3命无暴伤+10，4命有', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs()
    const config = useConfigStore()
    // 露西 + 任意输出（11号）
    config.team[0] = { slot: 0, agentId: '1041', cinemaLevel: 0, ...baseConfig } as any
    config.team[1] = { slot: 1, agentId: '1151', cinemaLevel: 3, ...baseConfig } as any
    config.team[2] = { slot: 2, agentId: '', cinemaLevel: 0, ...baseConfig } as any
    config.syncTeammateBuffsFromTeam()
    const { computePanelPhases } = await import('@/composables/resourceCalc/helpers')
    const p3 = computePanelPhases(0, config, catalog)!.inCombat as any
    config.team[1].cinemaLevel = 4
    config.syncTeammateBuffsFromTeam()
    const p4 = computePanelPhases(0, config, catalog)!.inCombat as any
    expect(p4.critDmg - p3.critDmg).toBe(10)
  })

  it('加油攻击：有露西时队友 atk 增加（公式生效，>0 且 ≤600）', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs()
    const config = useConfigStore()
    config.team[0] = { slot: 0, agentId: '1041', cinemaLevel: 0, ...baseConfig } as any
    config.team[1] = { slot: 1, agentId: '', cinemaLevel: 0, ...baseConfig } as any
    config.team[2] = { slot: 2, agentId: '', cinemaLevel: 0, ...baseConfig } as any
    config.syncTeammateBuffsFromTeam()
    const { computePanelPhases } = await import('@/composables/resourceCalc/helpers')
    const without = computePanelPhases(0, config, catalog)!.inCombat as any
    config.team[1] = { slot: 1, agentId: '1151', cinemaLevel: 0, ...baseConfig } as any
    config.syncTeammateBuffsFromTeam()
    const withLucy = computePanelPhases(0, config, catalog)!.inCombat as any
    const delta = withLucy.atk - without.atk
    expect(delta).toBeGreaterThan(0)
    expect(delta).toBeLessThanOrEqual(600)
  })
})
