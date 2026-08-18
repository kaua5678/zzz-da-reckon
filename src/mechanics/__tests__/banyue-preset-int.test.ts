import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
const catalogText = readFileSync(new URL('../../../public/static/catalog.json', import.meta.url), 'utf8')
const buffsText = readFileSync(new URL('../../../public/static/teammate-buffs.json', import.meta.url), 'utf8')
const recsText = readFileSync(new URL('../../../public/static/build-recommendations.json', import.meta.url), 'utf8')
const baseConfig = {
  wEngineId: '', wEngineModLevel: 5,
  driveDisc: { fourPieceSetId: '', twoPieceSetId: '', mainStats: { 4: 'atkPct' as any, 5: 'fireDmg' as any, 6: 'critRate' as any }, subStatAllocation: {} },
  parryCount: 10, dodgeCounterCount: 6, blockCount: 20,
  quickAssistCount: 0, chainCountPerStun: 0, basicAttackTimeWeight: 1,
}
describe('般琉通用预设（集成）：连段块认领自动行，池守恒', () => {
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
  it('应用预设后：无重复连段行；池总量 = 怒相内 + 怒相外（不因连段块翻倍）', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    const config = useConfigStore()
    config.team[0] = { slot: 0, agentId: '1471', cinemaLevel: 0, ...baseConfig } as any
    config.team[1] = { slot: 1, agentId: '1481', cinemaLevel: 0, ...baseConfig } as any
    config.team[2] = { slot: 2, agentId: '1451', cinemaLevel: 0, ...baseConfig } as any
    config.useStunAxis = true
    const { default: preset } = await import('@/data/stunAxisPresets/般琉通用.json') as any
    config.stunAxisPlans = JSON.parse(JSON.stringify(preset.plans))
    config.stunAxes = []
    const calc = useResourceCalc()
    await new Promise(r => setTimeout(r, 60))
    const c0 = calc.resourceResult.value?.characters.find(c => c.slot === 0)
    const cycle = c0?.banyueRageCycle
    const lunDaoRows = c0?.executions.filter(e => e.moveId === '1471015') ?? []
    // 论道只有「山威行」+「怒相外论道连段行」——无「轴内·连段块」行（轴内单段论道被认领，池守恒）
    expect(lunDaoRows.some(e => e.skillTableNote?.includes('轴内'))).toBe(false)
    const totalLunDao = lunDaoRows.reduce((s, e) => s + e.count, 0)
    // 池守恒：执行计划里的论道总数 = 怒相内(rage×2) + 怒相外自动连段，不被轴内连段块翻倍
    expect(cycle).toBeTruthy()
    expect(totalLunDao).toBe((cycle!.lunDaoRageCount ?? 0) + (cycle!.lunDaoOutCount ?? 0))
    expect(totalLunDao).toBeGreaterThanOrEqual(2)
  })
})
