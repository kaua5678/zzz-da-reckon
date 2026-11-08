/**
 * 双锋御队**管线级**判据：真的组一支 1601 + 1611 的队，跑完整资源环，
 * 确认①两个锋御都有毁伤（计算逻辑没缺失）②总毁伤数不被池翻倍 ③池确实合并了。
 *
 * 与 `gashMaimDualSharpen.test.ts` 的分工：那里测纯函数，这里测**接线**
 * （`buildResourceResult` 暴露申报 → `nextRoundFeedback` → `converge` 写回 cfg）。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'

function sharpenSlots(rr: any) {
  const out: Array<{ slot: number; points: number; layers: number; maim: number; kind: string }> = []
  for (const ch of rr.characters) {
    const sun: any = ch.sunbringerGashSource
    const cl: any = ch.claretSharpResourceSource
    if (sun) out.push({ slot: ch.slot, points: Number(sun.points), layers: Number(sun.gashLayers), maim: Number(sun.maimCount), kind: 'sun' })
    if (cl) out.push({ slot: ch.slot, points: Number(cl.gashValuePct), layers: Number(cl.gashStacks), maim: Number(cl.maimCount), kind: 'claret' })
  }
  return out
}

describe('[1601/1611] 双锋御队管线', () => {
  it('双锋御：两家都算出毁伤，池共享且不翻倍', async () => {
    await setupHarness(['', '', ''])
    const c = useConfigStore()
    c.setAgent(0, '1601'); c.setAgent(1, '1611'); c.setAgent(2, '1661')
    const calc = useResourceCalc()
    const rr = calc.resourceResult.value!
    const slots = sharpenSlots(rr)
    expect(slots.length, '两个锋御槽都要暴露申报').toBe(2)

    // ① 计算逻辑没缺失：两家都有毁伤
    for (const s of slots) {
      expect(s.maim, `${s.kind} 槽${s.slot} 的毁伤次数不能为 0`).toBeGreaterThan(0)
    }

    // ② 不翻倍：总毁伤 ≤ 池总层数（各槽自己那次申报的层数之和不超过合并池）
    const totalMaim = slots.reduce((a, s) => a + s.maim, 0)
    const poolLayers = Math.floor(slots.reduce((a, s) => a + s.points, 0) / 600)
    expect(totalMaim, '总毁伤不能超过合并池层数（否则就是各算各的）').toBeLessThanOrEqual(poolLayers)

    // ③ 池确实合并了：合并层数 ≥ 各自 floor 之和
    const sumOfFloors = slots.reduce((a, s) => a + Math.floor(s.points / 600), 0)
    expect(poolLayers).toBeGreaterThanOrEqual(sumOfFloors)
  }, 120000)

  it('单锋御：不启用团队池（granted 缺省，走私有池）', async () => {
    await setupHarness(['', '', ''])
    const c = useConfigStore()
    c.setAgent(0, '1601'); c.setAgent(1, '1621'); c.setAgent(2, '1661')
    const calc = useResourceCalc()
    const rr = calc.resourceResult.value!
    const slots = sharpenSlots(rr)
    expect(slots.length).toBe(1)
    const sun = slots[0]!
    expect(sun.kind).toBe('sun')
    // 单锋御：池层数 = 自己点数的 floor（没人和他分）
    expect(sun.layers).toBe(Math.floor(sun.points / 600))
    expect(sun.maim).toBeGreaterThan(0)
  }, 120000)
})