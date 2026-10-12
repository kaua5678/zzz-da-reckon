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
 * - 交换两态判据顺序（先 stack 后 fallback）⇒ 同上（fallback 时 stack 为 null，落进 `none`）。
 */
import { describe, expect, it } from 'vitest'
import { axisKindLabel, axisStands, axisStateOf, type AxisStateInput } from '@/composables/difficultyAxis'
import type { StackTraversalResult } from '@/core/stunAxisStack'

/** 最小夹具：只填 `axisStateOf` 真正读的字段（结构类型 ⇒ 不需要造整个 ResourceCalc） */
function mkInput(opts: {
  fallback?: boolean
  stack?: boolean
  skips?: { reason: 'time' | 'decibel' | 'energy' }[]
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
    expect(a.skipped).toEqual({ time: 0, decibel: 0, energy: 0 })
    expect(a.fallback).toBe(false)
    expect(axisStands(a)).toBe(true)
  })

  it('② partial：轴已注入但按三条原因跳过招式（分类计数）', () => {
    const a = axisStateOf(mkInput({
      fallback: false, stack: true,
      skips: [{ reason: 'time' }, { reason: 'energy' }, { reason: 'energy' }],
    }))
    expect(a.kind).toBe('partial')
    expect(a.skipped).toEqual({ time: 1, decibel: 0, energy: 2 })
    expect(a.skippedTotal).toBe(3)
    expect(axisStands(a)).toBe(true)
    // 三条原因各自可读（UI「跳过 N 招」与诊断共用）
    expect(axisStateOf(mkInput({ fallback: false, stack: true, skips: [{ reason: 'decibel' }] })).skipped.decibel).toBe(1)
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

  it('★ 不变量：skippedTotal ≡ skipped 三项之和（任意输入）', () => {
    const cases: { reason: 'time' | 'decibel' | 'energy' }[][] = [
      [], [{ reason: 'time' }], [{ reason: 'decibel' }, { reason: 'decibel' }],
      [{ reason: 'time' }, { reason: 'energy' }, { reason: 'decibel' }],
    ]
    for (const skips of cases) {
      const a = axisStateOf(mkInput({ fallback: false, stack: true, skips }))
      expect(a.skippedTotal).toBe(a.skipped.time + a.skipped.decibel + a.skipped.energy)
      expect(a.skippedTotal).toBe(skips.length)
    }
  })
})
