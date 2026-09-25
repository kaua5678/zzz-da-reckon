/**
 * 求解诊断累加器 —— `calcTeamResources` 的 10 个函数级诊断 `let` 的显式化（CC-4，2026-09-25）。
 *
 * 职责：把原住在 `core/resource.ts#calcTeamResources` 闭包里的 10 个可变诊断量收成一个对象，
 * 让 S2 折叠环（`./foldLoop#runFoldLoop`）以参数注入读写，而不是靠闭包隐式共享。**唯一可变诊断
 * 累加器**：重折环换新对象 = 旧式逐字段归零（`resetDiagnostics`）；被接受态存引用、拒绝时整体换回。
 *
 * 初值与旧 `:263–274` 逐字相同（口径 `engine:收敛读数归属`，见 `types/resource/team.ts`）：
 * 诊断量归属**被接受的那次调用**，重折环每次重跑换新对象即把读数归零，拒绝时换回快照对象。
 *
 * 依赖方向：本文件不得 import 任何求解实现（防环），只导出类型与工厂。
 */

export interface SolveDiagnostics {
  /** 内层不动点是否判稳（折叠环内任一 pass 判稳即 true） */
  converged: boolean
  /** 诊断量 `iterations`：只记折叠环的内层轮数（欠打回填试探复用 `runInnerLoop` 但不覆盖它） */
  iterations: number
  /** 折叠环实际 pass 数 */
  timeBudgetPasses: number
  /** 时间预算外层是否收敛（残差达标 / 停滞判据） */
  timeBudgetConverged: boolean
  /** 时间预算残差（秒）= 最后一轮 `maxExcess` */
  timeBudgetResidualSeconds: number
  /** 时间预算留白（秒）= 最后一轮 `maxIdle` */
  timeBudgetIdleSeconds: number
  /** 回填进平A池的 refund 秒数 */
  timeBudgetRefundedSeconds: number
  /** 每次折叠管线运行（含规范重放）独立冻结 refund 的旗标 */
  refundFrozen: boolean
  /** 折叠环停滞判据：历史最小 `maxExcess` */
  bestExcess: number | undefined
  /** 折叠环停滞判据：连续无改善轮数 */
  stagnantPasses: number | undefined
}

/** 与旧 `resource.ts:263–274` 逐字相同的初值。 */
export function createSolveDiagnostics(): SolveDiagnostics {
  return {
    converged: false,
    iterations: 0,
    timeBudgetPasses: 0,
    timeBudgetConverged: false,
    timeBudgetResidualSeconds: 0,
    timeBudgetIdleSeconds: 0,
    timeBudgetRefundedSeconds: 0,
    refundFrozen: false,
    bestExcess: undefined,
    stagnantPasses: undefined,
  }
}
