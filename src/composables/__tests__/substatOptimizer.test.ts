/**
 * CC-52：computeSubstatAllocationForSlot 与原 ImpactChart `runOptimizerForSlot0` 内联算法逐值一致。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { computeOptimalSubStats, getTemplate } from '@/core/substatOptimizer'
import { teammateBuffSourceContextFromStores } from '@/composables/teammateBuffContext'
import { computeSubstatAllocationForSlot } from '@/composables/substatOptimizer'

describe('computeSubstatAllocationForSlot', () => {
  it('与原组件内联算法逐值相等（三个槽位），且结果非空', async () => {
    const { config, catalog } = await setupHarness([{ agentId: '1161' }, { agentId: '1311' }, { agentId: '1211' }], { recommendedBuild: true })

    // 照抄原 ImpactChart.vue runOptimizerForSlot0（baceb72），只把「写 store」换成「返回分配」
    const inline = (slot: number) => {
      const char = config.team[slot]!
      const agent = catalog.getAgent(char.agentId!)!
      const wEngine = char.wEngineId ? catalog.getWEngine(char.wEngineId) : undefined
      const setInfo = teammateBuffSourceContextFromStores(config, catalog)
      const tmpl = getTemplate(agent)
      const sc = tmpl.stats.length
      const tsk = sc <= 2 ? 'optimizer.totalSteps2' : sc === 3 ? 'optimizer.totalSteps3' : 'optimizer.totalSteps4'
      const result = computeOptimalSubStats({
        agent, wEngine,
        driveDiscConfig: char.driveDisc,
        setsMap: catalog.driveDiscSetsMap,
        teammateBuffs: setInfo.enabledTeammateBuffs,
        statRules: catalog.statRules,
        statCap: config.getMechanicSetting('optimizer.substatCap', 20),
        totalSteps: config.getMechanicSetting(tsk, 0),
        config: { cinemaLevel: char.cinemaLevel ?? 0, wEngineModLevel: char.wEngineModLevel ?? 1, sourcePanelsByOwner: setInfo.sourcePanelsByOwner, enemyWeakness: config.enemy.weakness },
      })
      const out: Record<string, number> = {}
      for (const [s, n] of Object.entries(result.subStatAllocation)) {
        if (n > 0) out[s] = Math.max(0, Math.min(54, n))
      }
      return out
    }

    for (const slot of [0, 1, 2]) {
      const got = computeSubstatAllocationForSlot(slot, config, catalog)
      expect(got).toEqual(inline(slot))
      expect(Object.keys(got!).length).toBeGreaterThan(0)
    }
  }, 60000)

  it('空槽 ⇒ null', async () => {
    const { config, catalog } = await setupHarness([{ agentId: '1161' }, '', ''])
    expect(computeSubstatAllocationForSlot(1, config, catalog)).toBeNull()
  }, 60000)
})
