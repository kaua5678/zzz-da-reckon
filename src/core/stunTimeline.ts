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
  /**
   * 窗内**空闲段**逐段（发呆 / 捏轴缝隙）：`[0, endSeconds]` 对「动作区间并集 ∪ 填充段」的补集。
   *
   * 用户口径 2026-10-28：「只是给缝隙时间一个容器，便于计算失衡时间的分配……
   * 你可以算他是后台，发呆等效于后台，啥都没做。」——纯归属容器：
   * **不进覆盖率、不进利用率、不产任何资源**，只回答「这窗哪几秒没人干活」。
   * Σ seconds = `StunWindowSlot.unusedSeconds`（同源，不另算）。
   */
  idleSegments: { startSeconds: number; seconds: number }[]
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
   * 窗内**轴动作净占用**秒数 = 动作毛时长 − 合轴节省（**不含**平A填充；未按有效窗长钳位）。
   *
   * 它是「只算轴动作兑现了几窗」（`realizeStunWindows().axisOnlyWindows`）的唯一输入：
   * 与 `fillSeconds` 拆开，才能回答用户 2026-11-01 的两条稀缺通道——
   * **通道 A**（平A填充挤走攒条）看填充秒，**「轴真打完了吗」**看本字段。
   *
   * `null` = 本窗没有轴栈轨迹（非轴模式 / 轨迹比窗口数短）⇒ 不可推演，**不写 0**
   * （0 会被读成「这窗轴块一秒都没打」，而实际是「没量到」）。
   */
  axisSeconds: number | null
  /**
   * 窗内**平A兜底填充**秒数（来自 `windowTrace[].fillSeconds`，**不含**窗内轴动作）。
   *
   * 它占的是窗内时间本身 ⇒ 每填一秒就少一秒攒条（用户 2026-10-28「填充是产出端、窗内作废」），
   * 但它**也会**把窗"填满"，让旧的「兑现比例」看起来完整——2026-11-01 认定的盲区正是它。
   *
   * `null` = 本窗没有轴栈轨迹 ⇒ 不可推演，**不写 0**（同上）。
   */
  fillSeconds: number | null
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
  /**
   * **【已删除】曾用于「末窗按失衡值不足缩短」。**
   *
   * 2026-10-28 用户口径定案（逐字）：「一个轮回是非失衡+失衡期……**打完了 3 失衡，还积累了 56% 的失衡**」
   * 「**进入第四失衡了，但是只打了 6s 就结束了**」。
   *
   * ⇒ 失衡值不足 = **下一窗开不出来**（走 `plannedWindows` 的小数进度，不产生 `StunWindowSlot`）；
   *   窗开了但短 = **时间**不够（`clippedByClock` / `truncated`）。
   *   两者是不同成因，**不存在「失衡值不足导致已开窗变短」**这回事，故本入参已移除。
   */
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
// @fact engine:stun/末窗成因 口径: 末窗短一截有**两种**成因，各自扣各自的秒数、不许互相代扣——① 时钟不够 `clippedByClock`（时间账：战斗 180s 到点）② 决算截断 `truncated`（机制设计：佩洛伊斯/雨果做完即清空剩余失衡时间）。**「失衡值不够」不在此列**：失衡值不足只会让**下一窗开不出来**（走 `plannedWindows` 的小数进度 / `continuousWindowSplit#nextWindowProgress`），不会让已开的窗变短（用户 2026-10-28：「打完了 3 失衡，还积累了 56%」vs「进入第四失衡了，但是只打了 6s 就结束了」是两件事）。⚠ 曾把两者混成 `lastWindowFraction`/`partialByBuildUp`，已删除 | 据 用户@2026-10-28·复核@2026-10-28 | 验 src/core/__tests__/stunTimeline.test.ts | 锚 src/core/stunTimeline.ts#buildStunTimeline + src/core/stunTimeline.ts#StunWindowSlot | 信 确认
// ⟳复核: 若引擎支持「窗内也攒条」或把 `continuousWindowSplit` 的 `nextWindowProgress` 换口径，重核「失衡值不足 = 下一窗没开」这条前提 | 到期 2027-06-30
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
    const axisActionSeconds = t ? Math.max(0, finiteOr0(t.actionSeconds) - finiteOr0(t.overlapSeconds)) : 0
    const fillSeconds = t ? Math.max(0, finiteOr0(t.fillSeconds)) : 0
    const occupied = axisActionSeconds + fillSeconds
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
      // 两条稀缺通道的**原材料**（纯透传，不参与排布）：轴动作净占用 / 平A兜底填充。
      // 无轨迹 ⇒ null（不可推演），不当 0——0 会被读成「轴块一秒没打」。
      axisSeconds: t ? axisActionSeconds : null,
      fillSeconds: t ? fillSeconds : null,
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
 *
 * ## 2026-11-01：三读数拆分（**纯追加，不改 realizedWindows**）
 * 用户口径（逐字）：「这个平a填充是**足够分配**的情况，**如果资源不够**，要么是**平a填充了导致失衡不够，
 * 打不出新失衡或者新失衡残缺**，要么是**失衡打了但是时间不够无法填充**，导致最后一窗变成**残缺的只有前半部分**。」
 * ⇒ 「一个兑现比例」把两条互斥的稀缺通道混在一起了，必须拆开读：
 * | 通道 | 读数 | 物理 |
 * |---|---|---|
 * | **A 失衡值不够** | `fillSeconds`（+ 结果页「下一窗进度」） | 窗内平A填充**不产失衡值** ⇒ 填一秒少一秒攒条 |
 * | **B 时间不够** | `clippedByClock`（逐窗，`buildStunTimeline` 已标） | 窗排到 180s 外 ⇒ 末窗被时钟截短 |
 * | **C 窗开了没牌** | `idleSeconds` | 轴块 + 平A都填不满 ⇒ 发呆（**容器不是缺陷**，用户 2026-10-28） |
 *
 * `realizedWindows` 与 `axisOnlyWindows` 的差 = **平A填充撑起来的窗数**：
 * 旧读数把「填充把窗填满」当成「兑现完整」（2026-11-01 认定的盲区），
 * `axisOnlyWindows` 则只认轴动作本身。两者**同一把尺**（同 `effectiveSeconds` 归一、同 `durationShare` 折算），
 * 故 `realizedWindows − axisOnlyWindows === Σ(填充秒 / 有效窗长 × 时钟截短份额)` 恒成立（判据锁住）。
 *
 * ⚠ **纯读数，不进任何数值路径**：通道 A 要不要进数值待用户裁决（且必须先证伪「与池的
 * `inAxisStunFractionByKey` 双扣」）；通道 B 要可达须放开 `solveTeam.physicalMax`（A10 四步连锁）。
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
   * 已兑现的等效窗数 = Σ（每窗填充率 × **时钟截短份额**）。
   *
   * 截短份额只对 `clippedByClock` 生效（战斗时钟装不下这一窗 ⇒ 只剩几秒就只值几秒/窗长，
   * 用户口径 2026-10-27「最后一窗的连续失衡……做成**时间截断**的方式，配合我们可视化展示」）；
   * 决算截断（`truncated`）不折算——那是设计内的窗结束方式。
   * 无轨迹时填充率按 1（不编造），但时钟截短照样折算。
   */
  realizedWindows: number
  /**
   * **只算轴动作**的等效兑现窗数（**不含**平A填充；用户 2026-11-01 通道 A 的读数）。
   *
   * 与 `realizedWindows` 同一把尺（同 `effectiveSeconds` 归一、同 `durationShare` 折算），
   * 只是把分子从「轴动作 + 平A填充」换成「轴动作」。恒等式（判据锁）：
   * `realizedWindows − axisOnlyWindows === Σ(填充秒 / 有效窗长 × 时钟截短份额)`。
   *
   * 无轨迹 ⇒ 与 `realizedWindows` 同值（**不可区分**，不编造「轴一秒没打」）；轨迹比窗口数短时
   * 缺的那几窗同样按不可区分处理（与 `realizedWindows` 对这些窗的「按 1 计」同源）。
   */
  axisOnlyWindows: number
  /**
   * **窗内平A填充总秒数**（只算落在有效窗内的部分，已按 `effectiveSeconds` 钳位）。
   *
   * 通道 A 的物理量：填充**不产失衡值**（用户 2026-10-28「填充是产出端、窗内作废」），
   * 于是每填一秒就少一秒攒条。**纯读数**：不改池、不改覆盖率、不改伤害。
   * 无轨迹 ⇒ 0（不可推演，不代表没填）。
   */
  fillSeconds: number
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

// @fact engine:stun/三读数 口径: `realizeStunWindows` 同时报三个**互不代扣**的读数——`realizedWindows`（含平A填充的兑现，生产通道，语义不变）、`axisOnlyWindows`（只算轴动作净占用，与前者同一把尺：同 effectiveSeconds 归一、同 durationShare 折算）、`fillSeconds`（落在有效窗内的填充秒，通道 A 的物理量）、`idleSeconds`（通道 C，发呆容器）；恒等式 `realized − axisOnly === Σ(填充秒/有效窗长 × 时钟截短份额)` 由判据锁；无轨迹 ⇒ axisOnly 与 realized 同值、fillSeconds 记 0（不可区分，不编造）；**纯读数，不进任何数值路径**（通道 A 进数值须先证伪与 `stunPool#inAxisStunFractionByKey` 双扣；通道 B 须先放开 `solveTeam.physicalMax`） | 据 用户@2026-11-01（「平a填充了导致失衡不够」vs「失衡打了但是时间不够无法填充」） | 验 src/core/__tests__/stunTimeline.test.ts | 锚 src/core/stunTimeline.ts#realizeStunWindows + src/core/stunTimeline.ts#StunRealization | 信 确认
// ⟳复核: 若通道 A 获准进数值（或 `solveTeam.physicalMax` 放开使通道 B 可达），重核「三读数纯展示、互不代扣」这条前提与恒等式的折算份额 | 到期 2027-06-30
export function realizeStunWindows(timeline: StunTimeline): StunRealization {
  if (!timeline.hasTrace) {
    // 无轨迹 ⇒ 不编造填充（每窗按 1 计），但**时钟截短照样折算**：末窗只剩 4s 就只值 0.25 窗，
    // 与可视化那根短窗条一致（用户口径 2026-10-27「最后一窗……时间截断」）。
    const realized = timeline.slots.reduce((sum, s) => sum
      + (s.clippedByClock && s.nominalSeconds > 0 ? Math.max(0, Math.min(1, s.effectiveSeconds / s.nominalSeconds)) : 1), 0)
    // 无轨迹 ⇒ 轴/填充**不可区分**：axisOnly 与 realized 同值（不是「轴一秒没打」），填充秒记 0（不可推演）。
    return {
      plannedWindows: timeline.windows,
      realizedWindows: realized,
      axisOnlyWindows: realized,
      fillSeconds: 0,
      occupiedSeconds: 0,
      idleSeconds: 0,
      zeroedSeconds: 0,
      hasTrace: false,
    }
  }
  let realizedWindows = 0
  /** 只算轴动作的等效窗数（与 realizedWindows 同一把尺，分子换成轴动作净占用） */
  let axisOnlyWindows = 0
  /** 落在有效窗内的平A填充秒数（逐窗钳位，与 axisOnly 的分子同源） */
  let fillSeconds = 0
  let occupiedSeconds = 0
  let idleSeconds = 0
  /**
   * **末窗零化秒数**（用户口径 2026-10-27）：「游戏结束相当于你后面都无意义了，计算量只有前半部分」——
   * 末窗没填上的那段不算发呆（那是「之后无事发生」，与决算把剩余时间归零同机制），单独上报。
   * ⚠ 只影响**读数与画面**；`realizedWindows` 的算法不变（仍是 填充率 × 时钟截短份额）。
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
     * 填充率按**本窗**有效时长归一（决算截断 / 时钟截短的窗天生更短，不能按名义窗长摊）。
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
    const fillRate = slot.effectiveSeconds > 0 ? Math.min(1, occupied / slot.effectiveSeconds) : 0
    const durationShare = slot.clippedByClock && slot.nominalSeconds > 0
      ? Math.max(0, Math.min(1, slot.effectiveSeconds / slot.nominalSeconds))
      : 1
    realizedWindows += fillRate * durationShare
    /**
     * **三读数拆分**（用户 2026-11-01）：
     * - `axisOnlyWindows`：分子只留轴动作净占用（`slot.axisSeconds`），口径与 `fillRate` 逐位同源；
     * - `fillSeconds`：填充落在**有效窗内**的部分（先让轴动作占用，再给填充剩下的），
     *   与 `realizedWindows − axisOnlyWindows` 严格互补（同一处产出，不另算一遍）。
     *
     * 本窗没有轴栈轨迹（`slot.axisSeconds === null`）⇒ **不可区分**，把整窗算作轴动作
     * （与 `unusedSeconds = 0` 的「按 1 计」同源），填充秒不编造。
     */
    if (slot.axisSeconds === null) {
      axisOnlyWindows += fillRate * durationShare
    } else {
      /** 轴动作能占到的窗内秒数（时钟截短后不够时按有效窗长钳位——与 `occupied` 的钳位同源） */
      const axisOccupied = Math.max(0, Math.min(slot.effectiveSeconds, slot.axisSeconds))
      /** 填充只能占轴动作之后剩下的那部分有效窗长（栈引擎里两者本就不重叠） */
      const fillOccupied = Math.max(0, Math.min(slot.effectiveSeconds - axisOccupied, slot.fillSeconds ?? 0))
      const axisRate = slot.effectiveSeconds > 0 ? Math.min(1, axisOccupied / slot.effectiveSeconds) : 0
      axisOnlyWindows += axisRate * durationShare
      fillSeconds += fillOccupied
    }
  }
  return {
    plannedWindows: timeline.windows,
    realizedWindows,
    axisOnlyWindows,
    fillSeconds,
    occupiedSeconds,
    idleSeconds,
    zeroedSeconds,
    hasTrace: true,
  }
}
