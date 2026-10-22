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
 * 通用交互基准 —— **全职业 0**（2026-10-21 round 32，用户裁决）。
 *
 * 用户原话（逐字）：
 * > 「这个预填次数我让 agent 改了好几次，其中一次把辅助默认改成 0 了，结果还是没变。
 * >  **干脆直接全改成 0 得了。**」
 * > 「那是**平A预算**，不是交互。交互为 0，他们的平a会自动填满剩余时间啊」
 * > 「相当于你告诉我默认全 6/5 改成默认全 0/1 会导致伤害下降一样。**意义在哪？**」
 *
 * ## 为什么改成全 0
 *
 * 旧口径（2026-09-04）：非支援/防护默认 `parry 6 + dodge 10`（每人 16 次 ≈ 13 秒）。
 * 副作用是**结构性**的：引擎**先**塞进 16 次/人的交互、**再**算时间账 ⇒
 * 3 人队一次就多出 ≈26 秒交互，而溢出本该是「最多一次交互」的量级
 * （用户：「交互是从 0 往上填的，溢出最多也是 1 次」）。
 *
 * 改成 0 后：交互不再预填，**剩余时间自然回灌平A池**（用户：「他们的平a会自动填满剩余时间」）——
 * 那是平A预算的正常去向。用户要打交互时自己在交互栏填，或由模块补齐能力按需注入。
 *
 * ⚠ **不要用「0 交互掉伤害」来质疑本改动**（用户已明确否决该论证方式）：
 * 「默认 6/10 → 默认 0/0 伤害下降」与「默认 65 → 默认 01 伤害下降」同类，是**必然的算术事实**、
 * 不构成判据。真正要回答的是：**预填是否该由引擎替用户做**——用户的答案是「不该」。
 *
 * ⚠ 历史包袱（留痕）：旧注释写着「之前一度全默认 0 导致『谁都不打、留时间发呆』，是过度矫正」。
 * 那次的问题**不在 0 本身**，而在当时**平A池回灌不完整**（时间没人接才留白）。
 * 现在 `availableBasicTime` 的平A回灌已修好（`helpers.ts:779`），0 交互的时间会被平A池接走。
 *
 * @fact engine:交互基准 口径: **全职业默认 0 交互**（弹刀/闪反/格挡/双反都不预填）；交互由用户在交互栏填，或模块 `computeInteractionTopUp` 按需注入。剩余时间由平A池自动填满（`availableBasicTime`）。**不再**按职业给 6/10 基准——那会让引擎一次塞进 ≈26 秒交互、制造非「一次交互」量级的溢出 | 据 用户@2026-10-21 | 验 src/stores/__tests__/roleInteractionBaseline.test.ts | 锚 src/mechanics/interactionBaseline.ts#roleInteractionBaseline | 信 确认
 */
export function roleInteractionBaseline(_specialty: string | undefined): InteractionCounts {
  return { parry: 0, dodge: 0, block: 0, dual: 0 }
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
