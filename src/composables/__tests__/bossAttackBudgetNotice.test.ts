import { describe, expect, it } from 'vitest'
import { bossAttackBudgetNotice, bossAttackBudgetNoticeOfSnapshot, bossAttackBudgetNoteText }
  from '@/composables/bossAttackBudgetNotice'

/**
 * **「计算失真」提示**的纯函数判据。
 *
 * 用户逐字 2026-11-04：「关于用户硬填怎么算这个无所谓，**提醒了计算失真就行了，不用管错误计算的逻辑**。」
 * ⇒ 本模块**只产出文案**，不否决、不改任何数。
 *
 * 2026-11-06 口径收紧：「全队交互次数上限还是改为非失衡时间/3」「单人交互上限为非失衡*1/4」
 * ⇒ 提示从「逐字段」变成「逐槽位」，且闪反/弹刀**共用一个池**。
 */
describe('计算失真提示（只提示不拦）', () => {
  /** 旗舰夹具：有效 180s、失衡 112s ⇒ 非失衡 68s ⇒ 全队池 floor(68/3)=22、单人 floor(68/4)=17 */
  const base = {
    effectiveTime: 180,
    stunSeconds: 112,
    slotCount: 3,
    slotLabels: ['克拉蕾', '莱卡恩', '丽娜'],
  }
  const counts = (m: Record<number, { dodge?: number; parry?: number }>) =>
    (slot: number, field: string) => (m[slot] as Record<string, number> | undefined)?.[field === 'dodgeCounterCount' ? 'dodge' : 'parry'] ?? 0

  it('★ 硬填 99 ⇒ 提示出现，点名「填了 N / 削减原因 / 兑现 M」', () => {
    const n = bossAttackBudgetNotice({ ...base, requestedOf: counts({ 0: { dodge: 99 } }) })
    expect(n.show).toBe(true)
    expect(n.misses).toHaveLength(1)
    const m = n.misses[0]!
    expect(m.slot).toBe(0)
    expect(m.label).toBe('克拉蕾')
    expect(m.requestedTotal).toBe(99)
    // 单人上限 17 先削（99 > 17），再受全队池 22 —— 单槽只填一个槽 ⇒ 17 生效
    expect(m.perSlotBudget).toBe(17)
    expect(m.teamBudget).toBe(22)
    expect(m.deliveredTotal).toBe(17)
    expect(m.reasons).toContain('slotCap')
    expect(m.nonStunSeconds).toBe(68)
    expect(n.detail).toContain('99')
    expect(n.detail).toContain('17')
  })

  it('★ 只提示不拦：函数没有「拒绝/拦截/报错」出口，只返回文案（不抛错）', () => {
    const n = bossAttackBudgetNotice({ ...base, requestedOf: counts({ 0: { dodge: 99 } }) })
    expect(Object.keys(n).sort()).toEqual(['detail', 'misses', 'show', 'title'])
    expect(() => bossAttackBudgetNotice({ ...base, requestedOf: () => 9999 })).not.toThrow()
  })

  it('反空洞 ①：未超任一条尺 ⇒ 不提示（自动交互路径的常态）', () => {
    const n = bossAttackBudgetNotice({ ...base, requestedOf: counts({ 0: { dodge: 10, parry: 2 } }) })
    expect(n.show).toBe(false)
    expect(n.misses).toEqual([])
  })

  it('反空洞 ②：两条尺都为 0（整场都在失衡）⇒ 不提示（防常亮噪音）', () => {
    const n = bossAttackBudgetNotice({ effectiveTime: 180, stunSeconds: 180, slotCount: 3, requestedOf: () => 99 })
    expect(n.show).toBe(false)
  })

  it('反空洞 ③：全队都没填 ⇒ 不提示', () => {
    const n = bossAttackBudgetNotice({ ...base, requestedOf: () => 0 })
    expect(n.show).toBe(false)
  })

  it('★ 闪反与弹刀**合并在同一槽的额度里**：合计超才报，且只报一条', () => {
    // 合计 40（20+20）> 单人 17 ⇒ 一条（不是两条）
    const both = bossAttackBudgetNotice({ ...base, requestedOf: counts({ 0: { dodge: 20, parry: 20 } }) })
    expect(both.misses).toHaveLength(1)
    expect(both.misses[0]!.requestedTotal).toBe(40)
    // 只填一点点（5+2=7 ≤ 17）⇒ 不报
    const small = bossAttackBudgetNotice({ ...base, requestedOf: counts({ 0: { dodge: 5, parry: 2 } }) })
    expect(small.show).toBe(false)
  })

  it('★ 全队池被顶满时报「teamPool」（分给队友也救不回来）', () => {
    // 三槽各填 10 ⇒ 合计 30 > 池 22，但每槽都 < 单人 17 ⇒ 只命中 teamPool
    const n = bossAttackBudgetNotice({ ...base, requestedOf: counts({ 0: { dodge: 10 }, 1: { dodge: 10 }, 2: { dodge: 10 } }) })
    expect(n.show).toBe(true)
    expect(n.misses.length).toBeGreaterThanOrEqual(2)
    expect(n.misses.every(m => m.reasons.includes('teamPool'))).toBe(true)
    expect(n.misses.some(m => m.reasons.includes('slotCap'))).toBe(false)
    expect(n.detail).toContain('全队')
  })

  it('快照入口：预算分母 = 计划窗数 × 窗长（与引擎同一个数）', () => {
    // 有效 180s、失衡 = 7 窗 × 16s = 112s ⇒ 非失衡 68s ⇒ 全队 22 / 单人 17
    const n = bossAttackBudgetNoticeOfSnapshot({
      battleTime: 180, invincibleTime: 0, windowDuration: 16,
      resourceResult: { plannedStunCount: 7 },
      slotLabels: ['克拉蕾'], interactionCounts: [{ dodgeCounterCount: 99 }],
    })
    expect(n.show).toBe(true)
    expect(n.misses[0]!.nonStunSeconds).toBe(68)
    expect(n.misses[0]!.teamBudget).toBe(22)
    expect(n.misses[0]!.perSlotBudget).toBe(17)
    // 含无敌时间：有效 170s、失衡 = 5 窗 × 16s = 80s ⇒ 非失衡 90s ⇒ 全队 30 / 单人 22
    const inv = bossAttackBudgetNoticeOfSnapshot({
      battleTime: 180, invincibleTime: 10, windowDuration: 16,
      resourceResult: { plannedStunCount: 5 },
      interactionCounts: [{ dodgeCounterCount: 99 }],
    })
    expect(inv.misses[0]!.nonStunSeconds).toBeCloseTo(90, 9)
    expect(inv.misses[0]!.teamBudget).toBe(30)
    expect(inv.misses[0]!.perSlotBudget).toBe(22)
  })

  /** **回归锁：提示的预算必须等于引擎兑现的那个数**（2026-11-05 实测缺陷，2026-11-06 换代后重锁）。 */
  it('★ 回归：同一现场，提示预算必须等于引擎预算（覆盖率口径会算错）', () => {
    const eff = 180
    const plannedStunCount = 2.950937205760941
    const windowDuration = 16
    const notice = bossAttackBudgetNoticeOfSnapshot({
      battleTime: eff, invincibleTime: 0, windowDuration,
      resourceResult: { plannedStunCount },
      interactionCounts: [{ dodgeCounterCount: 99 }],
    })
    // 引擎侧独立复算（同一个公式两处各写一遍 ⇒ 任一侧改动都会在这里红）
    const engineNonStun = eff - Math.min(eff, plannedStunCount * windowDuration)
    const engineTeam = Math.floor(engineNonStun / 3 + 1e-9)
    const engineSlot = Math.floor(engineNonStun / 4 + 1e-9)
    expect(engineTeam).toBe(44)
    expect(engineSlot).toBe(33)
    expect(notice.misses[0]!.teamBudget).toBe(engineTeam)
    expect(notice.misses[0]!.perSlotBudget).toBe(engineSlot)
    expect(notice.misses[0]!.deliveredTotal, '提示报的兑现量必须等于引擎兑现量').toBe(engineSlot)
  })

  it('反空洞：缺字段（旧快照）⇒ 预算偏宽松，绝不误报', () => {
    const n = bossAttackBudgetNoticeOfSnapshot({
      battleTime: 180, invincibleTime: 0, windowDuration: 0,
      resourceResult: { plannedStunCount: Number.NaN },
      interactionCounts: [{ dodgeCounterCount: 99 }],
    })
    // 无分母 ⇒ 非失衡 = 整场 180s ⇒ 全队 60 / 单人 45 ⇒ 99 > 45 仍报，但**按整场算**（偏宽松）
    expect(n.misses[0]!.perSlotBudget).toBe(45)
  })

  it('note 单行版：空 ⇒ 空串（自动交互不因无失真而多出噪声）', () => {
    expect(bossAttackBudgetNoteText([])).toBe('')
    const n = bossAttackBudgetNotice({ ...base, requestedOf: counts({ 0: { dodge: 99 } }) })
    expect(bossAttackBudgetNoteText(n.misses)).toContain('计算失真')
  })
})
