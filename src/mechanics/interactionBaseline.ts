/**
 * 交互基准（弹刀 / 闪反 / 格挡 / 双反）纯函数簇——角色专属默认 > 正反馈排除 > 职业基准。
 *
 * CC-478（r658）：从 stores/config.ts 原样搬入。只依赖角色模块声明（registry#getAgentMechanic），无 pinia、无 store state，
 * 所以归属 mechanics 层：store（setAgent 预填）、引擎（convergence 保底 4 反推启动条件 CC-476）、部署 / 测试夹具都从这里取同一口径。
 * stores/config.ts 保留 re-export（既有导入路径不变）。回退：把四个函数搬回 config.ts、删本文件与 index.ts 导出。
 */
import { getAgentMechanic } from './registry'
import type { InteractionCounts } from './types'
/**
 * 按角色的交互次数默认值（主页「战斗动作次数」预填展示，相当于帮用户填好；用户可改）。
 * CC-65b：数据下沉为角色模块声明 `interactionDefaults`（星徽·比利 starlightBilly.ts、般岳 banyue.ts）；无声明 = 全 0。
 * 返回副本（原实现返回共享表对象，调用方均只读；副本更安全）。
 */
export function getInteractionDefaults(agentId: string): InteractionCounts {
  const d = agentId ? getAgentMechanic(agentId)?.interactionDefaults : undefined
  return d ? { ...d } : { parry: 0, dodge: 0, block: 0, dual: 0 }
}

/**
 * 通用交互基准（无角色专属默认时按职业；用户口径 2026-09-04 回调）：
 * - 支援/防护：0 交互——支援上战场 1 秒 = 浪费主C 1 秒输出，其后台时间不是发呆（主C 在打）。
 * - 其余（强攻/异常/击破）：弹刀 6 + 闪反 10（闪反在动作时间内给 2× 伤害+失衡；弹刀靠后续
 *   支援突击 + 喧响/失衡纯赚）。基准是「默认大家会打」，不是硬凑——时间紧的队（如叶瞬光
 *   白毛优先）由非轴降配 interactionScale 按必要时间挤占缩放（useResourceCalc 738-742）。
 * 之前一度全默认 0 导致「谁都不打、留时间发呆」，是过度矫正（叶瞬光个案不该推广到全队池）。
 */
// @fact engine:交互基准 口径: 非支援/防护默认弹刀6/闪反10（闪反动作时间内2×伤害失衡、弹刀喧响失衡纯赚），支援/防护0；基准可被必要时间挤占（超预算时 interactionScale 缩放），不硬凑 | 据 用户@2026-09-04·复核@2026-09-08·复核@2026-09-25·锚未变@2026-09-27·复核@2026-09-30·锚迁移@2026-10-05(CC-478 原样搬自 stores/config.ts)·复核@2026-10-08(r732 返回类型改引用 InteractionCounts，取值未动) | 验 src/stores/__tests__/roleInteractionBaseline.test.ts | 锚 src/mechanics/interactionBaseline.ts#roleInteractionBaseline | 信 确认
export function roleInteractionBaseline(specialty: string | undefined): InteractionCounts {
  if (specialty === 'support' || specialty === 'defense') return { parry: 0, dodge: 0, block: 0, dual: 0 }
  return { parry: 6, dodge: 10, block: 0, dual: 0 }
}
/**
 * 手动队默认交互（单一事实源，setAgent 预填用）：
 * 角色专属默认（getInteractionDefaults）> 正反馈排除（0）> 职业基准（roleInteractionBaseline）。
 */
export function interactionBaselineFor(agentId: string, specialty?: string): InteractionCounts {
  if (agentId && getAgentMechanic(agentId)?.noGenericInteraction) return { parry: 0, dodge: 0, block: 0, dual: 0 }
  return hasCustomInteractionDefaults(agentId) ? getInteractionDefaults(agentId) : roleInteractionBaseline(specialty)
}
/**
 * 角色是否有专属交互默认值（任一项 > 0）。CC-255：此前 pullPlannerEngine / teamTimelineStore / charIncrement /
 * runArchiveDeploy 各内联一份「hasCustom ? defs : 职业基准」，都漏了 noGenericInteraction（1051 伊德海莉被发通用弹刀/闪反）；
 * 现一律调 interactionBaselineFor，只有「不预设弹刀」的部署口径（runArchiveDeploy）另需本判定。
 */
export function hasCustomInteractionDefaults(agentId: string): boolean {
  const defs = getInteractionDefaults(agentId)
  return defs.parry > 0 || defs.dodge > 0 || defs.block > 0 || defs.dual > 0
}
