/**
 * 外层求解器（**Vue 无关**）—— 自 `composables/useResourceCalc.ts#computeCalcOutput` 的
 * :254–652 原样外提（CC-10，2026-09-25，零行为搬迁）。
 *
 * 职责：跑完整外层不动点 `runOuterLoop`（失衡次数 ↔ 资源池 ↔ 失衡池 全链路收敛，含 2-循环 /
 * 长环的规范停点选点），再做 S3 可行化决策 `stageResolveFeasibility`（轴退化 + 非轴降配），
 * 最后把收敛读数覆写进 `CalcRoundResult.resourceResult.convergence`。
 *
 * 与 composable 的通信面 = `SolveTeamInput`：把原先闭包读取的 4 个量显式化
 * （`lockedStunCount` / `stunWindowDur` / `stunEffTime` / `resourceConfig`）+ 注入单轮工厂
 * `runCalcRound`。**无 store 副作用**：只读输入、只返回结果（原唯一写回 = 降配档单调闸门下调
 * ceiling，已随闸门删除，T23）。
 *
 * 依赖方向：本文件**不得** import `vue` / `pinia` / `@/stores/*` / `./useResourceCalc`——
 * 抽离的意义就是求解器可脱 Vue 调用，判据 `__tests__/solveTeamPurity.test.ts` 锁死。
 * 只依赖同目录纯函数模块（`./roundThreads` / `./outerCycle` / `./feasibilitySearch`）、
 * 单轮工厂 `./convergence`（仅类型 + `ReturnType`）与 `@/core/*` 纯函数。
 */
import { TIME_BUDGET_TOLERANCE_SECONDS } from '@/core/resource'
import { netFrontlineOccupation } from '@/core/resource/timeOccupation'
import { continuousStunCount, withStunCount, withStunCountRebuilt } from '@/core/stunPool'
import { stunWindowFraction } from '@/core/effectiveTime'
import { continuousStunSplitOf } from '@/core/continuousStun'
import { buildStunTimeline, realizeStunWindows } from '@/core/stunTimeline'
import type { OuterExit, ResourceCalcConfig } from '@/types/resource'
import { initialCalcRoundThreads } from './roundThreads'
import { findOuterLongCycleLag, isOuterTwoCycle, outerFeedbackSignature, pickOuterCycleMember } from './outerCycle'
import { probeFlag, probeKey, probePush } from '@/core/probeTrace'
import { DOWNSCALE_SCALES, selectDownscaleScale, downscaleTrialAccepted, downscaleTrialFeasible } from './feasibilitySearch'
// 仅类型：`ReturnType<typeof createRunCalcRound>` 与 `CalcRoundResult` 都用不到运行时值，
// 故 type-only import（不引入 convergence.ts 的运行时依赖）。
import type { createRunCalcRound } from './convergence'
import type { CalcRoundResult } from './roundResult'

/**
 * 失衡次数 ↔ 资源池（连携=每失衡连携×失衡次数）↔ 失衡池 外不动点迭代上限。
 * 2026-08-24 实证（南宫羽C6+踉跄失衡延长+3s）：窗口延长加强「窗口↑→前台预算↓→失衡值↓→
 * 失衡次数↓」负反馈，整数边界间呈阻尼震荡（振幅≈×0.55/轮），12 轮不够落定 → 提到 20；
 * 收敛后结果不变，只多花极少数非收敛场景的轮次成本。
 */
const MAX_OUTER_ITER = 20
/**
 * 外层失衡次数的量化容差（判稳 / 真 2-循环 / 长环同相位比对 / 环内选点共用）。
 * 小数失衡的浮点比较容差，同相位判据见 resourceCalc/outerCycle.ts。
 */
const OUTER_STUN_TOLERANCE = 0.05

/** 单轮计算工厂的返回类型（= composable 里 `createRunCalcRound(...)` 的产物）。 */
export type RunCalcRound = ReturnType<typeof createRunCalcRound>

/** 外层求解的显式输入：原 `computeCalcOutput` 闭包读取的 4 个量 + 单轮工厂注入。 */
export interface SolveTeamInput {
  /** 单轮计算：给定失衡次数输入与上一轮收敛线程，返回本轮结果 */
  runCalcRound: RunCalcRound
  /** 原 :251 —— 锁定失衡次数（命座对比固定场景），-1 = 不锁 */
  lockedStunCount: number
  /** 原 :252 —— 单次失衡窗口时长（秒） */
  stunWindowDur: number
  /** 原 :253 —— 有效战斗时间（扣无敌时间） */
  stunEffTime: number
  /** = 守卫后的 `resourceConfig.value`（CC-419 起非 null：`calcOutput` 已前置守卫并显式下传） */
  resourceConfig: ResourceCalcConfig
}

/** 外层求解产物：`out` = 组装好的整轮结果。 */
export interface SolveTeamResult {
  /** CC-418：恒非 null —— `runCalcRound` 已无 null 出口（null 轮概念退役），外层至少跑一轮。 */
  out: CalcRoundResult
}

/** 外层不动点 + S3 可行化决策（函数体 = 原 `useResourceCalc.ts:254–652` 外提，CC-10；只读输入、不写 store）。 */
export function solveTeam(input: SolveTeamInput): SolveTeamResult {
  const { runCalcRound, lockedStunCount, stunWindowDur, stunEffTime, resourceConfig } = input
  /** 轴退化判据容差（秒）：收敛后仍留 ~2s 合轴可覆盖的量化残差（与 timeLedger 测试口径一致） */
  const AXIS_FALLBACK_TOLERANCE_SEC = 2
  /**
   * T165 挤压臂的削减上限（份）。**为什么是小数字**：每个候选都是一次**完整外层求值**
   * （含外层不动点），且现实里「自动多打」的量级有限（般岳怒相外连段实测 4~10 组）。
   * 到顶仍装不下 ⇒ 落回原路径（退化臂），行为与改动前一致 ⇒ 上限只影响成本、不影响正确性。
   */
  const AXIS_AUTO_TRIM_MAX = 12
  /** Σ前台行净占用（扣轴内合轴节省 + 招式合轴抵扣，max 不叠加；与 iterate 平A池、
   *  teamCompare.actionTimeTotal 同口径，单一事实源 netFrontlineOccupation） */
  const frontlineTotalOf = (r: CalcRoundResult): number => {
    if (!r.resourceResult) return 0
    return netFrontlineOccupation(r.resourceResult)
  }
  /**
   * **待装补齐**（⑥″，2026-09-19）：般岳补齐（轴自动补齐 / 保底4喧响补弹刀）是反馈线程——本轮算出的 `interactionTopUp`
   * 要到**下一轮**才装进计划。外层落进环时，「输入补齐 = 0、本轮才算出要补 N 次」的成员计划看似最贴预算，实则少装了它自己
   * 声明的补齐（般岳厚轴 4-环实测：179.2s 的计划装上 46.66s 补齐是 225.9s；保底4喧响 2-环：180.0s 的计划少装 7 弹刀 16.3s）。
   * 待装 = 本轮补齐时长 − 上一轮（= 本轮输入）补齐时长，取正；stable 停点两轮相等 ⇒ 0，对已收敛的队零影响。
   * 环内选点、轴退化判据、非轴降配的净占用**都**按「计划 + 待装」算。
   * 2-环根因（CC-296 实测）：补齐缺口按「已含本轮补齐弹刀喧响」的 decibelHave 算 ⇒ 装 N → 算 0 → 装 N。
   * ⚠ 别用「补齐量单调夹住上一轮」根治：模块按 215/弹刀估，实测 ≈291/弹刀，夹住 = 锁死首轮超补（1471 锚 12→20 弹刀），
   *   见 docs/mcp-stun-dual-source.md §24.135；要根治应改割线步（用实测 Δ喧响/Δ弹刀）。
   */
  const pendingTopUpSeconds = (x: CalcRoundResult, prev: CalcRoundResult | null): number =>
    Math.max(0, x.interactionTopUp.requiredSeconds - (prev?.interactionTopUp.requiredSeconds ?? 0))
  /**
   * **A10 轮内两趟的当前截短秒**（连续失衡，用户 2026-11-01 裁明机制）：0/undefined = 不截短。
   *
   * 语义 = 满条开出的窗装不进 180s 时，溢出从**最后一窗的时间里丢掉**（战斗时钟截断）。
   * 本变量 = 本次整轮求值采用的截短量；`runOuterLoop` 第 6 参缺省读它 ⇒ 其后所有重跑
   * （中断臂 / 挤压臂 / 轴态降配 / 弃轴 / 非轴降配 / kStar 按 K 重跑）**同一个 clip**，
   * 不会出现「主路径带截短、试算不带」的两套账。
   * 只有 `PROBE_STUN_CLIP_ITER=1` 的两趟块会写它；缺省 undefined ⇒ 逐位不变（零 delta）。
   */
  let stunClipPass: number | undefined
  /**
   * 跑完整外层不动点。forceNoAxis = 轴退化重算（用户口径 2026-08：轴的资源需求
   * （喧响/嗔火/轴内块 × 窗口数）超出时间预算 → 必要时间 > 战斗时间 → 该轴不可操作
   * （需 boss 秽盾等外界环境才打得成）→ 退化为一般轴（不注入轴块/连携覆盖/自动补齐）重算）。
   */
  /**
   * @param stunLastWindowClip **A10 轮内两趟**（2026-11-01 稳定化）：本次整轮求值用的**末窗时钟截短秒**
   *   （= pass1 的 `resourceResult.overflowSeconds`）。undefined ⇒ 不截短（逐位不变）。
   *   为什么不再用线程滞后注入：滞后 = 本轮轴栈按**上一轮**溢出重排，而本轮溢出已变 ⇒
   *   `auto-1051-1141-1451` K 6→5 双稳态（`zzIso`：stackOnly 就 6→5）。轮内两趟把「测溢出 → 用它重排」
   *   放进同一轮，clip 在整次求值内恒定 ⇒ 没有滞后通道。
   */
  function runOuterLoop(forceNoAxis: boolean, interactionScale?: number, interruptTopUp?: boolean, axisAutoTrim?: number, overrideLock?: number, stunLastWindowClip: number | undefined = stunClipPass): { out: CalcRoundResult; outPrev: CalcRoundResult | null; outerRounds: number; outerConverged: boolean; outerExit: OuterExit; outerCyclePickedEarlier: boolean; capacityResolved: boolean } {
    /**
     * 有效锁定值：`overrideLock` 优先（连续失衡「按时间可容纳次数重跑」用，2026-10-20）。
     * 缺省 undefined ⇒ 与原来逐位相同（读用户配置的 `lockedStunCount`）。
     */
    const effLock = overrideLock ?? lockedStunCount
    let stunCount = effLock >= 0 ? effLock : 0
    /** CC-418：`MAX_OUTER_ITER ≥ 1` ⇒ 循环体至少执行一次、首轮即赋值（runCalcRound 无 null 出口），故可定赋值断言。 */
    let out!: CalcRoundResult
    let threads = initialCalcRoundThreads()
    let prevFeedbackSignature: string | null = null
    /** 上一轮输入 x[k-1]：与本轮推导的 x[k+1] 比较，首轮没有候选。 */
    let prevStunValue: number | null = null
    /** 已完成轮次的反馈快照（二周期/长周期共用），不包含当前轮。 */
    const outerSigHistory: string[] = []
    /** 与 `outerSigHistory` 同步的 `stunCount` 历史（同相位比对用）。 */
    const outerStunHistory: number[] = []
    /** 与上面两个历史同步的每轮结果（cycle 规范停点选点用；轮数 ≤ MAX_OUTER_ITER，持有引用不复制） */
    const outerOutHistory: CalcRoundResult[] = []
    /** 与 `outerStunHistory` 同步的每轮**输出**失衡次数（= 下一轮输入；环内成员失衡自洽度用） */
    const outerNextHistory: number[] = []
    let outerCyclePickedEarlier = false
    /**
     * 环内停点选点（R37-J5 ⑥，用户裁决 2026-09-19「治本」；⑥′ 同日二次校准，见 docs/mcp-debt2-blade1-feasibility-v4.md §19）。
     * 外层不动点落进 2-循环 / 长环时，成员在失衡次数上互为映射、都「合法」，旧实现返回碰巧最后算的那轮
     * ⇒ 同一支队默认口径 −1.4s 超预算 / +3.7s 留白两个落点全看运气（auto-1431-1341-1311 实测）。
     * 用户口径「循环算到最后应只溢出一点或不溢出」⇒ 环内按判据取点，判据按序：
     *   ① **失衡自洽度** |输出 next − 输入 stunCount| 最小（容差 `OUTER_STUN_TOLERANCE`，与判稳/判环同源）——
     *      外层循环的目的就是失衡不动点，离不动点最近的成员才是环的规范代表。⑥ 首版只看时间自洽度，实测被两类成员骗过：
     *      - **反馈线程滞后成员**：般岳厚轴 4-环里「输入补齐=0、本轮才算出要补 20 弹刀/24 双反」的那轮前台 179.2s
     *        看似最贴预算，实则它的计划根本没装自己要的补齐（装上是 259.6s）⇒ 误判轴可操作、轴退化不触发；
     *      - **冷启动 0 窗成员**：2-环 0 ↔ 1.02 里 k=0（0 个失衡窗、窗内内容全缺席）前台 179.999 vs k=1 的 179.996，
     *        差 0.003s 就被判「更自洽」⇒ 落点变成没有失衡窗的计划（1431013 次数 16.6→7.3）。
     *      2-循环两成员的失衡自洽度恒相等（互为映射）⇒ 该判据只在长环上分高下；
     *   ② **时间自洽度** |预算 − Σ物化净占用| + 装配截断秒数 最小，**差 ≤ `AXIS_FALLBACK_TOLERANCE_SEC`（2s，
     *      合轴可覆盖的量化残差、轴退化同源容差）视为同级**——动态合轴（R37-J5 ①）把超必要队的前台一律吸收到 ≈预算，
     *      成员间时间差常落在 1e-3 量级，⑥ 首版的 1e-9 容差等于重新掷骰子；
     *   ③ 同级取最后一轮（与旧行为一致 ⇒ 对既有 stable / 未分出高下的 cycle 队逐位零影响）。
     * 选点纯函数见 outerCycle.ts#pickOuterCycleMember。
     */
    type OuterCycleMember = { out: CalcRoundResult; prev: CalcRoundResult | null; stunIn: number; next: number }
    const timeInconsistencyOf = (m: OuterCycleMember): number => {
      const r = m.out
      if (!r.resourceResult) return Number.POSITIVE_INFINITY
      return Math.abs(stunEffTime - (frontlineTotalOf(r) + pendingTopUpSeconds(r, m.prev))) + (r.resourceResult.convergence.timeTruncatedSeconds ?? 0)
    }
    /**
     * 终局整数化后的环成员离散自洽度（2026-09-20，叶瞬光 integer-finalize 配套）。
     *
     * 为什么需要它：终局整数化把「资源推导的离散触发次数」（照影/喧响进轮）在收敛后 floor，
     * 于是环成员之间差**一整次离散动作**（叶瞬光实测 C1 短轴：`dec=3/tot=12/net=178.24/截断 11.0s`
     * ↔ `dec=2/tot=11/net=178.84/截断 0`）。两个成员在失衡维度上完全相等（`stunIn` 都是 0、
     * `next` 都是 0），在时间维度上只差 2.6s —— 而 `timeInconsistencyOf` 的 **2s 同级容差**
     * （`AXIS_FALLBACK_TOLERANCE_SEC`，为「动态合轴把前台一律吸收到 ≈预算」设计）恰好把这一整次
     * 动作的差别抹平，取点退回「最后一轮」⇒ 报 12（高估，那 11s 实际装不下被截断）。
     *
     * 判据 = **截断秒数为零的成员优先**（装得下 > 装不下），再用截断量本身做次级排序。
     * 这是「离散动作只兑现装得下的部分」的直接表达，与 `@fact agent:1431/终局整数化` 同源；
     * 对没有终局整数化的队，环成员通常共享同一截断量（差 ≤ 量化残差）⇒ 逐位零影响。
     */
    const discreteInconsistencyOf = (m: OuterCycleMember): number => {
      const r = m.out
      if (!r.resourceResult) return Number.POSITIVE_INFINITY
      return r.resourceResult.convergence.timeTruncatedSeconds ?? 0
    }
    /** 选中成员的前一轮结果（= 它的输入线程来源；轴退化判据用它算「还没装进计划的补齐量」） */
    let outPrev: CalcRoundResult | null = null
    /**
     * 最近一次环内选点的成员集合。**kStar 结算直接用它**（见 capacity 块）：每个成员都是一次
     * 「按 K 排窗」的实测（K = 它前一轮的池次数，池 = 它的输出），所以「哪个 K 自洽」不必再求值。
     */
    let lastCycleMembers: OuterCycleMember[] = []
    const pickCanonical = (all: OuterCycleMember[]): CalcRoundResult => {
      lastCycleMembers = all
      /**
       * ⓪ **零窗成员不参选**（⑥″，2026-09-19 吸收上限落地时实测）：输入 stunCount ≈ 0（冷启动首轮 / 时间充足性约束把
       * 次数钳到 0 的那轮，计划里一个失衡窗都没有）的成员是瞬态——失衡是积蓄的结果不是玩家的选择，只要环里还有带窗成员，
       * 零窗成员就不能当规范停点。反例：1431/1481/1311 默认口径 0 ↔ 1.02 的 2-环，上限 0.4 后 1 窗成员截断 4.4s
       * （时间自洽度 8.6 vs 0.001）⇒ 光看时间会再次落到「没有失衡窗」的计划（1431013 次数 16.6→7.3）。
       * 门槛 = 判稳容差（≈0），**不是** 1：小数失衡（如 0.84 窗）是合法状态，按 1 划线会把 agent:1301 一类 0.84 ↔ 1.82 的环
       * 误判成「零窗 vs 带窗」而改落点。全员零窗（真 0 失衡队）时照旧全体参选。
       */
      // ⓪″ CC-153（第 176 轮，CC-150 残差的对称侧）：physical 下「池 < 读入」的成员不可行——引擎按读入 K（= 成员前一轮池
      // `m.prev.stunPool`，即 `threads.prevPoolStunCount`）分配了 K 个窗，池却撑不住（实测 yixuan-trigger-lucia 读入 4 → 池 3，
      // 资源行连携 4 / 池与轴栈 3）。判据在纯函数 outerCycle.ts#pickOuterCycleMember ⓪″；这里只算 `feasible`（非 physical 不传）。
      // 同理 physical 下 ⓪ 零窗判据的「窗数」= 读入 K（`windowsIn`），不是规划值 stunIn（实测 auto-1401-1511-1411 可行成员读入 2、规划 0.015）。
      const physical = resourceConfig.stunPlanProjection === 'physical'
      const feasibleOf = (m: OuterCycleMember): boolean | undefined => {
        if (!physical) return undefined
        const kIn = m.prev?.stunPool.stunCount
        const pool = m.out.stunPool.stunCount
        return kIn === undefined || pool >= kIn
      }
      const picked = pickOuterCycleMember(
        all.map(m => ({ stunIn: m.stunIn, next: m.next, disc: discreteInconsistencyOf(m), time: timeInconsistencyOf(m), feasible: feasibleOf(m), windowsIn: physical ? m.prev?.stunPool.stunCount : undefined })),
        { stun: OUTER_STUN_TOLERANCE, disc: TIME_BUDGET_TOLERANCE_SECONDS, time: AXIS_FALLBACK_TOLERANCE_SEC },
      )
      const best = all[picked.index]
      if (picked.pickedEarlier) outerCyclePickedEarlier = true
      outPrev = best.prev
      return best.out
    }
    let outerRounds = 0
    let outerConverged = false
    let outerExit: OuterExit = 'maxIter'
    // 净失衡迭代（用户 Excel 口径）：覆盖率由上一轮失衡次数得出，非失衡占比缩放全来源净失衡，
    // 时间预算把超出的残失衡折成小数——正反馈被全局负反馈对抗，收敛到静止
    for (let k = 0; k < MAX_OUTER_ITER; k++) {
      outerRounds = k + 1
      // 锁定次数（用户明确意图）不走净失衡缩放与小数截断，仍用原始池计数
      // 2026-10-20 round 20：判据改读 **effLock**（= overrideLock ?? lockedStunCount）——
      // 「按次数重跑」（kStar 结算）同样是「次数已定」，必须走锁定分支；否则重跑出来的不是
      // 「按 K 打一整轮」而是又一条发散迭代（实测只传 overrideLock 时池仍回弹）。
      const locked = effLock >= 0
      // CC-418：runCalcRound 无 null 出口（CC-417 删空失衡池 null 后，剩余守卫与 calcOutput 同条件不可达），
      // 原「null 轮 ⇒ threadsAfterNullRound 回退 + 签名清空 + continue」分支随之删除。
      out = runCalcRound(stunCount, threads, { forceNoAxis, interactionScale, interruptTopUp, axisAutoTrim, stunLastWindowClip })
      const t = out.threadsNext
      /**
       * ===== 步 4 实验（`PROBE_STUN_NEXT=trace`）：喂给下一轮计划的窗数改用**轴栈实测兑现窗数** =====
       *
       * 用户 2026-10-25 逐字：「你无法打出 7 个窗啊……连携次数看你的离散失衡怎么做的，
       * 你如果是按照时间截断轴模式，那就可以看**残疾轴在这时间前打了几个失衡**。非轴另算。」
       *
       * 一窗算不算数不再是 `floor(净失衡值 / b)` 的整数跳变，而是**这一窗实际打进去多少**
       * （`core/stunTimeline.ts#realizeStunWindows` = Σ 每窗填充率），**小数原样喂回去**：
       * 外不动点迭代的是连续量 ⇒ §0 的「按 4 排 ⇄ 按 5 排」双稳态从根上消失。
       * 非轴队没有轴栈轨迹（`hasTrace=false`）⇒ 退回池的整数次数（用户「非轴另算」）。
       */
      const realizedWindowsOf = (r: CalcRoundResult): number => {
        const realization = realizeStunWindows(buildStunTimeline({
          stunCount: r.stunPool.stunCount,
          windowDuration: stunWindowDur,
          effectiveTime: stunEffTime,
          windows: r.axisStack?.windowTrace,
        }))
        return realization.hasTrace ? realization.realizedWindows : r.stunPool.stunCount
      }
      const rawNext = probeFlag('PROBE_STUN_NEXT') === 'trace' && stunWindowDur > 0 && stunEffTime > 0
        ? realizedWindowsOf(out)
        : out.stunPool.stunCount
      // 净失衡缩放 + 时间可行性截断：非失衡占比缩放全来源净失衡，超出可容纳窗口数的残失衡按残差时间系数折成小数
      let next = rawNext
      if (!locked && stunWindowDur > 0 && stunEffTime > 0) {
        const coverage = stunWindowFraction(stunCount, stunWindowDur, stunEffTime)
        next = rawNext * (1 - coverage)
        const maxFull = Math.floor(stunEffTime / stunWindowDur)
        if (next > maxFull) {
          const residualFactor = stunEffTime / stunWindowDur - maxFull
          const excess = next - maxFull
          next = maxFull + Math.min(Math.max(0, excess), residualFactor)
        }
      }
      // 非失衡时间充足性约束：失衡次数过高时，角色的必做动作（回能/强特/喧响）时间
      // 会被挤到没有足够非失衡时间去执行，打法循环本身就不成立。
      // 收敛到非失衡时间 ≥ 该轮实际必要时间（含链的保守上界，但安全）。
      if (!locked && stunEffTime > 0 && stunWindowDur > 0) {
        const totalNecessary = out.resourceResult.characters.reduce(
          (s, c) => s + c.timeAllocation.necessaryTime, 0)
        const nonStunTime = stunEffTime - next * stunWindowDur
        if (nonStunTime < totalNecessary) {
          next = Math.max(0, (stunEffTime - totalNecessary) / stunWindowDur)
        }
      }
      // 本轮测量先成快照，再判 stable/cycle；严禁把上轮签名当成当前签名。
      const curSig = outerFeedbackSignature(out)
      // CC-479：外层不动点逐轮打表（`PROBE_TRACE_OUTER=1` 开，关着零成本）。签名各段含义见 outerCycle.ts#outerFeedbackSignature。
      probePush('PROBE_TRACE_OUTER', '__outerRounds', () => ({
        key: probeKey(), round: outerStunHistory.length + 1, stunIn: stunCount, stunNext: next, sig: curSig,
        poolStun: out.stunPool.stunCount, forceNoAxis, interactionScale: interactionScale ?? null,
        // CC-542：K 线程（= 下一轮喂给轴栈窗数与 countStun 的量）——环载体判据
        prevPoolIn: threads.prevPoolStunCount ?? null,
        topUpParry: out.threadsApplied.interactionTopUp.parry,
        topUpParryNext: out.interactionTopUp.parry,
      }))
      const feedbackStable = curSig === prevFeedbackSignature
      if (effLock >= 0) {
        if (feedbackStable) { outerConverged = true; outerExit = 'stable'; break }
      } else {
        // 失衡次数与反馈签名双稳定才收敛。CC-318：原先另比 `auricInkFlash`（仪玄玄墨触发，异常触发 → 回闪能 →
        // 强特 → 积蓄 → 触发），现在它在 moduleFeedback 里、随签名比较（锁定分支与环检测也一并覆盖）。
        // 失衡值用既有容差；反馈签名的量化与同相位判据见 outerCycle.ts。
        if (Math.abs(next - stunCount) < OUTER_STUN_TOLERANCE && feedbackStable) { outerConverged = true; outerExit = 'stable'; break }
        const isTwoCycle = isOuterTwoCycle({
          previousInput: prevStunValue,
          currentInput: stunCount,
          nextInput: next,
          currentSignature: curSig,
          signatureHistory: outerSigHistory,
          tolerance: OUTER_STUN_TOLERANCE,
        })
        if (isTwoCycle) {
          outerExit = 'cycle'
          // 2-循环两个成员 = 上一轮（输入 prevStunValue → 输出 stunCount）与本轮（输入 stunCount → 输出 next）；按环内判据取点
          out = pickCanonical([
            // 2-环判定要求 history 非空（签名历史里有同相位轮）⇒ history[-1] 必存在；`!` 仅为类型收窄
            { out: outerOutHistory[outerOutHistory.length - 1]!, prev: outerOutHistory[outerOutHistory.length - 2] ?? null, stunIn: prevStunValue ?? stunCount, next: stunCount },
            { out, prev: outerOutHistory[outerOutHistory.length - 1] ?? null, stunIn: stunCount, next },
          ])
          break
        }
        // 必须在判据之后追加，保证 history[-1] 是上一轮、history[-2] 是同相位轮。
        // 周期 ≥3 不在这里提前退出，保留轨迹供耗尽后的判定与规范选点使用。
        outerSigHistory.push(curSig)
        outerStunHistory.push(stunCount)
        outerNextHistory.push(next)
        outerOutHistory.push(out)
        prevStunValue = stunCount
        stunCount = next
      }
      // 线程推进：anomalyDecibelBonus 旧版从 out.anomalyPool 现取（threadsNext 内置空数组占位），
      // 其余 = threadsNext（runCalcRound 已按 prev 兜底算好下一轮值）
      threads = { ...t, anomalyDecibelBonus: out.anomalyPool.perSlotBonus }
      prevFeedbackSignature = curSig
    }
    /**
     * 周期 ≥3：只在迭代耗尽后查历史重复（签名相等且同相位失衡输入在容差内）。
     * 命中后复用规范选点，可能替换末轮结果；不是只重标注标签。
     */
    if (outerExit === 'maxIter') {
      const lag = findOuterLongCycleLag(outerSigHistory, outerStunHistory, OUTER_STUN_TOLERANCE)
      if (lag !== null) {
        outerExit = 'cycle'
        // 长环（周期 lag）：成员 = 最近一个周期内的各轮结果，按环内判据取点
        const from = Math.max(0, outerOutHistory.length - lag)
        out = pickCanonical(outerOutHistory.slice(from).map((o, j) => ({ out: o, prev: outerOutHistory[from + j - 1] ?? null, stunIn: outerStunHistory[from + j], next: outerNextHistory[from + j] })))
      }
    }
    /**
     * **环退出 ⇒ 结算为「最大自洽可行整数」**（round 20，2026-10-20）。
     *
     * ## 为什么不再用 cap 公式
     * 上一版按 `ceil((effTime − Σnec)/W)` 认领次数，只在 `nec < effTime` 时生效。实测剩余 3 支环队
     * `nec = 199~224s > 180` ⇒ cap 退化成物理上限（10~11）⇒ **从不构成约束**（实测 `capApplies=false`），
     * 环照旧。更根本的是：那个公式回答的是「时间还容得下几次」，而环的成因是
     * 「**计划 K 窗 ⇒ 摊薄 ⇒ 池只攒出 floor(cont(K)) 次**」，两者不是同一个量。
     *
     * ## 环的真正形态（`PROBE_TRACE_OUTER` 实测，与用户 §33 裁决一致）
     * ```
     * auto-1501: prev=3 → pool=2（t/b=2.96）；prev=2 → pool=3（t/b=3.02）  ⇒ 2-环 {2,3}
     * banyue   : prev=5 → pool=4（5.21→4.89）；prev=4 → pool=5            ⇒ 2-环 {4,5}
     * auto-1591: prevPool 恒 4，只有 |decibelRegenBySlot| 在环（跨轮测量反馈）
     * ```
     * 两条映射都是**真实物理结果**（用户 §33：2.96 = 第 3 次没开启、3.1 = 开启了但吞失衡值）
     * ⇒ 不是数值 bug，是「规划与产出互相追」。迭代 `next = f(prev)` 在两个相邻吸引子之间
     * **没有交点**时必然成环。
     *
     * ## 修法 = 直接求解「哪个 K 是自洽的」
     * 判据沿用本仓已立的 **最大自洽可行整数**（CC-150 / CC-153 / CC-329：按 K 分配时池撑得住 ≥ K 的最大 K）：
     * ```
     * kStar = max { K ∈ [0, floor(effTime/W)] : floor(continuousStunCount(pool(K))) ≥ K }
     * ```
     * 实测 cont(K)（锁定 K 窗时的连续失衡次数；`floor(cont(K))` 随 K 单调不增）：
     * | K | 2 | 3 | 4 | 5 | 6 |
     * |---|---|---|---|---|---|
     * | auto-1501 | 3.39 | 2.95 | 2.61 | 2.24 | 1.88 | ⇒ kStar **2**（cont(3)=2.95 < 3：第 3 次没开启）
     * | banyue    | 5.60 | 5.33 | 5.11 | 4.90 | 5.07 | ⇒ kStar **4**（cont(5)=4.90 < 5）
     * 这正是用户 §33 的判据：`floor` 不动，只是**把计划钉在自洽的那个 K 上**，不再让规划去追产出。
     *
     * ⚠ **搜索上界必须同时满足时间账**（实测踩过）：只按池自洽搜时 `auto-1051-1141-1451` 会取到
     * K=6（cont(6)=6.32 ⇒ 自洽），但 6 窗 × 16s + 必要 129s = 225s **远超 180s** ⇒ 物理不可能。
     * 上一版 cap 的「时间容得下几次」那部分是对的，只是对 `nec ≥ effTime` 的队无意义（那时它退化成
     * 物理上限、从不约束）。故两者**并联**：时间上界照旧算（有 room 时生效），池自洽做下扫判据。
     *
     * ## 为什么必须重跑一整轮
     * 只改 `stunPool.stunCount` 字段不会改贡献明细（实测 auto-1611：葬血强袭整行消失、伤害反而更低）。
     * 重跑 = 「按 kStar 窗排时间重新算一遍」，与锁定失衡次数（CC-305）走同一条 locked 路径
     * （`runOuterLoop` 的 `locked` 判据已改读 `effLock`，见该处注释）。
     *
     * ⚠ 深度闸：`overrideLock !== undefined` 时不进本块（否则递归无界，实测栈溢出）。
     * 回退点：删本块（`capacityResolved` 分支随之消失）。
     */
    /** 按 K 窗锁定的整轮（内层 promote 也走锁定路径，否则池不被钉到 K ⇒ cont 读数不成立） */
    const evalLocked = (k: number): ReturnType<typeof runOuterLoop> => {
      const prevOverride = resourceConfig.stunCountLockOverride
      const prevProjection = resourceConfig.stunPlanProjection
      resourceConfig.stunCountLockOverride = k
      /**
       * ⚠ **投影也要一起回落 off**（实测踩过）：用户锁定失衡次数时 `useResourceCalc` 会把
       * `stunPlanProjection` 从 physical 改成 off（CC-151），因为 physical 读的是**上一轮池**、
       * 会把锁定值旁路掉。这里走 override 通道，`useResourceCalc` 那层看不到，必须自己改——
       * 否则 core/resource 的计数通道仍按 physical 读上一轮池，等于**没按 K 排窗**
       * （实测 auto-1591：K=4 时内层 20 轮不收敛，而用户锁定同 K 只跑 3 轮即 stable）。
       */
      if (resourceConfig.stunPlanProjection === 'physical') resourceConfig.stunPlanProjection = 'off'
      try {
        return runOuterLoop(forceNoAxis, interactionScale, interruptTopUp, axisAutoTrim, k, stunLastWindowClip)
      } finally {
        resourceConfig.stunCountLockOverride = prevOverride
        resourceConfig.stunPlanProjection = prevProjection
      }
    }

    let capacityResolved = false
    if (outerExit === 'cycle' && stunWindowDur > 0 && stunEffTime > 0 && overrideLock === undefined) {
      /**
       * ⚠ **这一行把「连续失衡」钳掉了**（用户 2026-11-01 裁明机制）：满条开出 18s 窗后，若
       * 「非失衡攒条时间 + K×W」超过 180s，溢出应从**最后一窗的时间里丢掉**（时钟截断 `clippedByClock`）。
       * `floor(effTime/W)` 先封顶 ⇒ 该状态永远构造不出来（全库 `clippedByClock=0`）。
       * 放开 = A10 四步（①池可超上限 ②排被截短末窗 ③覆盖率扣截断秒 ④展示读时间轴）。
       */
      const physicalMax = Math.max(1, Math.floor(stunEffTime / stunWindowDur))
      /**
       * 时间上界（沿用上一版 cap 口径）：`nec < effTime` ⇒ 窗口余地 = `ceil((effTime−nec)/W)`；
       * `nec ≥ effTime` ⇒ 必要动作本身已占满预算（靠合轴吸收才装得下），窗口数不是瓶颈 ⇒ 退回物理上限。
       * `nec` 取环成员那一轮的读数（与旧实现同源，避免两把尺）。
       */
      const necUsed = out.resourceResult.characters.reduce((s, c) => s + c.timeAllocation.necessaryTime, 0)
      const budgetHasRoom = necUsed < stunEffTime
      const searchMax = Math.min(
        physicalMax,
        budgetHasRoom ? Math.max(1, Math.ceil((stunEffTime - necUsed) / stunWindowDur)) : physicalMax,
      )

      /**
       * **先从环成员里找 kStar —— 零额外求值**（2026-10-21 性能实测驱动）。
       *
       * 关键洞察：环里每个成员本来就是「按 K 排窗」的一次实测（K = 它前一轮的池次数
       * `m.prev.stunPool.stunCount`，池 = 它自己的输出 `m.out.stunPool`）。所以「哪个 K 自洽」
       * 在已经跑过的轮次里就有答案，**不必再求值**：
       *   kStar = max{ m.prev.pool : floor(continuousStunCount(m.out.stunPool)) ≥ m.prev.pool }
       *
       * 为什么必须走这条（实测）：每个 K 都是一次**完整外层求值**。线性下扫 11 档把
       * `charIncrement` 的单位工作量判据顶到 **1.52×**（线 1.0×），二分降到 **1.13×** 仍红；
       * 从环成员取 = **0 次额外求值**（实测回到阈值内）。
       *
       * 覆盖性：环成员只覆盖「迭代真正走过的 K」（实测 3 支环队各 2~4 个 K）。
       * 若环成员里没有自洽者（理论上可能：吸引子之间被跳过），才回落到二分下扫。
       */
      /**
       * **kStar = 最大自洽可行整数**（CC-150 / CC-153 / CC-329 同一条已立口径）。
       *
       * ⚠ 试过并否决「取最小」：min-K 会让 `auto-1051`/`auto-1611` 落到 K=1（自洽但**严重少打**，
       * 实测 stun 4→5 反跳、slack +1.68s、伤害 ±6~13%）⇒ 环从 1 支变 3 支。max-K 才是对的那个。
       */
      let kStar = 0
      for (const m of lastCycleMembers) {
        const kIn = m.prev?.stunPool.stunCount
        if (kIn === undefined || kIn <= 0 || kIn > searchMax) continue
        if (Math.floor(continuousStunCount(m.out.stunPool)) < kIn) continue
        if (kIn > kStar) kStar = kIn
      }
      if (kStar === 0) {
        /**
         * 回落：二分求**最大**自洽 K（与上面的成员扫描同一口径，别混两把尺——实测混用会把
         * `auto-1051`/`auto-1611` 从成员给的 K=4 拉到 K=1）。单调性依据 =
         * `continuousStunCount(pool(K))` 随 K 单调不增、判据右边随 K 增 ⇒ 谓词单调递减 ⇒ 二分合法。
         */
        let lo = 0
        let hi = searchMax
        while (lo <= hi) {
          const mid = (lo + hi) >> 1
          if (Math.floor(continuousStunCount(evalLocked(mid).out.stunPool)) >= mid) { kStar = mid; lo = mid + 1 } else hi = mid - 1
        }
      }
      /**
       * ⚠ **必须按 kStar 真跑一整轮，不能拿环成员的结果顶替**（实测踩过）：环成员那次跑的是
       * 「计划 m.stunIn、计数通道 K = 它前一轮的池」——池可能**大于** K（CC-150 的 `池 > 读入` 形态），
       * 直接拿它当结算结果就得人为把池钳到 K ⇒ 覆盖率与池不同源（实测 3 支队各差 1 窗）。
       * 重跑一次 = 「按 K 窗排时间重新算一遍」，池与覆盖率都由这一次自己产出 ⇒ 天然同源。
       */
      const chosenK = kStar
      /**
       * **能复用环成员就复用，省掉那次整轮重跑**（性能实测驱动）。
       *
       * 可复用的条件 = 该成员**本身就是「按 K 排窗」的产物**：`m.prev.pool === kStar` 且
       * `m.out.stunPool.stunCount === kStar`（池恰好等于读入 K，不存在「池 > 读入」需要钳位的情况）。
       * 此时它跑的就是「按 kStar 窗排一整轮」，与 `evalLocked(kStar)` 是同一件事
       * （实测逐位相同：auto-1501/auto-1611/banyue-jufufu/banyue-norma 的 kStar 成员都满足）。
       * 不满足（池 ≠ K）才重跑——那种成员钳位后覆盖率会与池不同源（坑 6）。
       *
       * 收益：`charIncrement` 的单位工作量判据从 1.01×（差 1% 就红）回到阈值内。
       */
      const reusable = lastCycleMembers.find(m =>
        m.prev?.stunPool.stunCount === kStar && m.out.stunPool.stunCount === kStar)
      const chosenRun: ReturnType<typeof runOuterLoop> | null = kStar <= 0
        ? null
        : reusable
          ? { out: reusable.out, outPrev: reusable.prev, outerRounds: 0, outerConverged: true, outerExit: 'stable' as const, outerCyclePickedEarlier: false, capacityResolved: false }
          : evalLocked(kStar)
      /**
       * ⚠ **重跑本身必须真的收敛**（实测踩过）：`auto-1591` 的 K=4 重跑 stable、但叶瞬光手组队
       * （B 类反馈环）的 kStar 档重跑是 `maxIter`（20 轮仍在两态间跳）。把那种重跑标成 stable
       * = **谎报收敛**（§27 已实测否决过同类做法）。故 `outerExit === 'stable'` 是采纳的前提；
       * 没收敛就落回旧路径（环内选点 + cycle），逐位等于改动前。
       */
      if (chosenRun && chosenRun.outerExit === 'stable') {
        /**
         * 池按 kStar 重建失衡值合计（`withStunCountRebuilt` = `stunBuildUpForCount` 反函数）：
         * locked 路径只钉「次数」，`totalStunBuildUp` 仍按自算值累加 ⇒ 不重建则
         * `floor(连续) === stunCount` 破掉（实测 auto-1371：池报 1、连续 6.349）。
         * 语义 = 「只兑现 kStar 次，多攒出来的那部分进不了下一次」——与用户 §33 同向。
         */
        const rebuiltPool = withStunCountRebuilt(chosenRun.out.stunPool, chosenK)
        /**
         * ⚠ **覆盖率必须随池一起重算**（C 项同源，与下方 CC-150 钳位块同一条纪律）。
         * 实测（3 支队）：环成员那一轮的 `stunCoverage` 是按**它自己**的池算的；把池换成 kStar
         * 之后不重算，就会出现「池报 4 窗 / 覆盖率隐含 5 窗」两个物理量
         * （`yidhari-trigger` / `auto-1501` / `banyue-jufufu` 实测各差 1 窗）。
         * 算式与 `computeStunCoverage` 完全同源（`stunWindowFraction` + 同一个 `verdictSecondsLost`）。
         */
        const aligned = {
          ...chosenRun.out,
          stunPool: rebuiltPool,
          stunCoverage: stunEffTime > 0
            ? stunWindowFraction(rebuiltPool.stunCount, stunWindowDur, stunEffTime, chosenRun.out.stunVerdictLostSeconds)
            : chosenRun.out.stunCoverage,
        }
        return {
          out: aligned,
          outPrev: chosenRun.outPrev,
          outerRounds: outerRounds + chosenRun.outerRounds,
          outerConverged: true,
          outerExit: 'stable',
          outerCyclePickedEarlier,
          capacityResolved: true,
        }
      }
    }

    // 非环停点（stable / 真 maxIter）：前一轮 = 历史末项（stable 的本轮未入历史；maxIter 的本轮是历史末项，取其前一项）
    if (outerExit === 'stable') outPrev = outerOutHistory[outerOutHistory.length - 1] ?? null
    else if (outerExit === 'maxIter') outPrev = outerOutHistory[outerOutHistory.length - 2] ?? null
    // CC-150（第 174 轮）：physical 计数下外层 2-环 = 整数物理次数无不动点（实测雨果 0 命轴 hugo-c0-e：
    // 读入 5 → 池 4、读入 4 → 池 5）。规范成员的引擎按读入 K（= 其前一轮池 `outPrev.stunPool`，即
    // `threads.prevPoolStunCount`）分配时间与计数，池却报 K+1 ⇒ 资源行（决算 4）与池 / 轴栈 / 伤害侧（5）不同源。
    // 取读入 K（按 K 分配时池撑得住 ≥ K，即最大自洽可行整数），报告池同步钳到 K；K+1 那次没有分配时间，不兑现。
    // 只处理「池 > 读入」的一侧；「池 < 读入」（引擎多分配了窗口）的成员已在 pickOuterCycleMember ⓪″（CC-153）排除出参选。
    // 回退点：删本块与 `core/stunPool.ts#withStunCount`。
    let clamped = false
    if (outerExit === 'cycle' && resourceConfig.stunPlanProjection === 'physical' && outPrev) {
      const kIn = outPrev.stunPool.stunCount
      if (out.stunPool.stunCount > kIn) {
        out = { ...out, stunPool: withStunCount(out.stunPool, kIn) }
        clamped = true
      }
    }
    /**
     * **覆盖率与池同源**（C 项，2026-10-20）：池次数被上一步钳到 K 之后，覆盖率必须按**同一个 N** 重算。
     *
     * 病灶（实测 3 支队）：`runCalcRound` 内的 `stunCoverage` 用的是**钳之前**的池
     * （`auto-1051-1141-1451` / `auto-1611-1141-1211` 池报 5、覆盖率隐含 **7** 窗；
     * `auto-1501-1561-1411` 池报 2、覆盖率隐含 **3** 窗）⇒ 同一份结果里两个物理量。
     * 覆盖率是**伤害易伤**与「攒条无效时间」的唯一输入（`damagePoolDirect` 直接读它），
     * 所以这不是展示口径问题——多算的那两窗会同时推高易伤覆盖与本轮攒条扣除。
     *
     * ⚠ 只在**真的钳过**时才重算（`clamped`）：stable / 未钳成员逐位不变。
     * 重算算式与 `computeStunCoverage` 完全同源（`stunWindowFraction` + 同一个 `verdictSecondsLost`）。
     */
    if (clamped) {
      const cov = stunEffTime > 0
        ? stunWindowFraction(out.stunPool.stunCount, stunWindowDur, stunEffTime, out.stunVerdictLostSeconds)
        : 0
      if (cov !== out.stunCoverage) out = { ...out, stunCoverage: cov }
    }
    /**
     * ===== 步 4 实验（`PROBE_STUN_NEXT=trace`）：按「残疾轴实际打了几个失衡」结算窗数 =====
     *
     * 用户 2026-10-25：「你无法打出 7 个窗啊……你如果是按照时间截断轴模式，那就可以看
     * **残疾轴在这时间前打了几个失衡**。非轴另算。」
     *
     * 做法：拿当前这一轮**轴栈实际填充**的等效窗数（`core/stunTimeline.ts#realizeStunWindows`），
     * floor 成整数后**按这个 K 重排一整轮**（与 `kStar` 同一条 locked 通道），再读一轮实测，
     * 直到实测与计划对上（最多 3 次）。非轴队没有轴栈轨迹 ⇒ 直接不动（「非轴另算」）。
     *
     * ⚠ 与 `kStar`（环退出时的拉合器）是**两件事**：kStar 判的是「池攒不攒得出 K」，
     * 本块判的是「这一轮排进去的窗，队伍有没有牌打满」。两者可同时命中，本块在后面。
     */
    if (probeFlag('PROBE_STUN_NEXT') === 'trace' && overrideLock === undefined && stunEffTime > 0 && stunWindowDur > 0) {
      for (let settle = 0; settle < 3; settle++) {
        const realization = realizeStunWindows(buildStunTimeline({
          stunCount: out.stunPool.stunCount,
          windowDuration: stunWindowDur,
          effectiveTime: stunEffTime,
          windows: out.axisStack?.windowTrace,
        }))
        if (!realization.hasTrace) break
        const target = Math.floor(realization.realizedWindows + 1e-9)
        if (target === out.stunPool.stunCount || target < 1) break
        const re = evalLocked(target)
        if (re.outerExit !== 'stable') break
        out = {
          ...re.out,
          stunPool: withStunCountRebuilt(re.out.stunPool, target),
          stunCoverage: stunWindowFraction(target, stunWindowDur, stunEffTime, re.out.stunVerdictLostSeconds),
        }
        capacityResolved = capacityResolved || true
      }
    }
    return { out, outPrev, outerRounds, outerConverged, outerExit, outerCyclePickedEarlier, capacityResolved }
  }

  let r = runOuterLoop(false)
  /**
   * ===== A10 轮内两趟（连续失衡稳定化，2026-11-01）=====
   *
   * 用户 2026-11-01 裁明机制：满条开出 18s 窗，但「非失衡攒条时间 + K×W」超过 180s ⇒
   * **溢出从最后一窗的时间里丢掉**（战斗时钟截断）。
   *
   * ## 为什么必须轮内两趟（旧实现的病灶）
   * 旧实现把 clip 走 `threads.prevStunOverflowSeconds` **滞后一轮**注入轴栈（与 energy/decibel 同款）：
   * 本轮轴栈按**上一轮**的溢出重排窗，而本轮溢出已经变了 ⇒ 反馈通道有延迟 ⇒
   * `auto-1051-1141-1451` 出现 K **6→5** 双稳态（`zzIso.perf.ts` 隔离：`stackOnly` 就 6→5，`covOnly` 稳定 6）。
   * 轮内两趟把「测溢出 → 用它重排」放进**同一次外层求解**里：clip 在整次求值内是**常量**，
   * 没有滞后通道，也没有 K 的第二不动点。
   *
   * ## 收敛
   * pass1（无截短）给出溢出 ⇒ 作为 pass2 的 clip 重跑；若 pass2 自己的装配溢出又变了（说明
   * 「按截短排窗」改变了装不下的量），再带新值跑一趟，最多 2 次重跑（`|Δclip| ≤ 1e-6` 即停）。
   * `stunClipPass` 留在作用域里 ⇒ 后续 `stageResolveFeasibility` 的全部试算（中断/挤压/轴态降配/
   * 弃轴/非轴降配）**继承同一个 clip**，不会出现「主路径带截短、试算不带」的两套账。
   *
   * ## 已进默认（2026-11-01，A10 第 2 步）
   * 本块与覆盖率 `clip` 口径**已进默认**（用户 2026-11-01 裁明机制 = 时钟截断是连续失衡的终点）。
   * 回退开关：`PROBE_STUN_CLIP_ITER=off` ⇒ 两趟与覆盖率截短一起退回改动前（零 delta，对拍/探针用）。
   *
   * ## 稳定化实测（`zzClipIter` / `zzClipExit` / `zzIso`，全库 103 队，闸开）
   * 7 队动、全部下降 up=0/down=7（−0.075%~−0.705%），**KChanged=0 / exitChanged=0 / rounds 逐位不变**；
   * 滞后注入时代 `auto-1051-1141-1451` 的 K **6→5** 双稳态已消失（`zzIso`：改前 stackOnly 就 6→5）。
   * 进默认的实测影响面（`zzDefaultOn` 与 timeGolden 闸开跑）：timeGolden **23 条 dmg 全降**、时间账零变化，
   * 回退闸下全绿（归因闭合）。详见提交说明 delta 表。
   */
  if (probeFlag('PROBE_STUN_CLIP_ITER') !== 'off' && stunWindowDur > 0) {
    /** 末窗最多被截到 0：clip 不得超过「全部窗秒」 */
    const clampClip = (x: CalcRoundResult): number =>
      Math.min(Math.max(0, x.resourceResult.overflowSeconds ?? 0), Math.max(0, x.stunPool.stunCount) * stunWindowDur)
    for (let pass = 0, clip = clampClip(r.out); pass < 2; pass++) {
      if (!(clip > 1e-9) || Math.abs(clip - (stunClipPass ?? 0)) <= 1e-6) break
      stunClipPass = clip
      r = runOuterLoop(false)
      const nextClip = clampClip(r.out)
      if (Math.abs(nextClip - clip) <= 1e-6) break
      clip = nextClip
    }
  }
  // 轴退化检测（用户口径 2026-08）：轴的资源需求（轴内块/自动补齐交互 × 窗口数）超出战斗时间预算
  // → 轴不可操作（需 boss 秽盾等外界环境才打得成）→ 退化为一般轴重算。
  // 误伤护栏：般岳等角色「配置本身的交互行」（金身20/招架10 等）也会把必要时间推超预算
  // （banyue.test 锁窗注释：2026-08-23 已知现状）——这与轴无关，弃轴解决不了。
  // 故先跑一次非轴对照：仅当**非轴模式可行**（Σ前台净占用 ≤ 预算+容差）时才认定「轴需求是超时主因」并退化。
  // 非轴也超 = 配置本身超预算 → 走下方**非轴降配**（二分缩放交互次数）。
  // ⛔ **否决记录（2026-10-05，§20.5-3）**：曾拟把本处（连同下方降配试算两处）改成「在轴态跑」，
  // 理由是「对照在非轴态吃到了动态合轴吸收 ⇒ 被救活 ⇒ 误判轴可操作」。**三重实测否决**：
  // ① 前提证伪——吸收比扫 0/0.4/1 而弃轴集合逐位相同（本处对照在 ratio=0 下净占用 174~180 照样可行）；
  //    吸收是溢出驱动、主路径与本处同吃，对照不是「被救活」。
  // ② 处方自毁——改轴态 ⇒ 本处 = 重跑主路径 ⇒ `axisFallback` 恒假（13 队不再上报）、
  //    净占用静默涨到 234~264s、破 `timeFillRatchet` **绝对不变量**（该断言禁止靠重生成基线绕过）。
  // ③ 归属误诊——所谓「轴态队掉 10~23%」= **最终结果自己吃 `comboAlignAbsorbRatio` 上限**的效应
  //    （实测 9.4~28.9%）；真杠杆是那个机制参数（队伍配置页可调），与对照口径无关。
  // 另：下方 `r = noAxis` 是**无条件**写回，故任何触碰对照的改动都会外溢到降配档基线
  // （实测 4 队落点位移）——要做先落「时间账不恶化」闸门（见本文件 S3 契约注释的「下一步②」）。
  // 完整对账：`.claude/axis205c-predictions.md`；复现探针：`.zc/perf/axis205c.perf.ts`。
  /**
   * ===== 阶段 S3：可行化决策（`stageResolveFeasibility`，2026-09-11 显式化）=====
   * 「轮结果 ⇒ 时间账能不能接受，不能接受就收拾」的唯一入口（此前这段是内联在 `calcOutput` 里的
   * 匿名代码块，改动要读 60 行上下文）。**契约**：
   *   输入：`r0` = 当前接受的整轮结果（含 resolvedAxes 判定轴/非轴态）；
   *        隐含输入：`runOuterLoop` 闭包（重跑整轮）、`stunEffTime`（预算）、`lockedStunCount`（锁窗）。
   *   输出：`{ r, axisFallback, interactionScale }` —— `r` 可能被换成**非轴态**或**某个降配档**。
   *   判据：① 轴太厚（`overBudgetNet` 或补齐非法）⇒ 退化非轴；② 非轴仍撑不下
   *         （`overBudgetNet` **或** 装配期真截断 `truncatedToo`）⇒ 二分缩放交互次数（6 轮，~1.6%）。
   *   锁窗（`lockedStunCount >= 0`）= 用户明确意图 ⇒ **一律不动**，超时如实上报。
   * 现状两条臂的语义与生效面见下方注释；**下一步**（账本 round 4 工作单）：
   *   ① 给每次试算加快照/还原（试算纯化——实测被拒试算的副作用会留进最终态）；
   *   ② 给轴侧 `r = noAxis` 加「时间账不恶化」闸门（现在是无条件替换，实测能掉 2.9s 净占用）。
   */
  type RoundOut = ReturnType<typeof runOuterLoop>
  const stageResolveFeasibility = (
    r0: RoundOut,
  ): { r: RoundOut; axisFallback: boolean; interactionScale: number | undefined; axisAutoTrimmed: number } => {
    let r = r0
    /**
     * **触发判据两条臂**（2026-09-11 用户口径：「交互次数导致的必要招式，通常是达成目标的最少要求；
     * 如果必须溢出才能达成目标，那就不会强行往上加交互次数了」）：
     *  - `overBudgetNet`（原口径，轴退化仍用它）：截断**之后**的净占用超预算。注意它读的是装配期
     *    截断后的量，截断保证净占用恒 ≤ 预算 ⇒ 对「必要行本来就装不下」的队**永不成立**；
     *  - `truncatedToo`（新增，只给**非轴降配**用）：装配期真截断 `overflowSeconds > 1s` ⇒ 手改配置
     *    （应用主流程）里那些"必要行装不下、装配期按比例砍行"的队现在会真正进入降配二分。
     *
     * **生效面（实测，2026-09-11）**：对 119 个预设 **0 delta**（`timeGolden` 全绿）——预设场景本来就被
     * 净占用臂/轴路径覆盖；对**默认配置的手组队**有效（实测 `仪玄+洛克茜+卢西娅`：截断 10.7→1.6s、
     * 超预算 1.0→0.96s、降配 ×0.906）。**仍有 19 个预设结构性截断**（必要行本身超预算，缩交互也装不下），
     * 那要靠轴侧触发 + 逐模块退化（口径见 `docs/ENGINE_PIPELINE_GUIDE.md` §4 坑 19⑤）。
     *
     * ⚠️ **验收臂决定结果**（2026-09-11 复核，纠正早前「试算不纯」的判断）：把「截断 ≤1s」也当验收
     * 条件会把好试算拒掉，于是 `r` 停在**二分前的基线态**——实测 `yixuan-roxy-lucia` 基线（非轴态）
     * 超预算 3.78s，而接受 scale=0.90625 的试算后是 0.96s（≈棘轮基线 1.0）。**被拒试算没有留下可观测
     * 副作用**（受控实验：显式拒绝全部试算得到的就是基线值；关掉热启动、关掉本触发臂也都复现同一基线）。
     * 所以「+2.8s 回归」= 验收太严 ⇒ 停在基线态，不是污染。**验收目标怎么定**（消截断 / 时间账不恶化 /
     * 伤害不降）是需要设计的口径问题，别再用「收紧验收」当修法。
     * 另：本队两次等价调用的 `axisFallback` true/false 分叉，2026-09-13 复现定性 = **验收臂 + 非单调
     * 可行集的必然产物**，不是状态泄漏：每个 scale 的试算结果与试算次序无关（实测 0.25 单独 vs 跟在
     * 0.0625 后，net 均 180.191/计数均 16/6）；次序只改「哪个 scale 先被采纳」。要动这条得先证可行集下闭。
     */
    /**
     * 净占用（**计划本身**的占用；补齐量不再计入——T140a）。口径见下方 `@fact`。
     */
    // @fact engine:轴可行性/净占用 口径: 轴退化的净占用判据 `netOf` **只算计划本身**（`frontlineTotalOf`），不含 `pendingTopUpSeconds`（待装补齐秒数）——补齐是「在 off 基线上做增量」，算进去会让**补得越多越容易判轴装不下**（方向反了，实测 r=0.8：ON 45.477M/弃轴 vs OFF 57.074M/保轴）；超预算的补齐由「中断臂」（同函数 `stageResolveFeasibility`：轴态超预算时先试「补齐整条通道不生效」，保住轴）在**收敛级**中断，而不是弃轴。⚠ `timeInconsistencyOf`（环内选点）里那份 `pendingTopUpSeconds` **保留**（它算「还欠多少补齐没装」，语义正确，不是同一把尺） | 据 用户@2026-10-12「补齐应该是在 off 的基础上去补招式，如果中途超预算，那就只能中断，而不是去选一个更烂的结果……一定大于非补齐」 | 验 src/composables/__tests__/topUpMonotonic.test.ts | 锚 src/composables/resourceCalc/solveTeam.ts#stageResolveFeasibility | 信 确认
    // ⟳复核: 若「补齐的秒数是否参与轴退化判定」再被改动（如重新引入预算封顶、或改 `AXIS_FALLBACK_TOLERANCE_SEC` 容差口径），重跑 `.zc/perf/T140cross.perf.ts` 的 9 档 ON/OFF 单调性扫描确认无 VIOLATION | 到期 2027-04-30
    const netOf = (x: RoundOut) => frontlineTotalOf(x.out)
    const overBudgetNet = (x: RoundOut) =>
      stunEffTime > 0 && netOf(x) > stunEffTime + AXIS_FALLBACK_TOLERANCE_SEC
    const truncatedToo = (x: CalcRoundResult) =>
      (x.resourceResult.overflowSeconds ?? 0) > TIME_BUDGET_TOLERANCE_SECONDS
    const overBudget = overBudgetNet
    let axisFallback = false
    let interactionScale: number | undefined
    /** T165 挤压臂：本轮为保轴削掉的「自动多打」份数（0 = 没削，逐位不变）；供展示与归因 */
    let axisAutoTrimmed = 0
    /** 中断臂是否已生效（挤压臂必须沿用该状态，否则会撤销中断成果 —— 见挤压臂注释） */
    let interrupted = false
    let hadAxis = false
    // 锁定失衡次数（命座对比/锁窗测试）= 用户明确意图「操作够就能打 N 次失衡」，同锁定不回填口径：
    // 退化/降配会改变次数与交互结构，锁窗场景一律不触发（超时如实上报）。
    if (lockedStunCount < 0) {
      // 非法补齐（自动填充交互 > 200s，用户口径 2026-09-01）与超预算同等对待：
      // 轴要的资源根本填不出来 ⇒ 轴不可操作 ⇒ 走同一条退化路径（补齐次数已在源头清零）
      // 非法补齐判据（沿用用户裁决 2026-09-01「>200s 判非法 ⇒ 次数清零并走轴退化」）：
      // ⚠ 除「下一轮量」外**还要看本轮已装量**（`threadsApplied`）。实测（`banyue.test` 厚轴夹具）：
      // 模块在环的某一轮返回过非法量（`applied.illegal === true`），但外层环内选点落到的那个成员
      // 其「下一轮量」已经回到合法（`interactionTopUp.illegal === false`）⇒ 只看前者会漏判，
      // 该裁决退化成**轨迹依赖**（T140a 前它靠 `netOf` 里那份 232s 的待装秒数「顺带」触发弃轴）。
      // 看已装量不重新引入病根：病根是「合法补齐的**秒数量级**参与轴可行性」，而本判据是
      // 用户裁决的**非法旗标**（>200s = 轴要的资源根本填不出来），两者不是一回事。
      const topUpIllegal = (x: CalcRoundResult) =>
        x.interactionTopUp.illegal === true || x.threadsApplied.interactionTopUp.illegal === true
      /**
       * **本轮算出的**补齐需求是否非法（**不看** `threadsApplied` 那份上一轮遗留的标志）。
       *
       * 为什么需要与 `topUpIllegal` 并存（T167，2026-10-15）：
       * - `topUpIllegal`（OR 形态）是**保守/粘滞**判据，用于**退化臂**——它宁可多判一次非法，
       *   这正是上方注释要的「防漏判」；
       * - 但把同一把尺拿去当**救援臂的入场闸门**就错了：`threadsApplied` 是**上一轮**的遗留量，
       *   与本轮计划无关。实测 `banyue-liuyin-lucia`（`.zc/perf/T167gate.perf.ts`）：
       *   `illNext = {parry:60, dual:12, illegal:false}`（本轮需求**合法**）却因
       *   `illApp = {0,0,illegal:true}`（遗留）⇒ 旧判据 `!(false||true) && true` = false
       *   ⇒ 中断臂与挤压臂**同时被挡** ⇒ 直接退化（76.62M → 71.50M）；
       *   而挤压臂其实**装得下**（trim=3 ⇒ net 179.47 ≤ 182，实测）。
       * ⇒ 救援臂的入场只看**本轮**需求（用户口径 2026-09-01 的「非法 ⇒ 走轴退化」由
       *   `topUpIllegalNow` 在入场处以 `!` 的形式保住：本轮真非法 ⇒ 两臂都不进场 ⇒ 落退化臂）。
       */
      const topUpIllegalNow = (x: CalcRoundResult) => x.interactionTopUp.illegal === true
      // ===== T140a「中断臂」：补齐超预算 ⇒ 先中断补齐，**不是**弃轴（用户口径 2026-10-11）=====
      // > 「补齐应该是在 off 的基础上去补招式，如果中途超预算，那就只能中断，而不是去选一个更烂的结果」
      //
      // 病根（T140a 前）：`netOf` 把 `pendingTopUpSeconds`（待装补齐）算进了「轴装不装得下」的判定
      // ⇒ **补齐越多越容易判「轴装不下」⇒ 越容易弃轴**，方向正好反了（r=0.8 实测：ON 45.477M/3 次失衡/弃轴
      // vs OFF 57.074M/5 次失衡/保轴）。本块的 `netOf` 已只算计划本身，补齐量不再参与该判定。
      //
      // 为什么还需要「中断」这一臂：`netOf` 摘掉补齐后，轴态的**计划本身**仍可能超预算——那可能是
      // ① 轴本身超预算（与补齐无关）或 ② **补齐已经装进计划**、把计划顶出预算（补齐行是真前台行，
      // `applyBanyueTeamConfig` 把它累加进 `parryCount`/`dualCounterCount`）。②必须与①区分：
      // 用户口径要求在②时**中断补齐**（退回非补齐基线），而不是弃轴（弃轴是「更烂的结果」）。
      //
      // 判据与次序（**中断优先于弃轴**）：轴态 + 超预算 ⇒ 先试「轴态 + 补齐整条通道不生效」
      // （`interruptTopUp`；轴块/连携覆盖照旧注入，只有补齐让位）；
      // ① 中断后不超预算 ⇒ 采纳它：轴保住、补齐中断，`axisFallback` **保持 false**（轴没退化）；
      // ② 中断后仍超预算 ⇒ 轴自身超预算，走原有轴退化路径（下面那个 `if`）。
      // ⚠ **不用更严的真预算（`net > stunEffTime`，无 2s 容差）当判据**：实测那会把「计划净占用
      // 180.00s、落在既有 2s 容差内」的落点（`axisAutoGuarantee` 夹具）也判成超预算 ⇒ 误中断
      // 一个本来可行的补齐（该点 ON 与 OFF 产出同值，中断它纯属有害）。容差与轴退化同源、同一把尺。
      // ⚠ 只在本轮**真的有补齐量**时试（否则纯增一次完整外层求值而无收益）；非法补齐没有可中断的量。
      // ⚠ 锁定失衡次数（`lockedStunCount >= 0`）不进来：本块本来就在 `lockedStunCount < 0` 分支内。
      const loadedTopUp = (x: CalcRoundResult): number => {
        const t = x.threadsApplied.interactionTopUp
        return t.parry + t.dual
      }
      const wantsTopUp = (x: RoundOut): boolean =>
        loadedTopUp(x.out) > 0 || x.out.interactionTopUp.parry > 0 || x.out.interactionTopUp.dual > 0
      if ((overBudget(r) || topUpIllegal(r.out)) && r.out.resolvedAxes.length) {
        hadAxis = true
        // ① 中断臂（入场判据 = 「本轮需求合法 且 真有补齐量可中断」，见 `topUpIllegalNow` 说明）
        if (!topUpIllegalNow(r.out) && wantsTopUp(r)) {
          r = runOuterLoop(false, undefined, true)
          // ⚠ 记下「本轮是否已中断补齐」：挤压臂必须沿用这个状态（否则会把中断成果撤销，
          // 见下方挤压臂注释的 `banyue-liuyin-lucia` 实测）。
          interrupted = true
        }
      }
      // ===== T165「挤压臂」：装不下就**削掉自动多打的那部分**，而不是丢整个轴 =====
      // 用户口径 2026-10-14（逐字）：
      // > 「我不希望**多打一次资源就导致挤不下然后取消轴模式导致巨大退化**，我希望你**挤不下就不要多打**。」
      //
      // 次序：**中断臂 → 挤压臂 → 退化臂**（越靠后代价越大）。
      // · 中断臂治「补齐把计划顶出去」；本臂治「模块自己自动打满的内容把计划顶出去」；
      // · 两者都救不回才退化为非轴（原行为）。
      //
      // 判据与终止：从 `axisAutoTrim = 1` 起逐个试到装得下为止，上限 `AXIS_AUTO_TRIM_MAX`。
      // **为什么由引擎循环而不是模块自己循环**：只有引擎能回答「这样装得下吗」（要跑完整轮 +
      // 净占用判定），模块侧看不到全队预算 ⇒ 循环只能住在这里。
      // ⚠ 每个候选都是**一次完整外层求值**（含外层不动点），故上限取小（般岳怒相外连段现实量级
      // ≤ 10 组）；到顶仍装不下 ⇒ 落回原路径（退化臂），行为与改动前一致。
      // ⚠ **只在轴态**（`resolvedAxes.length`）且**非锁窗**（本块已在 `lockedStunCount < 0` 内）：
      // 锁窗 = 用户明确意图，引擎不改结构（与退化/降配同款纪律）。
      // ⚠ 只在**没有非法补齐**时试：非法补齐（>200s = 轴要的资源根本填不出来）不是「多打了」，
      // 削内容救不了它，应直接走既有退化路径。
      //
      // ⚠ **必须沿用中断臂的结果状态**（`interrupted`）：若中断臂已经把补齐关掉（`r` 是中断后的
      // 态），挤压臂再以「补齐开着」重跑就等于**把中断臂的成果撤销**——实测 `banyue-liuyin-lucia`
      // 正是这样被拒的：中断臂关掉补齐后候选 net 已到 179.23（≤ 182，装得下），
      // 而挤压臂重开补齐 ⇒ `illegalNext=true` ⇒ 采纳条件 `!topUpIllegal` 判假 ⇒ 12 个候选全被拒。
      // ⇒ 本臂在「中断后」的基线上继续削，与次序「中断 → 挤压 → 退化」的语义一致。
      // ⚠ **本臂入场同样只看「本轮需求是否合法」**（`topUpIllegalNow`，理由同中断臂）：
      // 上一轮遗留的 `threadsApplied.illegal` 与本轮计划无关，不该挡住「削内容保轴」这条路。
      // ⚠ **如实记录：本行对 93 预设是零 delta**（实测「只改中断臂」与「两臂都改」逐位相同）——
      // 因为中断臂跑过之后 `threads` 被整块清零（`convergence.ts`：`interactionTopUp` 重置为
      // `{0,0,0,false}`）⇒ 该路径上 `topUpIllegal ≡ topUpIllegalNow`。二者只在「中断臂**没跑**
      // （本轮无补齐量可中断）而遗留标志为真」时分歧，而那一态未被任何预设触及。
      // **保留理由 = 语义一致性而非实测增益**：同一问题（「本轮需求合不合法」）不该在两条臂上
      // 用两把尺——那正是本卡修的「两套账」形态；且采纳条件（`!overBudget && !topUpIllegal`）
      // 一字未动 ⇒ 只会让本臂**有机会尝试**，永不放行装不下的候选。
      if ((overBudget(r) || topUpIllegal(r.out)) && r.out.resolvedAxes.length && !topUpIllegalNow(r.out)) {
        hadAxis = true
        for (let trim = 1; trim <= AXIS_AUTO_TRIM_MAX; trim++) {
          const squeezed = runOuterLoop(false, undefined, interrupted, trim)
          // 采纳条件 = **真的装得下**（与中断臂同款「绝对可行」口径：净占用进容差且补齐合法）
          if (!overBudget(squeezed) && !topUpIllegal(squeezed.out)) {
            r = squeezed
            axisAutoTrimmed = trim
            break
          }
        }
      }
      /**
       * ===== 用户裁决（2026-10-21 round 29）：**弃轴之前先试「轴态降配」** =====
       *
       * 用户原话：
       * > 「合轴率上限寻常情况不能动，你说的这个**合轴到上限依旧溢出，那就截断招式**，和 1 一样。」
       * > 「大胆试。**这个连续失衡也能解决一个队伍在两个离散失衡突变的情况**」
       *
       * ## 为什么不是直接保轴（前一轮失败的原因，留痕）
       *
       * 试过「无条件保轴」，但 `1471/1191/1481` 的净占用 207.4s（超 27.4s）撑爆
       * —— 那个规模**截断救不回来**（截断只能砍动作次数，砍不掉「计划本身排不下」）。
       * 试过 6 个「保轴门槛」（溢出 ≤2s / ≤2 窗 / 净占用 ≤预算+2s / +2 窗 / +1 窗 / +1窗+2s），
       * **每个都在别处制造新断崖** —— 因为净占用是连续量、保轴是二元决策，
       * 用连续量的固定阈值切二元决策，必然在阈值处跳变（只是把断崖搬家）。
       *
       * ## 正确顺序：挤压臂 → **轴态降配** → 弃轴
       *
       * 轴态超预算时，先像非轴那样**二分缩交互**（`interactionScale`），
       * 缩到装得下就保轴（轴还在、只是交互次数少了）；缩到 0 仍不行才弃轴。
       * 这样保轴不再有「阈值跳变」——它是**连续降配**的自然结果。
       */
      if ((overBudget(r) || topUpIllegal(r.out)) && r.out.resolvedAxes.length) {
        hadAxis = true
        /**
         * 轴态降配搜索：与非轴降配同一个验收口径（三条相对臂），但**保留轴**。
         * 候选 = `runOuterLoop(false, scale)`（false = 不弃轴）。
         */
        const axisScaleCandidates = [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1]
        let axisKept = false
        for (const scale of axisScaleCandidates) {
          const trial = runOuterLoop(false, scale)
          if (!overBudget(trial) && !topUpIllegal(trial.out)) {
            r = trial
            interactionScale = scale
            axisFallback = false
            axisKept = true
            break
          }
        }
        if (!axisKept) {
          const noAxis = runOuterLoop(true)
          if (!overBudget(noAxis) && !topUpIllegal(noAxis.out)) axisFallback = true
          r = noAxis // 可行与否都进入非轴态：不可行则走下方降配
        }
      }
      // 非轴降配（用户口径 2026-08-30 + 2026-09-11「必须溢出才能达成目标，就不会强行往上加交互次数」）：
      // 金身/招架这类手填交互与轴厚需求本质相同——撑不下都要降配。二分找**最大可行 scale**
      // （6 轮，精度 ~1.6%）；scale→0 仍不行 = 非交互必要时间本身超预算，如实保留报超时。
      //
      // ===== 验收目标（2026-09-11 设计，替换原来的「净占用 ≤ 预算+2s」单臂）=====
      // 单臂的毛病：① 它只看净占用、看不见「还在按比例砍行」（截断）；② 把「截断 ≤1s」并进单臂去收紧
      // 又会把好试算一起拒掉（实测 `yixuan-roxy-lucia`：拒绝全部试算 ⇒ 停在基线态 3.78s 超预算，
      // 而接受 scale=0.90625 ⇒ 0.96s 超预算 + 截断 10.7→1.6s）。所以改成**三条臂、都相对「二分前的基线态」
      // （不是相对绝对阈值）**、各自带 1s 量化容差（与棘轮同源）：
      //   ① `truncation(trial) ≤ truncation(base) + 1s` —— 不许砍得更多；
      //   ② `overBudget(trial) ≤ overBudget(base) + 1s` —— 不许更超预算；
      //   ③ `slack(trial) ≤ slack(base) + 1s` —— 不许把省下的时间变成留白/发呆（用户：「不搞表面工程」）。
      // 这三条一起 = 「**不比改动前更差**，且尽量消掉截断」⇒ 相对棘轮（只拦变差）**构造上不可能变红**，
      // 变红的只可能是 timeGolden 的硬字段（那是有意的改进，按规则 10 归因后重生）。
      /**
       * **手动锁定交互闸门**（用户口径 2026-10-06）：配装页勾「手动锁定交互」后，用户在交互栏填的
       * 次数 = **用户明确意图**（「用户选择交互次数已经确定了交互这一块的难度设置，就可以尽量满足，
       * 自动调整合轴率和其他内容来做到。实在做不到就说哪里做不到」）⇒ 非轴降配**整块不执行**：
       * 不缩交互、不改结构，`interactionScale` 保持 `undefined`，装不下时由
       * `overflowSeconds` / `convergence.truncationBySlot` **如实上报截断**。
       *
       * 同款先例 = 上方 `lockedStunCount < 0` 的「用户明确意图 ⇒ 引擎不改结构」（锁失衡次数时
       * 退化/降配一律不触发，超时如实上报）——本闸门是同一原则补到交互次数上。
       * ⚠ **不删降配代码**：不勾选（缺省 `false`）时下方整块仍服务难度曲线，逐位不变。
       * ⚠ **不需要新增「先提高合轴率」的调用**：合轴吸收（G5 / `comboAlignAbsorbRatio`）在
       * `core/resource/helpers.ts#iterate` 内部，**本来就在降配之前**生效 ⇒ 锁定后它自然先跑
       * （队友前台按溢出量并行吸收），只有吸收不完的剩余才成为截断。
       * ⚠ 只闸**非轴降配**（本块）：上方轴退化换的是「用不用轴」，不缩交互次数（其 `runOuterLoop`
       * 不带 scale），故不在本闸门语义内。
       */
      // @fact engine:降配搜索/手动锁定交互 口径: `ResourceCalcConfig.interactionsLocked === true`（配装页「手动锁定交互」勾选）= 用户在交互栏填的次数是**用户明确意图** ⇒ 非轴降配整块不执行（`downscaleAllowed` 闸门），`interactionScale` 保持 `undefined`，装不下时由 `overflowSeconds`/`truncationCuts` 如实上报截断；缺省 false ⇒ 本条路径逐位不变（全库预设 ×6 场景 zd DIFF 0）。同款先例 = 锁失衡次数（`lockedStunCount < 0`）。**不新增「先提高合轴率」的调用**——合轴吸收（G5）本就在 `core/resource/helpers.ts#iterate` 内、降配之前生效，锁定后自然先跑（实测 ratio 0→缺省→1 截断 93.69→93.61→31.23s）| 据 用户@2026-10-06·复核@2026-10-08 | 验 src/composables/__tests__/interactionsLocked.test.ts | 锚 src/composables/resourceCalc/solveTeam.ts#stageResolveFeasibility | 信 确认
      // ⟳复核: 若降配触发臂（`overBudget`/`truncatedToo`）或合轴吸收在 `iterate` 内的**先后顺序**再动，须重对「锁定态下合轴先跑」与「缺省路径逐位不变」（interactionsLocked.test.ts ①②③ + zd.sh）| 到期 2027-01-31
      const downscaleAllowed = resourceConfig.interactionsLocked !== true
      if (downscaleAllowed && (overBudget(r) || truncatedToo(r.out)) && !r.out.resolvedAxes.length) {
        // 搜索策略（2026-09-11 第三版，用户裁决）：**枚举候选 scale + 硬约束「真撑得下」取最大可行**。
        // 前两版教训：① 二分假定"可行域是 scale 的下闭区间"，把「截断 ≤1s」并进验收后会在
        // `yixuan-roxy-lucia` 上把好试算全拒（基线 3.78s 超预算）；② "最小截断优先"会把结构性溢出队压到
        // scale=0.0625（交互几乎清零）只为少几秒截断 —— 与「交互只取达成目标的**最少要求**」相反。
        // 本版：SCALES 由大到小扫，**首个「绝对可行」（截断 ≤1s 且净占用超预算 ≤1s）者即采纳**
        // （= 真装进 180s 的最大 scale、保留最多交互）；无绝对可行档 ⇒ 退回首个「三臂不比基线更差且
        // 截断 ≤1s」的相对档（第四版，2026-09-18 R32：相对臂降为兜底——旧版把「比基线好」当终点，
        // yixuan-roxy-lucia 在 0.875 档超预算 1.74s 就停了，真可行的 0.625 档试不到）；
        // 无相对档 ⇒ 第三层「缓解档」（CC-143，2026-09-28：三臂不劣 + 截断比基线少 >1s + 外层 stable，取截断最小；
        // 否则会留下「满交互 + 最大截断」，与「交互只取最少要求」相反）；**仍无人满足 ⇒ 不动**（保基线态、截断如实上报）。
        // **策略的单一事实源 = `resourceCalc/feasibilitySearch.ts`**（纯函数 + 回归测试；判据⑤的`@fact`在那里）。
        // **否决记录（2026-09-13 复现定性）**：曾试过「先用最小候选探一次、失败即跳过扫描」的成本闸门，实测改结果。
        // **根因不是"试算不纯/状态泄漏"**——受控实验证明每个 scale 的试算结果与它前面跑过哪些试算**无关**
        // （0.25 单独跑与跟在 0.0625 后跑，net 均 180.191）；真因是**可行集非下闭**（全库 21 队中 7 队
        // 「存在可行 x 且存在 y<x 不可行」，3 队最小档不可行但更大档可行）⇒「最小档不行 ⇒ 全体不行」的前提为假。
        const baseNet = netOf(r)
        const baseTruncation = r.out.resourceResult.overflowSeconds ?? 0
        const acceptsTrial = (x: RoundOut): boolean => downscaleTrialAccepted({
          trialNet: netOf(x),
          trialTruncation: x.out.resourceResult.overflowSeconds ?? 0,
          baseNet,
          baseTruncation,
          stunEffTime,
          toleranceSeconds: TIME_BUDGET_TOLERANCE_SECONDS,
        })
        const candidates = DOWNSCALE_SCALES
        const best = selectDownscaleScale(candidates, scale => {
          const trial = runOuterLoop(true, scale)
          const trialTruncation = trial.out.resourceResult.overflowSeconds ?? 0
          // CC-149（第 179 轮）：绝对可行**独立判定**，且绝对可行即接受。
          // 旧写法 `feasible = accepted && …` 让兜底的相对三臂否决了首选的绝对可行——违背两层字典序
          // （@fact engine:降配搜索/绝对可行优先）。绝对可行 ⇒ 臂①②必然满足，差别只在臂③「留白不增」：
          // 基线态大量截断时（实测 52.6s）其「留白」是截断后的残量，不代表真实余量，拿它否决真装得下的档
          // ⇒ 最大可行档沿合轴率锯齿（0.125/0.0625/0.125/0.0625，docs/mcp-stun-dual-source.md §21）。
          // 回退点：改回 `const accepted = acceptsTrial(trial) && trialTruncation <= TOL; const feasible = accepted && downscaleTrialFeasible(...)`。
          const feasible = downscaleTrialFeasible({
            trialNet: netOf(trial),
            trialTruncation,
            stunEffTime,
            toleranceSeconds: TIME_BUDGET_TOLERANCE_SECONDS,
          })
          const accepted = feasible || (acceptsTrial(trial) && trialTruncation <= TIME_BUDGET_TOLERANCE_SECONDS)
          // CC-143 第三层「缓解档」：截断仍 > 容差（未 accepted），但三臂不劣且截断比基线少一个容差以上
          // 另要求该档外层 stable：cycle 停点是环内选点（路径依赖），兜底档不拿它（实测不加此条 cycle 2→4）
          const relief = !accepted && trial.outerExit === 'stable' && acceptsTrial(trial)
            && trialTruncation < baseTruncation - TIME_BUDGET_TOLERANCE_SECONDS
          return { accepted, feasible, relief, reliefTruncation: trialTruncation, value: { ...trial, scale } }
        })
        if (best) {
          r = best.value
          axisFallback = hadAxis
          interactionScale = best.scale
        }
      }
    }
    return { r, axisFallback, interactionScale, axisAutoTrimmed }
  }

  const { r: rAfterFeasibility, axisFallback, interactionScale, axisAutoTrimmed } = stageResolveFeasibility(r)
  r = rAfterFeasibility
  const { out: baseOut, outerRounds, outerConverged, outerExit, outerCyclePickedEarlier } = r
  const out = baseOut.resourceResult
    ? {
        ...baseOut,
        resourceResult: {
          ...baseOut.resourceResult,
          convergence: {
            ...baseOut.resourceResult.convergence,
            outerConverged,
            outerRounds,
            outerExit,
            axisFallback,
            interactionScale,
            // T165 挤压臂读数：0 = 没削（缺省不带该字段，与既有停点逐位同形）
            axisAutoTrimmed: axisAutoTrimmed > 0 ? axisAutoTrimmed : undefined,
            outerCyclePickedEarlier: outerCyclePickedEarlier || undefined,
          },
        },
      }
    : baseOut
  /**
   * ===== 步 3 实验：连续失衡覆盖率**只喂结算侧**（施工图 §8c 第 1 步）=====
   *
   * 开关 `PROBE_STUN_CONT_COV`：`formula` = 失衡值公式（§1 口径，e = 每秒失衡值 × 窗长），
   * `trace` = 轴栈逐窗实测填充率（用户 2026-10-25「应该有前面失衡期的数据」），
   * `clip` = ★ A10 口径：装配溢出 `overflowSeconds` 记到**最后一窗的时间里**（覆盖率扣它，不砍行）——
   *   用户 2026-11-01 裁明的连续失衡机制。**已进默认**（2026-11-01，A10 第 2 步）；
   *   回退 = `PROBE_STUN_CONT_COV=off`（与 `PROBE_STUN_CLIP_ITER=off` 配套 ⇒ 退回改动前）。
   * `phase` = 试过的「按余量比例给部分窗」口径（= 池 `continuousStunCount` 的整数+小数，与
   *   `stunPhaseTimeline#trailingFraction` 同源）。**不设 = 逐位不变**（默认关）。
   *   ⛔ **已否决（2026-11-01，用户裁明机制后）**：失衡只有「开窗 / 不开窗」两态
   *   （`stunWindowDuration` 按队伍固定），「攒 X% 条 ⇒ 给 X% 窗」是额外假设。
   *   **连续失衡的真正机制 = 满条开窗后总时间超 180s，把溢出从最后一窗的时间里丢弃（时钟截断）**
   *   ——那是 A10 四步放开 `physicalMax` 的活，不是本条。实测 97/103 队全上升 +0.03%~+7.11%，
   *   仅留作否决记录，**不要改成默认**。
   *
   * 换的是 `out.stunCoverage`（= 伤害池易伤与行级 `stunCoverage` 的唯一输入），
   * **不换**迭代内部用的那份（`runOuterLoop` 每轮用的是它自己的局部 `stunWindowFraction(stunCount, …)`），
   * 所以失衡次数 / 时间账 / 轴栈全部保持整数口径 —— 这正是实验目的：
   * 先量「把末窗兑现折进易伤」对伤害的影响，以及会不会触发 §41 那种「覆盖率↑ ⇒ 攒条↓ ⇒ 池塌陷」。
   */
  let finalOut = out
  /**
   * 口径选择：**缺省 = `clip`**（A10 已进默认）；`off` = 整块不生效（回退到改动前，零 delta）；
   * `formula` / `trace` / `phase` = 保留的实验口径（`phase` 已被用户否决，仅留否决记录）。
   */
  const contRaw = probeFlag('PROBE_STUN_CONT_COV')
  const contMode = contRaw === 'off' ? '' : (contRaw || 'clip')
  if (contMode && stunEffTime > 0 && stunWindowDur > 0) {
    if (contMode === 'clip') {
      /**
       * ★ A10 口径（用户 2026-11-01 裁明机制）：满条开出的窗装不进 180s 时，
       * **溢出从最后一窗的时间里丢掉**（不是砍非失衡招式）——
       * 覆盖率 = 原覆盖率 − overflow/eff（同分母，不重算、不引入不同源）。
       * ⚠ 覆盖率只扣截断秒，**行侧的 cut 仍在**（A10 第 2 步未做行恢复）⇒ 本口径是下界。
       */
      const clipSec = Math.min(Math.max(0, out.resourceResult.overflowSeconds ?? 0), out.stunPool.stunCount * stunWindowDur)
      const clipped = Math.max(0, out.stunCoverage - clipSec / stunEffTime)
      if (clipped !== out.stunCoverage) finalOut = { ...out, stunCoverage: clipped }
    } else {
      /** 已兑现的等效窗数：`trace` 用轴栈逐窗实测、`phase` 用池连续计数、其余用公式 */
      const realized = contMode === 'trace'
        ? realizeStunWindows(buildStunTimeline({
            stunCount: out.stunPool.stunCount,
            windowDuration: stunWindowDur,
            effectiveTime: stunEffTime,
            windows: out.axisStack?.windowTrace,
          })).realizedWindows
        : contMode === 'phase'
          ? continuousStunCount(out.stunPool)
          : continuousStunSplitOf(out.stunPool).realizedWindows
      const contCoverage = stunWindowFraction(realized, stunWindowDur, stunEffTime, out.stunVerdictLostSeconds)
      if (contCoverage !== out.stunCoverage) finalOut = { ...out, stunCoverage: contCoverage }
    }
  }
  return { out: finalOut }
}
