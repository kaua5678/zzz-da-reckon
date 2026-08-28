/**
 * 洛克茜(1621) 录入生效测试（v4 影画）：
 * - 影画1 全抗-15% + 自身暴伤+40% 进面板；
 * - 影画4 招架/闪反回能 + 终结技伤害+20%；
 * - 影画6 无视20%风抗 + 巨型风旋倍率×2.5；
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
  roxyMechanic,
} from '@/mechanics/agents/roxy'

describe('洛克茜（1621）v4 影画', () => {
  it('影画1/2/6 面板：全抗-15%、暴伤+40%、失衡易伤+25%、无视风抗20%', () => {
    const p0: any = { critDmg: 50, enemyResReduction: 0, stunDmgMultiplierBonus: 0, enemyWindResReduction: 0 }
    roxyMechanic.applyPanel!({ cinemaLevel: 0, panel: p0, settings: {} } as any)
    expect(p0.critDmg).toBeCloseTo(50)
    expect(p0.enemyResReduction).toBeCloseTo(0)

    const p6: any = { critDmg: 50, enemyResReduction: 0, stunDmgMultiplierBonus: 0, enemyWindResReduction: 0 }
    roxyMechanic.applyPanel!({ cinemaLevel: 6, panel: p6, settings: {} } as any)
    expect(p6.critDmg).toBeCloseTo(50 + ROXY_C1_CRIT_DMG)
    expect(p6.enemyResReduction).toBeCloseTo(ROXY_C1_RES_REDUCTION)
    expect(p6.stunDmgMultiplierBonus).toBeCloseTo(25)
    expect(p6.enemyWindResReduction).toBeCloseTo(ROXY_C6_WIND_RES_REDUCTION)
  })

  it('影画4 回能（招架1 + 闪反2/次）并入 initialEnergyGift', () => {
    const cfg: any = { initialEnergyGift: 40, parryCount: 6, dodgeCounterCount: 10 }
    roxyMechanic.buildCharConfig!({ cinemaLevel: 4, cfg, skills: { categories: [] } as any, getRowValue: () => 0 } as any)
    expect(cfg.initialEnergyGift).toBeCloseTo(40 + 6 * ROXY_C4_PARRY_ENERGY + 10 * ROXY_C4_DODGE_ENERGY)
  })

  it('影画4 终结技 dmgBonus+20；影画6 巨型风旋倍率×2.5', () => {
    const execs: any[] = [
      { moveId: '1621014', dmgBonus: 0 },
      { moveId: '1621006', damageMultiplier: 100, damageMultiplierOverride: false },
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
