/**
 * 角色面板钩子的**单一派发点**（core 层，零 store 依赖）。
 *
 * 为什么单独建（2026-10-18，用户报「百暴溢出」）：角色面板效果有两个出口——
 *   ① `calcPanel`（`core/panel.ts`）：基础 → 局外 → 局内的**纯 buff 管线**；
 *   ② `applyPanel`（`mechanics/types.ts` 的模块钩子）+ 技能等级通用规则：在**编排层**
 *      `panelPhases.ts#computePanelPhases` 里派发。
 * 于是凡是在 ① 上取「当前面板」的消费者（最典型：副词条「百暴」缺口基线
 * `core/substatOptimizer.ts#computeNoSubstatPanel`），读到的都是**没跑 ②** 的面板。
 *
 * 实测（2026-10-18，全角色扫描）：62 个角色里 8 个因此把暴击词条配到溢出——
 *   1591 希格莉德基线 19.4% / 真实 85.4%（核心被动 +66）⇒ 满 20 步暴击，实际 133.4%，浪费 13 步；
 *   1321 伊芙琳 10 步、1521 希希芙 7 步、1431 叶瞬光 7 步、1301 奥菲丝 4 步、1291 雨果 4 步、
 *   1441 真斗 4 步、1611 克拉蕾 1 步。修后同一部署下「优化词条」重排为 暴击 6 / 爆伤 18 / 攻击 19，
 *   队伍总伤 184.3M → 210.8M（+14.4%）。
 *
 * ⚠ **不是所有消费者都该派发**：`applyPanel` 里读的是「当前局内面板 + 机制滑块」，某些效果
 * 依赖调用方已写好的上游字段（`additionalAbilityActive`、`panel.skillLevelBonus`、cfg 里的次数）。
 * 本函数只承诺「在给定面板上按与 `computePanelPhases` **相同的顺序**补跑 ② 的两步」，
 * 需要更多上游信息的消费者应显式传 `additionalAbilityActive`，不要另抄一份。
 */
import type { Agent, PanelValues } from '@/types/catalog'
import { getAgentMechanic } from '@/mechanics/registry'
import type { AgentPanelInput, MechanicTeamMember } from '@/mechanics/types'

/**
 * 角色 `combatBuffs` 是否已自带 3/5 命技能等级提升（避免通用规则重复叠加）。
 * 数据驱动（读 catalog 的 cinemaBuffs），不需要 store。
 */
export function agentHasCinemaSkillLevelBuff(agent: Agent | undefined): boolean {
  return (agent?.combatBuffs.cinemaBuffs ?? []).some((cinema) =>
    (cinema.buff?.effects ?? []).some((e) => e.stat === 'skillLevelBonus'),
  )
}

/** 3/5 命技能等级 +2/+4 的通用规则（单一事实源；`computePanelPhases` 与基线面板共用）。 */
export function applyDefaultCinemaSkillLevelBonus(panel: PanelValues, agent: Agent | undefined, cinema: number): void {
  if (!agentHasCinemaSkillLevelBuff(agent)) {
    panel.skillLevelBonus = panel.skillLevelBonus + (cinema >= 5 ? 4 : cinema >= 3 ? 2 : 0)
  }
}

export interface ApplyAgentPanelHooksInput {
  agent: Agent
  /** 可写的局内面板（调用方负责先 `{ ...inCombat }` 拷贝） */
  panel: PanelValues
  /** 局外面板（`initialStat` / `outOfCombatStat` 口径的读取源） */
  outOfCombatPanel: PanelValues
  slot: number
  cinemaLevel: number
  potentialLevel: number
  team: readonly MechanicTeamMember[]
  /** 已解析的机制滑块（`resolveMechanicSettings` 同形）；缺省 `{}` ⇒ 模块内 `settingOf` 走声明缺省 */
  settings: Readonly<Record<string, number>>
  /** 已求值的额外能力门控（1 = 生效）；缺省 = 保留面板现有值 */
  additionalAbilityActive?: number
  /** 敌方失衡易伤基础值（叶瞬光帷幕算式的外部输入） */
  enemyStunVuln?: number
  /**
   * 是否派发队伍级面板效果（`teamPanelEffects`，队友给本槽的面板加成）。
   * - `true`：复刻伤害管线面板（编排层优化器的起点面板要这个，否则起点与真实面板又差一层）；
   * - 缺省 / `false`：只算**角色自身**面板（store 配装推荐口径：推荐配装与队友无关）。
   */
  withTeamPanelEffects?: boolean
}

/**
 * 补跑 `applyPanel` + 技能等级通用规则（顺序与 `computePanelPhases` 逐位一致：
 * 先写额外能力门控标记 → 再派发 `applyPanel` → 最后技能等级）。
 * 返回同一个 `panel` 引用（就地改）。
 */
export function applyAgentPanelHooks(input: ApplyAgentPanelHooksInput): PanelValues {
  const { panel, agent } = input
  if (input.additionalAbilityActive !== undefined) {
    panel.additionalAbilityActive = input.additionalAbilityActive
  }
  getAgentMechanic(agent.id)?.applyPanel?.({
    slot: input.slot,
    agent,
    cinemaLevel: input.cinemaLevel,
    potentialLevel: input.potentialLevel,
    team: input.team,
    outOfCombatPanel: input.outOfCombatPanel,
    panel,
    settings: input.settings,
    enemyStunVuln: input.enemyStunVuln ?? 0,
  } satisfies AgentPanelInput)
  applyDefaultCinemaSkillLevelBonus(panel, agent, input.cinemaLevel)
  // 队伍级面板效果（`teamPanelEffects`）：与 `computePanelPhases` 的第二个派发点同序（按槽位序、可交换加法）。
  // 只有**要复刻伤害管线面板**的消费者才该打开（`withTeamPanelEffects`）——store 的推荐配装口径是
  // 「与队友无关」，开了就会把队友拐力算进百暴基线。
  if (input.withTeamPanelEffects) {
    for (const src of [...input.team].sort((a, b) => a.slot - b.slot)) {
      if (!src.agentId || !src.agent) continue
      getAgentMechanic(src.agentId)?.teamPanelEffects?.({
        slot: src.slot,
        agent: src.agent,
        cinemaLevel: src.cinemaLevel,
        team: input.team,
        targetSlot: input.slot,
        targetAgent: agent,
        panel,
        settings: input.settings,
      })
    }
  }
  return panel
}
