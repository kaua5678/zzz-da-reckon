import { beforeEach, describe, expect, it } from 'vitest'
import { mockStaticFetch, newPinia, setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { computePanelPhases } from '@/composables/resourceCalc/panelPhases'
import {
  computeLighterFlameShockCount,
  computeLighterFlameShockMultiplier,
  computeLighterMorale,
  computeLighterRoutStunBonus,
  estimateTeamNormalEnergyConsumed,
  LIGHTER_BURST_ENTRY,
  LIGHTER_IMPACT_CAP_PCT,
  LIGHTER_MORALE_PER_ENERGY,
  LIGHTER_MORALE_PER_SEC,
  lighterMechanic,
  LIGHTER_BURST_JAB_COUNT,
  MOVE_BURST_JAB,
  MOVE_QUICK_ASSIST,
  MOVE_FLAME_SHOCK,
  MOVE_POWER_FINISHER,
} from '@/mechanics/agents/lighter'

const baseConfig = {
  wEngineId: '', wEngineModLevel: 1,
  driveDisc: { fourPieceSetId: '', twoPieceSetId: '', mainStats: {}, subStatAllocation: {} },
  parryCount: 0, dodgeCounterCount: 0, defAssistCount: 0,
  quickAssistCount: 0, chainCountPerStun: 1, basicAttackTimeWeight: 1,
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
  it('士气：时间+能量，C6×2，喷发轮次按入场门槛 80', () => {
    const base = computeLighterMorale({ combatTime: 100, teamEnergyConsumed: 400, cinemaLevel: 0 })
    expect(base.moraleGainTime).toBeCloseTo(LIGHTER_MORALE_PER_SEC * 100, 5)
    expect(base.moraleGainEnergy).toBeCloseTo(400 * LIGHTER_MORALE_PER_ENERGY, 5)
    expect(base.moraleGain).toBeCloseTo(base.moraleGainTime + base.moraleGainEnergy, 5)
    // 用户口径 2026-10-26：轮数按入场门槛 80 计（每轮兑现 [80,100]，超额在一轮内溢出）。
    // 290 + 104 = 394 点 ⇒ floor(394/80) = 4 轮（旧口径 /100 = 3 轮，系统性低估）。
    expect(base.burstEntries).toBe(Math.floor(base.moraleGain / LIGHTER_BURST_ENTRY))
    expect(base.burstEntries).toBe(4)
    expect(base.powerFinisherCount).toBe(base.burstEntries)

    const c6 = computeLighterMorale({ combatTime: 100, teamEnergyConsumed: 400, cinemaLevel: 6 })
    expect(c6.moraleGain).toBeCloseTo(base.moraleGain * 2, 5)
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
  it('buildExecutions：士气喷发循环物化（起攻+刺拳连击+强力终结）+ C6 火焰冲击', () => {
    const cfg: any = {
      invincibleTime: 0,
      lighterCinemaLevel: 6,
      lighterImpact: 200,
      lighterTeamEnergyConsumed: 0,
      lighterFlameShockMult: 400,
      lighterQuickAssistActionTime: 0.317,
      lighterBurstJabActionTime: 0.777,
      lighterPowerFinisherActionTime: 1.002,
    }
    const executions: any[] = [{
      moveId: 'basic_attack', moveName: '普通攻击（平A汇总）', category: 'basic',
      count: 0, actionTime: 0, comboAlignRatio: 0, totalTime: 40, totalComboAlignTime: 0,
      energyConsume: 0, totalEnergyConsume: 0,
      energyRecovery: 3.6, totalEnergyRecovery: 144,
      decibelRecovery: 27.5, totalDecibelRecovery: 1100,
      timeBucket: 'basic',
    }]
    lighterMechanic.buildExecutions!({
      cfg,
      state: { exSpecialCount: 0, chainCountTotal: 0, ultimateCount: 0, frontlineTime: 60, backstageTime: 120 },
      executions,
    } as any)
    // 每轮 = 快支 0.317 + 冲拳 2×0.777 + 强化一击 1.002 = 2.873s；平A池 40s ⇒ 13 轮（士气轮次为上限）。
    const morale = computeLighterMorale({
      combatTime: 180, teamEnergyConsumed: 0, cinemaLevel: 6,
      burstSecondsPerCycle: 0.317 + LIGHTER_BURST_JAB_COUNT * 0.777 + 1.002,
    })
    expect(morale.burstEntries).toBeGreaterThanOrEqual(8)
    const opener = executions.find(e => e.moveId === MOVE_QUICK_ASSIST)
    const jab = executions.find(e => e.moveId === MOVE_BURST_JAB)
    const finisher = executions.find(e => e.moveId === MOVE_POWER_FINISHER)
    // 平A池 40s 钳制：floor(40 / 2.873) = 13 轮，士气轮次为上限
    expect(opener?.count).toBe(Math.min(morale.burstEntries, 13))
    expect(finisher?.count).toBe(Math.min(morale.burstEntries, 13))
    expect(jab?.count).toBe(opener!.count * LIGHTER_BURST_JAB_COUNT)
    expect(opener?.actionTime).toBeCloseTo(0.317, 5)
    expect(finisher?.actionTime).toBeCloseTo(1.002, 5)
    // 时间守恒：三段合计 == 从平A池挤出量
    const used = opener!.totalTime + jab!.totalTime + finisher!.totalTime
    expect(executions[0].totalTime).toBeCloseTo(40 - used, 5)
    expect(finisher?.dmgBonus).toBe(30)
    const flame = executions.find(e => e.moveId === MOVE_FLAME_SHOCK)
    expect(flame?.count).toBe(Math.floor(180 / 8) + opener!.count) // 常规 CD + 实际轮数
    expect(flame?.damageMultiplier).toBe(400)
    expect(flame?.element).toBe('fire')
  })
})

describe('莱特面板接线', () => {
  beforeEach(() => { newPinia(); mockStaticFetch() })

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

  it('整管线：士气喷发循环占时从平A池挤出（不白嫖），聚合行降级为时间/回能载体', async () => {
    const { catalog } = await setupHarness([{ agentId: '1041' }, { agentId: '1161' }, { agentId: '1311' }])
    void catalog
    const calc = useResourceCalc()
    const rr = calc.resourceResult.value!
    const ch = rr.characters.find(c => c.agentId === '1161')!
    const pool = ch.executions.find(e => e.moveId === 'basic_attack')!
    const opener = ch.executions.find(e => e.moveId === MOVE_QUICK_ASSIST)!
    const jab = ch.executions.find(e => e.moveId === MOVE_BURST_JAB)!
    const fin = ch.executions.find(e => e.moveId === MOVE_POWER_FINISHER)!
    // ① 三段都物化且都带真实时长
    for (const seg of [opener, jab, fin]) {
      expect(seg).toBeTruthy()
      expect(seg.actionTime).toBeGreaterThan(0)
      expect(seg.totalTime).toBeCloseTo(seg.count * seg.actionTime, 6)
    }
    // ② 时间守恒：池 + 三段合计 == 该槽平A分配额（carve 等量挤出）
    const used = opener.totalTime + jab.totalTime + fin.totalTime
    expect(pool.totalTime + used).toBeCloseTo(ch.timeAllocation.basicAttackTime, 5)
    // ③ 聚合行**保留正常倍率**：喷发循环只吃池的一部分，剩余时间仍是普通平A（不归零）
    expect(pool.damageMultiplier).toBeGreaterThan(0)
    // ④ 回能不双计：池上回能按剩余时间比例缩（段行按表回填能量/喧响）
    const perSecEnergy = pool.energyRecovery ?? 0
    expect(pool.totalEnergyRecovery).toBeCloseTo(perSecEnergy * pool.totalTime, 4)
  }, 60000)

  it('影画4：队友能量获得效率按后场占比', async () => {
    const { catalog, config } = await setup(4, '1151')
    config.setMechanicSetting('lighter.backstageRatio', 0.5)
    const mate = computePanelPhases(0, config, catalog)!.inCombat
    const lighter = computePanelPhases(1, config, catalog)!.inCombat
    expect(mate.energyGainEfficiency).toBeCloseTo(5) // 10% × 0.5
    expect(lighter.energyGainEfficiency ?? 0).toBe(0)
  })
})
