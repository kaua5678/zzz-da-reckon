/**
 * **二元相位时序**（连续失衡专项，`docs/STUN_TIMELINE_PROJECT.md` 期 2 的前置，2026-11-01）。
 *
 * ## 用户口径（2026-11-01，逐字）
 * > 「最精确的就是分清每个动作的贡献，在连续情况下精准表达出类似时序（仅仅是二元，
 * >  分清哪些积攒失衡哪些吃易伤）的**先失衡贡献后窗口时间**并且**剩余动作和剩余窗口较贴合**。」
 *
 * ## 它回答什么
 * 把一局战斗切成 `积攒 → 窗 → 积攒 → 窗 → … → 余量`：
 * - **积攒段**（窗外）：动作攒失衡值，不产易伤；
 * - **窗段**（吃易伤）：窗口开着，窗内动作不攒条（用户 2026-10-28）；
 * - **余量段**：打完最后一整窗后剩下的攒条时间，对应「下一窗攒了多少」（= `nextWindowProgress`）。
 *
 * ## 恒等式（本模块的验收判据）
 * ```
 * Σ phases[].seconds === effectiveTime（零容差；最后一段吸收浮点残差）
 * buildSeconds + windowSeconds === effectiveTime
 * ```
 * 按构造它与聚合口径同源：`buildSeconds = net / buildRate = outside`、
 * `windowSeconds = Σ slots[].effectiveSeconds`，两者相加 = `effectiveTime`。
 *
 * ## 边界（不编造）
 * - 非轴队（`timeline.hasTrace === false`）⇒ `hasTrace: false`、`phases: []`（不可推演）；
 * - `net ≤ 0` 或战斗时间为 0 ⇒ 同上；
 * - 一窗都没开（K = 0）⇒ 整局就是一段积攒（`phases = [build]`）；
 * - **只读**：不参与覆盖率 / 伤害（要接进去须先定「部分窗的分母」，见模块末尾 TODO）。
 */
import { finiteOr0 } from '@/utils/finiteClamp'
import type { StunTimeline } from '@/core/stunTimeline'

/** 相位类型：积攒（窗外）/ 窗（吃易伤） */
export type StunPhaseKind = 'build' | 'window'

/** 相位序列的一段 */
export interface StunPhaseSegment {
  kind: StunPhaseKind
  /** 段起点（绝对秒） */
  startSeconds: number
  /** 段时长（秒） */
  seconds: number
  /** 本段攒出的失衡值（`window` 段恒 0——窗内失衡作废，用户 2026-10-28） */
  stunBuildUp: number
  /** `window` 段 = 窗口序号（0-based）；`build` 段 = -1 */
  windowIndex: number
}

/** 二元相位时序产物 */
export interface StunPhaseTimeline {
  phases: StunPhaseSegment[]
  effectiveTime: number
  /** Σ 积攒段秒数（含余量段） */
  buildSeconds: number
  /** Σ 窗段秒数（= 时间轴的 `windowSeconds`） */
  windowSeconds: number
  /** 余量段秒数（打完最后一整窗后攒向下一窗的时间） */
  trailingSeconds: number
  /** 余量失衡值（= `net − Σ开窗成本`，与 `continuousStunCount` 的小数残量同源） */
  trailingStun: number
  /** 实际排出的窗口数 */
  windowCount: number
  /** 是否可推演（false ⇒ `phases` 空，不编造） */
  hasTrace: boolean
}

const EPS = 1e-9

const EMPTY: StunPhaseTimeline = {
  phases: [], effectiveTime: 0, buildSeconds: 0, windowSeconds: 0,
  trailingSeconds: 0, trailingStun: 0, windowCount: 0, hasTrace: false,
}

/**
 * 由时间轴 + 池的失衡账构建二元相位时序（纯函数，无副作用）。
 *
 * `buildRate = totalStunBuildUp / outsideSeconds`（全队窗外均速）；
 * 开窗成本按池的计数律：首窗 `b`、之后 `b × (1 − refund)`（`stunPool#continuousStunCount` 同律）。
 */
export function buildStunPhaseTimeline(input: {
  timeline: StunTimeline
  /** 净失衡值（= 池的 `totalStunBuildUp`；窗外攒出的可开窗量） */
  totalStunBuildUp: number
  /** Boss 失衡值（开一窗的成本） */
  bossStunValue: number
  /** 雨果决算返还比例（0~0.25） */
  stunRefundRatio?: number
}): StunPhaseTimeline {
  const tl = input.timeline
  const eff = Math.max(0, finiteOr0(tl.effectiveTime))
  const b = Math.max(0, finiteOr0(input.bossStunValue))
  const net = Math.max(0, finiteOr0(input.totalStunBuildUp))
  const refund = Math.max(0, Math.min(0.25, finiteOr0(input.stunRefundRatio)))
  const windowTotal = Math.max(0, Math.min(eff, finiteOr0(tl.windowSeconds)))
  if (!tl.hasTrace || !(b > 0) || !(net > 0) || !(eff > 0)) {
    return { ...EMPTY, effectiveTime: eff, windowSeconds: windowTotal, windowCount: tl.slots.length }
  }
  const phases: StunPhaseSegment[] = []
  let cursor = 0
  const push = (kind: StunPhaseKind, seconds: number, stunBuildUp: number, windowIndex: number) => {
    phases.push({ kind, startSeconds: cursor, seconds, stunBuildUp, windowIndex })
    cursor += seconds
  }
  // 一窗都没开：整局都是积攒（没有窗口可吃易伤）。
  if (tl.slots.length === 0) {
    push('build', eff, net, -1)
    return { phases, effectiveTime: eff, buildSeconds: eff, windowSeconds: 0, trailingSeconds: eff, trailingStun: net, windowCount: 0, hasTrace: true }
  }
  const outside = Math.max(0, eff - windowTotal)
  const buildRate = outside > EPS ? net / outside : 0
  /** 开窗成本（与池的计数律同源：首窗 b、之后 b(1−refund)） */
  const openCosts: number[] = []
  for (let i = 0; i < tl.slots.length; i++) openCosts.push(i === 0 ? b : b * (1 - refund))
  const openSum = openCosts.reduce((s, x) => s + x, 0)
  const trailingStun = Math.max(0, net - openSum)
  // 逐窗：先积攒再开窗；最后留下余量段
  for (let i = 0; i < tl.slots.length; i++) {
    const buildSec = buildRate > EPS ? openCosts[i]! / buildRate : 0
    push('build', buildSec, openCosts[i]!, -1)
    push('window', Math.max(0, tl.slots[i]!.effectiveSeconds), 0, i)
  }
  const trailingSeconds = buildRate > EPS ? trailingStun / buildRate : 0
  push('build', trailingSeconds, trailingStun, -1)
  /**
   * 零容差恒等式：浮点除法让 Σ 与 `effectiveTime` 差 ~1e-15。
   * 让**最后一段**（积攒/余量段）吸收残差，恒等式逐位成立（判据零容差）。
   */
  const residual = eff - cursor
  if (Math.abs(residual) > 0) {
    const last = phases[phases.length - 1]!
    last.seconds = Math.max(0, last.seconds + residual)
    cursor = eff
  }
  // 用 eff − windowTotal 而不是重求和：浮点结合律会让 Σbuild + Σwindow 差 ~1e-14，
  // 恒等式要零容差 ⇒ 直接取算术补（与 outside 同源，见函数头恒等式）。
  const buildSeconds = Math.max(0, eff - windowTotal)
  return {
    phases,
    effectiveTime: eff,
    buildSeconds,
    windowSeconds: windowTotal,
    trailingSeconds: phases.filter(p => p.kind === 'build').length > 0
      ? phases[phases.length - 1]!.kind === 'build' ? phases[phases.length - 1]!.seconds : 0
      : 0,
    trailingStun,
    windowCount: tl.slots.length,
    hasTrace: true,
  }
}