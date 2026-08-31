import { describe, expect, it } from 'vitest'
import { computePanelPhases } from '@/composables/resourceCalc/helpers'
import { computeYidhariHpSource, yidhariMechanic } from '@/mechanics/agents/yidhari'
import { setupHarness } from '@/test/harness'

async function setup(cinemaLevel = 0, mateId = '1141') {
  const r = await setupHarness([
    { agentId: '1051', cinemaLevel, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
    { agentId: mateId, cinemaLevel: 0, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
  ])
  for (const buff of r.config.globalBuffs) buff.enabled = false
  return r
}

describe('伊德海莉（1051）生命值/极寒重碾总量', () => {
  it('烧血喧响：每1%生命值10点喧响，影画4提升10%', () => {
    const cfg: any = { yidhariStunCount: 0, yidhariExPerStun: 2 }
    const state: any = { exSpecialCount: 4, basicAttackTime: 30 }
    // 蓄力循环单轮 = 1s 蓄力 + 下砸 + 平A，actionTime 未存时 chargeCycleTime 只有 1s
    const c0 = computeYidhariHpSource(cfg, state, false)
    expect(c0.decibelPerHpPct).toBe(10)
    const c4 = computeYidhariHpSource(cfg, state, true)
    expect(c4.decibelPerHpPct).toBe(11)
  })

  it('极寒重碾拆分：失衡内 = 每次失衡次数×失衡次数，非失衡 = 剩余（回15闪能）', () => {
    const cfg: any = { yidhariStunCount: 2, yidhariExPerStun: 2 }
    const state: any = { exSpecialCount: 6, basicAttackTime: 0 }
    const s = computeYidhariHpSource(cfg, state, false)
    // 失衡内 = min(6, 2×2) = 4，非失衡 = 2
    expect(s.inStunExCount).toBe(4)
    expect(s.outStunExCount).toBe(2)
  })
})

describe('伊德海莉面板（核心被动/额外能力/影画）', () => {
  it('核心被动低血增伤+100%；额外能力（击破队友）暴伤+30%', async () => {
    const { catalog, config } = await setup(0)
    const p = computePanelPhases(0, config, catalog)!.inCombat as any
    expect(p.additionalAbilityActive).toBe(1)
    // 核心被动 dmgBonus +100（烧血低血满覆盖）
    expect(p.dmgBonus).toBeGreaterThanOrEqual(100)
    // 额外能力 critDmg +30
    expect(p.critDmg).toBeGreaterThanOrEqual(50 + 30)
  })

  it('影画1 普攻/强特无视20%冰抗；影画2 暴伤+40 与闪能回0.5；影画6 贯穿伤+25', async () => {
    const { catalog, config } = await setup(6)
    const p = computePanelPhases(0, config, catalog)!.inCombat as any
    expect(p.enemyIceResReduction__basic).toBeGreaterThanOrEqual(20)
    expect(p.enemyIceResReduction__exSpecial).toBeGreaterThanOrEqual(20)
    expect(p.critDmg).toBeGreaterThanOrEqual(50 + 30 + 40)
    expect(p.flashEnergyRegenBonusFlat).toBeGreaterThanOrEqual(0.5)
    expect(p.sheerDmgBonus).toBeGreaterThanOrEqual(25)
  })

  it('影画差分：0命 vs 1/2/6 命字段变化', async () => {
    const p0 = (await setup(0)).catalog
    const c0 = (await setup(0)).config
    const p0panel = computePanelPhases(0, c0, p0)!.inCombat as any
    const c6 = (await setup(6)).config
    const c6catalog = (await setup(6)).catalog
    const p6panel = computePanelPhases(0, c6, c6catalog)!.inCombat as any
    expect(p6panel.enemyIceResReduction__basic - (p0panel.enemyIceResReduction__basic ?? 0)).toBe(20)
    expect(p6panel.critDmg - p0panel.critDmg).toBe(40)
    expect(p6panel.sheerDmgBonus - (p0panel.sheerDmgBonus ?? 0)).toBe(25)
  })
})

describe('伊德海莉执行行', () => {
  it('生成蓄力下砸/碎惘沉击/溯寒追碾/寒冰触手执行行', () => {
    const executions: any[] = [{
      moveId: 'basic_attack', totalTime: 30, totalDecibelRecovery: 0, totalEnergyRecovery: 0,
      damageMultiplier: 0, dazeMultiplier: 0,
    }]
    const cfg: any = {
      panel: { additionalAbilityActive: 1, skillLevelBonus: 0 },
      yidhariChargeSlam: { id: '1051007', damage: 100, daze: 10, anomaly: 10, actionTime: 2, decibel: 5, flash: 0 },
      yidhariBasicFollow: { id: '1051003', damage: 50, daze: 5, anomaly: 5, actionTime: 1, decibel: 3, flash: 0 },
      yidhariTentacleInterval: 13.5,
      yidhariCinemaLevel: 0,
    }
    const state: any = { frontlineTime: 30, backstageTime: 0, exSpecialCount: 2, basicAttackTime: 30 }
    yidhariMechanic.buildExecutions!({ cfg, state, executions } as any)
    const moveIds = executions.map((e: any) => e.moveId)
    expect(moveIds).toContain('1051007') // 霜寒拥覆#3 蓄力下砸
    expect(moveIds).toContain('1051003') // 碎惘沉击#4（满蓄+30%）
    expect(moveIds).toContain('1051011') // 溯寒追碾（0耗能触发重碾）
    expect(moveIds).toContain('1051024') // 寒冰触手（额外能力，12s CD）
  })

  it('寒冰触手需额外能力（击破/支援队友）才生成', () => {
    const executions: any[] = []
    const cfg: any = {
      panel: { additionalAbilityActive: 0, skillLevelBonus: 0 },
      yidhariChargeSlam: null,
      yidhariBasicFollow: null,
      yidhariTentacleInterval: 13.5,
      yidhariCinemaLevel: 0,
    }
    const state: any = { frontlineTime: 30, backstageTime: 0, exSpecialCount: 0, basicAttackTime: 0 }
    yidhariMechanic.buildExecutions!({ cfg, state, executions } as any)
    expect(executions.map((e: any) => e.moveId)).not.toContain('1051024')
  })

  it('连段定义：单次（溯寒+重碾60闪能）/ 双次（C1连续重碾，重碾count=2共85闪能）', () => {
    const combos = yidhariMechanic.combos!
    expect(combos['yidhari-heavy-single'].moves.map(m => m.moveId)).toEqual(['1051011', '1051012'])
    expect(combos['yidhari-heavy-single'].energyCost).toBe(60)
    expect(combos['yidhari-heavy-double'].moves.map(m => m.moveId)).toEqual(['1051011', '1051012'])
    expect(combos['yidhari-heavy-double'].moves.find(m => m.moveId === '1051012')!.count).toBe(2)
    expect(combos['yidhari-heavy-double'].energyCost).toBe(85)
  })
})

describe('伊德海莉滑块生效差分（防守卫冻结，SOP §3.5：改滑块→结果确实变）', () => {
  it('yidhari.exHealMissingHpPct → 回血总量差分（回血 = 强特数×33%×已损失比例）', () => {
    const state: any = { exSpecialCount: 4, basicAttackTime: 0 }
    const cfg: any = { yidhariStunCount: 0, yidhariExPerStun: 2 }
    const a = computeYidhariHpSource(cfg, state, false, 1)
    const b = computeYidhariHpSource(cfg, state, false, 0.5)
    // exHealPct = 4 × 33% × 比例：1 → 132，0.5 → 66；hpHealPct 差分 = 66
    expect(a.hpHealPct - b.hpHealPct).toBeCloseTo(4 * 33 * 0.5, 1)
    expect(a.hpHealPct).toBeGreaterThan(b.hpHealPct)
    // 烧血喧响随回血同涨：hpBurnPct = 75 + hpHealPct
    expect(a.hpBurnPct - b.hpBurnPct).toBeCloseTo(4 * 33 * 0.5, 1)
  })

  it('yidhari.hpBurnPctPerSecond → 逐秒烧血速率差分（hpBurnPctPerSecond 原样入账本）', () => {
    const state: any = { exSpecialCount: 2, basicAttackTime: 0 }
    const cfg: any = { yidhariStunCount: 0, yidhariExPerStun: 2 }
    const a = computeYidhariHpSource(cfg, state, false, 0.75, 30)
    const b = computeYidhariHpSource(cfg, state, false, 0.75, 15)
    expect(a.hpBurnPctPerSecond).toBe(30)
    expect(b.hpBurnPctPerSecond).toBe(15)
    expect(a.hpBurnPctPerSecond).toBeGreaterThan(b.hpBurnPctPerSecond)
  })

  it('yidhari.exPerStun → 极寒重碾失衡内/外拆分差分', () => {
    const state: any = { exSpecialCount: 6, basicAttackTime: 0 }
    const cfg2: any = { yidhariStunCount: 2, yidhariExPerStun: 2 }
    const cfg3: any = { yidhariStunCount: 2, yidhariExPerStun: 3 }
    const s2 = computeYidhariHpSource(cfg2, state, false)
    const s3 = computeYidhariHpSource(cfg3, state, false)
    // 失衡内 = min(6, exPerStun×2)：2→4（外2），3→6（外0）
    expect(s2.inStunExCount).toBe(4)
    expect(s2.outStunExCount).toBe(2)
    expect(s3.inStunExCount).toBe(6)
    expect(s3.outStunExCount).toBe(0)
  })

  it('yidhari.tentacleInterval → 寒冰触手行次数差分（floor(战斗时间/间隔)）', () => {
    const mk = (interval: number) => {
      const executions: any[] = []
      const cfg: any = {
        panel: { additionalAbilityActive: 1, skillLevelBonus: 0 },
        yidhariChargeSlam: null,
        yidhariBasicFollow: null,
        yidhariTentacleInterval: interval,
        yidhariCinemaLevel: 0,
        battleTime: 180,
        invincibleTime: 0,
      }
      const state: any = { frontlineTime: 180, backstageTime: 0, exSpecialCount: 0, basicAttackTime: 0 }
      yidhariMechanic.buildExecutions!({ cfg, state, executions } as any)
      return executions.find((e: any) => e.moveId === '1051024')?.count ?? 0
    }
    const dense = mk(9)
    const sparse = mk(18)
    expect(dense).toBe(20) // 180/9
    expect(sparse).toBe(10) // 180/18
    expect(dense).toBeGreaterThan(sparse)
  })
})
