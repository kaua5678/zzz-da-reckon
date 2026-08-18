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

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async (url: any) => {
    const u = String(url)
    if (u.includes('/static/catalog.json')) return { ok: true, json: async () => JSON.parse(catalogText) }
    if (u.includes('/static/teammate-buffs.json')) return { ok: true, json: async () => JSON.parse(buffsText) }
    if (u.includes('/static/build-recommendations.json')) return { ok: true, json: async () => JSON.parse(recsText) }
    return { ok: false, json: async () => ({}) }
  }))
}

async function setup(team: Array<{ agentId: string; cinemaLevel: number }>) {
  const catalog = useCatalogStore()
  await catalog.load()
  await catalog.loadTeammateBuffs()
  const config = useConfigStore()
  for (let i = 0; i < 3; i++) {
    const t = team[i]
    config.team[i] = { slot: i, agentId: t?.agentId ?? '', cinemaLevel: t?.cinemaLevel ?? 0, ...baseConfig } as any
  }
  config.syncTeammateBuffsFromTeam()
  return { catalog, config }
}

describe('伊芙琳（1321）影画2 赴火之舞：攻击力 +15%', () => {
  beforeEach(() => { setActivePinia(createPinia()); stubFetch() })

  it('命座差分：1命 → 2命，攻击力 ×1.15', async () => {
    const { catalog, config } = await setup([{ agentId: '1321', cinemaLevel: 1 }])
    const { computePanelPhases } = await import('@/composables/resourceCalc/helpers')
    const p1 = computePanelPhases(0, config, catalog)!.inCombat as any
    config.team[0].cinemaLevel = 2
    const p2 = computePanelPhases(0, config, catalog)!.inCombat as any
    expect(p2.atk).toBe(Math.round(p1.atk * 1.15))
  })

  it('防死数据：0/1命时无攻击力加成', async () => {
    const { catalog, config } = await setup([{ agentId: '1321', cinemaLevel: 0 }])
    const { computePanelPhases } = await import('@/composables/resourceCalc/helpers')
    const p0 = computePanelPhases(0, config, catalog)!.inCombat as any
    config.team[0].cinemaLevel = 1
    const p1 = computePanelPhases(0, config, catalog)!.inCombat as any
    expect(p1.atk).toBe(p0.atk)
  })
})

describe('薇薇安（1331）影画2《暴风雨夜，暴风雨夜》：以太异常积蓄效率 +25%', () => {
  beforeEach(() => { setActivePinia(createPinia()); stubFetch() })

  it('命座差分：1命 → 2命，etherAnomalyBuildUpEfficiency +25', async () => {
    const { catalog, config } = await setup([{ agentId: '1331', cinemaLevel: 1 }])
    const { computePanelPhases } = await import('@/composables/resourceCalc/helpers')
    const p1 = computePanelPhases(0, config, catalog)!.inCombat as any
    config.team[0].cinemaLevel = 2
    const p2 = computePanelPhases(0, config, catalog)!.inCombat as any
    expect((p2.etherAnomalyBuildUpEfficiency ?? 0) - (p1.etherAnomalyBuildUpEfficiency ?? 0)).toBe(25)
  })

  it('防死数据：0命时无积蓄效率加成', async () => {
    const { catalog, config } = await setup([{ agentId: '1331', cinemaLevel: 0 }])
    const { computePanelPhases } = await import('@/composables/resourceCalc/helpers')
    const p0 = computePanelPhases(0, config, catalog)!.inCombat as any
    expect(p0.etherAnomalyBuildUpEfficiency ?? 0).toBe(0)
  })
})

describe('安东（1111）影画4 一起燃烧！：全队暴击率 +10%（影画四门控）', () => {
  beforeEach(() => { setActivePinia(createPinia()); stubFetch() })

  it('安东4命在队：队友（安比）暴击率 +10', async () => {
    const { catalog, config } = await setup([
      { agentId: '1111', cinemaLevel: 4 },
      { agentId: '1011', cinemaLevel: 0 },
    ])
    const { computePanelPhases } = await import('@/composables/resourceCalc/helpers')
    const withBuff = computePanelPhases(1, config, catalog)!.inCombat as any
    config.team[0].cinemaLevel = 0
    config.syncTeammateBuffsFromTeam()
    const withoutBuff = computePanelPhases(1, config, catalog)!.inCombat as any
    expect(withBuff.critRate - withoutBuff.critRate).toBe(10)
  })

  it('门控验证：安东3命时全队拐力不生效', async () => {
    const { catalog, config } = await setup([
      { agentId: '1111', cinemaLevel: 3 },
      { agentId: '1011', cinemaLevel: 0 },
    ])
    const { computePanelPhases } = await import('@/composables/resourceCalc/helpers')
    const p = computePanelPhases(1, config, catalog)!.inCombat as any
    config.team[0].agentId = ''
    config.syncTeammateBuffsFromTeam()
    const baseline = computePanelPhases(1, config, catalog)!.inCombat as any
    expect(p.critRate).toBe(baseline.critRate)
  })
})
