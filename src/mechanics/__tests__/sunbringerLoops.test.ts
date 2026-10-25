/**
 * 挽昼（1601）六条资源循环的求解判据（2026-10-25 第二刀）。
 *
 * `solveSunbringerLoops` 是 executions 与测试共用的唯一求解入口（纯函数）：
 * 锐能池 → EX 次数 → 残痕值/层 → 毁伤次数 → 愿力 → 聚锋 → 链齿（长暗终焉）/旗令（终结技 A）→ 愿核。
 * 烬痕在 `patchSunbringerExecutions` 按同一套解结算（见模块注释）。
 */
import { describe, expect, it } from 'vitest'
import {
  solveSunbringerLoops,
  SHARPNESS_INITIAL,
  SHARPNESS_COST_PER_EX,
  GASH_PER_LAYER,
  JU_FENG_WISH_COST,
  WISH_PER_MAIM,
} from '@/mechanics/agents/sunbringer'

const meta = {
  basic: { damagePerSec: 268.7, gashPerSec: 80.3, sharpPerSec: 2.0 },
  ex: { moveId: '1601106', actionTime: 2.5, damage: 1240.5, daze: 743.7, decibel: 0, gash: 200, sharpness: 0 },
  jufeng: { moveId: '1601015', actionTime: 1.367, damage: 1722.5, daze: 226.3, decibel: 0, gash: 0, sharpness: 0 },
  changan: { moveId: '1601107', actionTime: 3.7, damage: 2690.6, daze: 611.7, decibel: 0, gash: 0, sharpness: 0 },
  ultA: { moveId: '1601111', actionTime: 2.883, damage: 3900.1, daze: 476.7, decibel: 0, gash: 0, sharpness: 0 },
  ultB: { moveId: '1601011', actionTime: 4.083, damage: 2827, daze: 674.7, decibel: 0, gash: 0, sharpness: 0 },
  maim: { moveId: '1601114', actionTime: 0, damage: 336.3, daze: 0, decibel: 0, gash: 0, sharpness: 0 },
  chain: { moveId: '1601110', actionTime: 2.466, damage: 1550.3, daze: 407.7, decibel: 0, gash: 197.31, sharpness: 0 },
  sharpnessRegen: 1.5,
} as const

const base = { meta: meta as any, combatTime: 180, basicTime: 90, chainCount: 1, totalDecibel: 6000, ultimateCost: 3000 }

describe('1601 挽昼 · 资源循环求解', () => {
  it('锐能池 = 60 + 1.5/s×接战 + 平A锐能/秒×平A时间；EX = ⌊池/30⌋', () => {
    const r = solveSunbringerLoops(base)
    const expectedPool = SHARPNESS_INITIAL + 1.5 * 180 + 2.0 * 90
    expect(r.sharpPool).toBeCloseTo(expectedPool, 6)
    expect(r.sharpPool).toBeCloseTo(510, 6)
    expect(r.exCount).toBe(Math.floor(expectedPool / SHARPNESS_COST_PER_EX))
    expect(r.exCount).toBe(17)
    expect(r.sharpUsed).toBe(r.exCount * SHARPNESS_COST_PER_EX)
  })

  it('残痕 = 平A秒均×时间 + EX×gash + 连携×gash；层 = ⌊/600⌋；毁伤 = min(层, 3×(EX+连携))', () => {
    const r = solveSunbringerLoops(base)
    const gash = 80.3 * 90 + r.exCount * 200 + 1 * 197.31
    expect(r.gash).toBeCloseTo(gash, 6)
    expect(r.gashLayers).toBe(Math.floor(gash / GASH_PER_LAYER))
    expect(r.maimDemand).toBe(3 * (r.exCount + 1))
    expect(r.maimCount).toBe(Math.min(r.gashLayers, r.maimDemand))
  })

  it('愿力：每层 +40 ⇒ 每 3 层 = 1 次聚锋（120）；链齿 = 聚锋；旗令 → 终结技 A 受喧响可行性封顶', () => {
    const r = solveSunbringerLoops(base)
    expect(r.wishTotal).toBe(r.maimCount * WISH_PER_MAIM)
    expect(r.jufengCount).toBe(Math.floor(r.wishTotal / JU_FENG_WISH_COST))
    expect(r.changanCount).toBeLessThanOrEqual(r.jufengCount)
    expect(r.ultFeasible).toBe(2) // 6000 喧响 / 3000
    expect(r.ultACount).toBe(Math.min(r.jufengCount, 2))
  })

  it('负向：时间为 0 ⇒ 一条都不发（无资源、无行）', () => {
    const r = solveSunbringerLoops({ ...base, combatTime: 0, basicTime: 0, chainCount: 0, totalDecibel: 0 })
    expect(r.exCount).toBe(0)
    expect(r.maimCount).toBe(0)
    expect(r.jufengCount).toBe(0)
    expect(r.changanCount).toBe(0)
    expect(r.ultACount).toBe(0)
  })
})
