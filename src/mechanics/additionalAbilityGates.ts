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
import { getAgentMechanic, getRegisteredAgentMechanics } from './registry'
import { getAgentSpec } from '@/specs/registry'
import { evalAdditionalAbility } from '@/specs/teamCondition'
import type { TeamConditionTeam } from '@/specs/teamCondition'
import { additionalGateBuffTable } from '@/specs/additionalGate'

/**
 * CC-306：角色**额外能力是否触发**的唯一求值入口（按该角色 spec `additionalAbility.teamConditions` 声明式判定，
 * 与面板阶段写 `panel.additionalAbilityActive` 的 `panelPhases.ts` 同一求值器）。模块在拿不到面板标记的钩子
 * （buildCharConfig / teammateBuffGate 等）里用它，**不要再手写「队里有 X 特性或同阵营」**——原先
 * 简 / 琉音 / 诺姆 / 蕾米埃尔各写了一份，与 spec 声明是两套来源（改 spec 不生效）。
 * 未声明 `additionalAbility` 或 agent 为空 ⇒ false。
 */
export function specAdditionalAbilityActive(team: TeamConditionTeam, slot: number, agent: Agent | null | undefined): boolean {
  if (!agent) return false
  return evalAdditionalAbility(team, slot, agent, getAgentSpec(agent.id)?.additionalAbility) === true
}

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

/**
 * CC-207：模块钩子 `teammateBuffGate` 的求值（store 默认门控与引擎共用，同 CC-206 的做法）。
 * 返回被任一模块否决（返回 false）的 buff id 集合；多个模块表态时为逻辑与（CC-76），与注册顺序无关。
 *
 * 为什么引擎也要执行：现有两个声明者都是**正确性约束**，不是默认值偏好——
 * - 蕾米埃尔 atk_1/2/3 是互斥档位，refringe_3 只在 3 档成立；强行全勾会叠加多档；
 * - 波可娜 6 命时基础条 `pulchra_extra_trap_followup` 必须关，否则与 `pulchra_cinema_6_trap_all` 重复计算。
 * CC-207 之前只有 store 读本钩子 ⇒ 用户强行勾上时引擎照算。
 *
 * `groupCinema` 按组 id 查在队影画（组 id = agentId 或 `agent.teammateBuffId` 别名；不在队 undefined），
 * 与迁移前 store 的 teamCinema 双键逐值一致。`team` 传给钩子的是队内查得到 Agent 的角色（槽位顺序）。
 */
export function teammateBuffGateBlocks(team: ReadonlyTeam, groups: readonly TeammateBuffGroup[]): Set<string> {
  const blocked = new Set<string>()
  const gates = getRegisteredAgentMechanics().flatMap(m => (m.teammateBuffGate ? [m.teammateBuffGate] : []))
  if (gates.length === 0) return blocked
  const agents: Agent[] = []
  const cinemaByGroup = new Map<string, number>()
  for (const member of team) {
    if (!member.agent || !member.agentId) continue
    agents.push(member.agent)
    cinemaByGroup.set(member.agentId, member.cinemaLevel ?? 0)
  }
  for (const group of groups) {
    const groupCinema = cinemaByGroup.get(group.id)
    for (const buff of group.buffs ?? []) {
      for (const gate of gates) {
        if (gate({ buffId: buff.id, team: agents, groupId: group.id, groupCinema }) === false) { blocked.add(buff.id); break }
      }
    }
  }
  return blocked
}
