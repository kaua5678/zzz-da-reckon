import { describe, it, expect } from 'vitest'
import { getAgentMechanic } from '@/mechanics'

// CC-33b（2026-09-27）：希希芙蚀骨轴内占比从伤害池编排层迁进模块能力 `directRowAxisSplit`。
// 经注册表取模块（同时证明能力没在 spec 合并时丢掉）。
describe('希希芙 directRowAxisSplit（蚀骨轴内占比）', () => {
  const cr = {
    specResources: { xixifu_toxin: { initialValue: 0, totalGain: 100, gains: {
      toxin_duya_base: 40, toxin_ultimate: 20, toxin_chain: 20, toxin_c2_stunned_chain_ultimate: 10, toxin_tuxin_stage4: 10,
    } } },
    exSpecialCount: 4, ultimateCount: 2, chainCountTotal: 4,
  } as any
  const units: Record<string, number> = { '1521008': 2, '1521009': 0, '1521013': 1, '1521012': 1 }
  const split = (moveId: string, charResult = cr) => getAgentMechanic('1521')!.directRowAxisSplit!({
    exec: { moveId } as any, slot: 0, charResult, axisInUnits: m => units[m] ?? 0,
  })

  it('非蚀骨行不认领（返回 null，走后续通用分支）', () => {
    expect(split('1521010')).toBeNull()
  })

  it('蚀骨行按毒素来源折算轴内占比，note 原样', () => {
    // 非平A轴内 = 40×(2/4) + 20×(1/2) + 20×(1/4) + 10 = 45；非平A总 = 90；平A轴内 = 10×45/90 = 5 ⇒ (45+5)/100
    const s = split('1521019')!
    expect(s.inFraction).toBeCloseTo(0.5, 10)
    expect(s.inNote).toBe(' · 失衡内毒素爆发')
    expect(s.outNote).toBe(' · 轴外毒素（无失衡易伤）')
    expect(split('xixifu_shigu_special')!.inFraction).toBeCloseTo(0.5, 10)
  })

  it('无毒素 ⇒ 占比 0', () => {
    expect(split('1521019', { specResources: {} } as any)!.inFraction).toBe(0)
  })

  /**
   * **量纲回归（2026-10-26 用户口径）**：毒牙 #2（`1521009`）是**同一次施放的额外打击段**
   * （`data/moveFusions.ts#XIXIFU_VENOM_FANG`：一次 = #1×3 + #2×1），不是独立一次施放。
   * 修前把它也加进分子（分母仍是 `exSpecialCount` 施放次数）⇒ 分子被系统性放大：
   * 实测 `auto-1521-1481-1491` 分子 16 / 分母 8 ⇒ `ratioEx = 2.0` ⇒ 占比 1.44 被 clamp 成 1。
   *
   * ⚠ 本用例**必须让 #2 有值**才拦得住：旧夹具把它设成 0，正好绕过这个 bug（改前也绿）。
   */
  it('★ 毒牙 #2 的打击数不进分子（#2 不是独立一次施放）', () => {
    const withHits = (hits: number) => getAgentMechanic('1521')!.directRowAxisSplit!({
      exec: { moveId: '1521019' } as any, slot: 0, charResult: cr,
      axisInUnits: m => ({ '1521008': 2, '1521009': hits, '1521013': 1, '1521012': 1 } as Record<string, number>)[m] ?? 0,
    })!.inFraction
    // #2 的打击数无论多大都不能改变占比（修前 2+8=10 / 4 ⇒ 放大 2.5 倍 ⇒ clamp 1）
    expect(withHits(0)).toBeCloseTo(0.5, 10)
    expect(withHits(8)).toBeCloseTo(0.5, 10)
    expect(withHits(20)).toBeCloseTo(0.5, 10)
  })

  /** 轴内施放次数被 clamp 到全局次数（防「轴内 16 次 vs 全局 8 次」这种不可能态放大占比） */
  it('★ 轴内施放次数不超过全局次数（防不可能态放大）', () => {
    const frac = getAgentMechanic('1521')!.directRowAxisSplit!({
      exec: { moveId: '1521019' } as any, slot: 0, charResult: cr,
      axisInUnits: m => ({ '1521008': 99, '1521009': 0, '1521013': 99, '1521012': 99 } as Record<string, number>)[m] ?? 0,
    })!.inFraction
    // 全部来源都「轴内 99 次」但全局只有 4/2/4 ⇒ 占比上限 1（不是 99/4 放大后的 clamp）
    expect(frac).toBeLessThanOrEqual(1)
    expect(frac).toBeCloseTo(1, 10)
  })
})
