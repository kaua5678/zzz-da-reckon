import { beforeEach, describe, expect, it } from 'vitest'
import { mockStaticFetch, newPinia } from '@/test/harness'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { computePanelPhases } from '@/composables/resourceCalc/helpers'
import {
  computeAriaBonuses,
  computeYaojiayinCoreAtkBonus,
  computeYaojiayinTremolos,
  MOVE_CLUSTER,
  MOVE_TREMOLO,
  yaojiayinMechanic,
  yaojiayinSkillLevel,
} from '@/mechanics/agents/yaojiayin'

const baseConfig = {
  wEngineId: '', wEngineModLevel: 1,
  driveDisc: { fourPieceSetId: '', twoPieceSetId: '', mainStats: {}, subStatAllocation: {} },
  parryCount: 0, dodgeCounterCount: 0, defAssistCount: 0,
  quickAssistCount: 0, chainCountPerStun: 1, basicAttackTimeWeight: 1,
}

/** 强攻队友触发额外能力 */
async function setup(cinemaLevel = 0, mateId = '1041') {
  const catalog = useCatalogStore()
  await catalog.load()
  await catalog.loadTeammateBuffs()
  const config = useConfigStore()
  // 关掉默认危局全局增伤，避免污染咏叹差分断言
  for (const buff of config.globalBuffs) buff.enabled = false
  config.team[0] = { slot: 0, agentId: mateId, cinemaLevel: 0, ...baseConfig } as any
  config.team[1] = { slot: 1, agentId: '1311', cinemaLevel, ...baseConfig } as any
  config.team[2] = { slot: 2, agentId: '', cinemaLevel: 0, ...baseConfig } as any
  config.syncTeammateBuffsFromTeam()
  return { catalog, config }
}

describe('耀嘉音纯函数', () => {
  it('咏叹华彩技能等级与数值', () => {
    expect(yaojiayinSkillLevel(0)).toBe(12)
    expect(yaojiayinSkillLevel(3)).toBe(14)
    expect(yaojiayinSkillLevel(5)).toBe(16)
    expect(computeAriaBonuses(12)).toEqual({ dmgBonus: 20, critDmg: 25 })
    expect(computeAriaBonuses(14)).toEqual({ dmgBonus: 22, critDmg: 28 })
    expect(computeAriaBonuses(16)).toEqual({ dmgBonus: 24, critDmg: 31 })
  })

  it('核心攻击 35%/1200 与 C2 54%/1600', () => {
    expect(computeYaojiayinCoreAtkBonus(3000, 0)).toBeCloseTo(1050)
    expect(computeYaojiayinCoreAtkBonus(4000, 0)).toBe(1200)
    expect(computeYaojiayinCoreAtkBonus(3000, 2)).toBeCloseTo(1620 > 1600 ? 1600 : 1620)
    expect(computeYaojiayinCoreAtkBonus(3000, 2)).toBe(1600)
    expect(computeYaojiayinCoreAtkBonus(2000, 2)).toBeCloseTo(1080)
  })

  it('震音：付费受能量与入场双限；额外能力与C2追加', () => {
    const base = computeYaojiayinTremolos({
      totalEnergy: 200, entryCount: 10, combatTime: 180, cinemaLevel: 0, additionalActive: false,
    })
    expect(base.paidTremolos).toBe(8) // floor(200/25)
    expect(base.freeTremolos).toBe(0)
    expect(base.clusters).toBe(0)

    const aa = computeYaojiayinTremolos({
      totalEnergy: 200, entryCount: 10, combatTime: 180, cinemaLevel: 0, additionalActive: true,
    })
    expect(aa.paidTremolos).toBe(8)
    expect(aa.freeTremolos).toBe(8)
    expect(aa.clusters).toBe(24)
    expect(aa.totalTremolos).toBe(16)

    const c2 = computeYaojiayinTremolos({
      totalEnergy: 200, entryCount: 10, combatTime: 30, cinemaLevel: 2, additionalActive: false,
    })
    expect(c2.c2Extra).toBe(10) // min(10, floor(30/3)=10)
    expect(c2.freeTremolos).toBe(10)
    expect(c2.clusters).toBe(30)

    const c6 = computeYaojiayinTremolos({
      totalEnergy: 250, entryCount: 20, combatTime: 100, cinemaLevel: 6, additionalActive: true,
    })
    expect(c6.paidTremolos).toBe(10)
    expect(c6.c6Capriccio).toBe(Math.min(10, Math.floor(100 / 10)))
  })
})

describe('耀嘉音执行行', () => {
  it('buildExecutions 生成震音/音簇，C6 倍率×2', () => {
    const cfg: any = {
      yaojiayinCinemaLevel: 6,
      yaojiayinAdditionalActive: 1,
      yaojiayinEntryCount: 12,
      yaojiayinTremoloDmg: 92.2,
      yaojiayinClusterDmg: 48.2,
      yaojiayinCapriccioDmg: 542.4,
      yaojiayinTeamHasAttack: 1,
      yaojiayinQuickAssistEntries: 6,
    }
    const executions: any[] = []
    yaojiayinMechanic.buildExecutions!({
      cfg,
      state: {
        totalEnergy: 200,
        exSpecialCount: 0,
        chainCountTotal: 0,
        ultimateCount: 0,
        frontlineTime: 40,
        backstageTime: 140,
      },
      executions,
    } as any)
    const tremolo = executions.find(e => e.moveId === MOVE_TREMOLO)
    const cluster = executions.find(e => e.moveId === MOVE_CLUSTER)
    expect(tremolo.count).toBeGreaterThan(0)
    expect(tremolo.damageMultiplier).toBeCloseTo(92.2 * 2)
    expect(tremolo.critRateBonus).toBe(80)
    expect(cluster.count).toBeGreaterThan(0)
    expect(cluster.damageMultiplier).toBeCloseTo(48.2 * 2)
    const cap = executions.find(e => e.moveId === '1311004')
    expect(cap?.count).toBeGreaterThan(0)
    expect(cap?.critRateBonus).toBe(80)
    const c4 = executions.find(e => e.moveId === '1311c4_atk_bonus')
    expect(c4?.count).toBeGreaterThan(0)
    expect(c4?.damageMultiplier).toBe(300)
  })
})

describe('耀嘉音面板接线', () => {
  beforeEach(() => { newPinia(); mockStaticFetch() })

  it('核心攻击与咏叹华彩全队生效', async () => {
    const { catalog, config } = await setup(0, '1041')
    const mateOut = computePanelPhases(0, config, catalog)!.outOfCombat
    const mate = computePanelPhases(0, config, catalog)!.inCombat
    const yj = computePanelPhases(1, config, catalog)!.inCombat
    const yjOut = computePanelPhases(1, config, catalog)!.outOfCombat
    const expectedAtk = Math.min(1200, yjOut.atk * 0.35)
    expect(mate.atk).toBeGreaterThan(mateOut.atk + expectedAtk * 0.5)
    expect(yj.atk).toBeGreaterThan(yjOut.atk)
    // 咏叹 lv12 → 伤害+20、暴伤+25（相对局外）
    expect(mate.dmgBonus - (mateOut.dmgBonus ?? 0)).toBeCloseTo(20, 0)
    expect(mate.critDmg - mateOut.critDmg).toBeCloseTo(25, 0)
  })

  it('影画1 全抗-18；影画2 核心攻差分', async () => {
    const { catalog, config } = await setup(0, '1041')
    const c0 = computePanelPhases(0, config, catalog)!.inCombat
    config.team[1].cinemaLevel = 1
    config.syncTeammateBuffsFromTeam()
    const c1 = computePanelPhases(0, config, catalog)!.inCombat
    expect(c1.enemyResReduction - c0.enemyResReduction).toBeCloseTo(18)

    const atk0 = c0.atk
    config.team[1].cinemaLevel = 2
    config.syncTeammateBuffsFromTeam()
    const c2 = computePanelPhases(0, config, catalog)!.inCombat
    expect(c2.atk).toBeGreaterThan(atk0)
  })

  it('咏叹数值随 3/5 命技能等级提升', async () => {
    const { catalog, config } = await setup(0, '1041')
    const dmgOf = () => {
      const p = computePanelPhases(0, config, catalog)!
      return p.inCombat.dmgBonus - (p.outOfCombat.dmgBonus ?? 0)
    }
    const d0 = dmgOf()
    config.team[1].cinemaLevel = 3
    config.syncTeammateBuffsFromTeam()
    const d3 = dmgOf()
    config.team[1].cinemaLevel = 5
    config.syncTeammateBuffsFromTeam()
    const d5 = dmgOf()
    expect(d0).toBeCloseTo(20, 0)
    expect(d3).toBeCloseTo(22, 0)
    expect(d5).toBeCloseTo(24, 0)
  })

  it('影画4 异常队友获得积蓄效率', async () => {
    // 简 1261 异常
    const { catalog, config } = await setup(4, '1261')
    const mate = computePanelPhases(0, config, catalog)!.inCombat
    expect(mate.anomalyBuildUpEfficiency).toBeGreaterThan(0)
  })
})
