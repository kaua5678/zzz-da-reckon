/**
 * 事件时间轴影子内核 · 类型（R4-A1，设计稿 docs/mcp-timeline-shadow-kernel.md）。
 *
 * 🛑 R4 已被用户撤销（2026-09-27，docs/REQUIREMENTS.md「R4 撤销说明」）：本目录是保留待用户决定去留的死代码，
 * **不接入任何路径，也不扩展**。
 *
 * ⚠ 隔离约束（判据 26 锁死）：本目录只依赖 `@/core/*` 纯函数与自身类型；**不 import**
 * composables / stores / mechanics / specs / views / components；非测试 src **不得 import** 本目录。
 * 影子阶段只产出差异报告，不改变任何既有输出（R4 硬约束 1）。
 */

/** 窗口外循环动作：影子内核在失衡窗口外按顺序反复执行（设计稿 D2 / 近似 U1） */
export interface LoopAction {
  slot: number
  moveId: string
  /** 动作占用前台的时长（秒，>0 才推进时间） */
  duration: number
  /** 本次动作完成时累加的**有效**失衡值（直接取引擎已算好的每次失衡值，不重新建模加成） */
  stun: number
  /** 本次动作完成时给本槽的喧响 */
  decibel?: number
}

/** 失衡窗口内动作（来自轴预设：offset = 相对开窗时刻的 startTime） */
export interface WindowAction {
  offset: number
  slot: number
  moveId: string
  decibel?: number
}

export interface StunTrackInput {
  /** 战斗时长（秒） */
  battleTime: number
  /** Boss 失衡值上限 */
  bossStunValue: number
  /** 失衡窗口时长（秒） */
  windowDuration: number
  /** 失衡值返还比例（0~0.25）：出窗后失衡条 = 比例 × bossStunValue */
  refundRatio?: number
  /** t=0 的初始失衡值（Boss 白送 stunGift 等） */
  initialStun?: number
  /**
   * 开窗时溢出的失衡值是否结转到下一轮（默认 false = 丢弃）。
   * 现引擎的闭式公式 `1 + floor((总 − 上限) / (上限 × (1 − 返还)))` 等价于**结转**；
   * 两种取值的差异即差异表里的 E1 类归因。
   */
  carryOverflow?: boolean
  offWindowLoop: LoopAction[]
  /** 第 i 个窗口用 templates[min(i, len−1)]；缺省 = 窗口内无动作事件 */
  windowTemplates?: WindowAction[][]
}

export type TimelineEventKind = 'action' | 'stunEnter' | 'windowAction' | 'stunExit' | 'ultimate' | 'end'

export interface TimelineEvent {
  t: number
  kind: TimelineEventKind
  slot?: number
  moveId?: string
  stun?: number
  decibel?: number
  /** 所属失衡窗口序号（stunEnter / windowAction / stunExit） */
  window?: number
}

export interface StunWindow {
  index: number
  start: number
  /** 窗口结束时刻（被战斗结束截断时 = battleTime） */
  end: number
  /** 开窗时刻的失衡条值（≥ bossStunValue） */
  enterMeter: number
  /** 开窗时超出上限的部分 */
  overflow: number
}

export interface StunTrackResult {
  events: TimelineEvent[]
  windows: StunWindow[]
  /** 失衡次数 = 开出的窗口数（整数） */
  stunCount: number
  /** 战斗结束时的失衡条余量 */
  residual: number
  /** 因不结转而丢弃的溢出失衡值合计（carryOverflow=true 时恒 0） */
  overflowLost: number
  /** 完成次数，键 `${slot}:${moveId}`（窗口外动作 + 窗口内动作） */
  completedByMove: Record<string, number>
  /** 最后一个窗口外动作是否被战斗结束截断（未完成、不计入） */
  truncatedAction: boolean
}

export type UltimatePolicy = 'windowEnter' | 'whenFull'

export interface DecibelTrackOptions {
  battleTime: number
  /** 槽位数（缺省 3） */
  slots?: number
  /** 大招消耗，标量或按槽（缺省 3000） */
  ultimateCost?: number | number[]
  /** 喧响上限，标量或按槽（缺省 = ultimateCost；1391「上限 +1000」的 A/B 就改这里） */
  cap?: number | number[]
  /** 每秒被动回复，按槽（缺省 0） */
  passiveRate?: number[]
  /** t=0 初始喧响，按槽 */
  initial?: number[]
  /** 每次开窗时每槽获得的喧响（失衡喧响奖励等），按槽 */
  onStunEnter?: number[]
  /** 大招释放策略：进窗时够就放（缺省）/ 满即放 */
  policy?: UltimatePolicy
}

export interface SlotDecibelResult {
  ultimates: number
  ultimateTimes: number[]
  /** 被上限截断浪费的喧响 */
  wasted: number
  /** 战斗结束时剩余 */
  remaining: number
  /** 累计获得（未扣浪费） */
  gained: number
}

export interface DecibelTrackResult {
  slots: SlotDecibelResult[]
  /** 大招事件（按时间排序） */
  events: TimelineEvent[]
}
