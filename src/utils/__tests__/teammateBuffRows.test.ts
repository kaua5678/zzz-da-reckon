/**
 * R65 batchA —— `src/utils/teammateBuffRows.ts` 的单元判据（纯谓词层）。
 *
 * 结构面判据（全库不变量 + 行为面）在 `src/mechanics/__tests__/specTeamBuffDeadControl.test.ts`；
 * 本文件只锁**谓词本身**的边界语义 —— 它是页面渲染与全库判据的共同事实源，
 * 这里写坏会让两边同时静默失效（所以边界必须逐条钉住）。
 *
 * ⚠ 与 `discEffectRows.test.ts` 同款分工：纯函数单测锁语义，页面/全库判据锁不变量。
 */
import { describe, expect, it } from 'vitest'
import {
  isTeammateBuffInteractive, hasComputablePayload, entersNumericChannel,
  interactiveTeammateBuffs, declaredOnlyTeammateBuffs, declaredOnlyReason,
} from '@/utils/teammateBuffRows'

type Probe = Parameters<typeof isTeammateBuffInteractive>[0]

const withEffects = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `e${i}`, stat: 'atkFlat' })) as never
const withModifiers = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `m${i}` })) as never

describe('队友 Buff 可交互性谓词（teammateBuffRows）', () => {
  it('否定式：singleSourced 条不可交互（数值走模块单通道，按设计不由用户拨）', () => {
    const b: Probe = { singleSourced: true, effects: withEffects(2), buffModifiers: [] }
    expect(entersNumericChannel(b)).toBe(false)
    expect(hasComputablePayload(b)).toBe(true) // 有载荷，但仍不可交互
    expect(isTeammateBuffInteractive(b)).toBe(false)
    expect(declaredOnlyReason(b)).toContain('单通道')
  })

  it('否定式：effects 为空且无 buffModifiers ⇒ 不可交互（结构上不可能有效果）', () => {
    const b: Probe = { effects: [], buffModifiers: [] }
    expect(entersNumericChannel(b)).toBe(true) // 会进通道……
    expect(hasComputablePayload(b)).toBe(false) // ……但没有东西可算
    expect(isTeammateBuffInteractive(b)).toBe(false)
    expect(declaredOnlyReason(b)).toContain('防双计')
  })

  it('肯定式：进通道 + 有 effects ⇒ 可交互', () => {
    expect(isTeammateBuffInteractive({ effects: withEffects(1), buffModifiers: [] })).toBe(true)
  })

  /**
   * ★★ 反过度过滤边界：`effects` 为空但 `buffModifiers` 非空 ⇒ **可交互**。
   * 这五条先例（丽娜 C1 / 青衣 C2 / 凯撒 C2 / 潘引壶 C6 / 诺姆 C2）靠 `multiplyResolvedValue`
   * 放大**别的**条，拨它确实改数值（R65 实测 4/5 逐位不同）⇒ 砍掉它们就是把活控件一起砍了。
   */
  it('肯定式（★反过度过滤）：effects 空但 buffModifiers 非空 ⇒ 可交互', () => {
    const b: Probe = { effects: [], buffModifiers: withModifiers(1) }
    expect(hasComputablePayload(b)).toBe(true)
    expect(isTeammateBuffInteractive(b)).toBe(true)
  })

  it('缺省（字段 undefined）按「无载荷 / 进通道」处理，不抛异常', () => {
    const empty = {} as Probe
    expect(entersNumericChannel(empty)).toBe(true)
    expect(hasComputablePayload(empty)).toBe(false)
    expect(isTeammateBuffInteractive(empty)).toBe(false)

    // singleSourced: false 与 undefined 等价（显式 false 不是「单源化」）
    expect(entersNumericChannel({ singleSourced: false } as Probe)).toBe(true)
    expect(isTeammateBuffInteractive({ singleSourced: false, effects: withEffects(1) } as Probe)).toBe(true)
  })

  it('集合划分：interactive + declaredOnly 互斥且覆盖全部（顺序保持）', () => {
    const a: Probe = { effects: withEffects(1) }
    const b: Probe = { singleSourced: true, effects: withEffects(1) }
    const c: Probe = { effects: [], buffModifiers: [] }
    const d: Probe = { effects: [], buffModifiers: withModifiers(2) }
    const list = [a, b, c, d]
    expect(interactiveTeammateBuffs(list)).toEqual([a, d])
    expect(declaredOnlyTeammateBuffs(list)).toEqual([b, c])
    expect(interactiveTeammateBuffs(undefined)).toEqual([])
    expect(declaredOnlyTeammateBuffs(undefined)).toEqual([])
  })
})
