import { describe, expect, it } from 'vitest'
import { bossAttackBudgetNotice, bossAttackBudgetNoticeOfSnapshot, bossAttackBudgetNoteText }
  from '@/composables/bossAttackBudgetNotice'

/**
 * **「计算失真」提示**（用户口径 2026-11-04）的纯函数判据。
 *
 * 用户逐字：「关于用户硬填怎么算这个无所谓，**提醒了计算失真就行了，不用管错误计算的逻辑**。」
 * ⇒ 本模块**只产出文案**，不否决、不改任何数（验收 §6-4：填 99 时出现提示、但计算照常完成）。
 */
describe('计算失真提示（只提示不拦）', () => {
  /** 旗舰夹具：有效 180s、失衡 112s ⇒ 非失衡 68s ⇒ 预算 34 次 */
  const base = {
    effectiveTime: 180,
    stunSeconds: 112,
    slotCount: 3,
    slotLabels: ['克拉蕾', '莱卡恩', '丽娜'],
  }
  const counts = (m: Record<number, { dodge?: number; parry?: number }>) =>
    (slot: number, field: string) => (m[slot] as Record<string, number> | undefined)?.[field === 'dodgeCounterCount' ? 'dodge' : 'parry'] ?? 0

  it('★ 硬填 99 ⇒ 提示出现且点名差额（34 次预算是那么算出来的）', () => {
    const n = bossAttackBudgetNotice({ ...base, requestedOf: counts({ 0: { dodge: 99 } }) })
    expect(n.show).toBe(true)
    expect(n.misses).toHaveLength(1)
    const m = n.misses[0]!
    expect(m.field).toBe('dodgeCounterCount')
    expect(m.requested).toBe(99)
    expect(m.budget).toBe(34)
    expect(m.delivered).toBe(34)
    expect(m.nonStunSeconds).toBe(68)
    expect(n.detail).toContain('99')
    expect(n.detail).toContain('34')
  })

  it('★ 只提示不拦：函数没有「拒绝/拦截/报错」出口，只返回文案（不抛错）', () => {
    const n = bossAttackBudgetNotice({ ...base, requestedOf: counts({ 0: { dodge: 99 } }) })
    expect(Object.keys(n).sort()).toEqual(['detail', 'misses', 'show', 'title'])
    // 极端输入（超出 ACTION_COUNT_BOUNDS 的 99）也不抛错
    expect(() => bossAttackBudgetNotice({ ...base, requestedOf: () => 9999 })).not.toThrow()
  })

  it('反空洞 ①：未超预算 ⇒ 不提示（自动交互路径的常态）', () => {
    const n = bossAttackBudgetNotice({ ...base, requestedOf: counts({ 0: { dodge: 20, parry: 2 } }) })
    expect(n.show).toBe(false)
    expect(n.misses).toEqual([])
  })

  it('反空洞 ②：预算为 0（整场都在失衡）⇒ 不提示（防常亮噪音）', () => {
    const n = bossAttackBudgetNotice({ effectiveTime: 180, stunSeconds: 180, slotCount: 3, requestedOf: () => 99 })
    expect(n.show).toBe(false)
  })

  it('反空洞 ③：该槽没填这个字段（0 次）⇒ 不提示', () => {
    const n = bossAttackBudgetNotice({ ...base, requestedOf: () => 0 })
    expect(n.show).toBe(false)
  })

  it('闪反与弹刀**各自独立**：两条各自超了才各报一条（不相加成一个总数）', () => {
    const both = bossAttackBudgetNotice({ ...base, requestedOf: counts({ 0: { dodge: 99, parry: 99 } }) })
    expect(both.misses.map(m => m.field).sort()).toEqual(['dodgeCounterCount', 'parryCount'])
    // 只超一个 ⇒ 只报一个
    const one = bossAttackBudgetNotice({ ...base, requestedOf: counts({ 0: { dodge: 99, parry: 2 } }) })
    expect(one.misses.map(m => m.field)).toEqual(['dodgeCounterCount'])
  })

  it('快照入口：预算分母 = 计划窗数 × 窗长（与引擎同一个数）', () => {
    // 有效 180s、失衡 = 7 窗 × 16s = 112s ⇒ 非失衡 68s ⇒ 预算 34（与上面纯函数用例同值）
    const n = bossAttackBudgetNoticeOfSnapshot({
      battleTime: 180, invincibleTime: 0, windowDuration: 16,
      resourceResult: { plannedStunCount: 7 },
      slotLabels: ['克拉蕾'], interactionCounts: [{ dodgeCounterCount: 99 }],
    })
    expect(n.show).toBe(true)
    expect(n.misses[0]!.nonStunSeconds).toBe(68)
    expect(n.misses[0]!.budget).toBe(34)
    // 含无敌时间：有效 170s、失衡 = 5 窗 × 16s = 80s ⇒ 非失衡 90s ⇒ 预算 45
    const inv = bossAttackBudgetNoticeOfSnapshot({
      battleTime: 180, invincibleTime: 10, windowDuration: 16,
      resourceResult: { plannedStunCount: 5 },
      interactionCounts: [{ dodgeCounterCount: 99 }],
    })
    expect(inv.misses[0]!.nonStunSeconds).toBeCloseTo(90, 9)
    expect(inv.misses[0]!.budget).toBe(45)
  })

  /**
   * **回归锁：提示的预算必须等于引擎兑现的那个数**（2026-11-05 实测缺陷）。
   *
   * 旗舰夹具 `auto-1611-1141-1211` 槽0 填 99：引擎按**计划窗数**（2.95 × 16s = 47.2s ⇒ 非失衡 132.8s）
   * 兑现 **66** 次；而提示曾按**覆盖率**（35.6% × 180s = 64s ⇒ 非失衡 116s）算成 **58** 次 ——
   * 于是结果页写着「闪反 66 次」，旁边却提示「实际兑现 58 次」。两把尺差 8 次。
   *
   * ⇒ 本用例锁死「提示 = 引擎」，禁止退回覆盖率口径。
   */
  it('★ 回归：同一现场，提示预算必须等于引擎预算（覆盖率口径会少 8 次）', () => {
    const eff = 180
    const engineArgs = { plannedStunCount: 2.950937205760941, windowDuration: 16 }
    const notice = bossAttackBudgetNoticeOfSnapshot({
      battleTime: eff, invincibleTime: 0, windowDuration: engineArgs.windowDuration,
      resourceResult: { plannedStunCount: engineArgs.plannedStunCount },
      interactionCounts: [{ dodgeCounterCount: 99 }],
    })
    // 引擎侧独立复算（同一个公式，两个模块各写一遍 ⇒ 任一侧改动都会在这里红）
    const engineNonStun = eff - Math.min(eff, engineArgs.plannedStunCount * engineArgs.windowDuration)
    const engineBudget = Math.floor(engineNonStun / 2 + 1e-9)
    expect(engineBudget).toBe(66)
    expect(notice.misses[0]!.budget).toBe(engineBudget)
    expect(notice.misses[0]!.delivered, '提示报的兑现量必须等于引擎兑现量').toBe(engineBudget)
    // 反例留痕：覆盖率口径（35.6%）会算成 58 —— 不许退回
    const coverageBudget = Math.floor((eff - 0.35555555555555557 * eff) / 2 + 1e-9)
    expect(coverageBudget).toBe(58)
    expect(notice.misses[0]!.budget).not.toBe(coverageBudget)
  })

  it('反空洞：缺字段（旧快照）⇒ 预算偏宽松，绝不误报', () => {
    const n = bossAttackBudgetNoticeOfSnapshot({
      battleTime: 180, invincibleTime: 0, windowDuration: 0,
      resourceResult: { plannedStunCount: Number.NaN },
      interactionCounts: [{ dodgeCounterCount: 99 }],
    })
    // 无分母 ⇒ 非失衡 = 整场 180s ⇒ 预算 90 ⇒ 99 > 90 仍报，但**按整场算**（偏宽松）
    expect(n.misses[0]!.budget).toBe(90)
  })

  it('note 单行版：空 ⇒ 空串（自动交互不因无失真而多出噪声）', () => {
    expect(bossAttackBudgetNoteText([])).toBe('')
    const n = bossAttackBudgetNotice({ ...base, requestedOf: counts({ 0: { dodge: 99 } }) })
    expect(bossAttackBudgetNoteText(n.misses)).toContain('计算失真')
  })
})