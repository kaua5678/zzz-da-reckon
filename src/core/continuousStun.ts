/**
 * **连续失衡：缺口标注**（用户口径 2026-10-23「再加点配置或交互就能达到完整失衡，进入下一阶段」）。
 *
 * ⚠ 2026-10-25：本模块原有的「末窗兑现物理推演」（realizeStunWindows）与连续覆盖率
 * （continuousStunCoverage）从未接进任何生产通道（deadChannelLs 判死导出；现行覆盖率仍是
 * 二值 stunWindowFraction），且与「没攒满 = 没开启 = 没有易伤」的裁决（2026-10-21 §33）不一致，
 * 已删除。完整推导、否决过程与实测表保留在 docs/STUN_CONTINUOUS_LASTWINDOW.md 与 git 历史。
 */
import { finiteOr0 } from '@/utils/finiteClamp'

/**
 * **「离下一次完整失衡还差多少」进度**（展示标注用；**不改任何数值**）。
 *
 * ## 为什么需要它
 * 引擎的 `kStar` 是「最大自洽可行整数」：它只会答「攒满了几次」。于是在难度曲线上，
 * 「完整 n」到「完整 n+1」之间是**一格跳变**（实测 `auto-1611-1141-1211` 闪反 18→19
 * 一格 +9.268M、占全程 70.9%）。用户口径要的是「到临界后快速增加」的那一段——
 * 而在**当前物理模型下那一段的伤害贡献恒为 0**（第 n+1 窗没攒满 = 没开启 = 没有易伤，
 * 用户 2026-10-21 §33 裁决），所以它不该被算成伤害，**只该被标注出来**：
 *
 * > 「再加点配置或交互就能达到完整失衡，进入下一阶段」（用户 2026-10-23）
 *
 * ## 口径
 * - `nextWindowProgress` ∈ [0,1)：距离第 ⌈cont⌉ 窗攒满的比例（0 = 刚好攒满上一窗，0.99 = 就差一点）；
 * - `missingBars`：还差几条失衡值（= ⌈cont⌉ − cont）；
 * - `missingBuildUp`：还差多少失衡值（按池的计数律 `b + (n−1)·b·(1−refund)` 折算，与
 *   `stunBuildUpForCount` 同源）；
 * - `atStep`：是否正好踩在整数上（= 已完整达成，无「再加点」可言）。
 */
export interface ContinuousStunProgress {
  /** 已完整兑现的失衡次数（整数） */
  completeWindows: number
  /** 距下一次完整失衡的进度（0..1）；`atStep` 时恒 0 */
  nextWindowProgress: number
  /** 还差几条失衡值（0..1） */
  missingBars: number
  /** 还差多少失衡值（绝对值；池的 boss 失衡值量纲） */
  missingBuildUp: number
  /** 是否正好踩在整数上（没有「再加点」可言） */
  atStep: boolean
  /**
   * **缺口折成「几个失衡窗被吃掉的量」**（用户 2026-10-23 的计量单位）。
   *
   * 用户口径：「打完 n 次失衡时，中间 n−1 个失衡窗里被吃掉的那些失衡值，就是这一轮周期的
   * 自然单位；从『刚进入第 n 次』到『完整 n+1 次』大约只要再补**一个被吃掉量**」。
   * ⇒ 展示层用这个数说话（「还差 ≈0.4 个失衡窗的量」），比裸失衡值点更好读。
   *
   * `null` = 该队没有可用的「被吃掉量」读数（`eatenPerWindow` 未给或 ≤ 0）。
   */
  missingInEatenWindows: number | null
}

export function continuousStunProgress(input: {
  /** 池报的**连续**失衡次数（`core/stunPool.ts#continuousStunCount`） */
  builtWindows: number
  bossStunValue: number
  /** 雨果决算口径的失衡值返还比例（0~0.25；与池同源） */
  stunRefundRatio?: number
  /**
   * **每个失衡窗里被吃掉的失衡值**（= `StunPoolResult.inAxisStunTotal / stunCount`；
   * 「失衡窗口内招式吃易伤但不攒条」⇒ 那段时间本该攒出来的条被吃掉）。
   * 给了才能把缺口折成用户口径的「几个失衡窗的量」；缺省 ⇒ `missingInEatenWindows = null`。
   */
  eatenPerWindow?: number
}): ContinuousStunProgress {
  const built = Math.max(0, finiteOr0(input.builtWindows))
  const b = Math.max(0, finiteOr0(input.bossStunValue))
  const refund = Math.max(0, Math.min(0.99, finiteOr0(input.stunRefundRatio)))
  const complete = Math.floor(built + 1e-9)
  const EPS = 1e-6
  const frac = built - complete
  const atStep = frac < EPS
  if (atStep) {
    return { completeWindows: complete, nextWindowProgress: 0, missingBars: 0, missingBuildUp: 0, atStep: true, missingInEatenWindows: 0 }
  }
  /** 第 ⌈built⌉ 窗还差的比例（1 − frac） */
  const missingBars = Math.min(1, Math.max(0, 1 - frac))
  /** 下一次失衡的边际成本：首次 b、之后 b(1−refund)（与 `stunBuildUpForCount` 同一条计数律） */
  const marginal = complete < 1 ? b : b * (1 - refund)
  const missingBuildUp = missingBars * marginal
  const eaten = Math.max(0, finiteOr0(input.eatenPerWindow))
  return {
    completeWindows: complete,
    nextWindowProgress: Math.min(1, Math.max(0, frac)),
    missingBars,
    missingBuildUp,
    atStep: false,
    missingInEatenWindows: eaten > 0 ? missingBuildUp / eaten : null,
  }
}
