/**
 * 局外面板（CC-51，2026-09-27，判据 7 还款）：基础面板 `calcPanel(...).outOfCombat` + 启用的全局 Buff。
 *
 * 原位置：TeamConfigPage.vue `currentPanel` 的「局外」分支（页面直接 import @/core/panel 与 @/core/buff）。
 * 与局内面板 `computePanel`（resourceCalc/panelPhases.ts）对称：页面两种模式都只调编排层函数。
 * 算法逐行照搬原页面实现，未改口径：
 *   · 队友 buff 来源上下文 = `teammateBuffSourceContextFromStores`（CC-49，与原页面同一份依赖组装）；
 *   · 全局 Buff 按 **结算口径** `statSettlementMode(stat)` 施加（不是展示口径 isPctStat，见 statMeta 注释）。
 */
import { calcPanel } from '@/core/panel'
import { applyTargetedStat } from '@/core/buff'
import { statSettlementMode } from '@/utils/statMeta'
import type { PanelValues } from '@/types/catalog'
import type { useConfigStore } from '@/stores/config'
import type { useCatalogStore } from '@/stores/catalog'
import { teammateBuffSourceContextFromStores } from './teammateBuffContext'

export function computeOutOfCombatPanel(
  slot: number,
  configStore: ReturnType<typeof useConfigStore>,
  catalogStore: ReturnType<typeof useCatalogStore>,
): PanelValues | null {
  const char = configStore.team[slot]
  if (!char?.agentId) return null
  const agent = catalogStore.getAgent(char.agentId)
  if (!agent) return null

  const wEngine = char.wEngineId ? catalogStore.getWEngine(char.wEngineId) : undefined

  const { enabledTeammateBuffs, sourcePanelsByOwner } = teammateBuffSourceContextFromStores(configStore, catalogStore)

  // 计算基础面板
  const result = calcPanel(
    agent,
    wEngine,
    char.driveDisc,
    catalogStore.driveDiscSetsMap,
    enabledTeammateBuffs,
    catalogStore.statRules,
    {
      cinemaLevel: char.cinemaLevel,
      wEngineModLevel: char.wEngineModLevel,
      sourcePanelsByOwner,
      effectCoverageMap: configStore.getWEngineEffectCoverageMap(),
      enemyWeakness: configStore.enemy.weakness,
    },
  )

  // 应用全局 buff
  const panel = { ...result.outOfCombat }
  for (const buff of configStore.globalBuffs) {
    if (!buff.enabled) continue
    applyTargetedStat(panel, buff.stat, buff.value, statSettlementMode(buff.stat), buff.targetSkillType)
  }

  return panel
}
