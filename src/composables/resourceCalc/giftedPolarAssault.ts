/**
 * 本轮极性强击赠送次数（模块能力 `giftedPolarAssaultCount`）的单一派发点（CC-75，2026-09-27）。
 *
 * **口径裁定（census §5.82）：多提供方 = 求和。** 每个角色的赠送是各自独立触发的 physical_polar_assault，
 * 互不替代 ⇒ 相加。原实现「取队内第一个爱丽丝」与求和在「队内角色不重复」时等价（CC-38b）；
 * 同角色多槽在 UI 层被过滤（stores/config.ts「队伍中已选的角色 ID（用于过滤重复选择）」），真出现时也按求和
 * （两位角色各自的星芒圆舞曲 #3 是两次独立触发）。
 *
 * 归属槽位（CC-78 解耦）：`roundInputs.ts#calcAnomalyPoolInput` 原要求本队有 `anomalyPoolSetup` 声明者才注入赠送，
 * 槽位也取 setup.slot；现注入不再看 setup，槽位 = `setup?.slot ?? firstGiftedPolarAssaultSlot(...)`。
 * 爱丽丝在队时 setup 恒存在（alice.ts applyTeamConfig 无条件置 `cfg.aliceEnabled = true`）且 slot 就是她 ⇒ 逐值不变；
 * 多提供方时赠送次数求和、全部记在 setup 槽（无 setup 时记在第一个有赠送的槽）——按槽细分属日后功能，届时改 giftedTriggerCounts 结构。
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

/** 第一个本轮赠送次数 > 0 的角色槽位；无 ⇒ undefined（CC-78：无 anomalyPoolSetup 声明者时的赠送归属槽）。 */
export function firstGiftedPolarAssaultSlot(chars: readonly CharacterResourceResult[]): number | undefined {
  return chars.find(c => giftedPolarAssaultOf(c) > 0)?.slot
}
