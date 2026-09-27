/**
 * 音擎被动 condition 的可判定子集。
 *
 * 只拦截引擎能从现有战斗状态判定的条件。散文条件（层数、后台、特定招式）
 * 仍由覆盖率滑块近似，这里返回 true，避免把没读懂的被动静默清零。
 * 新音擎只要把 condition 写成已登记的机器名，不用再加角色分支。
 */
import type { EffectRequirement } from '@/types/catalog'
import { ATTRIBUTE_LABEL } from '@/utils/agentLabelMaps'

export interface WEngineConditionContext {
  /** 装备者属性（ice/fire/…） */
  wearerAttribute?: string
  /** 装备者特化（attack/anomaly/…），effect 级 requirement.specialty 用 */
  wearerSpecialty?: string
  /** 装备者 agent.id，effect 级 requirement.wearerAgentIds 用（CC-103） */
  wearerAgentId?: string
  /**
   * 当前敌人弱点（中文，与 Boss 预设 phase.weakness 同口径）。
   * 缺省或空 = 未声明，不拦截（未选 Boss / 测试夹具保持原行为）。
   */
  enemyWeakness?: readonly string[]
}

/** 装备者属性是否克制当前弱点。弱点未声明时返回 true（不拦截）。 */
export function attributeCounterMet(attribute: string | undefined, weakness: readonly string[] | undefined): boolean {
  if (!weakness || weakness.length === 0) return true
  if (!attribute) return false
  const label = ATTRIBUTE_LABEL[attribute]
  if (!label) return false
  return weakness.some(w => w === label || w === attribute)
}

/** condition 缺省或未知 = 生效；已登记条件按上下文判定。 */
export function wEngineConditionMet(condition: string | undefined, ctx: WEngineConditionContext = {}): boolean {
  if (!condition) return true
  if (condition === 'attributeCounter') return attributeCounterMet(ctx.wearerAttribute, ctx.enemyWeakness)
  return true
}

/**
 * 音擎 effect 级 requirement（CC-102 / R5 D19）：按装备者 specialty / attribute 判定，
 * 与驱动盘 discRequirementMet 同口径；另支持 wearerAgentIds 装备者名单（CC-103）。装备者信息缺省 = 不拦截（测试夹具保持原行为）。
 * outOfCombatStat 门槛当前音擎数据 0 处，这里不判定（返回 true）；若日后出现需接粗算面板。
 */
export function wEngineEffectRequirementMet(req: EffectRequirement | undefined, ctx: WEngineConditionContext = {}): boolean {
  if (!req) return true
  if (req.specialty && ctx.wearerSpecialty && ctx.wearerSpecialty !== req.specialty) return false
  if (req.attribute && ctx.wearerAttribute && ctx.wearerAttribute !== req.attribute) return false
  if (req.wearerAgentIds?.length && ctx.wearerAgentId && !req.wearerAgentIds.includes(ctx.wearerAgentId)) return false
  return true
}
