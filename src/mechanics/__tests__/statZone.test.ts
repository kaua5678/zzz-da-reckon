/**
 * 属性乘区写入口的判据（用户 2026-11-06 口径）。
 *
 * 「一切属性都是在自己的乘区影响总属性」⇒ 「自身攻击力 +25%」必须兑现成
 * `局外总攻击 × 25%` 的**增量**，而不是拿当前局内面板整体乘。
 *
 * 本文件锁三件事：
 * ① 三种写法对拍：本函数 == 「局外 × (1+pct) + 局内固定」的理论值；
 *    `panel.atk *= (1+pct)` 与 `applyStat(panel,'atkPct',pct)` 都必须**偏离**（否则本判据是空断言）；
 * ② 加进乘区的量写回 `inCombatAtkPct`（属性账可读），且不改其它字段；
 * ③ 幂等/可加：连续调两次 == 一次调 2×pct（同基数，不滚雪球）。
 */
import { describe, expect, it } from 'vitest'
import { applyInCombatPct } from '@/mechanics/statZone'
import { applyStat, finalizeCoreStatBonuses } from '@/core/buff'
import type { PanelValues } from '@/types/catalog'

/** 只造本判据用到的字段（PanelValues 其余字段不参与本算式） */
function panelWith(atk: number, impact = 0): PanelValues {
  return { atk, impact } as unknown as PanelValues
}

describe('属性乘区：applyInCombatPct', () => {
  // 实测夹具（1591 / 丽娜 / 空槽）：局外 atk 1535.67、局内 2490.87 ⇒ 局内固定 955.20
  const OOC = 1535.67
  const INC = 2490.87
  const FLAT = INC - OOC

  it('① 与「局外 × (1+pct) + 局内固定」逐位一致；两条错路都必须偏离', () => {
    const panel = panelWith(INC)
    const delta = applyInCombatPct(panel, { atk: OOC }, 'atk', 25)
    const truth = OOC * 1.25 + FLAT
    expect(panel.atk).toBeCloseTo(truth, 9)
    expect(delta).toBeCloseTo(OOC * 0.25, 9)

    // 反证 1：整体乘（sigrid 原实现）
    const mult = panelWith(INC)
    mult.atk = Math.round(mult.atk * 1.25)
    expect(mult.atk - truth).toBeGreaterThan(200) // 实测 ≈ +239

    // 反证 2：applyStat 通道（看起来对，实际同样以局内为基数）
    const viaStat = panelWith(INC)
    finalizeCoreStatBonuses(viaStat)
    applyStat(viaStat, 'atkPct', 25, 'pct')
    expect(viaStat.atk - truth).toBeGreaterThan(200)
  })

  it('② 乘区输入写回 inCombatAtkPct（属性账可读），其它字段不动', () => {
    const panel = panelWith(INC, 93)
    applyInCombatPct(panel, { atk: OOC }, 'atk', 25)
    expect((panel as unknown as Record<string, number>).inCombatAtkPct).toBeCloseTo(25, 9)
    expect(panel.impact).toBe(93)
  })

  it('②b 可累加：同一面板再加 10% ⇒ 输入键 35、面板再涨 10% 的局外量', () => {
    const panel = panelWith(INC)
    applyInCombatPct(panel, { atk: OOC }, 'atk', 25)
    const after25 = panel.atk
    applyInCombatPct(panel, { atk: OOC }, 'atk', 10)
    expect(panel.atk - after25).toBeCloseTo(OOC * 0.10, 9)
    expect((panel as unknown as Record<string, number>).inCombatAtkPct).toBeCloseTo(35, 9)
  })

  it('③ 缺局外面板 / pct=0 ⇒ 返回 0 且面板不变（不猜基数）', () => {
    const a = panelWith(INC)
    expect(applyInCombatPct(a, null, 'atk', 25)).toBe(0)
    expect(a.atk).toBe(INC)
    const b = panelWith(INC)
    expect(applyInCombatPct(b, { atk: OOC }, 'atk', 0)).toBe(0)
    expect(b.atk).toBe(INC)
  })

  it('④ 冲击力同式（莱卡恩/莱特走同一乘区）', () => {
    const panel = panelWith(1000, 120)
    applyInCombatPct(panel, { impact: 100 }, 'impact', 15)
    expect(panel.impact).toBeCloseTo(135, 9) // 100×1.15 + (120-100)
    expect((panel as unknown as Record<string, number>).inCombatImpactPct).toBeCloseTo(15, 9)
  })
})
