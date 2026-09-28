/**
 * CC-172（第 197 轮）：队友 buff 来源面板的自身条件效果按覆盖率计算，与进场快照面板同口径。
 * 两者都是「不带队友 buff 的自身面板」，覆盖率表都来自 selfEffectCoverageMap（音擎记录 + 全队驱动盘）。
 * 队伍避开有 adjustTeammateBuffSource 钩子的 1161 莱特 / 1311 耀嘉音（它们的来源面板会被刻意修正）。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { computeEntrySnapshotPanel, resolveSlotPanelBuffInputs } from '@/composables/resourceCalc/panelPhases'

const TEAM = [{ agentId: '1091' }, { agentId: '1211' }, { agentId: '1221' }]
const KEYS = ['atk', 'hp', 'def', 'critRate', 'critDmg', 'dmgBonus', 'anomalyProficiency', 'anomalyMastery', 'impact', 'penRatio'] as const
const pick = (p: Record<string, unknown>) => Object.fromEntries(KEYS.map(k => [k, p[k]]))

describe('CC-172 来源面板覆盖率口径', () => {
  it('全队驱动盘效果覆盖率 50% 时：来源面板局内 = 进场快照面板，且确实不同于 100% 时', async () => {
    const { config, catalog } = await setupHarness(TEAM, { recommendedBuild: true })
    const full = TEAM.map((_, slot) => pick(resolveSlotPanelBuffInputs(0, config, catalog).sourcePanelsByOwner[config.team[slot]!.agentId]!.inCombat as never))

    // 把全队盘上的全部效果 id 设为 50%（effectCoverageMap 里含全队盘效果键；非盘键写进盘覆盖率表无副作用）
    for (const id of resolveSlotPanelBuffInputs(0, config, catalog).effectCoverageMap.keys()) config.setDiscEffectCoverage(id, 50)

    let changed = 0
    TEAM.forEach((_, slot) => {
      const src = pick(resolveSlotPanelBuffInputs(0, config, catalog).sourcePanelsByOwner[config.team[slot]!.agentId]!.inCombat as never)
      expect(src).toEqual(pick(computeEntrySnapshotPanel(slot, config, catalog)! as never))
      if (JSON.stringify(src) !== JSON.stringify(full[slot])) changed++
    })
    // 至少一个角色的盘上有局内条件效果，覆盖率确实生效（否则上面的相等可能只是「都没施加」）
    expect(changed).toBeGreaterThan(0)
  }, 60000)
})
