/**
 * 本轮极性强击赠送次数（模块能力 `giftedPolarAssaultCount`）的单一派发点（CC-75，2026-09-27）。
 *
 * **口径裁定（census §5.82）：多提供方 = 求和。** 每个角色的赠送是各自独立触发的 physical_polar_assault，
 * 互不替代 ⇒ 相加。原实现「取队内第一个爱丽丝」与求和在「队内角色不重复」时等价（CC-38b）；
 * 同角色多槽在 UI 层被过滤（stores/config.ts「队伍中已选的角色 ID（用于过滤重复选择）」），真出现时也按求和
 * （两位角色各自的星芒圆舞曲 #3 是两次独立触发）。
 *
 * ⚠ 已知耦合：注入异常池时 `roundInputs.ts#calcAnomalyPoolInput` 还要求本队有 `anomalyPoolSetup` 声明者
 * （`giftedTriggerCounts: setup && gifted > 0 ? … : undefined`）。现唯一提供方爱丽丝同时声明两者，无影响；
 * 若日后新增只声明 `giftedPolarAssaultCount` 的角色，它的赠送会被静默丢弃——届时去掉 `setup &&`（并跑 perf 零差）。
 */
import type { CharacterResourceResult } from '@/types/resource'
import { getAgentMechanic } from '@/mechanics'

/** 单个角色本轮的赠送次数；无此能力 / 空槽 ⇒ 0。 */
export function giftedPolarAssaultOf(c: CharacterResourceResult): number {
  return (c.agentId ? getAgentMechanic(c.agentId)?.giftedPolarAssaultCount?.(c) : 0) ?? 0
}

/** 全队求和（注入异常池 `giftedTriggerCounts['physical_polar_assault']` 的值）。 */
export function sumGiftedPolarAssault(chars: readonly CharacterResourceResult[]): number {
  return chars.reduce((sum, c) => sum + giftedPolarAssaultOf(c), 0)
}
