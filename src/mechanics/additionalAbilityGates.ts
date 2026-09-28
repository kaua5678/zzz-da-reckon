/**
 * CC-206：额外能力硬门控求值（原在 `composables/resourceCalc/panelPhases.ts`，逐字迁入）。
 *
 * 为什么放 mechanics 层：引擎（panelPhases 面板阶段）与 store 默认门控（`stores/config.ts#deriveTeammateBuffEnabled`）
 * 都要调它。store 值导入 panelPhases 会成环（`resourceCalc/helpers.ts` 值导入 stores/config），本函数的依赖
 * （spec 注册表、teamCondition、门控表、模块注册表）两边都已在用 ⇒ 放这里零新边。
 * 从 `./registry` 取 getAgentMechanic（不走 `./index`，避免与各角色模块互相 import）。
 */
import type { Agent, TeammateBuffGroup } from '@/types/catalog'
import type { ReadonlyTeam } from './types'
import { getAgentMechanic } from './registry'
import { getAgentSpec } from '@/specs/registry'
import { evalAdditionalAbility } from '@/specs/teamCondition'
import { additionalGateBuffTable } from '@/specs/additionalGate'

/**
 * 求 `additionalGateBuffTable(groups)` 的全部门控：buffId → 是否放行（未登记的 buff 不在 Map 中 = 不受门控，
 * 消费方判据为 `gates.get(buff.id) !== false`）。求值时机与迁移前逐位一致：面板阶段（calcPanel 之前）一次求值。
 */
export function evalAdditionalAbilityBuffGates(
  team: ReadonlyTeam,
  getCatalogAgent: (agentId: string) => Agent | null,
  groups: readonly TeammateBuffGroup[],
): Map<string, boolean> {
  const table = additionalGateBuffTable(groups)
  // 第一步：每角色按 spec additionalAbility 声明求值（不在队 = false）；slot 查找走索引表，零 agentId 特判
  const slotByAgentId = new Map<string, number>(team.map(member => [member.agentId, member.slot]))
  const activeByAgent = new Map<string, boolean>()
  for (const agentId of Object.keys(table)) {
    const slot = slotByAgentId.get(agentId) ?? -1
    activeByAgent.set(agentId, slot >= 0
      && evalAdditionalAbility(team, slot, getCatalogAgent(agentId), getAgentSpec(agentId)?.additionalAbility) === true)
  }
  // 第二步：展平为 buffId → active
  const gates = new Map<string, boolean>()
  for (const [agentId, buffIds] of Object.entries(table)) {
    for (const buffId of buffIds) gates.set(buffId, activeByAgent.get(agentId) === true)
  }
  // 第三步（CC-67）：在队角色的专属修正经模块能力 adjustAdditionalAbilityGates（凯撒「有任意队友」、菲欧妮 tier3「异常数≥3」；
  // 原在此按 id 写死）。各模块只改自己登记的 buff id ⇒ 顺序无关。
  for (const member of team) {
    const mod = member.agentId ? getAgentMechanic(member.agentId) : undefined
    mod?.adjustAdditionalAbilityGates?.({ team, slot: member.slot, gates })
  }
  return gates
}
