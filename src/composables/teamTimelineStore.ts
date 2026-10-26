/**
 * 队伍时间线共享工具（基础金与预算感知加金、装配队伍到 store、让出事件循环）。CC-343 起调用方在独立场景上
 * 求值，现场快照 / 恢复（configSnapshot.ts，CC-251）已删。
 * CC-86（2026-09-27，census §5.92）自 `composables/teamTimeline.ts` 逐字拆出；导入方直接从本文件导入（teamTimeline.ts 已不再转出）。
 */
import type { ConfigModel } from '@/stores/config'
import { useCatalogStore } from '@/stores/catalog'
import { teamGoldOf, applyGoldSteps, applyGoldAllocationToStore } from '@/composables/teamCompare'
import { baseStateFor, baseWEngineFor, bestLimitedWEngineFor, buildBudgetAwareGoldSteps } from './goldStepsFromCatalog'
import type { TeamGoldState } from './teamTimeline'
// ========== 配装工具（基础金 / 预算感知加金 / 装配到 store） ==========
// 基础音擎 / 预算感知加金步 / 基础档 已外提 `goldStepsFromCatalog.ts`（2026-10-25）：队伍对比页的
// 「未声明 goldSteps 的预设」也要用同一份 catalog 阶梯，复制一份会在两页分叉。
// 本文件只转出，历史 import 面（`from './teamTimelineStore'`）逐字不变。
export { baseWEngineFor, bestLimitedWEngineFor, baseStateFor, buildBudgetAwareGoldSteps }

/** 队伍基础总限定金 = 基础档（baseStateFor）的总限定金（teamGoldOf）：限定 S 角色本体 + 基础档限定音擎（各 1 金） */
export function baseGoldOfTeam(team: [string, string, string], catalog: ReturnType<typeof useCatalogStore>): number {
  const base = baseStateFor(team, catalog)
  return teamGoldOf(team, base.wEngines, base.cinemas, base.wengineMods)
}

/** 预算感知确定性分配（applyGoldSteps 封装）：返回可直接 applyTeamToStore 的配装态 */
export function budgetAwareStateFor(
  team: [string, string, string],
  budget: number,
  catalog: ReturnType<typeof useCatalogStore>,
): { state: TeamGoldState; totalGold: number; label: string } {
  const { steps, baseWEngines } = buildBudgetAwareGoldSteps(team, catalog)
  const base = baseGoldOfTeam(team, catalog)
  const applied = applyGoldSteps(steps, budget, base, [], baseWEngines)
  return {
    state: {
      cinemas: applied.cinemas,
      wengineMods: applied.wengineMods,
      wEngines: applied.wEngines,
    },
    totalGold: applied.totalGold,
    label: applied.label,
  }
}

/**
 * 装配队伍到 store：推荐配装 + 显式覆盖（音擎/命座/精炼/交互基准）。
 *
 * autoBuild=false（轻量速算，默认）：跳过推荐/优化器，只用 setAgent 兜底配装
 * （专属音擎、兜底套装、5号位主词条），并清掉上一队残留的 4/6 号主词条与副词条分配
 * （setAgent 不重置它们，不清会跨队泄漏）。
 */
export function applyTeamToStore(
  configStore: ConfigModel,
  team: [string, string, string],
  state: TeamGoldState,
  autoBuild = false,
) {
  // CC-340：先将命座/精炼写入槽位，使 autoBuild（applyTeamPreset → applyBuildRecommendationForSlot）与
  // syncTeammateBuffsFromTeam 按本队目标金态（而非上一队残留命座/精炼）计算默认副词条与队友 buff 门控
  for (let s = 0; s < 3; s++) {
    configStore.setCinemaLevel(s, state.cinemas[s])
    configStore.setWEngineModLevel(s, state.wengineMods[s])
  }
  if (autoBuild) {
    configStore.applyTeamPreset(team)
    applyGoldAllocationToStore(configStore, state)
  } else {
    for (let s = 0; s < 3; s++) configStore.setAgent(s, team[s], { defer: true })
    applyGoldAllocationToStore(configStore, state)
    configStore.syncTeammateBuffsFromTeam()
    for (let s = 0; s < 3; s++) {
      const char = configStore.team[s]
      if (!char) continue
      const m5 = char.driveDisc.mainStats[5]
      char.driveDisc.mainStats = { 5: m5 }
      char.driveDisc.subStatAllocation = {}
    }
  }
  // 交互 / 快支 / 连携基准不在这里写（CC-266）：上面两条分支都经 setAgent（applyTeamPreset 内部亦然），
  // setAgent 已按 interactionBaselineFor + chainBaselineFor 预填。
}

// ========== 让出事件循环 ==========

export function yieldNow(): Promise<void> {
  return new Promise(r => setTimeout(r, 0))
}
