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
import { netFrontlineOccupation } from '@/core/resource/helpers'
import { withStunCount } from '@/core/stunPool'
import { stunWindowFraction } from '@/core/effectiveTime'
import type { ResourceCalcConfig } from '@/types/resource'
import { initialCalcRoundThreads } from './roundThreads'
import { findOuterLongCycleLag, isOuterTwoCycle, outerFeedbackSignature, pickOuterCycleMember } from './outerCycle'
import { probeKey, probePush } from '@/core/probeTrace'
import { DOWNSCALE_SCALES, selectDownscaleScale, downscaleTrialAccepted, downscaleTrialFeasible } from './feasibilitySearch'
// 仅类型：`ReturnType<typeof createRunCalcRound>` 与 `CalcRoundResult` 都用不到运行时值，
// 故 type-only import（不引入 convergence.ts 的运行时依赖）。
import type { createRunCalcRound, CalcRoundResult } from './convergence'

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
    Math.max(0, (x.interactionTopUp?.requiredSeconds ?? 0) - (prev?.interactionTopUp?.requiredSeconds ?? 0))
  /**
   * 跑完整外层不动点。forceNoAxis = 轴退化重算（用户口径 2026-08：轴的资源需求
   * （喧响/嗔火/轴内块 × 窗口数）超出时间预算 → 必要时间 > 战斗时间 → 该轴不可操作
   * （需 boss 秽盾等外界环境才打得成）→ 退化为一般轴（不注入轴块/连携覆盖/自动补齐）重算）。
   */
  function runOuterLoop(forceNoAxis: boolean, interactionScale?: number): { out: CalcRoundResult; outPrev: CalcRoundResult | null; outerRounds: number; outerConverged: boolean; outerExit: 'stable' | 'cycle' | 'maxIter'; outerCyclePickedEarlier: boolean } {
    let stunCount = lockedStunCount >= 0 ? lockedStunCount : 0
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
      return Math.abs(stunEffTime - (frontlineTotalOf(r) + pendingTopUpSeconds(r, m.prev))) + (r.resourceResult.convergence?.timeTruncatedSeconds ?? 0)
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
      return r.resourceResult.convergence?.timeTruncatedSeconds ?? 0
    }
    /** 选中成员的前一轮结果（= 它的输入线程来源；轴退化判据用它算「还没装进计划的补齐量」） */
    let outPrev: CalcRoundResult | null = null
    const pickCanonical = (all: OuterCycleMember[]): CalcRoundResult => {
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
    let outerExit: 'stable' | 'cycle' | 'maxIter' = 'maxIter'
    // 净失衡迭代（用户 Excel 口径）：覆盖率由上一轮失衡次数得出，非失衡占比缩放全来源净失衡，
    // 时间预算把超出的残失衡折成小数——正反馈被全局负反馈对抗，收敛到静止
    for (let k = 0; k < MAX_OUTER_ITER; k++) {
      outerRounds = k + 1
      // 锁定次数（用户明确意图）不走净失衡缩放与小数截断，仍用原始池计数
      const locked = lockedStunCount >= 0
      // CC-418：runCalcRound 无 null 出口（CC-417 删空失衡池 null 后，剩余守卫与 calcOutput 同条件不可达），
      // 原「null 轮 ⇒ threadsAfterNullRound 回退 + 签名清空 + continue」分支随之删除。
      out = runCalcRound(stunCount, threads, { forceNoAxis, interactionScale })
      const t = out.threadsNext
      const rawNext = out.stunPool.stunCount
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
        const totalNecessary = (out.resourceResult?.characters ?? []).reduce(
          (s, c) => s + (c.timeAllocation?.necessaryTime ?? 0), 0)
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
      }))
      const feedbackStable = curSig === prevFeedbackSignature
      if (lockedStunCount >= 0) {
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
    // 非环停点（stable / 真 maxIter）：前一轮 = 历史末项（stable 的本轮未入历史；maxIter 的本轮是历史末项，取其前一项）
    if (outerExit === 'stable') outPrev = outerOutHistory[outerOutHistory.length - 1] ?? null
    else if (outerExit === 'maxIter') outPrev = outerOutHistory[outerOutHistory.length - 2] ?? null
    // CC-150（第 174 轮）：physical 计数下外层 2-环 = 整数物理次数无不动点（实测雨果 0 命轴 hugo-c0-e：
    // 读入 5 → 池 4、读入 4 → 池 5）。规范成员的引擎按读入 K（= 其前一轮池 `outPrev.stunPool`，即
    // `threads.prevPoolStunCount`）分配时间与计数，池却报 K+1 ⇒ 资源行（决算 4）与池 / 轴栈 / 伤害侧（5）不同源。
    // 取读入 K（按 K 分配时池撑得住 ≥ K，即最大自洽可行整数），报告池同步钳到 K；K+1 那次没有分配时间，不兑现。
    // 只处理「池 > 读入」的一侧；「池 < 读入」（引擎多分配了窗口）的成员已在 pickOuterCycleMember ⓪″（CC-153）排除出参选。
    // 回退点：删本块与 `core/stunPool.ts#withStunCount`。
    if (outerExit === 'cycle' && resourceConfig.stunPlanProjection === 'physical' && outPrev) {
      const kIn = outPrev.stunPool.stunCount
      if (out.stunPool.stunCount > kIn) out = { ...out, stunPool: withStunCount(out.stunPool, kIn) }
    }
    return { out, outPrev, outerRounds, outerConverged, outerExit, outerCyclePickedEarlier }
  }

  let r = runOuterLoop(false)
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
  ): { r: RoundOut; axisFallback: boolean; interactionScale: number | undefined } => {
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
    /** 净占用（计划 + 待装补齐，见 pendingTopUpSeconds） */
    const netOf = (x: RoundOut) => frontlineTotalOf(x.out) + pendingTopUpSeconds(x.out, x.outPrev)
    const overBudgetNet = (x: RoundOut) =>
      stunEffTime > 0 && netOf(x) > stunEffTime + AXIS_FALLBACK_TOLERANCE_SEC
    const truncatedToo = (x: CalcRoundResult) =>
      (x.resourceResult?.overflowSeconds ?? 0) > TIME_BUDGET_TOLERANCE_SECONDS
    const overBudget = overBudgetNet
    let axisFallback = false
    let interactionScale: number | undefined
    let hadAxis = false
    // 锁定失衡次数（命座对比/锁窗测试）= 用户明确意图「操作够就能打 N 次失衡」，同锁定不回填口径：
    // 退化/降配会改变次数与交互结构，锁窗场景一律不触发（超时如实上报）。
    if (lockedStunCount < 0) {
      // 非法补齐（自动填充交互 > 200s，用户口径 2026-09-01）与超预算同等对待：
      // 轴要的资源根本填不出来 ⇒ 轴不可操作 ⇒ 走同一条退化路径（补齐次数已在源头清零）
      const topUpIllegal = (x: CalcRoundResult) => x.interactionTopUp?.illegal === true
      // 轴太厚判据按「计划 + 待装补齐」算（见 pendingTopUpSeconds 注释）
      if ((overBudget(r) || topUpIllegal(r.out)) && r.out.resolvedAxes?.length) {
        hadAxis = true
        const noAxis = runOuterLoop(true)
        if (!overBudget(noAxis) && !topUpIllegal(noAxis.out)) axisFallback = true
        r = noAxis // 可行与否都进入非轴态：不可行则走下方降配
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
      // @fact engine:降配搜索/手动锁定交互 口径: `ResourceCalcConfig.interactionsLocked === true`（配装页「手动锁定交互」勾选）= 用户在交互栏填的次数是**用户明确意图** ⇒ 非轴降配整块不执行（`downscaleAllowed` 闸门），`interactionScale` 保持 `undefined`，装不下时由 `overflowSeconds`/`truncationCuts` 如实上报截断；缺省 false ⇒ 本条路径逐位不变（全库预设 ×6 场景 zd DIFF 0）。同款先例 = 锁失衡次数（`lockedStunCount < 0`）。**不新增「先提高合轴率」的调用**——合轴吸收（G5）本就在 `core/resource/helpers.ts#iterate` 内、降配之前生效，锁定后自然先跑（实测 ratio 0→缺省→1 截断 93.69→93.61→31.23s）| 据 用户@2026-10-06 | 验 src/composables/__tests__/interactionsLocked.test.ts | 锚 src/composables/resourceCalc/solveTeam.ts#stageResolveFeasibility | 信 确认
      // ⟳复核: 若降配触发臂（`overBudget`/`truncatedToo`）或合轴吸收在 `iterate` 内的**先后顺序**再动，须重对「锁定态下合轴先跑」与「缺省路径逐位不变」（interactionsLocked.test.ts ①②③ + zd.sh）| 到期 2027-01-31
      const downscaleAllowed = resourceConfig.interactionsLocked !== true
      if (downscaleAllowed && (overBudget(r) || truncatedToo(r.out)) && !r.out.resolvedAxes?.length) {
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
        const baseTruncation = r.out.resourceResult?.overflowSeconds ?? 0
        const acceptsTrial = (x: RoundOut): boolean => downscaleTrialAccepted({
          trialNet: netOf(x),
          trialTruncation: x.out.resourceResult?.overflowSeconds ?? 0,
          baseNet,
          baseTruncation,
          stunEffTime,
          toleranceSeconds: TIME_BUDGET_TOLERANCE_SECONDS,
        })
        const candidates = DOWNSCALE_SCALES
        const best = selectDownscaleScale(candidates, scale => {
          const trial = runOuterLoop(true, scale)
          const trialTruncation = trial.out.resourceResult?.overflowSeconds ?? 0
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
    return { r, axisFallback, interactionScale }
  }

  const { r: rAfterFeasibility, axisFallback, interactionScale } = stageResolveFeasibility(r)
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
            outerCyclePickedEarlier: outerCyclePickedEarlier || undefined,
          },
        },
      }
    : baseOut
  return { out }
}
