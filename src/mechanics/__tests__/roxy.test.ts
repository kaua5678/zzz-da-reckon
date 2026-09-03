/**
 * 洛克茜(1621) 录入生效测试（v12，2026-09-03）：
 * - 影画1 全抗-15% + 自身暴伤+40% 进面板；影画2 失衡易伤+30%（v12：旧 25% → 30%）；影画6 无视15%风抗；
 * - 影画4 招架/闪反回能 + 终结技伤害+20%；
 * - 影画6 巨旋风（1621020）倍率×2.5；
 * - C6 全管线伤害 > C0（命座有效性）。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import {
  ROXY_C1_CRIT_DMG,
  ROXY_C1_RES_REDUCTION,
  ROXY_C4_PARRY_ENERGY,
  ROXY_C4_DODGE_ENERGY,
  ROXY_C4_ULT_DMG,
  ROXY_C6_WIND_RES_REDUCTION,
  ROXY_C6_MEGA_TORNADO_MULT,
  ENERGY_PER_WIND_ENERGY,
  computeRoxyWindEnergy,
  roxyMechanic,
} from '@/mechanics/agents/roxy'

describe('洛克茜（1621）v4 影画', () => {
  it('影画1/2/6 面板：全抗-15%、暴伤+40%、失衡易伤+30%、无视风抗15%', () => {
    const p0: any = { critDmg: 50, enemyResReduction: 0, stunDmgMultiplierBonus: 0, enemyWindResReduction: 0 }
    roxyMechanic.applyPanel!({ cinemaLevel: 0, panel: p0, settings: {} } as any)
    expect(p0.critDmg).toBeCloseTo(50)
    expect(p0.enemyResReduction).toBeCloseTo(0)

    const p6: any = { critDmg: 50, enemyResReduction: 0, stunDmgMultiplierBonus: 0, enemyWindResReduction: 0 }
    roxyMechanic.applyPanel!({ cinemaLevel: 6, panel: p6, settings: {} } as any)
    expect(p6.critDmg).toBeCloseTo(50 + ROXY_C1_CRIT_DMG)
    expect(p6.enemyResReduction).toBeCloseTo(ROXY_C1_RES_REDUCTION)
    expect(p6.stunDmgMultiplierBonus).toBeCloseTo(30)
    expect(p6.enemyWindResReduction).toBeCloseTo(ROXY_C6_WIND_RES_REDUCTION)
  })

  it('影画4 回能（招架1 + 闪反2/次）并入 initialEnergyGift（另含额外能力进场 40）', () => {
    const cfg: any = { initialEnergyGift: 40, parryCount: 6, dodgeCounterCount: 10 }
    roxyMechanic.buildCharConfig!({ cinemaLevel: 4, cfg, skills: { categories: [] } as any, getRowValue: () => 0 } as any)
    // 额外能力·辉金心脏：进场 +40（勘域 180s 一次）
    expect(cfg.initialEnergyGift).toBeCloseTo(40 + 6 * ROXY_C4_PARRY_ENERGY + 10 * ROXY_C4_DODGE_ENERGY + 40)
  })

  it('影画4 终结技 dmgBonus+20；影画6 巨型风旋倍率×2.5', () => {
    const execs: any[] = [
      { moveId: '1621012', dmgBonus: 0 },
      { moveId: '1621020', damageMultiplier: 100, damageMultiplierOverride: false },
      { moveId: '1621005', dmgBonus: 0 },
    ]
    roxyMechanic.patchExecutions!({ cfg: { roxyCinemaLevel: 6 }, state: {} as any, executions: execs } as any)
    expect(execs[0].dmgBonus).toBe(ROXY_C4_ULT_DMG)
    expect(execs[1].damageMultiplier).toBeCloseTo(100 * ROXY_C6_MEGA_TORNADO_MULT)
    expect(execs[1].damageMultiplierOverride).toBe(true)
    expect(execs[2].dmgBonus).toBe(0)
  })

  it('C6 全管线伤害 > C0（命座有效性）', async () => {
    const { config } = await setupHarness([{ agentId: '1621', cinemaLevel: 0 }, '', ''])
    const calc = useResourceCalc()
    const d0 = calc.teamTotalDamage.value
    expect(d0).toBeGreaterThan(0)
    config.team[0].cinemaLevel = 6
    const d6 = calc.teamTotalDamage.value
    expect(d6).toBeGreaterThan(d0)
  })
})

describe('洛克茜风能模型（v12 + 手法）', () => {
  it('手法：每轮强特攒满 3 风能（自旋 2.5s → 75 能量）→ 敬请安息消耗 3 → 恕不远送 1 次巨旋风', () => {
    const r = computeRoxyWindEnergy({ exSpecialCount: 2, ultimateCount: 0, spinSeconds: 2.5 })
    expect(ENERGY_PER_WIND_ENERGY).toBe(25)
    // 每轮 10 启动 + 75 自旋 = 85；风能 = 每轮 3（floor(85/25)=3）
    expect(r.windEnergyGain).toBe(6)
    expect(r.windEnergyConsumed).toBe(6)
    expect(r.sendOffCount).toBe(2)
    expect(r.megaTornadoCount).toBe(2)
    expect(r.miniTornadoCount).toBe(0) // 3/轮手法无余数
    expect(r.windEyeGenerated).toBe(6)
    expect(r.energySpentTotal).toBe(2 * (10 + 2.5 * 30))
  })

  it('终结技 +1 风能：消耗仍按每轮 3 封顶，结余 1 点不超存量上限', () => {
    const r = computeRoxyWindEnergy({ exSpecialCount: 1, ultimateCount: 1, spinSeconds: 2.5 })
    expect(r.windEnergyGain).toBe(4)
    expect(r.windEnergyConsumed).toBe(3)
    expect(r.sendOffCount).toBe(1)
    expect(r.megaTornadoCount).toBe(1)
  })

  it('风能不足 3 点：不触发恕不远送巨旋风（仅小旋风 1s/个，兜底口径）', () => {
    const r = computeRoxyWindEnergy({ exSpecialCount: 1, spinSeconds: 1 })
    // 1s 自旋：10 + 30 = 40 能量 → 1 风能
    expect(r.windEnergyGain).toBe(1)
    expect(r.windEnergyConsumed).toBe(1)
    expect(r.sendOffCount).toBe(0)
    expect(r.miniTornadoCount).toBe(1)
    expect(r.miniTornadoSeconds).toBe(1)
  })
})
