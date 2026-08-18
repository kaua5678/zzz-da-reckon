import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { computePanelPhases } from '@/composables/resourceCalc/helpers'
import { NICOLE_C1_EX_BONUS, NICOLE_C2_ENERGY, nicoleMechanic } from '@/mechanics/agents/nicole'

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

async function setup(cinemaLevel = 0, mateId = '1241') {
  const catalog = useCatalogStore()
  await catalog.load()
  await catalog.loadTeammateBuffs()
  const config = useConfigStore()
  for (const buff of config.globalBuffs) buff.enabled = false
  // 1241 朱鸢 以太·强攻 → 同属性触发额外能力
  config.team[0] = { slot: 0, agentId: mateId, cinemaLevel: 0, ...baseConfig } as any
  config.team[1] = { slot: 1, agentId: '1031', cinemaLevel, ...baseConfig } as any
  config.team[2] = { slot: 2, agentId: '', cinemaLevel: 0, ...baseConfig } as any
  config.syncTeammateBuffsFromTeam()
  return { catalog, config }
}

describe('妮可模块', () => {
  it('影画1：EX 段伤害+16% 与积蓄×1.16', () => {
    const cfg: any = { nicoleCinemaLevel: 1 }
    const executions: any[] = [
      { moveId: '1031103', dmgBonus: 0, anomalyBuildUp: 100, count: 2, totalAnomalyBuildUp: 200, skillTableNote: '' },
      { moveId: '1031001', dmgBonus: 0, anomalyBuildUp: 50, count: 1 },
    ]
    nicoleMechanic.patchExecutions!({ cfg, state: {} as any, executions } as any)
    expect(executions[0].dmgBonus).toBe(NICOLE_C1_EX_BONUS)
    expect(executions[0].anomalyBuildUp).toBeCloseTo(100 * 1.16)
    expect(executions[0].totalAnomalyBuildUp).toBeCloseTo(100 * 1.16 * 2)
    expect(executions[1].dmgBonus).toBe(0)
  })

  it('影画2：开局能量赠送 floor(t/15)×5', () => {
    const cfg: any = { battleTime: 180, initialEnergyGift: 40 }
    nicoleMechanic.buildCharConfig!({
      slot: 1, agent: {} as any, skills: { categories: [] } as any,
      cinemaLevel: 2, wEngineId: '', wEngineModLevel: 1, team: [], panel: {} as any, cfg, getRowValue: () => 0,
    } as any)
    expect(cfg.initialEnergyGift).toBe(40 + Math.floor(180 / 15) * NICOLE_C2_ENERGY)
    const cfg0: any = { battleTime: 180, initialEnergyGift: 40 }
    nicoleMechanic.buildCharConfig!({
      slot: 1, agent: {} as any, skills: { categories: [] } as any,
      cinemaLevel: 0, wEngineId: '', wEngineModLevel: 1, team: [], panel: {} as any, cfg: cfg0, getRowValue: () => 0,
    } as any)
    expect(cfg0.initialEnergyGift).toBe(40)
  })
})

describe('妮可面板', () => {
  beforeEach(() => { setActivePinia(createPinia()); stubFetch() })

  it('核心减防40；同属性触发以太伤25', async () => {
    const { catalog, config } = await setup(0, '1241')
    const mate = computePanelPhases(0, config, catalog)!.inCombat
    expect(mate.enemyDefReduction).toBeCloseTo(40)
    expect(mate.etherDmg).toBeCloseTo(25)
  })

  it('无同属性/同阵营时额外以太伤不生效', async () => {
    // 11号 1041 火强攻 卡吕冬 — 非以太非狡兔屋
    const { catalog, config } = await setup(0, '1041')
    const mateOut = computePanelPhases(0, config, catalog)!.outOfCombat
    const mate = computePanelPhases(0, config, catalog)!.inCombat
    expect(mate.enemyDefReduction).toBeCloseTo(40)
    expect(mate.etherDmg - (mateOut.etherDmg ?? 0)).toBe(0)
  })

  it('影画6 满层暴击+15', async () => {
    const { catalog, config } = await setup(5, '1241')
    const c5 = computePanelPhases(0, config, catalog)!.inCombat
    config.team[1].cinemaLevel = 6
    config.syncTeammateBuffsFromTeam()
    const c6 = computePanelPhases(0, config, catalog)!.inCombat
    expect(c6.critRate - c5.critRate).toBeCloseTo(15)
  })
})
