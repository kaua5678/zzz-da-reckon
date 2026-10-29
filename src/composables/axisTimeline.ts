/**
 * 失衡轴**时间轴共享原语**（2026-10-30 收敛；用户口径：「把『失衡轴编辑器的时间轴』与
 * 『资源池·逐窗兑现图』两套渲染收敛成一套共享原语」）。
 *
 * ## 为什么会有这个模块
 * 同一个失衡轴在两处渲染：**编辑器**（`views/StunAxisPage.vue`，可拖拽的编辑视图）与
 * **逐窗兑现图**（`components/AxisWindowChart.vue`，只读的兑现视图）。此前两处各写一份几何：
 * 编辑器把像素常量收在页面的 `TL` 里，逐窗图把 `pct / blockStyle / fillStyle / closedStyle / inPct`
 * 散在组件脚本里 —— **同一条动作块在两处的横轴换算是两份实现**（越界夹取口径还不同：
 * 编辑器不夹、逐窗图夹），改一处忘一处就只剩肉眼能发现的漂移。
 *
 * 本模块是这两套渲染的**唯一几何来源**：
 * | 原语 | 管什么 |
 * |---|---|
 * | `AXIS_TIME_PX` | 全部像素常量（编辑器道/块/行 + 逐窗图条/块 + 共用的刻度行） |
 * | `axisPct` / `axisPctClamp` / `axisPctFromZero` | 秒 → 轨道百分比，三种夹取语义各自具名 |
 * | `axisBarGeometry` | 起点 + 时长 → `left/width`（含最小宽度、是否夹进轨道） |
 * | `axisInnerPct` | 跨界块里「在窗内」那段占整条的百分比 |
 * | `buildAxisTimeline` | 编辑器时间轴布局（角色道 → 专属窗口道 → 事件道自上而下累积） |
 *
 * ⚠ 两处的**视觉差异是有意保留的**（本模块只收敛几何，不收敛 DOM 与配色）：编辑器块 22px 可拖拽、
 * 逐窗图条 16px 只读；越界块在编辑器里要露出真位置（不夹），在逐窗图里必须夹进「一窗的兑现」
 * （条宽就是窗长，捅出去读者会以为那一窗更长）。差异由调用方**按参数**给，不在这里分叉。
 *
 * ⚠ 纯几何，无 store / 无 I/O：**判定与数据一律由调用方注入**（时长口径住在动作池、
 * 事件口径住在 `stunAxisEventLanes`），本模块只把秒换算成像素。
 */
import { layoutBlockLabels } from '@/composables/stunAxisView'
import type { AxisEventMarker } from '@/composables/stunAxisEventLanes'

// ---------------------------------------------------------------- 像素常量

/** 编辑器顶端：刻度行 */
const TICK_H = 18
/** 编辑器顶端：失衡窗口条 */
const WINDOW_BAR_H = 12
/** 刻度行与窗口条之间、窗口条与第一条角色道之间的空隙 */
const HEAD_GAP = 4

/**
 * 时间轴几何常量（**单一来源**）。
 *
 * ⚠ 这一份同时供 JS 布局（内联 style）与组件模板使用：此前同样的数在 JS 与 CSS 各写一份
 * （`.sap-lane` 19px / 道间距 20px / 事件道 16px 行高…），实测后果就是「道高写死 ⇒
 * 新增一条道直接溢出到下一个轴」。改这里的数，两处渲染一起改。
 *
 * 尺寸口径（用户 2026-10-29：「动作块也短小，写字也不清不楚」）：块高 15→22px、块内字号 8→11px、
 * 道高 19→26px，名字在块里站得住（放不下的见标签行 `buildAxisTimeline#labels`）。
 */
export const AXIS_TIME_PX = {
  /** 顶端 → 第一条角色道（刻度行 + 失衡窗口条 + 空隙） */
  head: TICK_H + WINDOW_BAR_H + HEAD_GAP,
  /** 刻度行高（`.sap-ticks`；时间轴最顶那一条 0s/2s/…） */
  tickH: TICK_H,
  /** 失衡窗口条高（`.sap-window-bar`，紧贴刻度行下方） */
  windowBarH: WINDOW_BAR_H,
  /** 角色道高 */
  laneH: 26,
  /** 道间距 */
  laneGap: 4,
  /** 动作块高（道内垂直居中） */
  blockH: 22,
  /** 外置标签行高 */
  labelH: 16,
  /** 事件道每行高 / 上下留白 */
  evRowH: 18,
  evPad: 6,
  /** 底边留白 */
  tail: 6,
  /** 专属窗口道里的窗口条（道高内靠上：距道顶 / 条高） */
  winBarTop: 3,
  winBarH: 20,
  /** 事件道里的标记（距道顶 / 标记高；行距 = evRowH） */
  evMarkTop: 3,
  evMarkH: 18,
  /** 逐窗兑现图：时间条高（`.awc-strip`） */
  chartStripH: 20,
  /** 逐窗兑现图：条内块与填充段距条顶 / 条内高 */
  chartBarTop: 2,
  chartBarH: 16,
} as const

// ---------------------------------------------------------------- 秒 → 百分比

/**
 * 秒 → 轨道百分比（轨道满宽 = `span` 秒）。**不做夹取** —— 夹取有三种语义，各自具名（见下）。
 * `span <= 0`（未就绪 / 空窗）⇒ 0，避免 `NaN%` 落进 style（浏览器会静默丢掉整条声明）。
 */
export function axisPct(sec: number, span: number): number {
  return span > 0 ? (sec / span) * 100 : 0
}

/** 夹到 0..100：条内定位（越界块不许捅出轨道；外置标签贴右端时要左移） */
export function axisPctClamp(sec: number, span: number): number {
  return Math.max(0, Math.min(100, axisPct(sec, span)))
}

/** 只夹下界：事件标记按**真实时刻**定位（负时刻归零，右端外照画 —— 标记本来就贴着它的时刻） */
export function axisPctFromZero(sec: number, span: number): number {
  return Math.max(0, axisPct(sec, span))
}

/** 一条时间条（动作块 / 窗口条 / 填充段 / 关窗阴影）的几何 */
export interface AxisBarGeometry {
  /** 条左端（轨道百分比；`clampToTrack=false` 时可为负 = 块被拖到窗口起点之前） */
  leftPct: number
  widthPct: number
}

/**
 * 起点 + 时长 → 条的 `left/width`（百分比）。
 *
 * @param minPct 最小宽度：0 时长的标记块（诺姆转连携等）也要看得见。缺省 0 = 不设下限
 *   （逐窗图的关窗阴影就是「剩下的全给它」）。
 * @param clampToTrack 是否把条夹进轨道。**两种口径都是对的，取决于这段条在讲什么**：
 *   · 编辑器（false）：块 = 「我把这招放在这几秒」⇒ 拖到窗外就该露出来，夹了用户就看不见自己拖出去了；
 *   · 逐窗图（true）：条 = 「这一窗的兑现」⇒ 条宽就是窗长，越界段只画到边界。
 */
export function axisBarGeometry(input: {
  start: number
  duration: number
  span: number
  minPct?: number
  clampToTrack?: boolean
}): AxisBarGeometry {
  const minPct = input.minPct ?? 0
  const raw = axisPct(input.start, input.span)
  const leftPct = input.clampToTrack ? Math.max(0, Math.min(100, raw)) : raw
  const widthPct = Math.max(minPct, axisPct(input.duration, input.span))
  return { leftPct, widthPct: input.clampToTrack ? Math.max(0, Math.min(100 - leftPct, widthPct)) : widthPct }
}

/**
 * 跨界块里「在窗内」那段占**整条**宽度的百分比（`inAxisCount / count`）。
 *
 * `count <= 0`（0 时长标记块 / 数据缺失）⇒ 100（整条实心）—— 与改动前的
 * `AxisWindowChart#inPct` 逐位一致：那时 `!(count > 0)` 恒返回 `'100%'`。
 */
export function axisInnerPct(inAxisCount: number, count: number): number {
  if (!(count > 0)) return 100
  return Math.max(0, Math.min(100, (inAxisCount / count) * 100))
}

// ---------------------------------------------------------------- 编辑器时间轴布局

/** 块里的名字放不下时，排到所在角色道下方的**标签行**上（分行口径见 `stunAxisView#layoutBlockLabels`） */
export interface AxisTimelineLabelRow {
  /** 动作块序（= `actions` 下标；模板按它做 key） */
  index: number
  /** 距时间轴顶（px） */
  top: number
  /** 左端（轨道百分比，已夹到 0..100） */
  leftPct: number
  /** 名字（不含时长尾巴 —— 时长是可收缩的尾巴，不参与「放不放得下」的判定） */
  label: string
  /** 时长后缀（`" 2.5s"`；空串 = 不写） */
  durText: string
  /** 悬停全文 */
  title: string
}

/** 一条事件道（顶/高由布局给，页面**不写死道距**） */
export interface AxisTimelineEventLane {
  key: string
  name: string
  /** 该道占几行版面（≥1；空道也占 1 行，用户能看出「这类事件今天没有」） */
  rows: number
  /** 道顶（px，绝对） */
  top: string
  height: string
  markers: Array<AxisEventMarker & { row: number }>
}

/** 一条轴的时间轴布局（每条轴一次算完，模板只读结果） */
export interface AxisTimelineLayout {
  /** 三槽角色道的顶 / 高（高含各自的外置标签行） */
  slotTop: number[]
  slotH: number[]
  /** 三槽动作块的顶（道内垂直居中） */
  blockTop: number[]
  /** 专属窗口道的顶（紧随最后一条角色道） */
  winTop: number
  /** 事件道的顶（紧随最后一条专属窗口道） */
  evTop: number
  /** 外置标签（与 `actions` 同序；`null` = 该块名字写在块内） */
  labels: Array<AxisTimelineLabelRow | null>
  evLanes: AxisTimelineEventLane[]
  /** 容器总高（角色道 + 专属窗口道 + 事件道 + 底边留白） */
  height: number
}

/** 该轴没有动作块 / 尚未取到时的空布局（模板据此仍能渲染刻度与道名） */
export function emptyAxisTimeline(): AxisTimelineLayout {
  return {
    slotTop: [AXIS_TIME_PX.head, AXIS_TIME_PX.head, AXIS_TIME_PX.head],
    slotH: [AXIS_TIME_PX.laneH, AXIS_TIME_PX.laneH, AXIS_TIME_PX.laneH],
    blockTop: [AXIS_TIME_PX.head, AXIS_TIME_PX.head, AXIS_TIME_PX.head],
    winTop: AXIS_TIME_PX.head,
    evTop: AXIS_TIME_PX.head,
    labels: [],
    evLanes: [],
    height: AXIS_TIME_PX.head + AXIS_TIME_PX.laneH * 3 + AXIS_TIME_PX.tail,
  }
}

export interface AxisTimelineInput {
  /** 该轴的动作块（与 `axis.actions` 同序） */
  actions: ReadonlyArray<{ readonly slot: number; readonly startTime?: number }>
  /** 第 i 块的时长（秒）—— 编辑器 = 动作池单次时长 × count（口径住在页面，不在这里重算） */
  durationOf: (index: number) => number
  /** 第 i 块要写进块里的**名字**（长度决定放不放得下；**不含**时长尾巴） */
  labelOf: (index: number) => string
  /** 第 i 块的时长后缀（`" 2.5s"`） */
  durTextOf: (index: number) => string
  /** 第 i 块的悬停全文 */
  titleOf: (index: number) => string
  /** 窗口时长（秒） */
  windowSeconds: number
  /** 时间轴**实测像素宽**（放不放得下必须按真实轴宽算；`0`/缺省 ⇒ 保守缺省 1000px） */
  trackPx: number
  /** 专属窗口道条数（每条占一行 `laneH`） */
  windowLaneCount: number
  /** 本轴的可见事件道（**行数与标记由页面按引擎产物派生**；`top/height` 由本函数给） */
  eventLanes: ReadonlyArray<{ key: string; name: string; rows: number; markers: ReadonlyArray<AxisEventMarker & { row: number }> }>
}

/**
 * 一条轴的时间轴布局：**自上而下累积**角色道（含各自的标签行）→ 专属窗口道 → 事件道。
 *
 * ⚠ 必须逐轴算：外置标签行数逐轴不同 ⇒ 窗口道 / 事件道的顶坐标**不再是常量**
 *   （旧实现把 `24 + 序号 × 20` 写死在 JS 与 CSS 两处，多一行就会互相压住）。
 */
export function buildAxisTimeline(input: AxisTimelineInput): AxisTimelineLayout {
  const acts = input.actions
  const win = input.windowSeconds
  // ① 每槽的块标签分行（纯几何在 stunAxisView#layoutBlockLabels：放得下写块里，放不下排标签行）
  const perSlot = [0, 1, 2].map(s => {
    const idx = acts.map((_, i) => i)
      .filter(i => acts[i]!.slot === s)
      .sort((a, b) => (acts[a]!.startTime ?? 0) - (acts[b]!.startTime ?? 0))
    const lay = layoutBlockLabels(
      // ⚠ text 只给**名字**：时长（" 2.5s"）是尾巴，块里放不下时由 CSS 先挤掉（.sap-block-dur 可收缩），
      //   不能因为尾巴塞不下就把整个名字赶到标签行去（实测会把 2.5s 的强特块也误判成放不下）。
      idx.map(i => ({ start: acts[i]!.startTime ?? 0, dur: input.durationOf(i), text: input.labelOf(i) })),
      win,
      // ⚠ 首帧还没量到宽时用保守缺省 1000px（= 宁可多排一行也不切字）；`0` 与缺省同义
      input.trackPx || 1000,
    )
    return { idx, lay }
  })
  // ② 道面自上而下累积
  const slotTop: number[] = [0, 0, 0]
  const slotH: number[] = [AXIS_TIME_PX.laneH, AXIS_TIME_PX.laneH, AXIS_TIME_PX.laneH]
  const blockTop: number[] = [AXIS_TIME_PX.head, AXIS_TIME_PX.head, AXIS_TIME_PX.head]
  const labels: Array<AxisTimelineLabelRow | null> = acts.map(() => null)
  let y = AXIS_TIME_PX.head
  perSlot.forEach(({ idx, lay }, s) => {
    const extra = lay.rows > 0 ? 2 + lay.rows * AXIS_TIME_PX.labelH : 0
    slotTop[s] = y
    slotH[s] = AXIS_TIME_PX.laneH + extra
    blockTop[s] = y + (AXIS_TIME_PX.laneH - AXIS_TIME_PX.blockH) / 2
    idx.forEach((i, k) => {
      if (lay.inside[k]) return
      labels[i] = {
        index: i,
        top: y + AXIS_TIME_PX.laneH + 2 + lay.row[k]! * AXIS_TIME_PX.labelH,
        leftPct: axisPctClamp(lay.at[k] ?? 0, win),
        label: input.labelOf(i),
        durText: input.durTextOf(i),
        title: input.titleOf(i),
      }
    })
    y += slotH[s]! + AXIS_TIME_PX.laneGap
  })
  const winTop = y
  y += input.windowLaneCount * AXIS_TIME_PX.laneH
  const evTop = y
  const evLanes: AxisTimelineEventLane[] = []
  // 起点由布局给出（角色道 + 专属窗口道之后）；道高随内部行数变化 ⇒ 逐条累加，不用固定间距
  let topS = evTop
  for (const lane of input.eventLanes) {
    const heightPx = lane.rows * AXIS_TIME_PX.evRowH + AXIS_TIME_PX.evPad
    evLanes.push({ key: lane.key, name: lane.name, rows: lane.rows, top: topS + 'px', height: heightPx + 'px', markers: [...lane.markers] })
    topS += heightPx + 2
  }
  const evH = evLanes.reduce((sum, l) => sum + l.rows * AXIS_TIME_PX.evRowH + AXIS_TIME_PX.evPad + 2, 0)
  return { slotTop, slotH, blockTop, winTop, evTop, labels, evLanes, height: evTop + evH + AXIS_TIME_PX.tail }
}
