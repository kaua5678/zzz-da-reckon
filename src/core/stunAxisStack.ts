/**
 * 失衡轴栈遍历引擎（预制轴 = 优先级栈，只算总量）
 *
 * 模型：一个角色（队伍×命座）挂一条「富裕轴」优先级栈，引擎对每次失衡窗口走栈：
 * 1. 从栈顶（最高优先级）往下取动作，逐个检查资源：
 *    - 闪能（强特）→ 不够就跳过这个动作（不是整轮失败）；
 *    - 喧响（终结技/开帷幕）→ 不够就跳过；
 *    - 时间 → 累计动作时长，超过失衡窗口就停（后面的动作整段舍弃）。
 * 2. 循环到资源耗尽或窗口填满。
 *
 * 效果：资源全够 = 爆发轴（栈顶到底全打）；能量/喧响不够 = 中低优先级动作被跳过 = 经济轴自然分化。
 * 本模块只做「哪些动作被执行」的纯函数决策，不碰面板/倍率/伤害。
 */

export interface StackActionCost {
  slot: number
  moveId: string
  /** 该栈条目要打的次数 */
  count: number
  /** 单次动作时长（秒） */
  actionTime: number
  /** 单次闪能消耗（强特；0 = 不耗闪能） */
  energyCost: number
  /** 单次喧响消耗（终结技/开帷幕；0 = 不耗喧响） */
  decibelCost: number
  /** 动作开始时间（秒，相对失衡窗口起点；缺省 0，可为负=窗口外提前起手）。
   *  平A填充用：从该槽位最后一个动作的结束时刻填到窗口结束（富余才填），不是「窗口 − Σ动作时长」。 */
  startTime?: number
  /** 窗口终结动作（如佩洛伊斯右分支决算）：该动作做完时清空窗口剩余失衡时间——
   *  所在窗口平A填充恒为 0（剩余时间已被清空，没有可填充的富余），窗口有效失衡时长按其结束时刻截断。 */
  endsStunWindow?: boolean
}

export interface StackAxisInput {
  /** 优先级栈，数组顺序 = 优先级从高到低 */
  actions: StackActionCost[]
  /** 该轴打几次失衡窗口；缺省 = 兜底（吃掉所有剩余窗口） */
  count?: number
  /** 该轴的兜底平A角色槽位：资源不足时剩余窗口时间由该角色打平A填充；缺省不填充 */
  basicFillerSlot?: number
}

export interface StackTraversalInput {
  /** 轴列表：按顺序分配窗口；count 缺省 = 兜底（吃掉所有剩余窗口） */
  axes: StackAxisInput[]
  /** 失衡窗口数（失衡池收敛结果） */
  stunCount: number
  /** 单次失衡窗口时长（秒）= stunTime + 连携窗口 + 队伍延长 */
  windowDuration: number
  /** 各槽位可用闪能（点）；缺省槽位按 0 */
  energyBySlot?: Record<number, number>
  /** 各槽位可用喧响（点）；缺省槽位按 0 */
  decibelBySlot?: Record<number, number>
}

export interface StackTraversalResult {
  /** 轴内实际执行的每个动作（跨所有窗口合计，key = `${slot}:${moveId}` → 次数） */
  executed: Record<string, { slot: number; moveId: string; count: number }>
  /** 轴内执行总耗时（秒） */
  timeUsed: number
  /**
   * 合轴节省（秒）：窗口内各角色块区间并集长度与块时长和的差（跨槽位并行只计一次前台）。
   * 时间预算消费口径：物化行全额 − 本值 = 前台净占用（iterate 平A池吃进节省）。
   */
  overlapSeconds: number
  /**
   * 合轴节省按块分摊（`${slot}:${moveId}` → 秒）：物化行按同一键扣减（行 count = 块次数、
   * 行 totalTime 全额，扣后为净占用）。比例分摊严格可加，Σ 值 = overlapSeconds。
   */
  overlapByAction: Record<string, number>
  /** 消耗闪能 */
  energyUsed: number
  /** 全队可用闪能总量（提示资源是否充足） */
  totalEnergy: number
  /** 消耗喧响 */
  decibelUsed: number
  /** 全队可用喧响总量（提示资源是否充足） */
  totalDecibel: number
  /** 实际用到的窗口数（≤ stunCount） */
  windowsUsed: number
  /** 被跳过的动作（资源不足） */
  skipped: { slot: number; moveId: string; reason: 'energy' | 'decibel' | 'time' }[]
  /** 兜底平A填充总秒数（资源不足的剩余窗口时间，所有轴合计） */
  basicFillSeconds: number
  /** 各槽位兜底平A填充秒数（每轴可指定不同 filler slot） */
  basicFillBySlot: Record<number, number>
  /** 含窗口终结动作（决算）被截断的窗口数 */
  truncatedWindows: number
  /** 截断损失的失衡秒数合计（Σ 窗口时长 − 截断结束时刻；供失衡覆盖率/易伤重算） */
  stunSecondsLost: number
  note: string
}

/**
 * 把失衡窗口数按轴顺序分配：count 有值 = 精确次数，缺省 = 兜底吃剩余。
 * 返回每个轴分配到的窗口数（与 axes 同序）。供栈遍历、连携加权、转大加权共用同一套口径。
 */
export function allocateAxisWindows(axes: { count?: number }[], stunCount: number): number[] {
  const wins: number[] = []
  let remaining = Math.max(0, stunCount)
  for (const axis of axes) {
    if (remaining <= 0) { wins.push(0); continue }
    const w = axis.count !== undefined ? Math.min(axis.count, remaining) : remaining
    wins.push(w)
    remaining -= w
  }
  return wins
}

export function calcStunAxisStack(input: StackTraversalInput): StackTraversalResult {
  const { axes, stunCount, windowDuration } = input
  const energyBySlot = input.energyBySlot ?? {}
  const decibelBySlot = input.decibelBySlot ?? {}

  const executed: Record<string, { slot: number; moveId: string; count: number }> = {}
  const skipped: StackTraversalResult['skipped'] = []
  let timeUsed = 0
  let overlapSeconds = 0
  const overlapByAction: Record<string, number> = {}
  let windowsUsed = 0
  let basicFillSeconds = 0
  const basicFillBySlot: Record<number, number> = {}
  let energyUsed = 0
  let decibelUsed = 0
  let truncatedWindows = 0
  let stunSecondsLost = 0

  const totalEnergy = Object.values(energyBySlot).reduce((a, b) => a + (b > 0 ? b : 0), 0)
  const totalDecibel = Object.values(decibelBySlot).reduce((a, b) => a + (b > 0 ? b : 0), 0)

  const bump = (slot: number, moveId: string, count: number) => {
    const key = `${slot}:${moveId}`
    const cur = executed[key]
    if (cur) cur.count += count
    else executed[key] = { slot, moveId, count }
  }

  // 窗口调度：按轴顺序分配；count 有值 → 精确次数，缺省 → 兜底吃剩余。
  // 每个窗口携带其来源轴的 filler slot（每轴可不同）。
  const schedule: { actions: StackActionCost[]; basicFillerSlot?: number }[] = []
  const winAlloc = allocateAxisWindows(axes, stunCount)
  axes.forEach((axis, ai) => {
    for (let i = 0; i < winAlloc[ai]; i++) schedule.push({ actions: axis.actions, basicFillerSlot: axis.basicFillerSlot })
  })

  for (const window of schedule) {
    // 合轴：时间按槽位独立门控（各角色并行填窗口，互不挤占先后时间）
    const slotTime: Record<number, number> = {}
    // 各槽位时间线最晚结束时刻（max(startTime+actionTime)，仅执行成功的动作）——平A填充从这往后
    const slotMaxEnd: Record<number, number> = {}
    // 合轴检测（2026-08-30）：窗口内各角色的块在时间轴上并行（如般岳强特时琉音抱拳），
    // 前台净占用 = 各槽位块区间的【并集】而非块时长之和。每槽位顺序排块（cursor 累计，
    // 显式 startTime 更晚则顺延到它），跨槽位区间重叠部分只计一次前台。
    const windowIntervals: { key: string; t0: number; t1: number }[] = []
    const slotCursor: Record<number, number> = {}
    let windowDidSomething = false
    let windowTimeSum = 0
    // 窗口终结（决算）：执行过 endsStunWindow 动作后，窗口剩余失衡时间被清空（截断结束时刻取最晚）
    let windowTruncEnd = -1

    for (const act of window.actions) {
      for (let i = 0; i < act.count; i++) {
        const used = slotTime[act.slot] ?? 0
        // 时间门控（优先级只作用于超时部分）：该槽位放不下 → 跳过（超时被截断）。
        // 例外：窗口终结动作（佩洛伊斯决算）无视时间阀门——发动时锁定失衡，即便失衡最后一刻放出也吃满易伤。
        if (!act.endsStunWindow && act.actionTime > 0 && used + act.actionTime > windowDuration) {
          skipped.push({ slot: act.slot, moveId: act.moveId, reason: 'time' })
          continue
        }
        // 资源：固定轴，不足也计入，但记警告（不自动变轴）
        if (act.energyCost > 0) {
          energyUsed += act.energyCost
          if (energyUsed > totalEnergy) skipped.push({ slot: act.slot, moveId: act.moveId, reason: 'energy' })
        }
        if (act.decibelCost > 0) {
          decibelUsed += act.decibelCost
          if (decibelUsed > totalDecibel) skipped.push({ slot: act.slot, moveId: act.moveId, reason: 'decibel' })
        }
        // 执行
        bump(act.slot, act.moveId, 1)
        slotTime[act.slot] = used + act.actionTime
        // 时间线末尾：该槽位最晚结束时刻（startTime 负值=窗口外提前起手，按 0 起算）
        const end = Math.max(0, act.startTime ?? 0) + act.actionTime
        slotMaxEnd[act.slot] = Math.max(slotMaxEnd[act.slot] ?? 0, end)
        // 合轴区间：该槽位顺序排块（cursor = 已排到的时刻），显式 startTime 更晚则顺延到它
        if (act.actionTime > 0) {
          const cursor = slotCursor[act.slot] ?? 0
          const t0 = Math.max(cursor, Math.max(0, act.startTime ?? 0))
          windowIntervals.push({ key: `${act.slot}:${act.moveId}`, t0, t1: t0 + act.actionTime })
          slotCursor[act.slot] = t0 + act.actionTime
        }
        windowTimeSum += act.actionTime
        windowDidSomething = true
        if (act.endsStunWindow) windowTruncEnd = Math.max(windowTruncEnd, end)
      }
    }

    if (windowDidSomething) windowsUsed++
    timeUsed += windowTimeSum
    // 合轴节省分摊：窗口总节省 = Σ块时长 − 区间并集（跨槽位并行只计一次前台）。
    // 按块时长比例分摊到 `${slot}:${moveId}`（比例分摊严格可加 Σ=总节省；「独立贡献」口径
    // 在多块完全重叠时不可加）。物化行按同一键扣减（行 count = 块次数，行 totalTime 全额）。
    if (windowIntervals.length > 1) {
      const sorted = [...windowIntervals].sort((a, b) => a.t0 - b.t0)
      let unionLen = 0
      let curT0 = sorted[0].t0
      let curT1 = sorted[0].t1
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].t0 > curT1) {
          unionLen += curT1 - curT0
          curT0 = sorted[i].t0
          curT1 = sorted[i].t1
        } else {
          curT1 = Math.max(curT1, sorted[i].t1)
        }
      }
      unionLen += curT1 - curT0
      const windowOverlap = Math.max(0, windowTimeSum - unionLen)
      if (windowOverlap > 1e-9) {
        for (const iv of windowIntervals) {
          const share = windowOverlap * ((iv.t1 - iv.t0) / windowTimeSum)
          overlapSeconds += share
          overlapByAction[iv.key] = (overlapByAction[iv.key] ?? 0) + share
        }
      }
    }
    if (windowTruncEnd >= 0) {
      // 决算截断：窗口剩余失衡时间在决算做完时被清空。
      // - 可填充的平A为 0（填充本意 = 剩余时间 − 最后动作结束时刻，剩余已被清空）
      // - 有效失衡时长按截断结束时刻计，损失秒数回传供覆盖率/易伤重算
      truncatedWindows++
      stunSecondsLost += Math.max(0, windowDuration - windowTruncEnd)
    } else if (window.basicFillerSlot !== undefined && windowDidSomething) {
      // 兜底平A：从该槽位最后一个动作的结束时刻填到窗口结束（窗口有富余才填）。
      // 动作之间的空隙（startTime 留白）不算平A——平A只补「最后一个动作之后」的富余。
      const end = slotMaxEnd[window.basicFillerSlot] ?? 0
      const fillSec = Math.max(0, windowDuration - end)
      basicFillSeconds += fillSec
      basicFillBySlot[window.basicFillerSlot] = (basicFillBySlot[window.basicFillerSlot] ?? 0) + fillSec
    }
  }

  return {
    executed,
    timeUsed,
    overlapSeconds,
    overlapByAction,
    truncatedWindows,
    stunSecondsLost,
    energyUsed,
    totalEnergy,
    decibelUsed,
    totalDecibel,
    windowsUsed,
    basicFillSeconds,
    basicFillBySlot,
    skipped,
    note: `栈遍历：${windowsUsed} 窗口 × 单窗口 ${windowDuration}s；闪能消耗 ${energyUsed} / ${totalEnergy}，喧响 ${decibelUsed} / ${totalDecibel}；超时/资源不足 ${skipped.length} 个动作（固定轴：资源不足只提示，不自动变轴）。`,
  }
}
