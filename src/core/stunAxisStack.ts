/**
 * 失衡轴栈遍历引擎（预制轴 = 优先级栈，只算总量）
 *
 * 模型：一个角色（队伍×命座）挂一条「富裕轴」优先级栈，引擎对每次失衡窗口走栈：
 * 1. 从栈顶（最高优先级）往下取动作，逐个检查资源：
 *    - 闪能（强特）→ **超出总量的动作直接去掉**（用户口径 2026-09-08：通用规则，耗资源的招式
 *      都从总量里拿，不许凭空创造；四舍五入开关在**总量侧**补缺口，见下）；
 *    - 喧响（终结技/开帷幕）→ 同口径**去掉**（总回复只够 3 次大招时，轴里捏的第 4 次打不出来 → 扣除）；
 *    - 时间 → 累计动作时长，超过失衡窗口就停（后面的动作整段舍弃）。
 * 2. 循环到资源耗尽或窗口填满。
 *
 * 效果：资源全够 = 爆发轴（栈顶到底全打）；资源不够 = 低优先级动作被跳过 = 经济轴自然分化。
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
  /**
   * 进轴时敌人身上已有的**残痕值**（点数，600 = 1 层；用户口径 2026-10-12）。
   * 栈引擎只做**透传**（本字段不参与时间/资源门控），由消费它的角色模块做轴内时序推演。
   */
  entryGash?: number
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

/** 某槽某招式在轴内的执行次数（`StackTraversalResult.executed` 的值，key = `${slot}:${moveId}`） */
export interface ExecutedMoveCount { slot: number; moveId: string; count: number }

/**
 * 轴内**逐次执行序列**的一条（`StackTraversalResult.sequence` 的元素）。
 * 顺序 = 栈引擎实际执行的先后（同槽位内为真实先后；跨槽位并行，消费者须按槽过滤）。
 * 语义边界 = **轴内本地**（全局侧仍是总量口径，见 `StackTraversalResult.sequence` 头注释）。
 */
export interface StackSequenceEntry {
  slot: number
  moveId: string
  count: number
  /**
   * **窗口序号**（从 1 起）——轴是**每窗重放的模板**，同一 moveId 会在每个窗口各出现一次。
   *
   * 用途：把「进轴值」（如克拉蕾残痕 `entryGash`）正确应用为**每窗开头**的初值，
   * 而不是整条序列只给一次——用户口径 2026-10-12：「我预设开头给1800，每个轴开头都该给1800呀。
   * 你这个静默清零搞得轴都没效果了，那轴的复制性呢」。
   */
  window: number
  /**
   * 该动作在**窗口内的开始时刻**（秒，相对失衡窗口起点；缺省 0）。
   *
   * 用途：把轴内推演结果（如克拉蕾的毁伤触发）标回时间轴上——用户口径 2026-10-12：
   * 「你的毁伤我还是没看到哪里写了触发时间点，触发多少次」。
   * ⚠ 跨窗口的重复执行都从各自窗口的 0 起算（栈是逐窗遍历的）⇒ 这是**窗内相对时刻**，
   *   不是整局绝对时刻；消费方若要排整局时间轴需自行按窗序偏移。
   */
  startTime: number
}

export interface StackTraversalResult {
  /** 轴内实际执行的每个动作（跨所有窗口合计，key = `${slot}:${moveId}` → 次数） */
  executed: Record<string, ExecutedMoveCount>
  /**
   * 轴内**逐次执行序列**（按实际执行先后；见 `StackSequenceEntry`）——**轴内本地数据**。
   *
   * 用途：角色专属资源在**轴内**的本地时序推演（克拉蕾残痕「积累 → 消耗 → 再积累」，
   * 用于判断轴内这次够不够消耗、能否触发毁伤）。
   * ⚠ 不是全局事件排序：全局侧失衡轴仍是「从总量里选取一部分做计数判定」（用户 2026-10-12 口径），
   *   本字段只暴露轴自身的执行先后；跨槽位并行 ⇒ 消费者必须**只按本槽过滤**后再推演。
   */
  sequence: StackSequenceEntry[]
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
  /**
   * 进轴残痕值（点数）：**透传**自消费轴（`StackAxisInput.entryGash`），供编排层注入 cfg。
   * 多轴时取**首条非零**（现实里只有一条轴会声明它；不设多轴求和以免语义含糊）。
   */
  entryGash: number
  /** 实际用到的窗口数（≤ stunCount） */
  windowsUsed: number
  /** 被跳过的动作（资源不足） */
  skipped: { slot: number; moveId: string; reason: 'energy' | 'decibel' | 'time' }[]
  /** 兜底平A填充总秒数（资源不足的剩余窗口时间，所有轴合计） */
  basicFillSeconds: number
  /** 各槽位兜底平A填充秒数（每轴可指定不同 filler slot） */
  basicFillBySlot: Record<number, number>
  note: string
}

/**
 * 把失衡窗口数按轴顺序分配：count 有值 = 精确次数，缺省 = 兜底吃剩余。
 * 返回每个轴分配到的窗口数（与 axes 同序）。供栈遍历、连携加权、转大加权共用同一套口径。
 */
export function allocateAxisWindows(axes: ReadonlyArray<{ readonly count?: number }>, stunCount: number): number[] {
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

  const executed: Record<string, ExecutedMoveCount> = {}
  /**
   * 逐次执行序列（**按实际执行顺序**追加，含 `count`——一次 `bump(count>1)` 记一条）。
   *
   * 为什么需要：`executed` 按 `${slot}:${moveId}` 聚合，顺序信息丢失。而角色专属资源若是
   * **时序**过程（克拉蕾残痕：积累 → 消耗 → 再积累；够不够决定这一次毁伤触不触发），
   * 就必须知道顺序——这是 `docs/ENGINE_PIPELINE_GUIDE.md` 坑 19 记的 R54 债务所指的
   * 「引擎获得逐事件顺序通道（**不需要绝对时刻，只需顺序**）」。
   *
   * ⚠ 本字段是**纯追加**：既有字段一个不动 ⇒ 对未声明时序消费者的角色零影响。
   * ⚠ `slot` 是**槽位号**（不是 `characters` 下标，见 `core/panel.ts#panelAt` 同族口径）；
   *   跨槽位的相对顺序**不等于**真实同时性（各槽并行），故消费者必须**只按本槽过滤**后再推演。
   */
  const sequence: StackSequenceEntry[] = []
  const skipped: StackTraversalResult['skipped'] = []
  let timeUsed = 0
  let overlapSeconds = 0
  const overlapByAction: Record<string, number> = {}
  let windowsUsed = 0
  let basicFillSeconds = 0
  const basicFillBySlot: Record<number, number> = {}
  let energyUsed = 0
  let decibelUsed = 0

  const totalEnergy = Object.values(energyBySlot).reduce((a, b) => a + (b > 0 ? b : 0), 0)
  const totalDecibel = Object.values(decibelBySlot).reduce((a, b) => a + (b > 0 ? b : 0), 0)
  // 每槽位剩余资源（门控用）。**口径（用户 2026-09-10 裁决 #3）**：预设动作只能「从本槽位总量拿取」，
  // 不得跨槽挪用队伍总量、也不得反填总量——旧实现用 `decibelUsed/energyUsed` 累加对**队伍总量**
  // 比较，等于让 A 槽的大招花掉 B 槽的喧响（与引擎「每槽按自身产出推导次数」两套逻辑混合）。
  const energyLeft: Record<number, number> = { ...energyBySlot }
  const decibelLeft: Record<number, number> = { ...decibelBySlot }

  const bump = (slot: number, moveId: string, count: number, startTime = 0, win = 1) => {
    const key = `${slot}:${moveId}`
    const cur = executed[key]
    if (cur) cur.count += count
    else executed[key] = { slot, moveId, count }
    // 逐次执行序列（**轴内本地时序数据**，2026-10-12）：`executed` 是**按 key 聚合**的、丢了顺序；
    // 而克拉蕾的残痕在轴内是「积累 → 消耗 → 再积累」的过程（用户口径：「一开始1800残痕值进去，
    // 打3层毁伤，残痕值归零，然后又积累1800，又打毁伤3层。再积累600点，再打一次，如果时间足够，
    // 就可以在轴内打出7次」）⇒ 轴内那一次单独计算需要知道**谁先谁后**。
    //
    // ⚠ 这**不是**全局事件排序能力、也不是全局口径变更（用户 2026-10-12 明确纠正）：
    //   全局侧失衡轴依旧是「**从总量里选取一部分来做计数判定**」——本字段只是把轴**自己本来就有的**
    //   执行先后（`window.actions` 的遍历序）如实暴露出来，供模块做**轴内本地**的时序推演。
    //   跨槽位是并行的，故消费者必须**只按本槽过滤**后再推演（不得跨槽比较先后）。
    // ⚠ 纯追加，既有字段一个不动 ⇒ 对未消费本字段的角色零行为变更。
    if (count > 0) sequence.push({ slot, moveId, count, startTime: Math.max(0, Number(startTime)), window: win })
  }

  // 窗口调度：按轴顺序分配；count 有值 → 精确次数，缺省 → 兜底吃剩余。
  // 每个窗口携带其来源轴的 filler slot（每轴可不同）。
  const schedule: { actions: StackActionCost[]; basicFillerSlot?: number }[] = []
  const winAlloc = allocateAxisWindows(axes, stunCount)
  axes.forEach((axis, ai) => {
    for (let i = 0; i < winAlloc[ai]; i++) schedule.push({ actions: axis.actions, basicFillerSlot: axis.basicFillerSlot })
  })

  let windowNo = 0
  for (const window of schedule) {
    windowNo++
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
        // 资源门控（**通用口径**，用户 2026-09-08）：轴从**总量**里挑招式——任何耗资源的动作，
        // 超出该槽位总量就**去掉**（不执行、不计入），不许凭空创造。喧响实测语义：总回复 9000 →
        // 只够 3 次大招，轴里捏了 4 次 → 第 4 次打不出来（窗口里攒不出 3000），必须扣掉；
        // 轴里本来就只捏 3 次则不受影响。闪能（强特）同口径。
        // 例外：四舍五入开关（保底4喧响 `guarantee.ultimate`）**已经在总量侧**把缺口补上
        //（补弹刀 → decibelSource.total 变高，见 useResourceCalc 的 decibelParryNext），
        // 所以这里不需要「允许超支」——开关打开时总量本身就略微提升了。
        // 本文件头注释一直写的也是「不够就跳过」，此前实现与之不符。
        if (act.decibelCost > 0 && (decibelLeft[act.slot] ?? 0) + 1e-9 < act.decibelCost) {
          skipped.push({ slot: act.slot, moveId: act.moveId, reason: 'decibel' })
          continue
        }
        if (act.energyCost > 0 && (energyLeft[act.slot] ?? 0) + 1e-9 < act.energyCost) {
          skipped.push({ slot: act.slot, moveId: act.moveId, reason: 'energy' })
          continue
        }
        if (act.energyCost > 0) {
          energyLeft[act.slot] = (energyLeft[act.slot] ?? 0) - act.energyCost
          energyUsed += act.energyCost
        }
        if (act.decibelCost > 0) {
          decibelLeft[act.slot] = (decibelLeft[act.slot] ?? 0) - act.decibelCost
          decibelUsed += act.decibelCost
        }
        // 执行
        bump(act.slot, act.moveId, 1, act.startTime ?? 0, windowNo)
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
    // 决算截断窗（windowTruncEnd ≥ 0）不填平A：剩余失衡时间在决算做完时已被清空，没有可填充的富余。
    // 覆盖率要扣的截断损失秒不在这里算——那是时间账，由 convergence 决算截断段按实数窗口算（verdictSecondsLost）。
    if (windowTruncEnd < 0 && window.basicFillerSlot !== undefined && windowDidSomething) {
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
    sequence,
    timeUsed,
    overlapSeconds,
    overlapByAction,
    energyUsed,
    totalEnergy,
    decibelUsed,
    totalDecibel,
    windowsUsed,
    basicFillSeconds,
    basicFillBySlot,
    entryGash: axes.reduce((acc, ax) => acc || Math.max(0, Number(ax.entryGash ?? 0)), 0),
    skipped,
    note: `栈遍历：${windowsUsed} 窗口 × 单窗口 ${windowDuration}s；闪能消耗 ${energyUsed} / ${totalEnergy}，喧响 ${decibelUsed} / ${totalDecibel}；超时/资源不足 ${skipped.length} 个动作（固定轴：资源不足只提示，不自动变轴）。`,
  }
}
