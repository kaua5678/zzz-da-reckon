/**
 * 「配装最优」（composables/loadoutOptimizer.ts）判据：
 * - 不劣化：优化后伤害 ≥ 优化前（真实伤害爬山，只接受改进）；
 * - 合法：主词条 ∈ 词条池（5 号位元素增伤须匹配角色属性）、副词条 ∈ 副词条池且满足 TOP2 ≤ 35；
 * - 写回一致：writeLoadoutToStore 写进 UI store 后，store 的配装与场景结果逐项相同、伤害一致；
 * - 空槽跳过、取消即返回 complete=false（调用方丢弃）。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { withAnalysisScenario } from '@/composables/analysisScenario'
import { optimizeLoadout, writeLoadoutToStore } from '@/composables/loadoutOptimizer'
import { topTwoOf } from '@/core/substatOptimizer'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { elementStatKey } from '@/utils/elementStatKeys'

describe('optimizeLoadout', () => {
  it('主词条 + 副词条一次性对齐：不劣化、合法、写回一致', async () => {
    const h = await setupHarness([{ agentId: '1471' }, { agentId: '1451' }, ''], { recommendedBuild: true })
    const res = await withAnalysisScenario(s => optimizeLoadout(s, h.catalog))
    expect(res.complete).toBe(true)
    expect(res.slots.length).toBe(2)
    expect(res.after).toBeGreaterThanOrEqual(res.before * (1 - 1e-9))
    expect(res.evals).toBe(res.mainEvals + res.subEvals)

    const pools = h.catalog.statRules!.driveDisc.mainStatPools!
    const subPool = new Set(h.catalog.statRules!.driveDisc.subStatPool!)
    for (const r of res.slots) {
      const agent = h.catalog.getAgent(r.agentId)!
      const elemKey = elementStatKey('dmg', agent.damageElement)
      for (const pos of [4, 5, 6] as const) {
        const stat = r.mainStats[pos]
        expect(stat).toBeTruthy()
        expect(pools[String(pos)] ?? []).toContain(stat)
        if (pos === 5 && stat!.endsWith('Dmg')) expect(stat).toBe(elemKey)
      }
      expect(Object.keys(r.subStats).length).toBeGreaterThan(0)
      for (const [stat, n] of Object.entries(r.subStats)) {
        expect(subPool.has(stat)).toBe(true)
        expect(n).toBeGreaterThan(0)
      }
      expect(topTwoOf(r.subStats)).toBeLessThanOrEqual(35)
      // 每个被换掉的主词条都必须真的提升（否则不该换）
      for (const c of r.mainChanges) expect(c.pct).toBeGreaterThan(0)
    }

    // 写回 UI store：逐项一致 + 伤害一致
    const calc = useResourceCalc()
    const beforeStore = calc.teamTotalDamage.value ?? 0
    writeLoadoutToStore(h.config, res)
    for (const r of res.slots) {
      const char = h.config.team[r.slot]!
      for (const pos of [4, 5, 6] as const) expect(char.driveDisc.mainStats[pos]).toBe(r.mainStats[pos])
      expect(char.driveDisc.subStatAllocation).toEqual(r.subStats)
      // 算出来的分配写回即「手动」（预算设置不再覆盖）
      expect(h.config.subStatAllocationManual[r.slot]).toBe(true)
    }
    const afterStore = calc.teamTotalDamage.value ?? 0
    expect(afterStore).toBeGreaterThanOrEqual(beforeStore * (1 - 1e-9))
    expect(Math.abs(afterStore - res.after) / Math.max(1, res.after)).toBeLessThan(1e-6)
  }, 180000)

  it('被换坏的 6 号位主词条会被扫描替换回更优项', async () => {
    const h = await setupHarness([{ agentId: '1471' }, { agentId: '1451' }, ''], { recommendedBuild: true })
    h.config.setMainStat(0, 6, 'defPct')
    const res = await withAnalysisScenario(s => optimizeLoadout(s, h.catalog))
    expect(res.complete).toBe(true)
    expect(res.after).toBeGreaterThan(res.before)
    const slot0 = res.slots.find(r => r.slot === 0)!
    expect(slot0.mainChanges.some(c => c.pos === 6 && c.from === 'defPct')).toBe(true)
  }, 180000)

  it('空槽跳过；取消 ⇒ complete=false 且不写回', async () => {
    const h = await setupHarness([{ agentId: '1471' }, '', ''], { recommendedBuild: true })
    const controller = new AbortController()
    controller.abort()
    const res = await withAnalysisScenario(s => optimizeLoadout(s, h.catalog, { control: { signal: controller.signal } }))
    expect(res.complete).toBe(false)
    expect(res.slots.length).toBe(0)

    const normal = await withAnalysisScenario(s => optimizeLoadout(s, h.catalog))
    expect(normal.slots.map(r => r.slot)).toEqual([0])
  }, 180000)
})
