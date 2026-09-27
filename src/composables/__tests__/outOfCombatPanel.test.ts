/**
 * CC-51：computeOutOfCombatPanel 与原 TeamConfigPage「局外」分支内联算法逐值一致（含一条启用的全局 Buff）。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { calcPanel } from '@/core/panel'
import { applyTargetedStat } from '@/core/buff'
import { statSettlementMode } from '@/utils/statMeta'
import { teammateBuffSourceContextFromStores } from '@/composables/teammateBuffContext'
import { computeOutOfCombatPanel } from '@/composables/outOfCombatPanel'

describe('computeOutOfCombatPanel', () => {
  it('与原页面内联算法逐值相等；启用的全局 Buff 生效、禁用的不生效', async () => {
    const { config, catalog } = await setupHarness([{ agentId: '1161' }, { agentId: '1311' }, { agentId: '1211' }], { recommendedBuild: true })
    config.globalBuffs.push({ id: 't-on', name: '测试开', stat: 'atkPct', value: 0.2, enabled: true, targetSkillType: 'all' })
    config.globalBuffs.push({ id: 't-off', name: '测试关', stat: 'critRate', value: 0.5, enabled: false, targetSkillType: 'all' })

    const inline = (slot: number) => {
      const char = config.team[slot]!
      const agent = catalog.getAgent(char.agentId!)!
      const wEngine = char.wEngineId ? catalog.getWEngine(char.wEngineId) : undefined
      const { enabledTeammateBuffs, sourcePanelsByOwner } = teammateBuffSourceContextFromStores(config, catalog)
      const result = calcPanel(agent, wEngine, char.driveDisc, catalog.driveDiscSetsMap, enabledTeammateBuffs, catalog.statRules, {
        cinemaLevel: char.cinemaLevel,
        wEngineModLevel: char.wEngineModLevel,
        sourcePanelsByOwner,
        effectCoverageMap: config.getWEngineEffectCoverageMap(),
        enemyWeakness: config.enemy.weakness,
      })
      const panel = { ...result.outOfCombat }
      for (const buff of config.globalBuffs) {
        if (!buff.enabled) continue
        applyTargetedStat(panel, buff.stat, buff.value, statSettlementMode(buff.stat), buff.targetSkillType)
      }
      return panel
    }

    for (const slot of [0, 1, 2]) expect(computeOutOfCombatPanel(slot, config, catalog)).toEqual(inline(slot))

    // 启用的 Buff 确实改变了面板（否则上面的相等可能只是「都没施加」）
    const withBuff = computeOutOfCombatPanel(0, config, catalog)!
    config.globalBuffs.forEach(b => { b.enabled = false })
    const without = computeOutOfCombatPanel(0, config, catalog)!
    expect(withBuff).not.toEqual(without)
  }, 60000)

  it('空槽 / 无角色 ⇒ null', async () => {
    const { config, catalog } = await setupHarness([{ agentId: '1161' }, '', ''])
    expect(computeOutOfCombatPanel(1, config, catalog)).toBeNull()
  }, 60000)
})
