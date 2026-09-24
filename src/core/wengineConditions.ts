/**
 * 音擎被动 condition 的可判定子集。
 *
 * 只拦截引擎能从现有战斗状态判定的条件。散文条件（层数、后台、特定招式）
 * 仍由覆盖率滑块近似，这里返回 true，避免把没读懂的被动静默清零。
 * 新音擎只要把 condition 写成已登记的机器名，不用再加角色分支。
 */
import { ATTRIBUTE_LABEL } from '@/utils/agentLabelMaps'

export interface WEngineConditionContext {
  /** 装备者属性（ice/fire/…） */
  wearerAttribute?: string
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
