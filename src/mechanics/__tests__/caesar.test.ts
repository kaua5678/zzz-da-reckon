import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { computePanelPhases } from '@/composables/resourceCalc/helpers'
import {
  CAESAR_C2_ENERGY_EFF,
  CAESAR_C6_DMG_BONUS,
  CAESAR_C6_SELF_CRIT_DMG,
  CAESAR_C6_SELF_CRIT_RATE,
  caesarMechanic,
} from '@/mechanics/agents/caesar'

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

async function setup(cinemaLevel = 0, mateId = '1151') {
  const catalog = useCatalogStore()
  await catalog.load()
  await catalog.loadTeammateBuffs()
  const config = useConfigStore()
  for (const buff of config.globalBuffs) buff.enabled = false
  config.team[0] = { slot: 0, agentId: mateId, cinemaLevel: 0, ...baseConfig } as any
  config.team[1] = { slot: 1, agentId: '1071', cinemaLevel, ...baseConfig } as any
  config.team[2] = { slot: 2, agentId: '', cinemaLevel: 0, ...baseConfig } as any
  config.syncTeammateBuffsFromTeam()
  return { catalog, config }
}

describe('凯撒模块', () => {
  it('影画6：盾击/支援之锋 必定暴击 + 伤害+100%', () => {
    const cfg: any = { caesarCinemaLevel: 6 }
    const executions: any[] = [
      { moveId: '1071013', dmgBonus: 0, critRateBonus: 0, skillTableNote: '' },
      { moveId: '1071024', dmgBonus: 0, critRateBonus: 0, skillTableNote: '' },
      { moveId: '1071001', dmgBonus: 0, critRateBonus: 0, skillTableNote: '' },
    ]
    caesarMechanic.patchExecutions!({ cfg, state: {} as any, executions } as any)
    expect(executions[0].dmgBonus).toBe(CAESAR_C6_DMG_BONUS)
    expect(executions[0].critRateBonus).toBe(100)
    expect(executions[1].dmgBonus).toBe(CAESAR_C6_DMG_BONUS)
    expect(executions[2].dmgBonus).toBe(0)
  })
})

describe('凯撒面板', () => {
  beforeEach(() => { setActivePinia(createPinia()); stubFetch() })

  it('核心攻+1000、额外伤害+25；有队友即触发额外能力', async () => {
    const { catalog, config } = await setup(0, '1151')
    const mateOut = computePanelPhases(0, config, catalog)!.outOfCombat
    const mate = computePanelPhases(0, config, catalog)!.inCombat
    expect(mate.atk - mateOut.atk).toBeGreaterThanOrEqual(1000 * 0.9)
    expect(mate.dmgBonus - (mateOut.dmgBonus ?? 0)).toBeCloseTo(25)
  })

  it('影画1 全抗-15；影画2 攻击×1.5 与能量效率+10', async () => {
    const { catalog, config } = await setup(0, '1151')
    const c0 = computePanelPhases(0, config, catalog)!.inCombat
    const caesar0 = computePanelPhases(1, config, catalog)!.inCombat
    config.team[1].cinemaLevel = 1
    config.syncTeammateBuffsFromTeam()
    const c1 = computePanelPhases(0, config, catalog)!.inCombat
    expect(c1.enemyResReduction - c0.enemyResReduction).toBeCloseTo(15)

    config.team[1].cinemaLevel = 2
    config.syncTeammateBuffsFromTeam()
    const c2 = computePanelPhases(0, config, catalog)!.inCombat
    const caesar2 = computePanelPhases(1, config, catalog)!.inCombat
    // C2：核心攻 1000 → 1500，相对 0 命多 +500
    expect(c2.atk - c0.atk).toBeCloseTo(500, 0)
    expect(caesar2.energyGainEfficiency - (caesar0.energyGainEfficiency ?? 0)).toBeCloseTo(CAESAR_C2_ENERGY_EFF)
  })

  it('影画6 自身暴击/暴伤', async () => {
    const { catalog, config } = await setup(5, '1151')
    const c5 = computePanelPhases(1, config, catalog)!.inCombat
    config.team[1].cinemaLevel = 6
    config.syncTeammateBuffsFromTeam()
    const c6 = computePanelPhases(1, config, catalog)!.inCombat
    expect(c6.critRate - c5.critRate).toBeCloseTo(CAESAR_C6_SELF_CRIT_RATE)
    expect(c6.critDmg - c5.critDmg).toBeCloseTo(CAESAR_C6_SELF_CRIT_DMG)
  })
})
