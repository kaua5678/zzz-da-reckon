/**
 * **轴态**（`complete` / `partial` / `infeasible` / `none`）的**唯一事实源**。
 *
 * ## 为什么要有它（用户口径 2026-10-12）
 *
 * > 「低难度的曲线因为达不到资源要求而弃轴或者跳过部分招式了，**标注没正常打完就行**。
 * >  高难度到一定程度才能打完，这时候就是完整的轴模式。」
 *
 * 在此之前，难度曲线与页面各处**各自**读 `convergence.axisFallback` 再拼语义（有的只看弃轴、
 * 有的看 `effectiveStunAxes.length`、有的看 `stackTraversalResult` 真假）⇒ 同一队同一档
 * 在不同位置显示不同的「轴态」。本模块把这些读数收成**一个纯函数**：曲线、结果页、报告都读它。
 *
 * ## 四态判据（**引擎读数**，不重算）
 *
 * | 态 | 判据 | 游戏含义 |
 * |---|---|---|
 * | `infeasible` | `convergence.axisFallback === true` | 轴计划净占用超 180s 预算 ⇒ **整个轴崩掉**（时间路，`solveTeam#stageResolveFeasibility`） |
 * | `partial` | 轴真的注入了（`stackTraversalResult != null`）但 `skipped` 非空 | 轴带残缺照跑，**跳过了 N 招**（资源路，`core/stunAxisStack`） |
 * | `complete` | 轴真的注入了且 `skipped` 为空 | **完整轴**：轴内招式一招没少 |
 * | `none` | 既没弃轴也没注入轴 | 该队**本来就不是轴队**（没绑轴 / 轴开关关） |
 *
 * ⚠ **两条通道必须分开读**（这是本卡 §2.2 的核心事实）：
 *  - **时间路** `axisFallback`：超预算 ⇒ 弃轴，`axisStack` 同时被清空 ⇒ 只看 `axisStack == null`
 *    会把「弃轴」误判成「非轴队」；
 *  - **资源路** `skipped`：轴照跑但少打几招 ⇒ 只看 `axisFallback` 会把「残缺轴」误判成「完整轴」。
 *  故判据顺序是**先看 fallback、再看 stack**，两者缺一不可。
 *
 * ## `skipped` 的来源与形态
 *
 * `core/stunAxisStack#calcStunAxisStack` 在遍历轴内动作时，按 `time` / `decibel` / `energy`
 * 三种原因 `skipped.push(...)`（三处，**语义由 T140a 保留，不许改**）。本模块只做**分类计数**，
 * 不改判定。轴上「跳过 N 招」= 三项之和。
 *
 * 判据测试：`__tests__/difficultyAxis.test.ts`。
 *
 * @fact engine:难度曲线/轴态 口径: 轴态四态**唯一事实源** = `axisStateOf`——`infeasible` = `convergence.axisFallback`（时间路：轴计划净占用超预算 ⇒ 弃轴）、`partial` = 轴已注入但 `stackTraversalResult.skipped` 非空（资源路：跳过 N 招）、`complete` = 轴已注入且零跳过、`none` = 两者皆无（非轴队）；判据顺序**先 fallback 后 stack**（弃轴时 `axisStack` 也被清空，只看它会误判成非轴队） | 据 用户@2026-10-12「达不到资源要求而弃轴或者跳过部分招式了，标注没正常打完就行」+ T140c 正式卡 §3.2 | 验 src/composables/__tests__/difficultyAxis.test.ts | 锚 src/composables/difficultyAxis.ts#axisStateOf | 信 确认
 * ⟳复核: 若 `StackTraversalResult.skipped` 增删 `reason` 取值、或轴退化新增第三条通道（现为「时间路 axisFallback + 资源路 skipped」两条），重核四态判据表与 `AxisSkipCounts` 的字段是否仍覆盖全部形态 | 到期 2027-04-30
 * ⚠ **本触发器已于 2026-10-15 触发并复核过一次（T169）**：`skipped.reason` 新增第四值 `'sway'`
 *   （角色专属资源不足，如般岳山威），`AxisSkipCounts` 同步加 `sway` 字段、`skippedTotal` 计入它、
 *   `NO_SKIPS` 补零；四态判据表**未变**（`sway` 仍属「资源路」⇒ 归 `partial`，不是新通道）。
 *
 * @fact engine:难度曲线/轴要求未满足 口径: **轴模式 = 硬资源要求**——`axisRequirementMet` 为 false 的档位（`partial` 跳过 N 招 / `infeasible` 弃轴）**不出数**（该点不进 `LadderResult.points`，改记 `axisTruncated` 带理由）；`none`（非轴队）**恒可出数**（没绑轴 = 没有要求要满足，不是没达标）⇒ 判据 = `axisStands(a) || a.kind === 'none'`；`axisStands` 同步收紧为**只认 `complete`**（旧口径 `partial` 也算成立） | 据 用户@2026-10-15「轴模式已经限定了资源要求了，你没达到要求来问我能不能通融，你不算不就行了吗。我要的是你达到资源要求然后计算」 | 验 src/composables/__tests__/difficultyAxis.test.ts::★ 新口径 + src/composables/__tests__/difficultyLadder.test.ts::① 点数 ≤4 + 截断如实 | 锚 src/composables/difficultyAxis.ts#axisRequirementMet | 信 确认
 * ⟳复核: 若 `AxisKind` 增删取值、或引擎新增第三条轴态通道（现为「时间路 axisFallback + 资源路 skipped」两条），重核 `axisRequirementMet` 的「哪些态可出数」与 `axisTruncationReason` 的措辞是否仍覆盖全部形态 | 到期 2027-04-30
 */
import type { StackTraversalResult } from '@/core/stunAxisStack'
import type { TeamResourceResult } from '@/types/resource'

/** 轴态四态（见文件头判据表） */
export type AxisKind = 'complete' | 'partial' | 'infeasible' | 'none'

/** 轴内被跳过的招式数，按引擎的三条原因分类（`core/stunAxisStack#calcStunAxisStack`） */
export interface AxisSkipCounts {
  /** 窗口时间装不下（该轴块超出失衡窗剩余时长） */
  time: number
  /** 喧响不足 */
  decibel: number
  /** 闪能不足 */
  energy: number
  /** 角色专属资源不足（T169，2026-10-15）：如般岳山威用完 ⇒ 超出「怒相数 × 2 组」的连段块打不出 */
  sway: number
}

export interface AxisState {
  kind: AxisKind
  /** 跳过招式的分类计数（`none` / `complete` 时三项均为 0） */
  skipped: AxisSkipCounts
  /** 跳过招式**总条数** = `skipped` 三项之和（UI「跳过 N 招」直接读它，不再各自求和） */
  skippedTotal: number
  /** 时间路判定结果（`convergence.axisFallback`）——`infeasible` 的判据本身，单列便于诊断 */
  fallback: boolean
}

/**
 * `axisStateOf` 的输入：**只吃 `ResourceCalc` 的公开读数**（本模块因此能住 `composables/`
 * 且不 import `@/core` 之外的引擎内部——`difficultyCurve.ts` 这类展示层可安全依赖它）。
 *
 * 结构类型（不是 `Pick<ResourceCalc, …>`）是为了让单测能直接喂最小夹具：
 * `ComputedRef<T>` 天然满足 `{ value: T }`。
 */
export interface AxisStateInput {
  resourceResult: { value: TeamResourceResult | null }
  stackTraversalResult: { value: StackTraversalResult | null }
}

/** 空计数（避免各处重复写 `{ time: 0, decibel: 0, energy: 0 }`） */
const NO_SKIPS: AxisSkipCounts = { time: 0, decibel: 0, energy: 0, sway: 0 }

/** 读一队当前档的轴态（纯函数，不碰 store、不触发求值——只读已算好的 computed） */
export function axisStateOf(calc: AxisStateInput): AxisState {
  const fallback = calc.resourceResult.value?.convergence.axisFallback === true
  // 时间路优先：弃轴时引擎把 axisStack 一起清空（`resolvedAxes: []` + `axisActive=false`），
  // 只看 stack 会把「弃轴」静默读成「非轴队」——这正是本卡要修的表达力缺陷之一。
  if (fallback) return { kind: 'infeasible', skipped: { ...NO_SKIPS }, skippedTotal: 0, fallback: true }
  const stack = calc.stackTraversalResult.value
  if (!stack) return { kind: 'none', skipped: { ...NO_SKIPS }, skippedTotal: 0, fallback: false }
  const skipped: AxisSkipCounts = { ...NO_SKIPS }
  for (const s of stack.skipped) skipped[s.reason] += 1
  const skippedTotal = skipped.time + skipped.decibel + skipped.energy + skipped.sway
  return { kind: skippedTotal > 0 ? 'partial' : 'complete', skipped, skippedTotal, fallback: false }
}

/**
 * 轴态的中文短标签（UI 列 / tooltip 共用一个口径，避免页面各写一套措辞）。
 * `skippedTotal` 为 0 的 `partial` 在判据上不可能出现（见 `axisStateOf`），故这里直接用总数。
 */
export function axisKindLabel(a: AxisState): string {
  switch (a.kind) {
    case 'complete': return '完整轴'
    case 'partial': return `跳过 ${a.skippedTotal} 招`
    case 'infeasible': return '轴不可行'
    case 'none': return '—'
  }
}

/**
 * **为什么这一档不出数**（截断原因，UI 直接用）——与 `axisKindLabel` 同源措辞。
 *
 * 只在 `axisRequirementMet` 为 false 时有意义（`complete` / `none` 调用它是编程错误）。
 * 分类计数取自 `AxisSkipCounts`，**不重算**引擎判定（规则 11）。
 */
export function axisTruncationReason(a: AxisState): string {
  if (a.kind === 'infeasible') return '轴计划净占用超时间预算 ⇒ 弃轴'
  const parts: string[] = []
  if (a.skipped.energy > 0) parts.push(`闪能不足 ${a.skipped.energy} 招`)
  if (a.skipped.decibel > 0) parts.push(`喧响不足 ${a.skipped.decibel} 招`)
  if (a.skipped.time > 0) parts.push(`窗口时间装不下 ${a.skipped.time} 招`)
  if (a.skipped.sway > 0) parts.push(`专属资源不足 ${a.skipped.sway} 招`)
  return parts.length > 0
    ? `轴没打完（${parts.join('、')}）⇒ 资源要求未满足`
    : '轴没打完 ⇒ 资源要求未满足'
}

/**
 * 「轴成立」= 轴**一招没少**地立起来了——② 点的判据。
 *
 * ⚠ **2026-10-15 口径收紧（用户裁决，推翻了 2026-10-12 的「残缺也算」）**：
 * 旧判据把 `partial` 也算成立（「完整或残缺都算」），于是 ② 会落在「轴只打了一半」的档位上，
 * 该档还照出伤害。用户口径逐字：
 * > 「**轴模式已经限定了资源要求了**，你没达到要求来问我能不能通融，**你不算不就行了吗**。
 * >  我要的是你**达到资源要求然后计算**」
 * ⇒ `partial`（跳过 N 招）不再算成立：轴模式声明的资源要求没被满足，**那一档就不出数**。
 * `infeasible`（弃轴）/ `none`（非轴队）同样不算——非轴队由 ② 的「无轴队跳过该点」分支处理。
 */
export function axisStands(a: AxisState): boolean {
  return a.kind === 'complete'
}

/**
 * **该档能不能出数**（= 轴模式的要求被满足了）——低难度截断的判据。
 *
 * - `none`（非轴队）⇒ **能**：没绑轴就没有资源要求要满足（不适用 ≠ 不达标）；
 * - `complete` ⇒ 能；
 * - `partial` / `infeasible` ⇒ **不能**：轴没打完 / 轴崩了。
 *
 * 与 `axisStands` 的分工：`axisStands` 回答「② 点能不能落在这里」（非轴队恒 false ⇒ 跳过该点），
 * 本函数回答「这一点要不要出数」（非轴队恒 true ⇒ 照出）。**后者由前者派生**，避免两套判据漂移。
 */
export function axisRequirementMet(a: AxisState): boolean {
  return a.kind === 'none' || axisStands(a)
}
