/**
 * 失衡窗口**时间轴**（`docs/STUN_TIMELINE_PROJECT.md` 期 1 的地基模块，2026-10-20）。
 *
 * ## 为什么需要它（现状 = 聚合近似）
 * 引擎目前只回答「窗口总共占多少秒」：`stunWindowFraction(N, W, effTime) = clamp(N×W / effTime)`
 * （`core/effectiveTime.ts`，CC-217 全仓唯一实现）。它把 N 个窗口当成**等长且连续占满**，
 * 于是回答不了用户要的三件事：**每一个窗口什么时候开、开多久、里面打了什么**——
 * 更别说「最后一窗时间残疾」（用户口径 2026-10-20：最后一窗要么失衡不够导致时间慢，
 * 要么资源回复来不及导致动作次数残疾，**如实上报**，不要抹平）。
 *
 * 本模块把「N 个窗口」摊到战斗时钟上，产出**逐窗口**的 `StunWindowSlot`：
 * 起点 / 名义窗长 / 决算类按块延长 / 实际可用秒数 / 是否被决算提前结束 / 是否被时钟截短 /
 * 窗内动作（来自轴栈逐窗轨迹）/ 窗内剩余秒数（期 4 的输入）。
 *
 * ## 期 1 的边界（**零 delta**）
 * 本模块**不改任何既有数值**：`stunWindowFraction`、池、伤害全部照旧。唯一生产出口 =
 * `useResourceCalc#stunTimeline`（`computed`，惰性：没有消费者时零求值成本），供结果页/探针
 * 读「逐窗时间轴」；期 1 起它还兼作「导出必须有生产消费点」的落点（`deadChannelLs` ⑫ 全仓死导出为空）。
 * 期 2 才把 `stunWindowFraction` 换成 `Σ slots[].effectiveSeconds / effTime`
 * （那时会改数值，按规则 10 四步逐队归因 + 重生成 `timeGolden`/`timeFillRatchet`）。
 *
 * ## 恒等式（本期的验收判据）
 * ```
 * Σ slots[].effectiveSeconds + outsideSeconds === effectiveTime   （零容差）
 * slots[i].startSeconds === slots[i-1].startSeconds + slots[i-1].effectiveSeconds  （无缝隙、无重叠）
 * ```
 * `outsideSeconds` 由**排布本身**得出（= effectiveTime − Σ），不是另算一遍的近似：
 * 每个窗口的 `effectiveSeconds` 都被时钟钳过（`start + effective ≤ effectiveTime`），
 * 故 Σ ≤ effectiveTime 恒成立，`outsideSeconds ≥ 0`。
 *
 * ## 口径（用户 2026-10-20 逐字，见 `docs/STUN_TIMELINE_PROJECT.md` §2）
 * 1. **失衡窗口时间计入 180s**（不是白送时间）⇒ 窗口占用与窗外时间共用同一本时钟；
 * 2. 窗口内动作占**窗口时间**，不额外占窗外时间；
 * 3. 合轴吸收是合法的（全局合轴率算），本模块不为此做特殊处理；
 * 4. 最后一窗允许「残疾」，**如实上报**（`clippedByClock` / `effectiveSeconds < nominalSeconds`），
 *    不用吸收或补齐抹平；
 * 5. 窗口内的剩余时间（`unusedSeconds`）可以给队友技能填充——期 4 才做，本期只**度量**。
 *
 * ## 与轴栈的分工（单一事实源）
 * 「窗内发生了什么」只有轴栈知道（`core/stunAxisStack.ts#calcStunAxisStack`）。故它**纯追加**地
 * 暴露 `windowTrace: StunWindowTrace[]`（逐窗：延长 / 截断时刻 / 动作 / 毛占用 / 合轴节省 / 平A填充），
 * 本模块只做**排布与聚合**，不重新推演窗口内容（否则就是第二套账）。
 * 非轴模式没有轴栈（`axisStack = null`）⇒ 调用方不传 `windows`，此时
 * `hasTrace === false`、`actions` 为空、`unusedSeconds` 记 0（**不代表打满**，只表示「不可推演」）。
 *
 * ## 已知差异（期 2 / 期 3 的活，本期只如实记录）
 * 佩洛伊斯决算队的 `calc.stunCoverage × effTime` **不等于**本模块的 Σ effectiveSeconds：
 * 聚合口径用**计划窗数**（实数 2.3909）扣决算损失（2.3909 × 16.7164 = 39.9669 ⇒ 48 − 39.9669 = 8.033s），
 * 而轴栈**物理上只填了 3 个窗**、每窗在决算处截断（3 × 2.2836 = 6.851s）。
 * 差 1.18s 正是「计划值 vs 物理逐窗」的量纲错配——`docs/STUN_TIMELINE_PROJECT.md` 期 3 要修的东西。
 */

import { finiteOr0 } from '@/utils/finiteClamp'

/** 窗内一条动作（来自轴栈逐窗轨迹；非轴模式为空） */
export interface StunWindowAction {
  slot: number
  moveId: string
  /** 施放次数（整数；轴栈一次 `bump` 记 1 条） */
  count: number
  /** 落在窗口内的部分（0..count，跨界小数；见 `ExecutedMoveCount.inAxisCount`） */
  inAxisCount: number
  /** 窗内相对开始时刻（秒，相对窗口起点） */
  startTime: number
  /** 单次动作时长（秒） */
  actionTime: number
}

/**
 * 窗尾填充的**一段**（2026-10-27，用户口径「末尾自动填了平a/强特…要能看出来」）。
 *
 * 为什么要分段而不是只给总量：多槽接续（`auto-1521-1481-1491` 的 5 窗实例）下同一条窗尾可能
 * 由两个以上槽位**接力**填满——「谁在哪一秒填到哪」是逐窗可视化的直接输入，
 * 由总量反推不出来（各槽起点不同）。纯记录，不参与判定。
 */
export interface StunWindowFillSegment {
  /** 填充角色槽位 */
  slot: number
  /** 窗内相对起点（秒） */
  startSeconds: number
  /** 该段填充秒数（> 0） */
  seconds: number
}

/**
 * 轴栈的**逐窗轨迹**一条（`StackTraversalResult.windowTrace` 的元素）。
 *
 * 纯追加：不改变栈的任何既有判定（时间门 / 资源门 / 合轴 / 平A填充），只是把每窗**已经算出来的**
 * 那几个量记下来，供时间轴排布。窗口按调度顺序编号（0-based），**每个被调度的窗口都有一条**
 * （含一个动作都没执行的空窗——聚合口径里它照样占一个名义窗长）。
 */
export interface StunWindowTrace {
  index: number
  /**
   * 本窗来自**哪条轴**（`StackTraversalInput.axes` 的下标）。
   *
   * 多轴时窗口按轴顺序排（`schedule`：先第一条轴的 `winAlloc[0]` 窗，再第二条…），
   * 页面据此标出「第 3 窗属于收尾轴」；不从窗内动作反推——同样的块可能出现在两条轴里。
   */
  axisIndex: number
  /**
   * 本窗的兜底填充是否**缺省补位**（轴没声明 `basicFillerSlot` ⇒ 引擎回落轴内主C）。
   *
   * 两种语义不同（见 `calcStunAxisStack` 的兜底段注释）：声明槽受**窗外平A池**封顶，
   * 缺省补位是**产出端**（上限 = 窗口剩余秒数本身）。展示层据此如实标注「为什么这槽在填」。
   */
  fillerDefaulted: boolean
  /** 名义窗长（= `StackTraversalInput.windowDuration`） */
  nominalSeconds: number
  /** 决算块按块延长（0 = 本窗无延长；佩洛伊斯 3s） */
  extendSeconds: number
  /** 窗口有效结束时刻（窗内相对秒）：有决算截断 = 截断时刻，否则 = nominal + extend */
  endSeconds: number
  /** 是否被决算提前结束（`endsStunWindow` 块做完即清空剩余失衡时间） */
  truncated: boolean
  /** 窗内执行的动作（按实际执行顺序；含跨界小数） */
  actions: StunWindowAction[]
  /** 窗内动作毛占用（秒，= Σ actionTime 整段，未扣合轴） */
  actionSeconds: number
  /** 窗内合轴节省（秒，跨槽位并集口径，见栈引擎 `overlapSeconds`） */
  overlapSeconds: number
  /** 兜底平A填充（秒；决算截断窗恒 0） */
  fillSeconds: number
  /**
   * 窗尾填充**逐段**（谁 / 从第几秒 / 填多久；决算截断窗为空数组）。
   *
   * Σ `seconds` 恒等于 `fillSeconds`（同一处产出，不另算一遍）。
   */
  fillSegments: StunWindowFillSegment[]
}

/** 时间轴上的一个失衡窗口 */
export interface StunWindowSlot {
  /** 第几个窗口（0-based） */
  index: number
  /** 窗口开始时刻（绝对秒） */
  startSeconds: number
  /** 名义窗长 W（含所有常驻延长） */
  nominalSeconds: number
  /** 决算类按块延长（佩洛伊斯 +3s；其余 0） */
  extendedSeconds: number
  /** 实际可用于爆发的秒数（= nominal + extended − 决算截断 − 时钟截短） */
  effectiveSeconds: number
  /** 是否被决算提前结束 */
  truncated: boolean
  /** 是否被战斗时钟截短（「最后一窗时间残疾」；与 `truncated` 是两回事） */
  clippedByClock: boolean
  /** 窗内动作（来自轴栈；非轴模式为空 = 走比例近似） */
  actions: StunWindowAction[]
  /**
   * 窗内剩余秒数 = `effectiveSeconds − (动作毛占用 − 合轴节省 + 平A填充)`（下限 0）。
   * ⚠ 无轴轨迹（`hasTrace === false`）时记 0：**不代表打满**，只表示本模式不可逐窗推演。
   */
  unusedSeconds: number
  /**
   * 本窗**兜底填充**秒数（来自轨迹 `fillSeconds`；无轨迹 / 决算截断窗 = 0）。
   *
   * 为什么要在 slot 上再存一份：`realizeStunWindows` 要把「计划动作」与「兜底填充」拆成两把尺
   * （用户口径 2026-10-27「5 失衡不如 4 失衡」——窗填满了但填的是低价值平A），
   * 而 `unusedSeconds` 只给出「占据总量」，反推不出其中有多少是填充。
   *
   * ⚠ 可选：手写 `StunWindowSlot` 的测试夹具（逐窗视图）不必知道填充，
   * 缺省按 0 读（= 「这窗没有兜底填充」）。`buildStunTimeline` 产出的**总是**带上它。
   */
  fillSeconds?: number
}

/** 时间轴输入 */
export interface StunTimelineInput {
  /**
   * 失衡次数（**实际窗口数 = `floor(它)`**，与轴栈 `for (i < wins)` 同口径）。
   * 传池的整数次数（`stunPoolResult.stunCount`，= 轴栈实际排窗依据）即可；
   * 传外层计划实数（可能带小数）时小数部分只进 `plannedWindows`、**不产生窗口**（期 3 才消费）。
   */
  stunCount: number
  /** 名义窗长 W（`core/effectiveTime.ts#stunWindowDuration`） */
  windowDuration: number
  /** 有效战斗时间（`core/effectiveTime.ts#effectiveBattleTime`） */
  effectiveTime: number
  /**
   * 逐窗轨迹（轴栈 `windowTrace`；非轴模式缺省）。
   * 轨迹比窗口数短时，缺的那几窗按「无轨迹」处理（`actions` 空、`unusedSeconds` 记 0）。
   */
  windows?: readonly StunWindowTrace[]
}

/** 时间轴产物 */
export interface StunTimeline {
  /** 有效战斗时间（恒等式的另一端） */
  effectiveTime: number
  /** 输入失衡次数原值（可能带小数；如实上报，**不参与**本期排布——窗口数见 `windows`） */
  plannedWindows: number
  /** 实际排出的窗口数 = `slots.length` = `floor(stunCount)`（与轴栈 `for (i < wins)` 同口径） */
  windows: number
  slots: StunWindowSlot[]
  /** Σ `slots[].effectiveSeconds`（窗口总占用） */
  windowSeconds: number
  /** 窗外时间 = `effectiveTime − windowSeconds`（≥ 0） */
  outsideSeconds: number
  /** 是否拿到轴栈逐窗轨迹（false ⇒ `actions` 恒空、`unusedSeconds` 恒 0） */
  hasTrace: boolean
}

// @fact engine:stun/时间轴 口径: 逐窗口时间轴 = 「N 个窗口按有效时长连续排在战斗时钟上」，恒等式 Σ effectiveSeconds + outsideSeconds === effectiveTime（零容差）；窗口数取 floor(计划值) 与轴栈 `for (i < wins)` 同口径，末窗允许被时钟截短（`clippedByClock`，用户口径 2026-10-20「最后一窗口时间残疾如实上报」），决算块按块延长/提前结束走轴栈 `windowTrace` 不另算第二套账；期 1 零 delta（唯一生产出口 = `useResourceCalc#stunTimeline` 的惰性 computed）——**注意 `realizeStunWindows` 已经是生产通道**（`solveTeam` 的兑现窗数 → 覆盖率），末窗按**时钟截短份额**折算窗数（用户口径 2026-10-27「最后一窗的连续失衡做成时间截断」，与图表那根短窗条同口径） | 据 用户@2026-10-20（「失衡是需要计入 180s 的……4 次就是 180s」「最后一窗口要么失衡不够导致时间慢了，最后失衡窗口时间残疾」）·复核@2026-10-20 | 验 src/core/__tests__/stunTimeline.test.ts | 锚 src/core/stunTimeline.ts#buildStunTimeline | 信 确认
// ⟳复核: 期 2 把 `stunWindowFraction` 换成 `Σ slots[].effectiveSeconds / effTime` 时，确认本恒等式与「末窗残疾」口径未被聚合钳位（clamp 1）抹平，且 `plannedWindows` 的小数残差（期 3）有明确归属 | 到期 2027-04-30
/**
 * 把 N 个失衡窗口摊到战斗时钟上（纯函数，无副作用、无 store、无 I/O）。
 *
 * 排布规则（与聚合口径 `stunWindowFraction` 保持同源）：
 * - 窗口数 = `floor(stunCount)`（轴栈按 `for (i < wins)` 执行，小数部分不产生窗口）；
 * - 第 i 窗起点 = 前 i−1 窗的有效时长之和（**连续占满**，与「N 个窗口等长且连续」的旧假设一致，
 *   差别只在「每窗长度可以不同」+「末窗可以被时钟截短」）；
 * - 每窗有效时长 = `nominal + extended`，有决算截断取 `min(·, 截断时刻)`，再被时钟钳
 *   （`start + effective ≤ effectiveTime`，截短时 `clippedByClock = true`）；
 * - `outsideSeconds` 由排布得出，**不另算**。
 */
export function buildStunTimeline(input: StunTimelineInput): StunTimeline {
  const effectiveTime = Math.max(0, finiteOr0(input.effectiveTime))
  const nominal = Math.max(0, finiteOr0(input.windowDuration))
  const plannedWindows = Math.max(0, finiteOr0(input.stunCount))
  const windows = Math.floor(plannedWindows)
  const trace = input.windows
  const hasTrace = !!trace && trace.length > 0

  const slots: StunWindowSlot[] = []
  /** 当前排到的时刻（= 上一窗的结束时刻；恒 ≤ effectiveTime） */
  let cursor = 0
  for (let i = 0; i < windows; i++) {
    const t = trace?.[i]
    const extendedSeconds = Math.max(0, finiteOr0(t?.extendSeconds))
    const truncated = t?.truncated === true
    let effectiveSeconds = nominal + extendedSeconds
    // 决算截断（佩洛伊斯：决算做完即清空窗口剩余失衡时间）——截断时刻是**窗内相对秒**
    if (truncated) effectiveSeconds = Math.min(effectiveSeconds, Math.max(0, finiteOr0(t?.endSeconds)))
    // 时钟钳：窗口放不进剩余战斗时间 ⇒ 如实截短（用户口径「最后一窗口时间残疾」）
    const startSeconds = Math.min(cursor, effectiveTime)
    let clippedByClock = false
    if (startSeconds + effectiveSeconds > effectiveTime) {
      effectiveSeconds = Math.max(0, effectiveTime - startSeconds)
      clippedByClock = true
    }
    // 窗内占用 = 动作毛时长 − 合轴节省 + 平A填充（与栈引擎的记账同源）
    const occupied = t
      ? Math.max(0, finiteOr0(t.actionSeconds) - finiteOr0(t.overlapSeconds) + finiteOr0(t.fillSeconds))
      : 0
    slots.push({
      index: i,
      startSeconds,
      nominalSeconds: nominal,
      extendedSeconds,
      effectiveSeconds,
      truncated,
      clippedByClock,
      actions: t?.actions ? [...t.actions] : [],
      unusedSeconds: t ? Math.max(0, effectiveSeconds - occupied) : 0,
      // 兜底填充按**有效窗**截断：决算截断窗栈内恒 0，时钟截短时超出的部分不算这一窗的填充
      fillSeconds: t ? Math.min(Math.max(0, finiteOr0(t.fillSeconds)), effectiveSeconds) : 0,
    })
    cursor = startSeconds + effectiveSeconds
  }

  return {
    effectiveTime,
    plannedWindows,
    windows: slots.length,
    slots,
    // 用游标而不是再 reduce 一次：两者本应逐位相同，但游标与逐窗 end 严格同源（恒等式零容差靠它）
    windowSeconds: cursor,
    outsideSeconds: Math.max(0, effectiveTime - cursor),
    hasTrace,
  }
}
/**
 * **已兑现的失衡窗口**（用户 2026-10-25：「这里在算最后一失衡，应该有前面失衡期的数据了吧」）。
 *
 * ## 为什么它是「连续失衡」的实体读数，而不是失衡值公式的近似
 * 用户 §1 的故事是**动作经济**：
 * > 「招式全用来打击破，刚好把窗口打出来后就没有招式可打了（0 秒爆发）」
 * 也就是「第 N+1 窗只兑现 frac」的物理成因 = **没招可打**，而「招够不够」轴栈**逐窗记着**：
 * 每窗的 `effectiveSeconds − unusedSeconds` 就是这一窗里真正打出去的动作秒数。
 * 实测 `auto-1521-1251-1311`（计划 7 窗）填充率 `[1,1,1,0.94,0.94,0.70,0.16]` ⇒ 兑现 **5.75 窗**（池报 7），
 * 与用户「哪来这么多失衡」同向，且**是量出来的，不是假设出来的**（全库 35 支有轨迹的队：27 队兑现 < 池报，0 队 > 池报）。
 *
 * ⚠ 与 §1 的失衡值公式（`core/continuousStun.ts#continuousStunSplitOf`）**并列而非替换**：
 * 那个把「每秒 100 点失衡值」当均匀速度（用户举例时的简化），本函数用实测填充率（含「窗内换爆发招」这类
 * 招式构成差异）。实测分歧例：`auto-1041-1571-1211` 公式 3.0 / 实测 4.0（该队 4 窗全满，池报 4 = 实测）。
 *
 * ## 边界
 * - 无轴栈轨迹（非轴队；全库 96 队里 61 队）⇒ `hasTrace === false`，**不编造**，`realizedWindows` 返回整数窗数；
 * - 轨迹比窗口数短时缺的那几窗按「无轨迹」处理（`unusedSeconds` 记 0），与 `buildStunTimeline` 同口径；
 * - `realizedWindows ≤ windows` 按构造成立（每窗填充率 ≤ 1）——它只能**减少**兑现，不会凭空多算。
 */
export interface StunRealization {
  /**
   * **计划窗数 K**（= 池的整数次数 = 排出来的窗口个数）。
   *
   * 与 `realizedWindows` 配对才有意义：用户要看的是「**计划 K 窗 / 兑现 X 窗**」——
   * 只报兑现数会被读成「队伍只打了 X 窗」，而实际是「排了 K 窗、其中 X 窗的等效内容真打出来了」。
   * 非轴队也有这个数（池次数与轨迹无关），故它不受 `hasTrace` 影响。
   */
  plannedWindows: number
  /**
   * **计划动作兑现的等效窗数** = Σ（每窗**计划动作**占比 × **时钟截短份额**）。
   *
   * ⚠ 2026-10-28 口径拆分（用户 2026-10-27「5 失衡不如 4 失衡……资源不够导致失衡伤害较低」）：
   * 修前分子 = 动作 + **兜底填充**，一旦窗内被平A填满它就恒等于 `windows` ⇒「填满了但填的是
   * 低价值平A」这个现象**从度量里消失**。现在分子只认**计划动作**（`actionSeconds − overlapSeconds`），
   * 兜底填充单独报 `filledRatio`——两者都进读数，**合起来才等于「窗内被占了多少」**。
   *
   * 截短份额只对 `clippedByClock` 生效（战斗时钟装不下这一窗 ⇒ 只剩几秒就只值几秒/窗长，
   * 用户口径 2026-10-27「最后一窗的连续失衡……做成**时间截断**的方式，配合我们可视化展示」）；
   * 决算截断（`truncated`）不折算——那是设计内的窗结束方式。
   * 无轨迹时分子按「打满」1（不编造），但时钟截短照样折算。
   */
  realizedWindows: number
  /**
   * **兜底填充占比** ∈ [0,1]：这些已兑现的窗口里，有多少**窗内秒数**是靠兜底（平A / 模块兜底池）
   * 填出来的，而不是计划动作打出来的。
   *
   * 为什么不并进 `realizedWindows`：那正是「5 失衡不如 4 失衡」被抹平的地方——窗数一样多，
   * 但 5 窗那次的秒数是平A垫的。展示层并排报「兑现 X 窗（其中兜底占 Y%）」。
   * 无轨迹（`hasTrace=false`）⇒ 0（不可推演，不代表没有填充）。
   */
  filledRatio: number
  /**
   * **窗内占据占比** ∈ [0,1]：动作 + 填充占了这些窗有效时长的比例（= 修前的 `realizedWindows`
   * 归一化形态）。保留它是为了让「窗开满了没」和「窗里打的是什么」两个问题各有自己的尺。
   */
  occupiedRatio: number
  /** 已兑现的易伤秒数（= Σ 每窗实际占用秒数；无轨迹时为 0） */
  occupiedSeconds: number
  /**
   * **窗内发呆秒数** = Σ 每窗 unusedSeconds（窗口开着、却没有任何动作也没人兜底平A的那几秒）。
   *
   * 用户口径 2026-10-26：「再没有就空着，**写明发呆时间**」——窗口空转必须如实记账，
   * 不许被「窗口占 N×W 秒」的聚合读数吞掉。无轨迹（非轴队）⇒ 0（不可推演，不代表打满）。
   */
  idleSeconds: number
  /**
   * **末窗归零秒数**：战斗结束 ⇒ 这一窗最后那段直接归零（与决算同机制「把剩余时间归零」），
   * 不算发呆、画面按归零后的长度画（用户口径 2026-10-27）。只影响读数与画面，不改 `realizedWindows`。
   */
  zeroedSeconds: number
  /** 是否拿到轴栈逐窗轨迹（false ⇒ `realizedWindows` = 整数窗数，不编造） */
  hasTrace: boolean
}

// @fact engine:stun/兑现窗数 口径: 兑现窗数只认**计划动作**（Σ min(1, 动作/有效) × 时钟截短份额），兜底填充另报 `filledRatio`、占据合计报 `occupiedRatio`——窗内被平A填满**不等于**兑现（否则「5 失衡不如 4 失衡」从读数里消失）；无轨迹时按打满计、不编造 | 据 用户@2026-10-27（「真实游戏中这段时间不打招式只能有什么打什么…真实花费时间。这也是为什么有时候 5 失衡不如 4 失衡」）·复核@2026-10-28 | 验 src/core/__tests__/stunTimeline.test.ts | 锚 src/core/stunTimeline.ts#realizeStunWindows + src/core/stunTimeline.ts#StunRealization | 信 确认
// ⟳复核: 窗内填充改为「引擎侧按资源真出招」（而非兜底平A）时，重核 filledRatio 是否该并入 realizedWindows | 到期 2027-06-30
export function realizeStunWindows(timeline: StunTimeline): StunRealization {
  if (!timeline.hasTrace) {
    // 无轨迹 ⇒ 不编造填充（每窗按 1 计），但**时钟截短照样折算**：末窗只剩 4s 就只值 0.25 窗，
    // 与可视化那根短窗条一致（用户口径 2026-10-27「最后一窗……时间截断」）。
    const realized = timeline.slots.reduce((sum, s) => sum
      + (s.clippedByClock && s.nominalSeconds > 0 ? Math.max(0, Math.min(1, s.effectiveSeconds / s.nominalSeconds)) : 1), 0)
    return {
      plannedWindows: timeline.windows,
      realizedWindows: realized,
      filledRatio: 0,
      occupiedRatio: realized,
      occupiedSeconds: 0,
      idleSeconds: 0,
      zeroedSeconds: 0,
      hasTrace: false,
    }
  }
  let realizedWindows = 0
  let occupiedSeconds = 0
  let idleSeconds = 0
  /** 已兑现窗口的**有效时长合计**（填充占比 / 占据占比的分母） */
  let realizedWindowSeconds = 0
  /** 已兑现窗口里**兜底填充**的秒数合计（分子之一） */
  let fillSeconds = 0
  /**
   * **末窗零化秒数**（用户口径 2026-10-27）：「游戏结束相当于你后面都无意义了，计算量只有前半部分」——
   * 末窗没填上的那段不算发呆（那是「之后无事发生」，与决算把剩余时间归零同机制），单独上报。
   * ⚠ 只影响**读数与画面**；`realizedWindows` 的算法不变（仍是 计划动作占比 × 时钟截短份额）。
   */
  let zeroedSeconds = 0
  const lastIdx = timeline.slots.length - 1
  for (const [idx, slot] of timeline.slots.entries()) {
    const occupied = Math.max(0, slot.effectiveSeconds - slot.unusedSeconds)
    occupiedSeconds += occupied
    // 末窗没填上的那段 = 归零（不算发呆）；中间窗打不满仍是真发呆
    const unused = Math.max(0, slot.unusedSeconds)
    if (idx === lastIdx) zeroedSeconds += unused
    else idleSeconds += unused
    /**
     * ## 分子只认**计划动作**（2026-10-28 口径拆分，用户 2026-10-27 逐字）
     * > 「真实游戏中，这段时间你不打招式只能有什么打什么（比如填充的强e或者平a），而且**真实花费时间**。
     * >  这也是为什么有时候 **5 失衡不如 4 失衡**，因为资源不够导致失衡伤害较低。」
     *
     * 修前分子 = 动作 + 兜底填充 ⇒ 窗内一旦被填满就恒等于 1 窗，「填满了但填的是低价值平A」
     * 这件事在读数上**完全不可见**（正是用户点名的现象）。现在：
     * - `realizedWindows` 分子 = **计划动作**（毛占用 − 合轴节省）；
     * - `filledRatio` = 兜底填充秒 / 已兑现窗口有效秒（单独报，与窗口数并排）；
     * - `occupiedRatio` = (动作 + 填充) / 已兑现窗口有效秒（= 修前的归一化读数，保留作对照）。
     *
     * ⚠ `fillSeconds` **不扣合轴**：兜底填充是单槽独占时间（`stunAxisStack` 逐段产出），
     * 与动作的并集口径不同源，故这里只用它算占比，不参与 `realizedWindows` 的分子。
     */
    /**
     * ⚠ 分子必须沿用**既有** `occupied = effectiveSeconds − unusedSeconds` 这条口径，不能另读轨迹：
     * 轨迹比窗口数短时那几窗 `unusedSeconds` 记 0 ⇒ 既有口径把它们按「打满」计（`hasTrace` 的
     * 已知边界，见 stunTimeline.test.ts「轨迹比窗口数短」那条）。计划动作 = occupied − 兜底填充。
     */
    const fill = Math.max(0, finiteOr0(slot.fillSeconds))
    const plannedActionSeconds = Math.max(0, occupied - fill)
    realizedWindowSeconds += slot.effectiveSeconds
    fillSeconds += fill
    /**
     * 占比按**本窗**有效时长归一（决算截断 / 时钟截短的窗天生更短，不能按名义窗长摊）。
     *
     * ## 末窗按**时间截断**折算窗数（用户口径 2026-10-27，逐字）
     * > 「现在资源页有可视化失衡了，最后一窗的连续失衡我认为可以做成**时间截断**的方式，
     * >  配合我们可视化展示。」
     *
     * 修前：被**时钟**截短的末窗只要「填满了自己那几秒」就算**整窗**（填充率 1）——
     * 于是「计划 11 窗 / 兑现 11 窗」和画面上最后那根**短了一截**的窗条自相矛盾。
     * 现在乘上**时长份额** effectiveSeconds / nominalSeconds：只剩 4s 的窗就只值 0.25 窗。
     *
     * ⚠ **只对 clippedByClock**（时钟没时间了）。**决算截断**（truncated，佩洛伊斯/雨果做完即清空
     * 剩余失衡时间）不折算：那是**设计内**的窗结束方式、不是「时间不够」，判据见
     * stunTimeline.test.ts::决算截断窗按有效时长归一。
     */
    const actionRate = slot.effectiveSeconds > 0 ? Math.min(1, plannedActionSeconds / slot.effectiveSeconds) : 0
    const durationShare = slot.clippedByClock && slot.nominalSeconds > 0
      ? Math.max(0, Math.min(1, slot.effectiveSeconds / slot.nominalSeconds))
      : 1
    realizedWindows += actionRate * durationShare
  }
  return {
    plannedWindows: timeline.windows,
    realizedWindows,
    filledRatio: realizedWindowSeconds > 0 ? Math.min(1, fillSeconds / realizedWindowSeconds) : 0,
    occupiedRatio: realizedWindowSeconds > 0 ? Math.min(1, occupiedSeconds / realizedWindowSeconds) : 0,
    occupiedSeconds,
    idleSeconds,
    zeroedSeconds,
    hasTrace: true,
  }
}
