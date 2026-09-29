import type { Agent } from '@/types/catalog'
import type { MechanicTeamMember } from '@/mechanics/types'
import type { AdditionalAbilitySpec, TeamConditionSpec } from './types'

/**
 * 条件求值只读队员的 slot / agentId / agent（CC-306：放宽为结构子集，让只有「压缩 Agent 列表」的调用方
 * ——如 teammateBuffGate 钩子——也能直接用本求值器，不必再手写一份条件）。`ReadonlyTeam` 可直接传入。
 */
export type TeamConditionTeam = ReadonlyArray<Readonly<Pick<MechanicTeamMember, 'slot' | 'agentId' | 'agent'>>>

/**
 * 额外能力触发条件统一判定（声明式）。
 * 满足任一条件即触发；不带 additionalAbility 声明时返回 undefined（未声明，由模块自行处理）。
 */
export function evalTeamConditions(
  team: TeamConditionTeam,
  ownSlot: number,
  agent: Agent | null,
  conditions: TeamConditionSpec[],
): boolean {
  for (const cond of conditions) {
    if (matchTeamCondition(team, ownSlot, agent, cond)) return true
  }
  return false
}

export function evalAdditionalAbility(
  team: TeamConditionTeam,
  ownSlot: number,
  agent: Agent | null,
  spec: AdditionalAbilitySpec | undefined,
): boolean | undefined {
  if (!spec || !spec.teamConditions.length) return undefined
  return evalTeamConditions(team, ownSlot, agent, spec.teamConditions)
}

function matchTeamCondition(
  team: TeamConditionTeam,
  ownSlot: number,
  agent: Agent | null,
  cond: TeamConditionSpec,
): boolean {
  const candidates = team.filter(m => {
    if (m.slot === ownSlot) return false // 自身不算
    if (cond.type === 'specialty' && cond.excludeSelf === true && m.agentId === agent?.id) return false
    return true
  })

  switch (cond.type) {
    case 'specialty':
      return candidates.some(m => m.agent && cond.values.includes(m.agent.specialty))
    case 'sameFactionAsSelf':
      return candidates.some(m => m.agent && agent?.faction != null && m.agent.faction === agent.faction)
    case 'sameAttributeAsSelf':
      return candidates.some(m => m.agent && agent?.attribute != null && m.agent.attribute === agent.attribute)
    case 'sameSpecialtyAsSelf':
      return candidates.some(m => m.agent && agent?.specialty != null && m.agent.specialty === agent.specialty)
    default:
      return false
  }
}
