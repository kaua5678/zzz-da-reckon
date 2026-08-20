import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { computePanelPhases } from '@/composables/resourceCalc/helpers'
import {
  BEN_C2_DEF_MULT,
  BEN_C4_COUNTER_DMG,
  BEN_C6_STUN_BONUS,
  BEN_DEF_TO_ATK,
  MOVE_C2_COUNTER,
  benMechanic,
} from '@/mechanics/agents/ben'

const catalogText = readFileSync(new URL('../../../public/static/catalog.json', import.meta.url), 'utf8')
const buffsText = readFileSync(new URL('../../../public/static/teammate-buffs.json', import.meta.url), 'utf8')
const recsText = readFileSync(new URL('../../../public/static/build-recommendations.json', import.meta.url), 'utf8')

const baseConfig = {
  wEngineId: '', wEngineModLevel: 1,
  driveDisc: { fourPieceSetId: '', twoPieceSetId: '', mainStats: {}, subStatAllocation: {} },
  parryCount: 2, dodgeCounterCount: 0, defAssistCount: 0,
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

async function setup(cinemaLevel = 0, mateId = '1101') {
  const catalog = useCatalogStore()
  await catalog.load()
  await catalog.loadTeammateBuffs()
  const config = useConfigStore()
  for (const buff of config.globalBuffs) buff.enabled = false
  // 1101 珂蕾妲 火击破 白祇 → 同属性同阵营
  config.team[0] = { slot: 0, agentId: mateId, cinemaLevel: 0, ...baseConfig } as any
  config.team[1] = { slot: 1, agentId: '1121', cinemaLevel, ...baseConfig } as any
  config.team[2] = { slot: 2, agentId: '', cinemaLevel: 0, ...baseConfig } as any
  config.syncTeammateBuffsFromTeam()
  return { catalog, config }
}

describe('本模块', () => {
  it('防转攻 applyPanel', () => {
    const panel: any = { def: 1000, atk: 500 }
    benMechanic.applyPanel!({ slot: 1, agent: {} as any, cinemaLevel: 0, team: [], outOfCombatPanel: panel, panel, settings: {} })
    expect(panel.atk).toBeCloseTo(500 + 1000 * BEN_DEF_TO_ATK)
  })

  it('影画2 附加行 + 影画4 反击增伤 + 影画6 失衡', () => {
    const cfg: any = { benCinemaLevel: 6, benDef: 800, parryCount: 3 }
    const panel: any = { def: 800, atk: 0 }
    benMechanic.applyPanel!({ slot: 1, agent: {} as any, cinemaLevel: 6, team: [], outOfCombatPanel: panel, panel, settings: {} })
    expect(panel.stunBuildUpBonus__basic).toBe(BEN_C6_STUN_BONUS)

    const executions: any[] = [
      { moveId: '1121008', dmgBonus: 0, skillTableNote: '' },
    ]
    benMechanic.buildExecutions!({
      cfg,
      state: { exSpecialCount: 2 } as any,
      executions,
    } as any)
    const c2 = executions.find(e => e.moveId === MOVE_C2_COUNTER)
    expect(c2?.count).toBe(3)
    expect(c2?.damageMultiplier).toBe(BEN_C2_DEF_MULT)
    expect(c2?.basisValueOverride).toBe(800)
    expect(c2?.dmgBonus).toBe(BEN_C4_COUNTER_DMG)

    benMechanic.patchExecutions!({ cfg, state: {} as any, executions } as any)
    expect(executions.find(e => e.moveId === '1121008')?.dmgBonus).toBe(BEN_C4_COUNTER_DMG)
  })
})

describe('本面板', () => {
  beforeEach(() => { setActivePinia(createPinia()); stubFetch() })

  it('同阵营触发全队暴击+16；防转攻抬自身攻击', async () => {
    const { catalog, config } = await setup(0, '1101')
    const mateOut = computePanelPhases(0, config, catalog)!.outOfCombat
    const mate = computePanelPhases(0, config, catalog)!.inCombat
    const benOut = computePanelPhases(1, config, catalog)!.outOfCombat
    const ben = computePanelPhases(1, config, catalog)!.inCombat
    // 额外能力暴击拐至少 +16（允许其它来源叠加，只断言下限与门控）
    expect(mate.critRate - mateOut.critRate).toBeGreaterThanOrEqual(16)
    expect(ben.critRate - benOut.critRate).toBeGreaterThanOrEqual(16)
    expect(ben.atk).toBeGreaterThan(benOut.atk + benOut.def * BEN_DEF_TO_ATK * 0.5)
  })

  it('无同属性/同阵营时暴击拐不生效', async () => {
    // 妮可 1031 以太支援 狡兔
    const { catalog, config } = await setup(0, '1031')
    const mateOut = computePanelPhases(0, config, catalog)!.outOfCombat
    const mate = computePanelPhases(0, config, catalog)!.inCombat
    expect(mate.critRate - mateOut.critRate).toBe(0)
  })
})
