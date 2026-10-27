/**
 * 轴态唯一事实源 `axisStateOf` 判据（T140c 卡 §6.1）。
 *
 * ## 锁什么
 *
 * 四态各 ≥1 例 + **两条通道分开读**（这是本卡 §2.2 的核心事实）：
 *  - **时间路**（`axisFallback`）⇒ `infeasible`：轴计划净占用超预算 ⇒ 弃轴，引擎同时清空 `axisStack`
 *    ⇒ 只看 `stackTraversalResult == null` 会把「弃轴」误判成「非轴队」；
 *  - **资源路**（`skipped`）⇒ `partial`：轴照跑但少打几招 ⇒ 只看 `axisFallback` 会把「残缺轴」
 *    误判成「完整轴」。
 *
 * ## 负控（删掉被锁行为后本测试确实变红）
 *
 * - 把 `if (fallback)` 那一行删掉 ⇒ 「弃轴不得读成非轴队」两条断言红；
 * - 把 `skippedTotal > 0` 改回恒 `complete` ⇒ `partial` 用例红；
 * - 把 `axisStands` 改回「`partial` 也算成立」⇒ ★ 新口径用例与 ② 用例红；
 * - 把 `axisRequirementMet` 写成 `axisStands(a)`（丢掉 `none` 分支）⇒ 非轴队全被截断 ⇒ ★ 用例红；
 * - 交换两态判据顺序（先 stack 后 fallback）⇒ 同上（fallback 时 stack 为 null，落进 `none`）。
 */
import { describe, expect, it } from 'vitest'
import {
  axisKindLabel, axisRequirementMet, axisStands, axisStateOf, axisTruncationReason, partialAxisContributes,
  type AxisStateInput,
} from '@/composables/difficultyAxis'
import type { StackTraversalResult } from '@/core/stunAxisStack'

/** 最小夹具：只填 `axisStateOf` 真正读的字段（结构类型 ⇒ 不需要造整个 ResourceCalc） */
function mkInput(opts: {
  fallback?: boolean
  stack?: boolean
  /** T169：改用**引擎类型**而不是就地重抄一遍联合 —— 引擎加 `reason` 取值时这里自动跟上（原先手抄，加 sway 就红了） */
  skips?: { reason: StackTraversalResult['skipped'][number]['reason'] }[]
}): AxisStateInput {
  const skipped = (opts.skips ?? []).map((s, i) => ({ slot: 0, moveId: `m${i}`, reason: s.reason }))
  return {
    resourceResult: {
      value: opts.fallback === undefined && opts.stack === undefined
        ? null
        : ({ convergence: { axisFallback: opts.fallback } } as never),
    },
    stackTraversalResult: {
      value: opts.stack ? ({ skipped } as unknown as StackTraversalResult) : null,
    },
  }
}

describe('axisStateOf（轴态唯一事实源）', () => {
  it('① complete：轴已注入且零跳过', () => {
    const a = axisStateOf(mkInput({ fallback: false, stack: true, skips: [] }))
    expect(a.kind).toBe('complete')
    expect(a.skippedTotal).toBe(0)
    expect(a.skipped).toEqual({ time: 0, decibel: 0, energy: 0, sway: 0, family: 0 })
    expect(a.fallback).toBe(false)
    expect(axisStands(a)).toBe(true)
  })

  it('② partial：轴已注入但按四条原因跳过招式（分类计数）+ **不算轴成立**', () => {
    const a = axisStateOf(mkInput({
      fallback: false, stack: true,
      skips: [{ reason: 'time' }, { reason: 'energy' }, { reason: 'energy' }],
    }))
    expect(a.kind).toBe('partial')
    expect(a.skipped).toEqual({ time: 1, decibel: 0, energy: 2, sway: 0, family: 0 })
    expect(a.skippedTotal).toBe(3)
    /**
     * ⚠ **2026-10-15 口径收紧**：`partial` **不算**轴成立（旧断言 `toBe(true)` 是旧口径）。
     * 用户口径逐字：「**轴模式已经限定了资源要求了**，你没达到要求……**你不算不就行了吗**。
     * 我要的是你**达到资源要求然后计算**」。
     * 负控：把 `axisStands` 改回 `kind === 'complete' || kind === 'partial'` ⇒ 本断言红。
     */
    expect(axisStands(a)).toBe(false)
    expect(axisRequirementMet(a)).toBe(false)
    // 截断原因可读（UI 直接用它说明「为什么这档不出数」）
    expect(axisTruncationReason(a)).toContain('闪能不足 2 招')
    expect(axisTruncationReason(a)).toContain('窗口时间装不下 1 招')
    // 四条原因各自可读（UI「跳过 N 招」与诊断共用）
    expect(axisStateOf(mkInput({ fallback: false, stack: true, skips: [{ reason: 'decibel' }] })).skipped.decibel).toBe(1)
    // T169：角色专属资源不足（般岳山威）也归 partial —— 它是**资源路**的第四个成员
    const sw = axisStateOf(mkInput({ fallback: false, stack: true, skips: [{ reason: 'sway' }, { reason: 'sway' }] }))
    expect(sw.kind).toBe('partial')
    expect(sw.skipped.sway).toBe(2)
    expect(sw.skippedTotal).toBe(2)
    expect(axisRequirementMet(sw)).toBe(false)
    expect(axisTruncationReason(sw)).toContain('专属资源不足 2 招')
  })

  it('★ 新口径：只有 complete / none 才「可以出数」（低难度截断的判据）', () => {
    const complete = axisStateOf(mkInput({ fallback: false, stack: true, skips: [] }))
    const partial = axisStateOf(mkInput({ fallback: false, stack: true, skips: [{ reason: 'time' }] }))
    const infeasible = axisStateOf(mkInput({ fallback: true, stack: false }))
    const none = axisStateOf(mkInput({ fallback: false, stack: false }))
    // 轴队：要求满足才出数
    expect(axisRequirementMet(complete)).toBe(true)
    expect(axisRequirementMet(partial)).toBe(false)
    expect(axisRequirementMet(infeasible)).toBe(false)
    /**
     * **非轴队恒可出数**（`none`）——「没绑轴」= 没有资源要求要满足，**不是**「没达标」。
     * 负控：把 `axisRequirementMet` 写成 `axisStands(a)` ⇒ 非轴队全被截断（58 队曲线消失）⇒ 红。
     */
    expect(axisRequirementMet(none)).toBe(true)
    // `axisStands` 仍只管「② 点能不能落在这里」⇒ 非轴队恒 false（两条判据分工不同，不得合并）
    expect(axisStands(none)).toBe(false)
    expect(axisRequirementMet(none)).not.toBe(axisStands(none))
    // 截断原因：弃轴与资源不足措辞不同
    expect(axisTruncationReason(infeasible)).toContain('弃轴')
  })

  it('③ infeasible：时间路判不过（弃轴）—— 且**不得**读成 none（负控核心）', () => {
    // 引擎弃轴时同时清空 axisStack（resolvedAxes=[] + axisActive=false）⇒ stack = null
    const a = axisStateOf(mkInput({ fallback: true, stack: false }))
    expect(a.kind).toBe('infeasible')
    expect(a.kind).not.toBe('none')
    expect(a.fallback).toBe(true)
    expect(axisStands(a)).toBe(false)
    // 即便 stack 仍有残留（理论态），fallback 也必须赢——判据顺序「先 fallback」
    expect(axisStateOf(mkInput({ fallback: true, stack: true, skips: [{ reason: 'time' }] })).kind).toBe('infeasible')
  })

  it('④ none：该队本来就不是轴队（既没弃轴也没注入轴）', () => {
    const a = axisStateOf(mkInput({ fallback: false, stack: false }))
    expect(a.kind).toBe('none')
    expect(a.skippedTotal).toBe(0)
    expect(axisStands(a)).toBe(false)
    // 引擎还没算完（resourceResult 为 null）也归 none，不抛错
    expect(axisStateOf(mkInput({})).kind).toBe('none')
  })

  it('标签口径单源：四态各有中文短标签，跳过数直接进标签', () => {
    expect(axisKindLabel(axisStateOf(mkInput({ fallback: false, stack: true, skips: [] })))).toBe('完整轴')
    expect(axisKindLabel(axisStateOf(mkInput({ fallback: false, stack: true, skips: [{ reason: 'time' }, { reason: 'time' }] })))).toBe('跳过 2 招')
    expect(axisKindLabel(axisStateOf(mkInput({ fallback: true, stack: false })))).toBe('轴不可行')
    expect(axisKindLabel(axisStateOf(mkInput({ fallback: false, stack: false })))).toBe('—')
  })

  it('★ 不变量：skippedTotal ≡ skipped 四项之和（任意输入）', () => {
    const cases: { reason: StackTraversalResult['skipped'][number]['reason'] }[][] = [
      [], [{ reason: 'time' }], [{ reason: 'decibel' }, { reason: 'decibel' }],
      [{ reason: 'time' }, { reason: 'energy' }, { reason: 'decibel' }],
      // T169：第四类原因也进同一条不变量（防「新理由加了但总数没算」）
      [{ reason: 'sway' }, { reason: 'time' }, { reason: 'sway' }],
    ]
    for (const skips of cases) {
      const a = axisStateOf(mkInput({ fallback: false, stack: true, skips }))
      expect(a.skippedTotal).toBe(a.skipped.time + a.skipped.decibel + a.skipped.energy + a.skipped.sway)
      expect(a.skippedTotal).toBe(skips.length)
    }
  })

  /**
   * ★ 用户口径 2026-10-18：「只有少数招式打不了的可以展示，怎么界定范围呢？
   *   **就是这个残疾轴的综合易伤超过非轴的默认均匀易伤后**，就可以认为残疾轴也是有轴易伤上的贡献，
   *   **可以不隐藏**。这样也能看到残疾轴提高交互变成完善轴的提升。」
   *
   * 判据 = `partialAxisContributes(加权易伤, 非轴均匀易伤)`，**严格大于**才放行（不带人为阈值）。
   * 实测锚点（命破队 × 彷徨猎手）：放行档差值 **+0.195 ~ +0.514**（如 `banyue-liuyin` 0.818 vs 0.303）；
   * 弃轴档差值 ≈ **−0.006**（轴没执行 ⇒ 加权易伤退回非轴口径）。
   */
  describe('★ 残疾轴放行判据 partialAxisContributes（2026-10-18）', () => {
    it('易伤确实更高 ⇒ 放行', () => {
      expect(partialAxisContributes(0.818, 0.303)).toBe(true)
      expect(partialAxisContributes(0.4051, 0.405)).toBe(true) // 极窄差也放行（判据不带人为阈值）
    })

    it('易伤相等或更低 ⇒ 不放行（弃轴档的形态）', () => {
      expect(partialAxisContributes(0.4045, 0.4045)).toBe(false) // 相等：没有额外贡献
      expect(partialAxisContributes(0.398, 0.4045)).toBe(false) // 弃轴档实测 −0.006
      expect(partialAxisContributes(0, 0.4)).toBe(false)
    })

    it('反空洞：判据不是恒真也不是恒假', () => {
      const cases: [number, number][] = [[0.818, 0.303], [0.398, 0.4045], [0.5, 0.5], [0.6, 0.4]]
      const results = cases.map(([a, b]) => partialAxisContributes(a, b))
      expect(results.some(r => r), '恒假 ⇒ 残疾轴永远放不进来').toBe(true)
      expect(results.some(r => !r), '恒真 ⇒ 弃轴档也会被放进来').toBe(true)
    })
  })
})
