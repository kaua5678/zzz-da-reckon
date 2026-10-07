/**
 * 测试夹具（只供测试；生产代码不得引用——死导出判据把 src/test 归为测试侧）。
 */
import { calcAnomalyPool } from '@/core/anomalyPool'
import type { AnomalyPoolResult } from '@/types/resource'

/**
 * 合法空池（CC-434）：`calcAnomalyPool` 跑空输入的结果（perElement [] / 计数 0 / 覆盖率 0）；totalTime 必填，夹具缺省 180 = 默认战斗时间。
 * 自 CC-423 起流水线对无异常行队伍也产出这种空池而不是 null；模块钩子契约（`AgentNextRoundFeedbackInput.anomalyPool`）
 * 随之不再接受 null，测试夹具用本函数表示「无异常信息」。不手写字面量：形状跟着 calcAnomalyPool 走，不会漂。
 */
export function emptyAnomalyPool(totalTime = 180): AnomalyPoolResult {
  return calcAnomalyPool({ executions: [], panels: [], teamMechanics: [], totalTime })
}
