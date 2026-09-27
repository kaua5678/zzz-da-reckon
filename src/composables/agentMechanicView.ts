/**
 * 展示层读取角色模块**声明式数据**的只读门面（CC-47，2026-09-27，判据 7「展示层越层 import」还款）。
 *
 * views/components 不直接 import '@/mechanics'（判据 7），改经本文件取模块声明：
 * settings（机制设置表）/ combos（轴连段定义）/ resourceSections（资源卡专属分区）。
 * 纯转发：不计算、不缓存；语义与原展示层内联写法逐位一致（见各函数注释）。
 */
import { getAgentMechanic } from '@/mechanics'
import type { AgentMechanicModule, AxisEditorBlockMark } from '@/mechanics/types'
import type { MechanicSetting } from '@/types/resource'

/**
 * 队伍各槽模块声明的机制设置，按 `setting.id` 去重、**先出现的槽位优先**；
 * 顺序 = 槽位顺序 × 模块内声明顺序；空槽跳过。
 * 原位置：ResourceUtilizationPage.vue `mechanicSettings`、ImpactChart.vue `settingMap`（两处同口径）。
 */
export function teamMechanicSettings(
  team: ReadonlyArray<{ agentId?: string | null } | null | undefined>,
): MechanicSetting[] {
  const seen = new Set<string>()
  const out: MechanicSetting[] = []
  for (const char of team) {
    if (!char?.agentId) continue
    for (const setting of getAgentMechanic(char.agentId)?.settings ?? []) {
      if (seen.has(setting.id)) continue
      seen.add(setting.id)
      out.push(setting)
    }
  }
  return out
}

/** 角色模块声明的轴连段（原位置：StunAxisPage.vue 轴块候选列表） */
export function agentCombos(agentId: string | null | undefined): AgentMechanicModule['combos'] {
  return agentId ? getAgentMechanic(agentId)?.combos : undefined
}

export type AgentResourceSectionsInput = Parameters<NonNullable<AgentMechanicModule['resourceSections']>>[0]
export type AgentResourceSections = ReturnType<NonNullable<AgentMechanicModule['resourceSections']>>

/**
 * 资源卡专属分区；模块未声明 ⇒ []。按方法调用（保留 this 绑定，与原 `?.resourceSections?.(…)` 一致）。
 * 原位置：ResourceResultCard.vue `specialResourceSections`。
 */
export function agentResourceSections(
  agentId: string | null | undefined,
  input: AgentResourceSectionsInput,
): AgentResourceSections {
  const mod = agentId ? getAgentMechanic(agentId) : undefined
  return mod?.resourceSections?.(input) ?? []
}

export type AgentAxisBlockMarksInput = Parameters<NonNullable<AgentMechanicModule['axisEditorBlockMarks']>>[0]

/**
 * 轴编辑器逐块标注（CC-48）：模块能力 `axisEditorBlockMarks`；未声明或空 id ⇒ 空 Map。
 * 原位置：StunAxisPage.vue 直调 computeBanyueMingwangBlocks / computeYixuanNingshenBlocks。
 */
export function agentAxisBlockMarks(
  agentId: string | null | undefined,
  input: AgentAxisBlockMarksInput,
): Map<string, AxisEditorBlockMark> {
  const mod = agentId ? getAgentMechanic(agentId) : undefined
  return mod?.axisEditorBlockMarks?.(input) ?? new Map()
}

/** 轴编辑器招式元数据（CC-48）：模块声明 `axisMoveMeta`；原位置 StunAxisPage.vue 读 BANYUE_AXIS_MOVE_META */
export function agentAxisMoveMeta(agentId: string | null | undefined): AgentMechanicModule['axisMoveMeta'] {
  return agentId ? getAgentMechanic(agentId)?.axisMoveMeta : undefined
}

export type ReleaseShareDecl = NonNullable<AgentMechanicModule['releaseShare']>

/**
 * 队伍里声明了「异放占比可调」的角色（CC-55）：按槽位顺序、按 namespace 去重；空槽 / catalog 查不到跳过。
 * 每个角色同时按 `agent.id` 与 `agent.teammateBuffId` 查模块——与原展示层写死判断
 * `agent?.id === '1171' || agent?.teammateBuffId === '1171'`（ResourceUtilizationPage / ImpactChart）同口径。
 */
export function teamReleaseShares(
  team: ReadonlyArray<{ agentId?: string | null } | null | undefined>,
  getAgent: (id: string) => { id: string; teammateBuffId?: string } | null | undefined,
): ReleaseShareDecl[] {
  const out: ReleaseShareDecl[] = []
  const seen = new Set<string>()
  for (const char of team) {
    if (!char?.agentId) continue
    const agent = getAgent(char.agentId)
    if (!agent) continue
    for (const id of [agent.id, agent.teammateBuffId]) {
      if (!id) continue
      const decl = getAgentMechanic(id)?.releaseShare
      if (!decl || seen.has(decl.namespace)) continue
      seen.add(decl.namespace)
      out.push(decl)
    }
  }
  return out
}

type AgentIdentity = { id: string; teammateBuffId?: string }
/** 按 `agent.id` 与 `agent.teammateBuffId` 各查一次模块（与原展示层 `agent?.id === X || agent?.teammateBuffId === X` 同口径） */
function identityModules(agent: AgentIdentity | null | undefined): AgentMechanicModule[] {
  if (!agent) return []
  const out: AgentMechanicModule[] = []
  for (const id of [agent.id, agent.teammateBuffId]) {
    const mod = id ? getAgentMechanic(id) : undefined
    if (mod) out.push(mod)
  }
  return out
}

export type TeammateSplitDecl = NonNullable<AgentMechanicModule['teammateSplit']>

/**
 * 队伍里第一个声明 `teammateSplit` 的槽位（CC-56）；无 ⇒ null。
 * 原位置：ResourceUtilizationPage.vue `remielleQSetting` 的 `findIndex(agent?.id === '1581' || agent?.teammateBuffId === '1581')`。
 */
export function teamTeammateSplit(
  team: ReadonlyArray<{ agentId?: string | null } | null | undefined>,
  getAgent: (id: string) => AgentIdentity | null | undefined,
): { slot: number; split: TeammateSplitDecl } | null {
  for (let slot = 0; slot < team.length; slot++) {
    const char = team[slot]
    if (!char?.agentId) continue
    for (const mod of identityModules(getAgent(char.agentId))) {
      if (mod.teammateSplit) return { slot, split: mod.teammateSplit }
    }
  }
  return null
}

/**
 * 风化浸染默认挑槽是否排除该角色（CC-56）：模块声明 `excludeFromWindInfectionPick`（CC-42，引擎 anomalyPanels 同源）。
 * 原位置：ResourceUtilizationPage.vue `windInfectionConfig` 的 `isRemielle: agent?.id === '1581' || …`。
 */
export function agentExcludedFromWindInfectionPick(agent: AgentIdentity | null | undefined): boolean {
  return identityModules(agent).some(mod => !!mod.excludeFromWindInfectionPick)
}
