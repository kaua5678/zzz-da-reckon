/**
 * computeParrySplit 单测：Boss 预设弹刀拆分（击破位按保底失衡反推、主C 拿剩余；无突击弹刀全归击破位）。
 */
import { describe, expect, it } from 'vitest'
import { computeParrySplit } from '@/core/parrySplit'

/** 叶释渊 口径：保底4失衡、弹刀总数 13；nonParryStun = 非弹刀失衡基数（已剔除击破位弹刀行贡献） */
function base(overrides: Partial<Parameters<typeof computeParrySplit>[0]> = {}) {
  return computeParrySplit({
    targetStunCount: 4,
    stunCount: 2,
    nonParryStun: 50000,
    bossStunValue: 14000,
    stunRefundRatio: 0,
    perParryDaze: 1000,
    perNoFollowUpDaze: 400,
    parryTotal: 13,
    parryNoFollowUpTotal: 0,
    breakerInput: 0,
    mainDpsInput: 0,
    ...overrides,
  })
}

describe('computeParrySplit（Boss 弹刀反推拆分）', () => {
  it('已达保底失衡 → 不补齐，主C 拿剩余', () => {
    const r = base({ stunCount: 4, nonParryStun: 70000 })
    expect(r.topUp).toBe(0)
    expect(r.breakerParry).toBe(0)
    expect(r.mainDpsParry).toBe(13)
    expect(r.reached).toBe(true)
  })

  it('缺口按非弹刀基数反推（ceil），主C = 总数 − 击破位', () => {
    // 需要 4×14000 = 56000，非弹刀 50000 → 缺口 6000，每次弹刀 1000 → 击破位需 6 次
    const r = base({ stunCount: 2, nonParryStun: 50000 })
    expect(r.topUp).toBe(6)
    expect(r.breakerParry).toBe(6)
    expect(r.mainDpsParry).toBe(7)
    expect(r.reached).toBe(false)
  })

  it('尊重击破位用户输入：输入 ≥ 需求 → 不补齐；输入 < 需求 → 补到需求', () => {
    const r1 = base({ breakerInput: 3, nonParryStun: 50000 })
    expect(r1.topUp).toBe(3)
    expect(r1.breakerParry).toBe(6)
    expect(r1.mainDpsParry).toBe(7)
    const r2 = base({ breakerInput: 8, nonParryStun: 50000 })
    expect(r2.topUp).toBe(0)
    expect(r2.breakerParry).toBe(8)
    expect(r2.mainDpsParry).toBe(5)
  })

  it('主C 用户已填 >0 → 不覆盖（用户值优先于默认拆分）', () => {
    const r = base({ mainDpsInput: 9, nonParryStun: 50000 })
    expect(r.breakerParry).toBe(6)
    expect(r.mainDpsParry).toBe(9)
  })

  it('失衡值返还（雨果决算）后每条更便宜', () => {
    // 返还 25%：需要 = 14000 + 3×14000×0.75 = 45500；非弹刀 43000 → 缺口 2500 → 需 3 次
    const r = base({ stunRefundRatio: 0.25, nonParryStun: 43000 })
    expect(r.topUp).toBe(3)
    expect(r.breakerParry).toBe(3)
    expect(r.mainDpsParry).toBe(10)
  })

  it('击破位无招架失衡来源（perParryDaze ≤ 0）→ 无法反推，不补齐', () => {
    const r = base({ perParryDaze: 0, nonParryStun: 30000 })
    expect(r.topUp).toBe(0)
    expect(r.breakerParry).toBe(0)
    expect(r.mainDpsParry).toBe(13)
  })

  it('缺口巨大 → 击破位封顶 parryTotal，主C 归 0', () => {
    const r = base({ nonParryStun: 10000, perParryDaze: 200 })
    expect(r.topUp).toBe(13)
    expect(r.breakerParry).toBe(13)
    expect(r.mainDpsParry).toBe(0)
  })

  it('parryTotal = 0（未声明正常弹刀）→ 正常拆分全 0', () => {
    const r = base({ parryTotal: 0 })
    expect(r.breakerParry).toBe(0)
    expect(r.mainDpsParry).toBe(0)
    expect(r.topUp).toBe(0)
  })

  it('不带支援突击弹刀：全部归击破位，其失衡值先从缺口扣掉', () => {
    // 司祭型：15 无突击（每次 400）、0 正常；非弹刀 40000 → 缺口 16000 − 15×400 = 10000 → 正常弹刀 0
    const r = base({ parryTotal: 0, parryNoFollowUpTotal: 15, perNoFollowUpDaze: 400, nonParryStun: 40000 })
    expect(r.breakerNoFollowUp).toBe(15)
    expect(r.mainDpsNoFollowUp).toBe(0)
    // 无突击 daze 15×400=6000 已覆盖，剩余缺口 10000 > 0 但正常弹刀池为 0 → 正常补 0
    expect(r.breakerParry).toBe(0)
    expect(r.mainDpsParry).toBe(0)
  })

  it('无突击弹刀 daze 覆盖部分缺口 → 正常弹刀反推量减少', () => {
    // 需要 56000；非弹刀 48000；无突击 10×400=4000 → 剩余缺口 4000 → 正常补 4 次
    const r = base({ parryTotal: 13, parryNoFollowUpTotal: 10, perNoFollowUpDaze: 400, nonParryStun: 48000 })
    expect(r.breakerNoFollowUp).toBe(10)
    expect(r.breakerParry).toBe(4)
    expect(r.mainDpsParry).toBe(9)
  })

  it('T 只依赖非弹刀基数（与当前注入量无关）→ 轮间单调收敛不振荡', () => {
    const a = base({ nonParryStun: 50000 })
    const b = base({ nonParryStun: 50000 })
    expect(a).toEqual(b)
    expect(a.topUp).toBe(6)
  })
})
