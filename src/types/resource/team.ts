/**
 * ZZZ 资源池计算 · 类型定义（按域拆分自原 `src/types/resource.ts`，2026-09-11）
 *
 * 域：队伍资源汇总（TeamResourceResult 及其派生）
 * 消费方一律经 `@/types/resource`（barrel = ./index.ts）引用，勿深链本目录内部文件。
 */

import type { CharacterResourceResult } from './agentResources'
import type { TruncationCut } from './execution'

// ============ 队伍资源汇总 ============

/**
 * 收敛诊断（一次计算里三层不动点各自的落地情况）。
 *
 * 背景：本引擎有三层嵌套不动点——
 *   ① `iterate` 内层（能量→强特→喧响→终结→时间，判据 = 强特/终结次数整数相等）
 *   ② `calcTeamResources` 时间预算外层（Σ执行行前台时间 ≤ 战斗时间，只折正 excess）
 *   ③ `useResourceCalc.runCalcRound` 失衡外层（失衡次数 ↔ 资源池 ↔ 转大 ↔ 异常喧响奖励）
 * 但原先只有 ① 上报 `converged`，② 与 ③ 耗尽迭代上限时**静默接受末轮结果**：既无告警也无残差，
 * 测试也断言不到 —— 建模错误（例如某模块 estimateExSpecialTime 系统性高估）会被悄悄吞掉。
 * 本结构把三层的收敛状态与残差一起抬到结果对象上，让「没收敛」变成可观测、可断言的事实。
 *
 * @fact engine:收敛读数归属 口径: 本结构五个字段全部同源于**被接受的那次** `calcTeamResources` 调用；一次预设求值会跑 N 次（外层不动点轮 + 非轴对照 + 降配二分 6×2 + 下游重算，实测 billy-roxy-lucia 18 次 / auto-1591-1161-1211 6 次），逐 pass 打表不按调用分组会把可行试探的末轮（残差 0.000）误读成被接受管线的末轮 | 据 实测@2026-09-10 尾巴专项（PROBE_TRACE_FOLD + PROBE_CONV_TEAM） | 验 src/composables/__tests__/convergenceProbe.test.ts | 锚 src/types/resource/team.ts#ConvergenceReport | 信 确认
 */
export interface ConvergenceReport {
  /** 时间预算外层：是否在上限内收敛（Σ执行行前台时间 ≤ 战斗时间） */
  timeBudgetConverged: boolean
  /** 时间预算外层实际跑的轮数 */
  timeBudgetPasses: number
  /** 退出时仍未消化的最大正溢出（秒）；0 = 完全收敛 */
  timeBudgetResidualSeconds: number
  /**
   * 退出时的最大「负溢出」（秒）：执行行前台时间比战斗时间**少**的量。
   * 按设计不折回（折回会让 necessaryTime 变负、平A池膨胀），但持续偏大意味着
   * `estimateExSpecialTime` 系统性高估必要时间 —— 单侧钳制会掩盖这类建模错误，故单独上报。
   */
  timeBudgetIdleSeconds: number
  /**
   * 欠打回填总量（秒，团队级）：账本高估挤占的平A池经 timeBudgetRefund 回填的量。
   * 0 = 账本与物化行自洽；偏大 = 某模块 estimate 高估（同 timeBudgetIdleSeconds 的诊断语义）。
   */
  timeBudgetRefundedSeconds?: number
  /**
   * 时间线截断总量（秒）：装配阶段按「本槽可用前台」砍掉的执行行时间（含被等比缩的边界行）。
   * >0 = 资源允许的动作量装不进战斗时间，多余资源没兑现成动作（实战 180s 结算口径）。
   * 与 overflowSeconds 同值口径，单独上报便于与"账本超预算"区分。
   */
  timeTruncatedSeconds?: number
  /**
   * 各槽装配期截断的秒数账：`requested` = 截断前该槽招式行秒数、`kept` = 180s 里真保住的、
   * `cutSeconds` = 砍掉。**`kept / requested` = 该槽招式的存活率**，难度轴（`liveInteractions`）
   * 用它把交互次数缩到「180s 里真打的次数」——用户 2026-09-11 口径：「不上升合轴率导致招式截断，
   * 那么对应的资源回复也应该降低，或者交互次数应该降低」。
   */
  truncationBySlot?: { slot: number; requested: number; kept: number; cutSeconds: number }[]
  /**
   * 失衡外层不动点（runCalcRound 环）是否真收敛。
   * 由编排层回填；`calcTeamResources` 单独调用时保持 false（它看不到外层）。
   */
  outerConverged?: boolean
  /** 失衡外层实际跑的轮数 */
  outerRounds?: number
  /**
   * 失衡外层的退出方式：
   * - `stable`：反馈量全稳定（真收敛）；
   * - `cycle`：检测到离散 2-循环（如失衡次数 5→4→5）后主动停 —— 离散场景的正确兜底，不是失败，
   *   但结果取的是循环中的一支，需与真收敛区分（**只指外层**：`stunPoolResult.stunCount` 自
   *   2026-09-08 起由非轴连续不动点闭式给出，与迭代入口/热启动历史无关，见 ENGINE_PIPELINE_GUIDE 坑 25）；
   * - `maxIter`：耗尽迭代上限（**可疑**：反馈量仍在变，结果可能停在错误值）。
   */
  outerExit?: 'stable' | 'cycle' | 'maxIter'
  /**
   * 轴退化（用户口径 2026-08）：轴的资源需求（轴内块/自动补齐交互 × 窗口数）超出战斗时间预算
   * → 收敛后 Σ物化前台行仍 > 战斗时间 → 该轴不可操作（需 boss 秽盾等外界环境才打得成）
   * → 编排层自动弃用轴注入（退化为一般轴）重算。true = 本结果是无轴的一般循环，
   * 轴定义仍可从 UI 查看；false/undefined = 未触发退化（含本来就无轴）。
   */
  axisFallback?: boolean
  /**
   * 非轴降配（用户口径 2026-08-30）：无轴态前台净占用仍超预算时，用户交互次数
   * （招架/金身/双反/闪反）按该比例缩放（round）直到回到预算内；boss 强制弹刀不缩放。
   * undefined = 未降配；0 = 交互全砍仍超（如实保留超时结果）。与 axisFallback 可同时为 true
   * （轴退化后配置本身仍超预算）。
   */
  interactionScale?: number
}

/** 队伍资源池计算结果 */
export interface TeamResourceResult {
  /** 总时间（秒，默认180） */
  totalTime: number
  /**
   * **计划/输入**失衡次数（= 外层不动点喂进本轮资源环的那个值），**不是**失衡池算出的答案。
   * 真答案在 `StunPoolResult.stunCount`（= floor(有效总失衡值 ÷ boss失衡值)）。
   * 旧名 `stunCount` 且注释写着池子的公式，读错账本零报错——2026-09-07 实测同一低金归档部署
   * 本字段 1.27 vs 池真值 4.00，据此得出的"引擎失衡偏低"结论整条作废。
   */
  plannedStunCount: number
  /** 3个角色的资源结果 */
  characters: CharacterResourceResult[]
  /** 迭代次数（内层 iterate） */
  iterations: number
  /** 是否达到收敛（内层 iterate：强特/终结次数稳定） */
  converged: boolean
  /** 三层不动点的收敛诊断（见 ConvergenceReport） */
  convergence: ConvergenceReport
  /**
   * 轴内合轴节省（秒，团队级）：失衡窗口内跨角色块并行（如般岳强特时琉音抱拳）只计一次前台，
   * 节省 = 轴内块时长和 − 块区间并集（栈引擎 overlapSeconds）。**前台净占用口径**：
   * Σ物化前台行 totalTime − 本值 = 时间轴净占用（iterate 平A池吃进、折叠循环/队伍对比超时判定按净占用）。
   * 非轴模式 / 无并行块 = 0。
   */
  axisOverlapSeconds?: number
  /** 合轴节省按块分摊（`${slot}:${moveId}` → 秒）：单角色行级扣减用，Σ 值 = axisOverlapSeconds */
  axisOverlapByAction?: Record<string, number>
  /**
   * 时间线溢出＝**被截断掉的秒数**（合轴抵扣后，轴模式抵扣与栈引擎节省取 max）：资源允许的
   * 动作量超出「战斗时间 − 无敌」的部分。装配阶段按可用前台截断执行计划（实战 180s 直接结算，
   * 不管这一轮/这套连段打没打完 ⇒ 截断后净占用恒 ≤ 预算，见 truncateExecutionsToFrontline），
   * 本字段就是"为了塞进 180s 砍掉了多少"。已并入 TeamComparePage 操作难度横轴
   * （1 秒 = 1 难度点，用户口径 2026-09-04；截断口径 2026-09-05）。
   */
  overflowSeconds?: number
  /**
   * 装配期被截断的招式**逐行明细**（Σ `cutSeconds` == `overflowSeconds`）：资源池「被砍招式」清单、
   * 难度轴交互缩放的同一份输入（见 `TruncationCut`）。无截断时不带本字段。
   */
  truncationCuts?: TruncationCut[]
  /**
   * 琉音好评转大赠链时间预留量（非轴模式，秒）：iterate 已把 promote × 目标终结技时长计入
   * 必要时间（守恒由引擎成立）→ applyLiuyinPromote 见到本字段即**跳过 post-hoc carve**
   * （旧 carve 只抠 basic_attack 聚合行，目标平A时间在分段行里时会落空 → 守恒破 +7.2s）。
   * 轴模式无预留（轴内 60/90 转大次数由轴预设决定），字段缺省。
   */
  liuyinGiftTimeReserved?: number
  /**
   * 诺姆膛温换连携赠链时间预留量（秒）：与 `liuyinGiftTimeReserved` 对称——iterate 必要时间与
   * 装配截断上限都按同一 `normaGiftChainInfo` 计入（单一事实源），本字段只**对外暴露该值**
   * 供机器判据核对「账本预留 == 装配赠行」（`giftMoveTimeLedger.test.ts`）。
   */
  normaGiftTimeReserved?: number
}
