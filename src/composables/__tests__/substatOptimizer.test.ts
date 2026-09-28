/**
 * CC-52：computeSubstatAllocationForSlot 与原 ImpactChart `runOptimizerForSlot0` 内联算法逐值一致。
 * 第 194 轮：优化器的队友 buff 输入改为与伤害管线同源（`resolveSlotPanelBuffInputs`：门控 / 接收槽过滤 / 全局 Buff /
 *   覆盖率 / 来源面板修正）。
 * 第 195 轮：原始上下文组装 `composables/teammateBuffContext.ts` 已无生产消费方，删除；第一条用例的内联算法改为新口径
 *   （队友 buff 输入 = `resolveSlotPanelBuffInputs`），末尾用例的「原始集合」直接调 core `buildTeammateBuffSourceContext`。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { computeOptimalSubStats, getTemplate } from '@/core/substatOptimizer'
import { buildTeammateBuffSourceContext } from '@/core/teammateBuffSource'
import { computeSubstatAllocationForSlot } from '@/composables/substatOptimizer'
import { resolveSlotPanelBuffInputs } from '@/composables/resourceCalc/panelPhases'

describe('computeSubstatAllocationForSlot', () => {
  it('与内联算法逐值相等（三个槽位；队友 buff 输入 = 伤害管线同源），且结果非空', async () => {
    const { config, catalog } = await setupHarness([{ agentId: '1161' }, { agentId: '1311' }, { agentId: '1211' }], { recommendedBuild: true })

    // 照抄原 ImpactChart.vue runOptimizerForSlot0（baceb72），只把「写 store」换成「返回分配」；第 194 轮起队友 buff 输入换源
    const inline = (slot: number) => {
      const char = config.team[slot]!
      const agent = catalog.getAgent(char.agentId!)!
      const wEngine = char.wEngineId ? catalog.getWEngine(char.wEngineId) : undefined
      const setInfo = resolveSlotPanelBuffInputs(slot, config, catalog)
      const tmpl = getTemplate(agent)
      const sc = tmpl.stats.length
      const tsk = sc <= 2 ? 'optimizer.totalSteps2' : sc === 3 ? 'optimizer.totalSteps3' : 'optimizer.totalSteps4'
      const result = computeOptimalSubStats({
        agent, wEngine,
        driveDiscConfig: char.driveDisc,
        setsMap: catalog.driveDiscSetsMap,
        teammateBuffs: setInfo.teammateBuffs,
        statRules: catalog.statRules,
        statCap: config.getMechanicSetting('optimizer.substatCap', 20),
        totalSteps: config.getMechanicSetting(tsk, 0),
        config: { cinemaLevel: char.cinemaLevel ?? 0, wEngineModLevel: char.wEngineModLevel ?? 1, sourcePanelsByOwner: setInfo.sourcePanelsByOwner, effectCoverageMap: setInfo.effectCoverageMap, enemyWeakness: config.enemy.weakness },
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

describe('副词条优化器的队友 buff 输入与伤害管线同源（第 194 轮）', () => {
  it('席德 + 命破队友（额外能力不触发）：原始上下文含「明攻」，管线输入按门控剔除', async () => {
    const { config, catalog } = await setupHarness([{ agentId: '1461' }, { agentId: '1441' }, ''], { recommendedBuild: true })
    const effectIds = (buffs: { effects?: { id: string }[] }[]) => new Set(buffs.flatMap(b => (b.effects ?? []).map(e => e.id)))
    const raw = buildTeammateBuffSourceContext(config.team, {
      teammateBuffGroups: catalog.teammateBuffGroups,
      driveDiscSetsMap: catalog.driveDiscSetsMap,
      statRules: catalog.statRules,
      getAgent: (id) => catalog.getAgent(id),
      getWEngine: (id) => catalog.getWEngine(id),
      isTeammateBuffEnabled: (id) => config.isTeammateBuffEnabled(id),
      enemyWeakness: config.enemy.weakness,
    })
    const brightIds = [...effectIds(raw.enabledTeammateBuffs
      .filter(b => b.id === 'seed.core_vanguard_bright_attack'))]
    expect(brightIds.length).toBeGreaterThan(0) // 原始上下文里有明攻：否则本用例无判别力
    const piped = effectIds(resolveSlotPanelBuffInputs(1, config, catalog).teammateBuffs)
    for (const id of brightIds) expect(piped.has(id), id).toBe(false)
  }, 60000)
})
