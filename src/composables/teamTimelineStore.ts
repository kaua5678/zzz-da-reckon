/**
 * 队伍时间线共享工具：现场快照/恢复、基础金与预算感知加金、装配队伍到 store、让出事件循环。
 * CC-86（2026-09-27，census §5.92）自 `composables/teamTimeline.ts` 逐字拆出；teamTimeline.ts 原样转出公开名，导入方不用改。
 */
import { getInteractionDefaults, roleInteractionBaseline, useConfigStore } from '@/stores/config'
import { useCatalogStore } from '@/stores/catalog'
import { isLimitedAgent, isLimitedWEngine, applyGoldSteps } from '@/composables/teamCompare'
import type { Agent } from '@/types/catalog'
import type { TeamGoldState } from './teamTimeline'

// ========== 现场快照 / 恢复 ==========

export interface StoreSnapshot {
  team: unknown[]
  enemy: unknown
  appliedBoss: unknown
  stunAxes: unknown[]
  stunAxisPlans: unknown[]
  useStunAxis: boolean
  globalBuffs: unknown[]
}

export function snapshotStore(configStore: ReturnType<typeof useConfigStore>): StoreSnapshot {
  return {
    team: JSON.parse(JSON.stringify(configStore.team)),
    enemy: JSON.parse(JSON.stringify(configStore.enemy)),
    appliedBoss: configStore.appliedBoss,
    stunAxes: JSON.parse(JSON.stringify(configStore.stunAxes)),
    stunAxisPlans: JSON.parse(JSON.stringify(configStore.stunAxisPlans)),
    useStunAxis: configStore.useStunAxis,
    globalBuffs: JSON.parse(JSON.stringify(configStore.globalBuffs)),
  }
}

export function restoreStore(configStore: ReturnType<typeof useConfigStore>, snap: StoreSnapshot) {
  configStore.team.splice(0, configStore.team.length, ...(snap.team as never[]))
  configStore.setEnemy(snap.enemy as never)
  configStore.appliedBoss = snap.appliedBoss as never
  configStore.stunAxes.splice(0, configStore.stunAxes.length, ...(snap.stunAxes as never[]))
  configStore.stunAxisPlans.splice(0, configStore.stunAxisPlans.length, ...(snap.stunAxisPlans as never[]))
  configStore.useStunAxis = snap.useStunAxis
  configStore.globalBuffs.splice(0, configStore.globalBuffs.length, ...(snap.globalBuffs as never[]))
}

// ========== 配装工具（基础金 / 预算感知加金 / 装配到 store） ==========

/** 基础音擎（0 金档）：
 * - 限定 S 角色：基础档直接带专属音擎（限定 → 计 1 金，与「队伍对比」基础档 = 0命1精+专武 同口径）；
 * - 非限定槽位：只选不占金的音擎（专属优先，其次同职业常驻/A 级）。 */
function baseWEngineFor(agent: Agent | null | undefined, catalog: ReturnType<typeof useCatalogStore>): string {
  if (!agent) return ''
  const ws = catalog.displayWEngines
  const sig = ws.find(w => w.ownerAgentId === agent.id)
  if (isLimitedAgent(agent.id)) {
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
  const sig = ws.find(w => w.ownerAgentId === agent.id)
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

/** 队伍基础总限定金 = 限定 S 角色本体 + 基础档限定音擎（各 1 金） */
export function baseGoldOfTeam(team: [string, string, string], catalog: ReturnType<typeof useCatalogStore>): number {
  let gold = 0
  for (let s = 0; s < 3; s++) {
    if (isLimitedAgent(team[s])) gold += 1
    const w = baseWEngineFor(catalog.getAgent(team[s]), catalog)
    if (w && isLimitedWEngine(w)) gold += 1
  }
  return gold
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
    const name = agent.name.zhCN ?? agent.name.en ?? `槽位${s + 1}`
    if (isLimitedAgent(team[s])) {
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
  configStore: ReturnType<typeof useConfigStore>,
  team: [string, string, string],
  state: TeamGoldState,
  autoBuild = false,
) {
  if (autoBuild) {
    configStore.applyTeamPreset(team)
  } else {
    for (let s = 0; s < 3; s++) configStore.setAgent(s, team[s], { defer: true })
    configStore.syncTeammateBuffsFromTeam()
    for (let s = 0; s < 3; s++) {
      const char = configStore.team[s]
      if (!char) continue
      const m5 = char.driveDisc.mainStats[5]
      char.driveDisc.mainStats = { 5: m5 } as typeof char.driveDisc.mainStats
      char.driveDisc.subStatAllocation = {}
    }
  }
  for (let s = 0; s < 3; s++) {
    configStore.setCinemaLevel(s, state.cinemas[s])
    configStore.setWEngineModLevel(s, state.wengineMods[s])
    if (state.wEngines[s]) configStore.setWEngine(s, state.wEngines[s])
    // 交互基准：角色专属默认（般岳/星徽·比利等）> 通用职业基准（支援/防护不交互，击破只弹刀，主C弹刀+闪反）
    const defs = getInteractionDefaults(team[s])
    const hasCustom = defs.parry > 0 || defs.dodge > 0 || defs.block > 0 || defs.dual > 0
    const base = hasCustom ? defs : roleInteractionBaseline(useCatalogStore().getAgent(team[s])?.specialty)
    configStore.setParryCount(s, base.parry)
    configStore.setDodgeCounterCount(s, base.dodge)
    configStore.setBlockCount(s, base.block)
    configStore.setDualCounterCount(s, base.dual)
    configStore.setQuickAssistCount(s, 3)
    configStore.setChainCountPerStun(s, 1)
  }
}

// ========== 让出事件循环 ==========

export function yieldNow(): Promise<void> {
  return new Promise(r => setTimeout(r, 0))
}
