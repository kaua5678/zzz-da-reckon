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
})
