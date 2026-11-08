/**
 * 挽昼（1601）3.4.3 新增的**[招架支援]残痕**——数据钉值 + 生效判据（2026-11-08 批 3）。
 *
 * 原文：「德蕾琪娜成功招架敌人的攻击时，可为敌人积累残痕值」。
 * 数值不在 catalog 的 1601201/2/3 行（gash 全空），而在 gachabase 的 1601206/7/8
 * （animator_event = ParryAid_L/H/…，轻/重/连续），gash_buildup 5664/9914/9914 ⇒ /100。
 *
 * 本文件锁四件事：
 * ① **钉值**：模块常量与 data/raw/gachabase/1601.json 逐位对拍（raw 一变测试就红）；
 * ② **档位由引擎选**：不同 defensiveAssistMoveId 取不同点数，未选中档 = 0；
 * ③ **吃影画1 的 ×1.1 积蓄效率**，且与 basic/ex/chain **在同一处乘**（与灯塔白送层对照负控）；
 * ④ **次数 = parryCount**，且这一项真能把残痕值推过 600 点一档（端到端生效）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  solveSunbringerLoops,
  SUNBRINGER_PARRY_GASH_BY_ASSIST_MOVE_ID,
  SUNBRINGER_C1_GASH_EFFICIENCY,
} from '@/mechanics/agents/sunbringer'
import { GASH_PER_LAYER } from '@/mechanics/gashMaim'

const gachabase = JSON.parse(
  readFileSync(new URL('../../../data/raw/gachabase/1601.json', import.meta.url), 'utf8'),
) as { skill_data: Array<{ id: number, gash_buildup: number }> }
const rawGash = (id: number) => (gachabase.skill_data.find(r => Number(r.id) === id)?.gash_buildup ?? 0) / 100

const meta = {
  basic: { damagePerSec: 268.7, gashPerSec: 80.3, sharpPerSec: 2.0 },
  ex: { moveId: '1601106', actionTime: 2.5, damage: 1240.5, daze: 743.7, decibel: 0, gash: 200, sharpness: 0 },
  jufeng: { moveId: '1601015', actionTime: 1.367, damage: 1722.5, daze: 226.3, decibel: 0, gash: 0, sharpness: 0 },
  changan: { moveId: '1601107', actionTime: 3.7, damage: 2690.6, daze: 611.7, decibel: 0, gash: 0, sharpness: 0 },
  torch: { moveId: '1601007', actionTime: 3.667, damage: 2441.1, daze: 605.8, decibel: 0, gash: 0, sharpness: 0 },
  ultA: { moveId: '1601111', actionTime: 2.883, damage: 3900.1, daze: 476.7, decibel: 0, gash: 0, sharpness: 0 },
  ultB: { moveId: '1601011', actionTime: 4.083, damage: 2827, daze: 674.7, decibel: 0, gash: 0, sharpness: 0 },
  maim: { moveId: '1601114', actionTime: 0, damage: 336.3, daze: 0, decibel: 0, gash: 0, sharpness: 0 },
  chain: { moveId: '1601110', actionTime: 2.466, damage: 1550.3, daze: 407.7, decibel: 0, gash: 197.31, sharpness: 0 },
  sharpnessRegen: 1.5,
} as const

const base = {
  meta: meta as any,
  combatTime: 180,
  basicTime: 90,
  chainCount: 1,
  totalDecibel: 6000,
  ultimateCost: 3000,
}

describe('1601 招架支援残痕（3.4.3）', () => {
  it('① 钉值：模块常量与 gachabase raw 逐位一致（1601206/7/8 ÷100）', () => {
    expect(SUNBRINGER_PARRY_GASH_BY_ASSIST_MOVE_ID['1601201']).toBe(rawGash(1601206))
    expect(SUNBRINGER_PARRY_GASH_BY_ASSIST_MOVE_ID['1601202']).toBe(rawGash(1601207))
    expect(SUNBRINGER_PARRY_GASH_BY_ASSIST_MOVE_ID['1601203']).toBe(rawGash(1601208))
    // 反空洞：raw 里这三行必须真有非零 gash（否则上面的等式退化成 0 === 0）
    expect(rawGash(1601206), '轻招架 raw 必须非 0').toBeGreaterThan(0)
    expect(rawGash(1601207), '重招架 raw 必须非 0').toBeGreaterThan(0)
    expect(rawGash(1601206)).toBeCloseTo(56.64, 6)
    expect(rawGash(1601207)).toBeCloseTo(99.14, 6)
  })

  it('② 档位由引擎选：轻 56.64 / 重 99.14 / 未选中 0', () => {
    const light = solveSunbringerLoops({ ...base, parryCount: 3, defensiveAssistMoveId: '1601201' })
    const heavy = solveSunbringerLoops({ ...base, parryCount: 3, defensiveAssistMoveId: '1601202' })
    const none = solveSunbringerLoops({ ...base, parryCount: 3, defensiveAssistMoveId: '' })
    expect(light.parryGashPerCast).toBeCloseTo(56.64, 6)
    expect(light.parryGash).toBeCloseTo(3 * 56.64, 6)
    expect(heavy.parryGash).toBeCloseTo(3 * 99.14, 6)
    expect(none.parryGash, '未选中任何招架档 ⇒ 0').toBe(0)
  })

  it('③ 吃影画1 ×1.1，且与 basic/ex/chain 同一处乘（灯塔白送层不吃）', () => {
    // C1 的 ×1.1 作用于**整条积累括号**（basic + ex + chain + 招架），不是只乘招架。
    // 「招架在括号里」的判据：把它拿掉后算出的基线 A0，满足 (A0 + 招架) × 1.1 − A0 = 括号×0.1。
    const noParryC0 = solveSunbringerLoops({ ...base, parryCount: 0, defensiveAssistMoveId: '1601201' })
    const c0 = solveSunbringerLoops({ ...base, parryCount: 4, defensiveAssistMoveId: '1601201' })
    const c1 = solveSunbringerLoops({ ...base, cinemaLevel: 1, parryCount: 4, defensiveAssistMoveId: '1601201' })
    const parryPart = 4 * 56.64
    // ① 招架确实进了括号：差分 = (基线 + 招架) × (1.1 − 1)
    expect(c1.gash - c0.gash).toBeCloseTo((noParryC0.gash + parryPart) * (SUNBRINGER_C1_GASH_EFFICIENCY - 1), 6)
    // ② 负控：若招架被写在乘法**外面**，差分只会是基线 × 0.1 ⇒ 与实测差出 parryPart × 0.1
    const ifOutside = noParryC0.gash * (SUNBRINGER_C1_GASH_EFFICIENCY - 1)
    expect(Math.abs((c1.gash - c0.gash) - ifOutside), '证明不是写在乘法外面').toBeGreaterThan(parryPart * 0.09)
    // 对照负控：灯塔白送层**不吃**效率 ⇒ 在同一命座下，每多一组只 +600（不被 ×1.1 放大）。
    // （不能拿 C0/C1 的绝对值相减：C1 会同时放大 basic/ex/chain，那不是验证白送层。）
    for (const cinemaLevel of [0, 1]) {
      const g0 = solveSunbringerLoops({ ...base, cinemaLevel, counterAssistCount: 0 })
      const g2 = solveSunbringerLoops({ ...base, cinemaLevel, counterAssistCount: 2 })
      expect(g2.gash - g0.gash, `C${cinemaLevel}: 2 组白送 = 1200 点，不吃效率`).toBeCloseTo(2 * GASH_PER_LAYER, 6)
    }
  })

  it('④ 端到端：招架多到跨过 600 一档，层数跟着涨', () => {
    const noParry = solveSunbringerLoops({ ...base, parryCount: 0, defensiveAssistMoveId: '1601201' })
    const manyParry = solveSunbringerLoops({ ...base, parryCount: 20, defensiveAssistMoveId: '1601201' })
    expect(manyParry.gash - noParry.gash).toBeCloseTo(20 * 56.64, 6)
    expect(manyParry.gashLayers).toBeGreaterThan(noParry.gashLayers)
    expect(manyParry.gashLayers).toBe(Math.floor(manyParry.gash / GASH_PER_LAYER))
  })

  it('次数口径 = parryCount（小数 floor，负数记 0）', () => {
    const frac = solveSunbringerLoops({ ...base, parryCount: 2.9, defensiveAssistMoveId: '1601201' })
    expect(frac.parryGash).toBeCloseTo(2 * 56.64, 6)
    const neg = solveSunbringerLoops({ ...base, parryCount: -5, defensiveAssistMoveId: '1601201' })
    expect(neg.parryGash).toBe(0)
  })
})
