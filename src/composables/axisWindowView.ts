/**
 * **逐窗动作块视图**（资源池页「逐窗兑现」卡的数据层，2026-10-27）。
 *
 * ## 用户口径（2026-10-27，逐字）
 * > 「资源池页面如果开了轴模式，能显示 **n 次轴的动作块的丢失填充可视化**吗。
 * >  丢失比如某些情况**跳招**了，填充比如我在末尾**自动填了平a或者强特或者诺姆转连携**之类的奖励招式。」
 *
 * 读法：轴 = **每窗重放的模板**，跑 n 窗之后每一窗的**兑现**都不一样（资源越往后越紧），
 * 页面要能看出「哪一窗、谁的、哪一招丢了（为什么丢）」以及「窗尾被谁填了什么」。
 *
 * ## 数据来源（全部既有单一来源，本模块**不重算任何判定**）
 * | 量 | 来源 |
 * |---|---|
 * | 逐窗执行的动作 / 跨界比例 | `StackTraversalResult.windowTrace[].actions`（`inAxisCount`） |
 * | 逐窗窗尾填充（谁/第几秒/多久） | `windowTrace[].fillSegments`（+ `fillSeconds` 总量） |
 * | 逐窗被跳过的招 + 原因 | `StackTraversalResult.skipped[]`（按 `window` 归因，1-based） |
 * | 逐窗有效秒数 / 发呆秒 / 时钟截短 | `useResourceCalc#stunTimeline` 的 `StunWindowSlot` |
 * | 该窗属于哪条轴 | `windowTrace[].axisIndex`（→ 生效轴名单取名） |
 * | 跳过原因中文 | `axisMarker.ts#AXIS_SKIP_REASON_TEXT`（**唯一口径**，曲线图例同源） |
 *
 * ## 诚实边界（不编造）
 * - **没有轨迹**（非轴队 / 弃轴 / `axisStack` 为空）⇒ `hasTrace: false`、`windows: []`，页面整卡不渲染
 *   （用户口径的前提就是「开了轴模式」）；
 * - **没有时间轴快照**（理论上不会：有轨迹就有 timeline）⇒ `idleSeconds` 记 `null`（「不可推演」），
 *   **不写 0**——0 会被读成「打满了」，而实际是「没量到」；
 * - 同一次施放被跳过记一条 ⇒ 本模块按「槽 + 招式 + 原因」合并成 `times`，不丢次数。
 */
import type { StackTraversalResult } from '@/core/stunAxisStack'
import type { StunWindowSlot, StunWindowTrace } from '@/core/stunTimeline'
import { AXIS_SKIP_REASON_TEXT, type AxisSkipReason } from '@/composables/axisMarker'

/** 窗内一条**已执行**的动作块（来自 `windowTrace.actions`，逐次一条） */
export interface AxisWindowBlockView {
  slot: number
  moveId: string
  /** 可读招式名（`nameOf` 解析；解析不到回落 moveId——不编名字） */
  name: string
  /** 槽位名（角色名；`nameOfSlot` 解析）——时间条按**角色**分道，道名不能用招式名 */
  slotName: string
  /** 施放次数（栈轨迹逐次一条 ⇒ 恒 1；保留字段以便消费方按块合并） */
  count: number
  /** 其中落在失衡窗口内的部分（0..count） */
  inAxisCount: number
  /** 窗内相对起点（秒） */
  startTime: number
  /** 单次动作时长（秒） */
  actionTime: number
  /** 跨界：只有 `inAxisCount / count` 这一段吃失衡易伤（用户口径 2026-10-18「小数这块要做完」） */
  partial: boolean
}

/** 窗尾填充的一段（谁 / 从第几秒 / 填多久） */
export interface AxisWindowFillView {
  slot: number
  name: string
  /** 填充起点（窗内相对秒） */
  startSeconds: number
  /** 该段秒数 */
  seconds: number
  /** 是否**缺省补位**（轴没声明 `basicFillerSlot` ⇒ 引擎回落轴内主C，见 `StunWindowTrace.fillerDefaulted`） */
  defaulted: boolean
}

/** 本窗被跳过的一招（同槽 + 同招 + 同原因已合并） */
export interface AxisWindowSkipView {
  slot: number
  moveId: string
  name: string
  /** 槽位名（角色名；同 `AxisWindowBlockView.slotName`） */
  slotName: string
  reason: AxisSkipReason
  /** 原因中文（`AXIS_SKIP_REASON_TEXT` 原文，页面不再各写一套） */
  reasonText: string
  /** 本窗内被跳过的次数（引擎逐次记一条） */
  times: number
}

/** 一窗 */
export interface AxisWindowLine {
  /** 窗口序号（0-based） */
  index: number
  /** 「第 N 窗」 */
  label: string
  /** 该窗来自哪条轴（生效轴下标；越界 ⇒ 0） */
  axisIndex: number
  /** 该轴的名字（取不到 ⇒ null，页面不写「未知」而是不显示） */
  axisName: string | null
  /** 名义窗长（含决算类常驻延长前的 `windowDuration`） */
  nominalSeconds: number
  /** 决算块按块延长（0 = 无） */
  extendedSeconds: number
  /** 时间条的**满宽**时长 = nominal + extended（决算截断只是提前结束，条不变窄） */
  spanSeconds: number
  /** 窗口**有效**秒数（决算截断 / 时钟截短后） */
  effectiveSeconds: number
  /** 是否被决算提前结束 */
  truncated: boolean
  /** 是否被战斗时钟截短（「最后一窗时间残疾」） */
  clippedByClock: boolean
  /** 窗内动作毛占用（秒） */
  actionSeconds: number
  /** 窗内合轴节省（秒，跨槽位并行只计一次前台） */
  overlapSeconds: number
  /** 窗尾填充总秒数 */
  fillSeconds: number
  /**
   * 窗内发呆秒数（窗口开着、轴块打完了、三槽平A预算也见底）。
   * `null` = 没有时间轴快照 ⇒ 不可推演（**不是 0**）。
   *
   * ⚠ **末窗没有发呆**：战斗结束之后那段没有意义（见 `zeroedSeconds`）。
   */
  idleSeconds: number | null
  /**
   * **末窗零化秒数**（2026-10-27 用户口径）：「决算本来就是直接把剩余时间归零的机制，
   * 连续失衡类似，因为游戏结束相当于你后面都无意义了，计算量只有前半部分。」
   *
   * 末窗里没被填上的那段**不算发呆**，而是像决算一样把剩余时间**归零**：
   * 时间条画短（`effectiveSeconds` 已扣掉它），尾巴留空表示「之后无事发生」。
   * 只有**最后一窗**这么算——中间窗打不满仍是真发呆。
   */
  zeroedSeconds: number
  actions: AxisWindowBlockView[]
  fills: AxisWindowFillView[]
  skipped: AxisWindowSkipView[]
}

/** 逐窗视图汇总（卡片标题行用；不参与判定） */
export interface AxisWindowTotals {
  actionSeconds: number
  fillSeconds: number
  /** 见 `AxisWindowLine.idleSeconds`：任一窗不可推演 ⇒ `null` */
  idleSeconds: number | null
  /** 末窗因战斗结束被归零的秒数（见 `AxisWindowLine.zeroedSeconds`） */
  zeroedSeconds: number
  /** 被跳过**次数**（引擎逐次记一条，不是「几招」） */
  skippedTimes: number
  /** 有动作或填充的窗数（空窗 = 一个动作都没执行） */
  activeWindows: number
}

export interface AxisWindowView {
  windows: AxisWindowLine[]
  /** 是否拿到轴栈逐窗轨迹（false ⇒ 整卡不渲染） */
  hasTrace: boolean
  totals: AxisWindowTotals
}

export interface AxisWindowViewInput {
  /** 轴栈逐窗轨迹（`useResourceCalc#stackTraversalResult` 的 `windowTrace`） */
  trace?: readonly StunWindowTrace[] | null
  /** 引擎 skipped（`window` 字段 = 1-based 窗口序号） */
  skipped?: StackTraversalResult['skipped'] | null
  /** 时间轴逐窗快照（`useResourceCalc#stunTimeline` 的 `slots`；缺省 ⇒ 发呆记 null） */
  slots?: readonly StunWindowSlot[] | null
  /** 生效轴（`useResourceCalc#effectiveStunAxes`；只用来取名，不参与判定） */
  axes?: readonly { readonly name?: string }[] | null
  /** 招式名解析（解析不到回落 moveId） */
  nameOf: (slot: number, moveId: string) => string
  /** 槽位 → 角色名 */
  nameOfSlot: (slot: number) => string
}

const EPS = 1e-9

/** 空视图（非轴 / 弃轴 / 轨迹未产出）：页面据此整卡不渲染 */
const EMPTY: AxisWindowView = {
  windows: [],
  hasTrace: false,
  totals: { actionSeconds: 0, fillSeconds: 0, idleSeconds: null, zeroedSeconds: 0, skippedTimes: 0, activeWindows: 0 },
}

/**
 * 轴栈逐窗轨迹 + 跳过记录 + 时间轴快照 → 逐窗动作块视图（纯函数，无 store / 无 I/O）。
 *
 * ⚠ **输入顺序 = 引擎调度顺序**（`windowTrace` 本身就是按窗口调度顺序追加的），本模块不排序、
 * 不重排窗口——窗口号就是轨迹的 `index + 1`，与 `skipped[].window`/`sequence[].window` 同源。
 */
export function axisWindowView(input: AxisWindowViewInput): AxisWindowView {
  const trace = input.trace ?? []
  if (trace.length === 0) return EMPTY
  const slotSnapshots = input.slots ?? []
  const skippedAll = input.skipped ?? []
  const axes = input.axes ?? []

  const windows: AxisWindowLine[] = []
  let skippedTimes = 0
  let activeWindows = 0
  /** 末窗的轨迹下标（「战斗结束 ⇒ 剩余时间归零」只对最后一窗生效） */
  const lastWindowIndex = trace[trace.length - 1]?.index ?? -1
  for (const t of trace) {
    const i = t.index
    const snap = slotSnapshots[i]
    // 该窗属于哪条轴（轨迹缺省 → 第 0 条；越界夹到末条），`axisName` 只用来标名，不参与判定
    const axisIndex = Math.max(0, Math.min(axes.length - 1, t.axisIndex))
    const extendedSeconds = Math.max(0, t.extendSeconds)
    const spanSeconds = Math.max(0, t.nominalSeconds + extendedSeconds)
    const truncated = t.truncated === true
    // 有效秒数优先取时间轴快照（它多扣了「时钟截短」）；没有快照时按窗内自己的截断时刻算
    const effectiveRaw = snap
      ? snap.effectiveSeconds
      : (truncated ? Math.min(spanSeconds, Math.max(0, t.endSeconds)) : spanSeconds)
    /**
     * **末窗零化**（用户口径 2026-10-27）：「决算本来就是直接把剩余时间归零的机制，连续失衡类似，
     * 因为游戏结束相当于你后面都无意义了，计算量只有前半部分。」
     *
     * 末窗里没填上的那段**不算发呆**（不是"窗口开着没人打"，是"之后无事发生"）：
     * 扣出 `zeroedSeconds`、时间条画到归零后的位置，尾巴由 `awc-closed` 那段表示。
     * ⚠ 只对**最后一窗**且**非决算截断**（决算已经自己归零过）生效；中间窗打不满仍是真发呆。
     */
    const zeroedSeconds = snap && i === lastWindowIndex && !truncated
      ? Math.max(0, Math.min(effectiveRaw, Number(snap.unusedSeconds) || 0))
      : 0
    const effectiveSeconds = Math.max(0, effectiveRaw - zeroedSeconds)

    const actions: AxisWindowBlockView[] = t.actions.map(a => ({
      slot: a.slot,
      moveId: a.moveId,
      name: input.nameOf(a.slot, a.moveId),
      slotName: input.nameOfSlot(a.slot),
      count: a.count,
      inAxisCount: a.inAxisCount,
      startTime: Math.max(0, a.startTime),
      actionTime: Math.max(0, a.actionTime),
      partial: a.count > 0 && a.inAxisCount < a.count - EPS,
    }))

    const fills: AxisWindowFillView[] = t.fillSegments
      .filter(f => f.seconds > EPS)
      .map(f => ({
        slot: f.slot,
        name: input.nameOfSlot(f.slot),
        startSeconds: Math.max(0, f.startSeconds),
        seconds: f.seconds,
        defaulted: t.fillerDefaulted === true,
      }))

    // 跳过记录按「槽 + 招式 + 原因」合并次数（引擎逐次记一条）
    const skipMap = new Map<string, AxisWindowSkipView>()
    for (const s of skippedAll) {
      if (s.window !== i + 1) continue
      const key = `${s.slot}:${s.moveId}:${s.reason}`
      const hit = skipMap.get(key)
      if (hit) hit.times += 1
      else {
        skipMap.set(key, {
          slot: s.slot,
          moveId: s.moveId,
          name: input.nameOf(s.slot, s.moveId),
          slotName: input.nameOfSlot(s.slot),
          reason: s.reason,
          reasonText: AXIS_SKIP_REASON_TEXT[s.reason],
          times: 1,
        })
      }
      skippedTimes += 1
    }
    const skipped = [...skipMap.values()].sort(
      (a, b) => a.slot - b.slot || a.reason.localeCompare(b.reason) || a.moveId.localeCompare(b.moveId),
    )

    const hasContent = actions.length > 0 || fills.length > 0
    if (hasContent) activeWindows += 1

    windows.push({
      index: i,
      label: `第 ${i + 1} 窗`,
      axisIndex,
      axisName: axes[axisIndex]?.name ?? null,
      nominalSeconds: Math.max(0, t.nominalSeconds),
      extendedSeconds,
      spanSeconds,
      effectiveSeconds,
      truncated,
      clippedByClock: snap?.clippedByClock === true,
      actionSeconds: Math.max(0, t.actionSeconds),
      overlapSeconds: Math.max(0, t.overlapSeconds),
      fillSeconds: Math.max(0, t.fillSeconds),
      idleSeconds: snap ? Math.max(0, (Number(snap.unusedSeconds) || 0) - zeroedSeconds) : null,
      zeroedSeconds,
      actions,
      fills,
      skipped,
    })
  }

  const idleKnown = windows.every(w => w.idleSeconds !== null)
  const totals: AxisWindowTotals = {
    actionSeconds: windows.reduce((s, w) => s + w.actionSeconds, 0),
    fillSeconds: windows.reduce((s, w) => s + w.fillSeconds, 0),
    // 任一窗不可推演 ⇒ 汇总也记 null（部分求和会被读成全队发呆）
    idleSeconds: idleKnown ? windows.reduce((s, w) => s + (w.idleSeconds ?? 0), 0) : null,
    zeroedSeconds: windows.reduce((s, w) => s + w.zeroedSeconds, 0),
    skippedTimes,
    activeWindows,
  }
  return { windows, hasTrace: true, totals }
}
