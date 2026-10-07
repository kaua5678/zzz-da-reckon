/**
 * 队伍时间线共享工具（基础金与预算感知加金、装配队伍到 store、让出事件循环）。CC-343 起调用方在独立场景上
 * 求值，现场快照 / 恢复（configSnapshot.ts，CC-251）已删。
 * CC-86（2026-09-27，census §5.92）自 `composables/teamTimeline.ts` 逐字拆出；导入方直接从本文件导入（teamTimeline.ts 已不再转出）。
 */
import type { ConfigModel } from '@/stores/config'
import { useCatalogStore } from '@/stores/catalog'
import { isLimitedWEngine, teamGoldOf, applyGoldSteps, applyGoldAllocationToStore } from '@/composables/teamCompare'
import { isLimitedSAgentId } from '@/composables/limitedGold'
import type { Agent } from '@/types/catalog'
import type { TeamGoldState } from './teamTimeline'

import { localized } from '@/utils/format'
import { signatureWEngineOf } from '@/composables/signatureWEngine'
// ========== 配装工具（基础金 / 预算感知加金 / 装配到 store） ==========

/** 基础音擎（0 金档）：
 * - 限定 S 角色：基础档直接带专属音擎（限定 → 计 1 金，与「队伍对比」基础档 = 0命1精+专武 同口径）；
 * - 非限定槽位：只选不占金的音擎（专属优先，其次同职业常驻/A 级）。 */
function baseWEngineFor(agent: Agent | null | undefined, catalog: ReturnType<typeof useCatalogStore>): string {
  if (!agent) return ''
  const ws = catalog.displayWEngines
  const sig = signatureWEngineOf(catalog, agent.id)
  if (isLimitedSAgentId(agent.id)) {
    if (sig) return sig.id
    return bestLimitedWEngineFor(agent, catalog) ?? ''
  }
  if (sig && !isLimitedWEngine(sig.id)) return sig.id
  const freeSpec = ws.find(w => w.specialty === agent.specialty && !isLimitedWEngine(w.id))
  if (freeSpec) return freeSpec.id
  if (sig) return sig.id
  const sameSpec = ws.find(w => w.specialty === agent.specialty)
  return sameSpec?.id ?? ws[0]?.id ?? ''
}

/** 槽位最佳限定音擎（花 1 金获取的候选；非限定槽位也可佩戴） */
export function bestLimitedWEngineFor(agent: Agent | null | undefined, catalog: ReturnType<typeof useCatalogStore>): string | null {
  if (!agent) return null
  const ws = catalog.displayWEngines
  const sig = signatureWEngineOf(catalog, agent.id)
  if (sig && isLimitedWEngine(sig.id)) return sig.id
  const sameSpec = ws.find(w => w.specialty === agent.specialty && isLimitedWEngine(w.id))
  return sameSpec?.id ?? null
}

export function baseStateFor(team: [string, string, string], catalog: ReturnType<typeof useCatalogStore>): TeamGoldState {
  return {
    cinemas: [0, 0, 0],
    wengineMods: [1, 1, 1],
    wEngines: [
      baseWEngineFor(catalog.getAgent(team[0]), catalog),
      baseWEngineFor(catalog.getAgent(team[1]), catalog),
      baseWEngineFor(catalog.getAgent(team[2]), catalog),
    ],
  }
}

/** 队伍基础总限定金 = 基础档（baseStateFor）的总限定金（teamGoldOf）：限定 S 角色本体 + 基础档限定音擎（各 1 金） */
export function baseGoldOfTeam(team: [string, string, string], catalog: ReturnType<typeof useCatalogStore>): number {
  const base = baseStateFor(team, catalog)
  return teamGoldOf(team, base.wEngines, base.cinemas, base.wengineMods)
}

/**
 * 预算感知的确定性加金步清单（主C优先：主C影画1..6 → 主C精炼2..5 → 队友1 → 队友2）。
 * 供「搜索排名」用：每队按目标金数做一次确定性分配（1 次伤害求值），
 * 排名即「所选金数下的大致强度」，比基础金排名更贴近最优加金结果（换人时机正确）。
 * 与 applyGoldSteps 同口径（总限定金、钳制到 [基础金, 基础金+步数]）。
 */
export function buildBudgetAwareGoldSteps(
  team: [string, string, string],
  catalog: ReturnType<typeof useCatalogStore>,
): { steps: Parameters<typeof applyGoldSteps>[0]; baseWEngines: [string, string, string] } {
  const steps: Parameters<typeof applyGoldSteps>[0] = []
  const baseWEngines = baseStateFor(team, catalog).wEngines
  for (let s = 0; s < 3; s++) {
    const agent = catalog.getAgent(team[s])
    if (!agent) continue
    const name = localized(agent.name, `槽位${s + 1}`)
    if (isLimitedSAgentId(team[s])) {
      for (let c = 1; c <= 6; c++) steps.push({ label: `${name} ${c}命`, slot: s, kind: 'cinema' as const, value: c })
    }
    const baseW = baseWEngines[s]
    if (baseW && isLimitedWEngine(baseW)) {
      for (let m = 2; m <= 5; m++) steps.push({ label: `${name} 精炼${m}`, slot: s, kind: 'wengine' as const, value: m })
    }
  }
  return { steps, baseWEngines }
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
  // setAgent 已按 interactionBaselineFor + ASSIST_ACTION_BASELINE 预填。
}

// ========== 让出事件循环 ==========

export function yieldNow(): Promise<void> {
  return new Promise(r => setTimeout(r, 0))
}
