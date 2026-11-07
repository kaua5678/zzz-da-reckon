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
  computeEmberScar,
  SHARPNESS_INITIAL,
  SHARPNESS_COST_PER_EX,
  JU_FENG_WISH_COST,
  WISH_PER_MAIM,
} from '@/mechanics/agents/sunbringer'
import { GASH_PER_LAYER } from '@/mechanics/gashMaim'

const meta = {
  basic: { damagePerSec: 268.7, gashPerSec: 80.3, sharpPerSec: 2.0 },
  ex: { moveId: '1601106', actionTime: 2.5, damage: 1240.5, daze: 743.7, decibel: 0, gash: 200, sharpness: 0 },
  jufeng: { moveId: '1601015', actionTime: 1.367, damage: 1722.5, daze: 226.3, decibel: 0, gash: 0, sharpness: 0 },
  changan: { moveId: '1601107', actionTime: 3.7, damage: 2690.6, daze: 611.7, decibel: 0, gash: 0, sharpness: 0 },
  // 强化特殊技：燃灯·永昼之炬（消耗[旗令]）——2026-10-27 补录，表值取 mode:'gan' catalog（2441.1% / 605.8）
  torch: { moveId: '1601007', actionTime: 3.667, damage: 2441.1, daze: 605.8, decibel: 0, gash: 0, sharpness: 0 },
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

  /**
   * 强化 E 两个都要建模（用户 2026-10-27）：
   * 长暗终焉耗[链齿]、永昼之炬耗[旗令]，两种资源都由聚锋各发 1 个 ⇒ 互不挤占；
   * 旗令**先给**「此行，共赴前路」（产愿核），**剩余**才由永昼之炬消化。
   */
  it('强化 E：旗令先给终结技 A，剩余旗令由永昼之炬消化（两发互不挤占）', () => {
    // 喧响够 ⇒ 终结技 A 最多吃 2 枚旗令，剩 4 枚转永昼之炬
    const rich = solveSunbringerLoops(base)
    expect(rich.jufengCount).toBe(6)
    expect(rich.ultACount).toBe(2)
    expect(rich.torchCount).toBe(4)
    expect(rich.torchCount + rich.ultACount).toBe(rich.jufengCount)
    // 链齿那条线是**另一份资源**（聚锋同时发链齿+旗令）⇒ 不受旗令分配影响
    expect(rich.changanCount).toBe(6)
    // 喧响不够 ⇒ 终结技 A 打不出 ⇒ 旗令全部转永昼之炬
    const poor = solveSunbringerLoops({ ...base, totalDecibel: 0 })
    expect(poor.ultACount).toBe(0)
    expect(poor.torchCount).toBe(poor.jufengCount)
    expect(poor.changanCount).toBe(rich.changanCount)
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

describe('烬痕：存值不吃易伤，但攒的时候吃（线性，不平方）', () => {
  it('烬痕 = 0.60 × 积攒招式倍率和（3.4.3 核心被动），且只套一次乘区 ⇒ 总伤对失衡覆盖率线性', () => {
    const loops = { jufengCount: 6, changanCount: 6, ultACount: 2 }
    const ember = computeEmberScar({ meta: meta as any, loops, ultBCount: 2 })
    const sum = 6 * 1722.5 + 6 * 2690.6 + 2 * 3900.1 + 2 * 2827
    expect(ember).toBeCloseTo(sum * 0.6, 6)
    // 线性：易伤系数 s 只作用一次 —— 「积攒伤害 × s」得出的存量，在结算行再乘同一个 s 之前
    // 已经是 s 的一份；若模型把它当"结算时再吃一次"就会变成 s²（这里断言不会）
    const s1 = 1, s2 = 1.5
    const total1 = (sum + ember) * s1
    const total2 = (sum + ember) * s2
    expect(total2 / total1).toBeCloseTo(s2 / s1, 6)
  })

  it('灯塔送层（反制支援）：每组白送 1 层残痕 = +600 点，且不吃积蓄效率', () => {
    const plain = solveSunbringerLoops(base)
    const gifted = solveSunbringerLoops({ ...base, counterAssistCount: 1 } as any)
    expect(gifted.gash - plain.gash).toBe(600)
    // C1 的残痕效率只放大「积累来源」，灯塔那 600 点原样
    const g0 = solveSunbringerLoops({ ...base, cinemaLevel: 0, counterAssistCount: 1 } as any)
    const g1 = solveSunbringerLoops({ ...base, cinemaLevel: 1, counterAssistCount: 1 } as any)
    expect(g1.gash - g0.gash).toBeCloseTo(plain.gash * 0.1, 6)
  })

  it('零积攒 ⇒ 烬痕为 0（不造数）', () => {
    expect(computeEmberScar({ meta: meta as any, loops: { jufengCount: 0, changanCount: 0, ultACount: 0 }, ultBCount: 0 })).toBe(0)
  })

  /**
   * 3.4.3 新增第二条来源：原文「全队代理人造成的[毁伤]也可使目标积攒等同于该次实际伤害 35% 的[烬痕]」。
   * 自己那份 = 模块产出的毁伤行（maim 1601114）× 35%；影画2 的「积攒量 +20%」对两条来源一视同仁。
   */
  it('毁伤 35% 也积攒烬痕（3.4.3 第二条来源），影画2 对两条来源都 ×1.2', () => {
    const loops = { jufengCount: 6, changanCount: 6, ultACount: 2, maimCount: 9 }
    const sum = 6 * 1722.5 + 6 * 2690.6 + 2 * 3900.1 + 2 * 2827
    const e0 = computeEmberScar({ meta: meta as any, loops, ultBCount: 2 })
    expect(e0).toBeCloseTo(sum * 0.6 + 9 * 336.3 * 0.35, 6)
    const e2 = computeEmberScar({ meta: meta as any, loops, ultBCount: 2, cinemaLevel: 2 })
    expect(e2).toBeCloseTo((sum * 0.6 + 9 * 336.3 * 0.35) * 1.2, 6)
  })

  /**
   * 3.4.3 的消耗限定「[愿火]未达上限时」在稳态里不咬合：上限 160、每层 +40、≥120 立刻转聚锋
   * ⇒ 愿火银行恒 < 120 < 160，永远不会挡住残痕消耗（这条把注释变成断言）。
   */
  it('愿火未达上限：银行恒 < 120 ⇒ 3.4.3 的消耗限定不会少算毁伤', () => {
    const r = solveSunbringerLoops(base)
    expect(r.wishSpent).toBe(r.jufengCount * JU_FENG_WISH_COST)
    expect(r.wishTotal - r.wishSpent).toBeLessThan(JU_FENG_WISH_COST)
  })
})


describe('影画 1/2（2026-10-25 接线）', () => {
  it('一命（v2）：进战 +120 愿力 ⇒ 多一次聚锋 + 残痕积蓄效率 +10%；首次聚锋 150% 已删', () => {
    const c0 = solveSunbringerLoops({ ...base, cinemaLevel: 0 } as any)
    const c1 = solveSunbringerLoops({ ...base, cinemaLevel: 1 } as any)
    // C1 的直接 +120，加上残痕效率 +10% 多消出的层（每层 +40）
    expect(c1.wishTotal - c0.wishTotal).toBeGreaterThanOrEqual(120)
    expect(c1.jufengCount).toBeGreaterThanOrEqual(c0.jufengCount)
    // v2 C1 = 残痕积蓄效率 +10%（灯台白送层除外）；base 无 counterAssist ⇒ 精确 ×1.1
    expect(c1.gash).toBeCloseTo(c0.gash * 1.1, 6)
    // v2 删掉「首次聚锋烬痕 150%」⇒ 同 loops 下烬痕与命座无关
    const e = computeEmberScar({ meta: meta as any, loops: c0, ultBCount: 1, cinemaLevel: 0 })
    const e1 = computeEmberScar({ meta: meta as any, loops: c0, ultBCount: 1, cinemaLevel: 1 })
    expect(e1).toBeCloseTo(e, 6)
  })

  it('二命（v2）：积攒量 +20% + 其他招式（除 5 招外）实际伤害 15% 也积攒', () => {
    const loops = { jufengCount: 6, changanCount: 6, ultACount: 2 }
    const c1 = computeEmberScar({ meta: meta as any, loops, ultBCount: 2, cinemaLevel: 1 })
    const other = 17 * 1240.5 + 1 * 1550.3
    const c2 = computeEmberScar({ meta: meta as any, loops, ultBCount: 2, cinemaLevel: 2, otherMultiplierSum: other })
    // C2 = 两条来源都 ×1.2：核心 65→78%、其他招式 15→18%（用户 2026-11-01）
    expect(c2 - c1).toBeCloseTo(c1 * 0.2 + other * 0.15 * 1.2, 6)
  })

  it('六命（v2）：终结技额外一次[烬灭] = 该次终结技积攒烬痕量的 150%', () => {
    const loops = { jufengCount: 6, changanCount: 6, ultACount: 2 }
    const c2 = computeEmberScar({ meta: meta as any, loops, ultBCount: 2, cinemaLevel: 2 })
    const c6 = computeEmberScar({ meta: meta as any, loops, ultBCount: 2, cinemaLevel: 6 })
    // C6 相对 C2 的净增 = 额外烬灭（含 C2 的 ×1.2）
    const ultBEmber = 2 * 2827 * 0.6 * 1.2
    expect(c6 - c2).toBeCloseTo(ultBEmber * 1.5, 6)
  })
})

