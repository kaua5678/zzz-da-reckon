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
import type { TeamConditionTeam } from '@/specs/teamCondition'
import { additionalGateBuffTable } from '@/specs/additionalGate'

/**
 * CC-306：角色**额外能力是否触发**的唯一求值入口（按该角色 spec `additionalAbility.teamConditions` 声明式判定，
 * 与面板阶段写 `panel.additionalAbilityActive` 的 `panelPhases.ts` 同一求值器）。只给**拿不到本槽面板标记**的钩子用
 * （teammateBuffGate 这类面板阶段之前的钩子）。applyPanel（派发前已写好标记）、buildCharConfig（入参 `panel`）、
 * transformSkillExecutions（入参 `panel`）一律读 `additionalAbilityActiveOf(panel)`，不在那里重算（r760 收口）。
 * 现存唯一调用者 `remielle.ts#computeRemielleAdditionalState`：三档状态同时供 teammateBuffGate 与面板/配置钩子，共用一份求值。
 * **不要再手写「队里有 X 特性或同阵营」**——原先简 / 琉音 / 诺姆 / 蕾米埃尔各写了一份，与 spec 声明是两套来源（改 spec 不生效）。
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
 * 返回被拥有者模块否决（返回 false）的 buff id 集合。
 *
 * 为什么引擎也要执行：现有两个声明者都是**正确性约束**，不是默认值偏好——
 * - 蕾米埃尔 atk_1/2/3 是互斥档位，refringe_3 只在 3 档成立；强行全勾会叠加多档；
 * - 波可娜 6 命时基础条 `pulchra_extra_trap_followup` 必须关，否则与 `pulchra_cinema_6_trap_all` 重复计算。
 * CC-207 之前只有 store 读本钩子 ⇒ 用户强行勾上时引擎照算。
 *
 * **只问拥有者**（r403 CC-377）：buff 组 id = 拥有者 agentId（CC-275 加载处归一，spec teamBuffs 也并进本人组），
 * 所以每个组只派给 `getAgentMechanic(group.id)` 的钩子，并给出 `self`（本人那一槽，不在队 undefined；r410 CC-384 取代 `selfCinema`，
 * team 也由压缩 `Agent[]` 改为同一份 `ReadonlyTeam`，模块不再按 id 自找、拿下标当槽位）。
 * 原先每条 buff 都问**全部已注册模块**，模块再按 buffId / groupId 自己认领——与 r399 CC-373 修掉的
 * 「派给所有人、各自扫一遍找自己」是同一个病。两个声明者的 6 条门控 buff 都只在本人组（数据核对见 CC-377），故逐值等价。
 * r411 CC-385：拥有者不在队时**不询问**（原「仍询问」）。依据：store 侧该组 base 恒为 false；引擎侧不在队拥有者的 buff
 * 已由 `core/inCombatBuffs.ts#collectInCombatTeamBuffs` 丢弃 ⇒ 询问结果不可能生效，留着只会让模块多写一条「不在队」分支。
 */
export function teammateBuffGateBlocks(team: ReadonlyTeam, groups: readonly TeammateBuffGroup[]): Set<string> {
  const blocked = new Set<string>()
  for (const group of groups) {
    const gate = getAgentMechanic(group.id)?.teammateBuffGate
    if (!gate) continue
    // 本人判据与原 selfCinema 口径一致：agentId 匹配且 agent 可查
    const self = team.find(member => member.agentId === group.id && !!member.agent)
    if (!self) continue
    for (const buff of group.buffs) {
      if (gate({ buffId: buff.id, team, self }) === false) blocked.add(buff.id)
    }
  }
  return blocked
}
