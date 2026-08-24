/**
 * 失衡内异常事件系统 v1（2026-08，用户指令立项）：
 * SOP §3.8 待办「失衡轴内应建模 初始进失衡积蓄值 → 动作积满异常条 → 触发异常+伴随事件」的
 * 第一块基石——把全池口径的异常触发数分配到失衡窗口内/外。
 *
 * v1 口径（均匀速率近似，非完整事件仿真）：
 * - 积蓄随攻击活动近似均匀累积 → 窗口内触发数 = 总触发数 × 窗口时间占比；
 * - 窗口开始时已有异常存活概率 ≈ min(1, 加权平均异常时长 / 窗口时长)（仅计有触发的元素），
 *   供「极性紊乱需目标同时处于异常+失衡」类计数用。
 * 消费方：南宫羽极性紊乱次数、颤音自动层数（后续逐事件仿真接入后替换本模块）。
 */
import { ANOMALY_DURATION } from './helpers'

export interface InStunElementInput {
  element: string
  /** 全池口径该元素触发次数 */
  triggerCount: number
}

export interface InStunAnomalyResult {
  /** 失衡窗口内的属性异常触发次数合计（各元素期望取整和） */
  triggersInWindows: number
  /** 窗口开始时目标已处于某属性异常状态的覆盖比例（0-1，加权平均） */
  activeCoveragePerWindow: number
  /** 参与加权的元素（调试/展示） */
  elements: string[]
  note: string
}

export function computeInStunAnomalyEvents(input: {
  perElement: InStunElementInput[]
  totalTime: number
  stunCount: number
  windowDuration: number
}): InStunAnomalyResult {
  const totalTime = Math.max(0, input.totalTime)
  const stunCount = Math.max(0, Math.floor(input.stunCount))
  const windowDuration = Math.max(0, input.windowDuration)
  const inWindowRatio = totalTime > 0
    ? Math.min(1, (stunCount * windowDuration) / totalTime)
    : 0
  let triggersInWindows = 0
  let durationWeighted = 0
  let weightTotal = 0
  const elements: string[] = []
  for (const e of input.perElement) {
    const n = Math.max(0, Math.floor(e.triggerCount))
    if (n <= 0) continue
    elements.push(e.element)
    triggersInWindows += Math.round(n * inWindowRatio)
    const dur = ANOMALY_DURATION[e.element] ?? ANOMALY_DURATION.physical ?? 10
    durationWeighted += dur * n
    weightTotal += n
  }
  const avgDuration = weightTotal > 0 ? durationWeighted / weightTotal : 0
  const activeCoveragePerWindow = windowDuration > 0 && weightTotal > 0
    ? Math.min(1, avgDuration / windowDuration)
    : 0
  return {
    triggersInWindows,
    activeCoveragePerWindow,
    elements,
    note: `均匀速率近似：窗口占比 ${(inWindowRatio * 100).toFixed(0)}% → 窗口内触发 ${triggersInWindows} 次；异常存活覆盖 ${Math.round(activeCoveragePerWindow * 100)}%（平均时长 ${avgDuration.toFixed(0)}s / 窗口 ${windowDuration.toFixed(0)}s）。`,
  }
}
