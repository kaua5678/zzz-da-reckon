import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { computePanelPhases } from '@/composables/resourceCalc/helpers'
import {
  computeLighterFlameShockCount,
  computeLighterFlameShockMultiplier,
  computeLighterMorale,
  computeLighterMoraleDmgBonus,
  computeLighterRoutStunBonus,
  estimateTeamNormalEnergyConsumed,
  LIGHTER_IMPACT_CAP_PCT,
  LIGHTER_MORALE_PER_ENERGY,
  LIGHTER_MORALE_PER_SEC,
  lighterMechanic,
  MOVE_FLAME_SHOCK,
  MOVE_POWER_FINISHER,
} from '@/mechanics/agents/lighter'

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

/** mateId: 强攻队友用于额外能力；1081 安比为电·击破不触发 specialty=attack，改用火强攻 11号 1041 或同阵营露西 1151 */
async function setup(cinemaLevel = 0, mateId = '1151') {
  const catalog = useCatalogStore()
  await catalog.load()
  await catalog.loadTeammateBuffs()
  const config = useConfigStore()
  config.team[0] = { slot: 0, agentId: mateId, cinemaLevel: 0, ...baseConfig } as any
  config.team[1] = { slot: 1, agentId: '1161', cinemaLevel, ...baseConfig } as any
  config.team[2] = { slot: 2, agentId: '', cinemaLevel: 0, ...baseConfig } as any
  config.syncTeammateBuffsFromTeam()
  return { catalog, config }
}

describe('莱特纯函数', () => {
  it('士气：时间+能量，C6×2，喷发轮次按100点', () => {
    const base = computeLighterMorale({ combatTime: 100, teamEnergyConsumed: 400, cinemaLevel: 0 })
    expect(base.moraleGainTime).toBeCloseTo(LIGHTER_MORALE_PER_SEC * 100, 5)
    expect(base.moraleGainEnergy).toBeCloseTo(400 * LIGHTER_MORALE_PER_ENERGY, 5)
    expect(base.moraleGain).toBeCloseTo(base.moraleGainTime + base.moraleGainEnergy, 5)
    expect(base.burstEntries).toBe(Math.floor(base.moraleGain / 100))
    expect(base.powerFinisherCount).toBe(base.burstEntries)

    const c6 = computeLighterMorale({ combatTime: 100, teamEnergyConsumed: 400, cinemaLevel: 6 })
    expect(c6.moraleGain).toBeCloseTo(base.moraleGain * 2, 5)
  })

  it('昂扬：冲击力实时，满层硬顶75，C2×1.2', () => {
    // impact=170 → perStack 1.25 → 25，未满顶
    expect(computeLighterMoraleDmgBonus({ impact: 170, cinemaLevel: 0, additionalActive: true })).toBeCloseTo(25, 5)
    // impact=270 → over 100 → 10 steps → perStack 1.25+2.5=3.75 → 75 封顶
    expect(computeLighterMoraleDmgBonus({ impact: 270, cinemaLevel: 0, additionalActive: true })).toBeCloseTo(75, 5)
    expect(computeLighterMoraleDmgBonus({ impact: 270, cinemaLevel: 2, additionalActive: true })).toBeCloseTo(90, 5)
    expect(computeLighterMoraleDmgBonus({ impact: 999, cinemaLevel: 0, additionalActive: false })).toBe(0)
  })

  it('溃败失衡时长 0命+3 / 1命+5', () => {
    expect(computeLighterRoutStunBonus(0)).toBe(3)
    expect(computeLighterRoutStunBonus(1)).toBe(5)
  })

  it('火焰冲击：CD次数 + 耗尽士气额外，倍率含冲击超额', () => {
    expect(computeLighterFlameShockCount(80, 3)).toBe(10 + 3)
    // impact 170 → 250；impact 270 → 250+500cap? over=100 → +500 cap → 750
    expect(computeLighterFlameShockMultiplier(170)).toBe(250)
    expect(computeLighterFlameShockMultiplier(270)).toBe(750)
  })

  it('全队能量消耗排除闪能用户', () => {
    const chars: any[] = [
      { isFlashUser: false, exSpecialEnergyConsume: 60 },
      { isFlashUser: true, exSpecialEnergyConsume: 40 },
      { isFlashUser: false, exSpecialEnergyConsume: 40 },
    ]
    expect(estimateTeamNormalEnergyConsumed(chars, [2, 5, 1])).toBe(60 * 2 + 40 * 1)
  })
})

describe('莱特执行行', () => {
  it('buildExecutions：C6 生成火焰冲击；强力终结按士气轮次', () => {
    const cfg: any = {
      lighterCinemaLevel: 6,
      lighterImpact: 200,
      lighterTeamEnergyConsumed: 0,
      lighterFlameShockMult: 400,
    }
    const executions: any[] = []
    lighterMechanic.buildExecutions!({
      cfg,
      state: {
        exSpecialCount: 0,
        chainCountTotal: 0,
        ultimateCount: 0,
        frontlineTime: 60,
        backstageTime: 120,
      },
      executions,
    } as any)
    // 180s 士气 = 2.9*180*2(C6)=1044 → 10 轮
    const finisher = executions.find(e => e.moveId === MOVE_POWER_FINISHER)
    expect(finisher?.count).toBe(10)
    expect(finisher?.dmgBonus).toBe(30) // C6≥1
    const flame = executions.find(e => e.moveId === MOVE_FLAME_SHOCK)
    expect(flame?.count).toBe(Math.floor(180 / 8) + 10)
    expect(flame?.damageMultiplier).toBe(400)
    expect(flame?.element).toBe('fire')
  })
})

describe('莱特面板接线', () => {
  beforeEach(() => { setActivePinia(createPinia()); stubFetch() })

  it('核心减抗15 + 溃败时长3；同阵营触发昂扬', async () => {
    const { catalog, config } = await setup(0, '1151') // 露西同阵营
    const mate = computePanelPhases(0, config, catalog)!.inCombat
    const lighter = computePanelPhases(1, config, catalog)!.inCombat
    expect(mate.enemyIceResReduction).toBeCloseTo(15)
    expect(mate.enemyFireResReduction).toBeCloseTo(15)
    expect(lighter.stunDurationBonusSeconds).toBeCloseTo(3)
    // 冲击力吃满 +20%
    const out = computePanelPhases(1, config, catalog)!.outOfCombat
    expect(lighter.impact / Math.max(1, out.impact)).toBeCloseTo(1 + LIGHTER_IMPACT_CAP_PCT / 100, 2)
    // 昂扬：同阵营应有冰火伤
    expect(mate.iceDmg).toBeGreaterThan(0)
    expect(mate.fireDmg).toBeGreaterThan(0)
  })

  it('额外能力无强攻/同阵营时不给昂扬', async () => {
    // 青衣 1251 电击破、维多利亚家政 → 非强攻非同阵营
    const { catalog, config } = await setup(0, '1251')
    const mate = computePanelPhases(0, config, catalog)!.inCombat
    // 减抗仍在（核心被动不依赖额外能力）
    expect(mate.enemyFireResReduction).toBeCloseTo(15)
    // 昂扬不应生效
    expect(mate.iceDmg).toBe(0)
    expect(mate.fireDmg).toBe(0)
  })

  it('影画1/2 有命座差分', async () => {
    const { catalog, config } = await setup(0, '1151')
    const c0 = computePanelPhases(0, config, catalog)!.inCombat
    const lighter0 = computePanelPhases(1, config, catalog)!.inCombat
    config.team[1].cinemaLevel = 1
    config.syncTeammateBuffsFromTeam()
    const c1 = computePanelPhases(0, config, catalog)!.inCombat
    const lighter1 = computePanelPhases(1, config, catalog)!.inCombat
    expect(c1.enemyIceResReduction - c0.enemyIceResReduction).toBeCloseTo(10)
    expect(c1.enemyFireResReduction - c0.enemyFireResReduction).toBeCloseTo(10)
    expect(lighter1.stunDurationBonusSeconds - lighter0.stunDurationBonusSeconds).toBeCloseTo(2)

    config.team[1].cinemaLevel = 2
    config.syncTeammateBuffsFromTeam()
    const c2 = computePanelPhases(0, config, catalog)!.inCombat
    expect(c2.stunDmgMultiplierBonus - c1.stunDmgMultiplierBonus).toBeCloseTo(25)
    // 昂扬 ×1.2
    expect(c2.iceDmg / Math.max(1e-6, c1.iceDmg)).toBeCloseTo(1.2, 2)
  })

  it('影画4：队友能量获得效率按后场占比', async () => {
    const { catalog, config } = await setup(4, '1151')
    config.setMechanicSetting('lighter.backstageRatio', 0.5)
    const mate = computePanelPhases(0, config, catalog)!.inCombat
    const lighter = computePanelPhases(1, config, catalog)!.inCombat
    expect(mate.energyGainEfficiency).toBeCloseTo(5) // 10% × 0.5
    expect(lighter.energyGainEfficiency ?? 0).toBe(0)
  })
})
