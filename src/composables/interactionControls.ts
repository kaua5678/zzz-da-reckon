/** 交互旋钮的单一声明：零档、策略搜索与曲线共用；哨兵字段只由模块显式声明进入爬升面。 */
import { ACTION_COUNT_BOUNDS, type ActionCountField, type ConfigModel } from '@/stores/config'
import type { ResourceCalc } from '@/composables/useResourceCalc'
import { getAgentMechanic } from '@/mechanics/registry'
import { getInteractionDefaults } from '@/mechanics/interactionBaseline'
import { COMBO_ALIGN_ABSORB_RATIO_SETTING, DEFAULT_COMBO_ALIGN_ABSORB_RATIO } from '@/data/resourceDefaults'

export interface InteractionContext {
  config: ConfigModel
  calc: ResourceCalc
  absorbCap?: number
}

export const INTERACTION_COUNT_KEYS = [
  'parryCount', 'dodgeCounterCount', 'blockCount', 'perfectBlockCount', 'assaultOrderCount',
  'dualCounterCount', 'tauntCancelCount', 'claretBurialInterruptCount',
  'yixuanInk2Count', 'yixuanInk3Count', 'yixuanPerfectBlockCount', 'promiaNiyingCount',
] as const

export const TAUNT_CANCEL_FULL = ACTION_COUNT_BOUNDS.tauntCancelCount.max

export function absorbCapOf(ctx: InteractionContext): number {
  const cap = ctx.absorbCap ?? ctx.config.getMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, DEFAULT_COMBO_ALIGN_ABSORB_RATIO)
  return Number.isFinite(cap) ? Math.min(1, Math.max(0, cap)) : DEFAULT_COMBO_ALIGN_ABSORB_RATIO
}

export function tauntLeverSlots(config: ConfigModel): number[] {
  return config.team.flatMap((row, slot) => row.agentId
    && getAgentMechanic(row.agentId)?.characterCountInputs?.some(i => i.field === 'tauntCancelCount') ? [slot] : [])
}

/** ① 原有全零实现逐位保留：不改权重/连携/负值哨兵，不初始化缺省字段。 */
export function clearInteractions(ctx: InteractionContext): void {
  for (let slot = 0; slot < 3; slot++) {
    for (const field of INTERACTION_COUNT_KEYS) {
      if (ctx.config.team[slot]?.[field] !== undefined) ctx.config.setActionCount(slot, field, 0)
    }
  }
}

/** 搜索种子取角色声明；只能作为待评估候选，不能绕过伤害与截断门。 */
export function applyRoleInteractionBaseline(ctx: InteractionContext): void {
  ctx.config.team.forEach((row, slot) => {
    if (!row.agentId) return
    const d = getInteractionDefaults(row.agentId)
    const pairs: Array<readonly [ActionCountField, number]> = [
      ['parryCount', d.parry], ['dodgeCounterCount', d.dodge], ['blockCount', d.block], ['dualCounterCount', d.dual],
    ]
    for (const [field, count] of pairs) if (count > 0) ctx.config.setActionCount(slot, field, count)
  })
}

/** 可调项按槽位声明；0=自动/−1=自动的输入不会被当作普通计数扫描。 */
export function interactionFieldsAt(config: ConfigModel, slot: number): ActionCountField[] {
  const row = config.team[slot]
  if (!row?.agentId) return []
  const mod = getAgentMechanic(row.agentId)
  const defaults = getInteractionDefaults(row.agentId)
  const fields = new Set<ActionCountField>(['parryCount', 'dodgeCounterCount'])
  /** 哨兵语义字段（≤0=自动）绝不进爬升面（T171） */
  const sentinels = new Set<ActionCountField>(['yixuanInk2Count', 'yixuanInk3Count', 'yixuanPerfectBlockCount', 'yixuanExtremeAssistCount'])
  if (defaults.block > 0 || mod?.interactionFieldTypes?.blockCount) fields.add('blockCount')
  if (defaults.dual > 0 || mod?.interactionFieldTypes?.dualCounterCount) fields.add('dualCounterCount')
  // 角色专属输入：只收**模块声明**且非哨兵的字段（与基线同口径）
  for (const input of mod?.characterCountInputs ?? []) {
    if (!sentinels.has(input.field) && input.field !== 'tauntCancelCount') fields.add(input.field)
  }
  if (mod?.interactionClimb) fields.add(mod.interactionClimb.field)
  return [...fields]
}

export function climbFieldsOf(ctx: InteractionContext): ActionCountField[] {
  return [...new Set(ctx.config.team.flatMap((_, slot) => interactionFieldsAt(ctx.config, slot)))]
}
