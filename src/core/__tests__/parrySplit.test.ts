/**
 * computeParrySplit 单测：Boss 预设弹刀拆分（击破位按保底失衡反推、主C 拿剩余；无突击弹刀全归击破位）。
 */
import { describe, expect, it } from 'vitest'
import { computeParrySplit, guaranteeStunShortfall } from '@/core/parrySplit'

/** 叶释渊 口径：失衡次数四舍五入、弹刀总数 13；nonParryStun = 非弹刀失衡基数（已剔除击破位弹刀行贡献） */
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
  })

  it('缺口按非弹刀基数反推（ceil），主C = 总数 − 击破位', () => {
    // 需要 4×14000 = 56000，非弹刀 50000 → 缺口 6000，每次弹刀 1000 → 击破位需 6 次
    const r = base({ stunCount: 2, nonParryStun: 50000 })
    expect(r.topUp).toBe(6)
    expect(r.breakerParry).toBe(6)
    expect(r.mainDpsParry).toBe(7)
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

  it('缺口巨大 → 尽力而为照旧封顶 parryTotal（四舍五入不改变「尽量补」）', () => {
    // 本用例原名「缺口巨大 → 击破位封顶 parryTotal，主C 归 0」。用户裁决 2026-10-11 改四舍五入后，
    // **这条断言逐位不变**——这正是「四舍五入」与「放弃硬凑」的差别所在：
    // 四舍五入作用在**取整那一步**（只削掉余量 < 半刀的那一次），缺口再大也照样尽力补满。
    // ⚠ 初版实现曾把判据写成「缺口 > 半格 ⇒ 补 0」，本用例当即变红（expected 13 to be 0）——
    // 那会让「离目标还有 9.9 刀」的队一刀都不补，与尽力而为相悖，已否决（见 roundedParryCount 头注释）。
    const r = base({ nonParryStun: 10000, perParryDaze: 200 })
    expect(r.topUp, '缺口巨大 ⇒ 仍尽力补满（封顶 parryTotal）').toBe(13)
    expect(r.breakerParry).toBe(13)
    expect(r.mainDpsParry).toBe(0)
  })

  it('四舍五入的判别力：余量 < 半刀 ⇒ 少补一次；≥ 半刀 ⇒ 补满', () => {
    // 口径 = 对补的次数取整：round(缺口 / 每刀失衡)，与喧响侧的「半格」同构。
    // 夹具：缺口 = 2.4 刀 ⇒ ceil 3 / round 2（少补 1 次）；缺口 = 2.5 刀 ⇒ round 3（补齐，边界进一）。
    // 旧 ceil 与 round 的差仅 1 次——这正是「硬向上取很难」的那一次，不再硬塞。
    const below = base({ nonParryStun: 56000 - 2400, perParryDaze: 1000 })
    expect(below.topUp, '缺口 2.4 刀 ⇒ round 2（ceil 会给 3）').toBe(2)
    const atHalf = base({ nonParryStun: 56000 - 2500, perParryDaze: 1000 })
    expect(atHalf.topUp, '缺口恰 2.5 刀 ⇒ round 3（半刀进一）').toBe(3)
    const whole = base({ nonParryStun: 56000 - 3000, perParryDaze: 1000 })
    expect(whole.topUp, '缺口整 3 刀 ⇒ 3（无取整损失）').toBe(3)
  })

  it('parryTotal = 0（未声明正常弹刀）→ 正常拆分全 0', () => {
    const r = base({ parryTotal: 0 })
    expect(r.breakerParry).toBe(0)
    expect(r.mainDpsParry).toBe(0)
    expect(r.topUp).toBe(0)
  })

  it('不带支援突击弹刀：**对半分**（用户口径 2026-09-10，奇数时击破位多 1）', () => {
    // 司祭型：15 无突击（每次 400）、0 正常；非弹刀 40000 → 缺口 16000 − 8×400（击破位那半）= 12800
    const r = base({ parryTotal: 0, parryNoFollowUpTotal: 15, perNoFollowUpDaze: 400, nonParryStun: 40000 })
    expect(r.breakerNoFollowUp).toBe(8)
    expect(r.mainDpsNoFollowUp).toBe(7)
    expect(r.breakerNoFollowUp + r.mainDpsNoFollowUp).toBe(15)
    // 正常弹刀池为 0 → 补 0
    expect(r.breakerParry).toBe(0)
    expect(r.mainDpsParry).toBe(0)
  })

  it('对半分后只有击破位那半的 daze 抵缺口 → 正常弹刀反推量相应增加', () => {
    // 需要 56000；非弹刀 48000；无突击对半分 10 → 击破位 5×400=2000 → 剩余缺口 6000 → 正常补 6 次
    const r = base({ parryTotal: 13, parryNoFollowUpTotal: 10, perNoFollowUpDaze: 400, nonParryStun: 48000 })
    expect(r.breakerNoFollowUp).toBe(5)
    expect(r.mainDpsNoFollowUp).toBe(5)
    expect(r.breakerParry).toBe(6)
    expect(r.mainDpsParry).toBe(7)
  })

  it('T 只依赖非弹刀基数（与当前注入量无关）→ 轮间单调收敛不振荡', () => {
    const a = base({ nonParryStun: 50000 })
    const b = base({ nonParryStun: 50000 })
    expect(a).toEqual(b)
    expect(a.topUp).toBe(6)
  })
})

describe('guaranteeStunShortfall（失衡次数四舍五入未达成诊断，CC-156）', () => {
  it('达成 → null', () => {
    expect(guaranteeStunShortfall(4, { breakerParry: 8, parryTotal: 8 })).toBeNull()
    expect(guaranteeStunShortfall(5, null)).toBeNull()
  })
  it('弹刀预算用满仍不够 → parry-exhausted', () => {
    expect(guaranteeStunShortfall(3, { breakerParry: 6, parryTotal: 6 })).toEqual({ target: 4, stunCount: 3, cause: 'parry-exhausted' })
  })
  it('无弹刀预算（拆分未激活）→ no-parry-budget', () => {
    expect(guaranteeStunShortfall(2, null)?.cause).toBe('no-parry-budget')
  })
  it('预算未用满却未达成 → other', () => {
    expect(guaranteeStunShortfall(3, { breakerParry: 2, parryTotal: 8 })?.cause).toBe('other')
  })
})
