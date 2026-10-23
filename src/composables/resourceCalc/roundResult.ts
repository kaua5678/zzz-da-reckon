import type { AnomalyPoolResult, StunAxis, TeamResourceResult, StunPoolResult, InStunAnomalySummary, SpecialActionBonusResult } from '@/types/resource'
import type { InteractionTopUp } from '@/mechanics/types'
import type { ParrySplitResult } from '@/core/parrySplit'
import type { BossAnomalyStateResult } from '@/core/stunAxis/inStunAnomaly'
import type { CalcRoundThreads } from './roundThreads'
import type { StackTraversalResult } from '@/core/stunAxisStack'

/** 单轮计算输出：下游 computed 消费的 13 字段 + 下一轮收敛线程 */
export interface CalcRoundResult {
    resourceResult: TeamResourceResult
    /** CC-421：恒非 null（来源 `promoteFixpoint().pool`；空失衡贡献 ⇒ stunCount 0 的合法池，见 CC-417） */
    stunPool: StunPoolResult
    /** CC-423：恒非 null（calcAnomalyPoolInput 对空 execs 返回合法空池） */
    anomalyPool: AnomalyPoolResult
    /** CC-422：恒非 null（= applyChainGift(applyUltimatePromote(rr))，两者对非 null 入参恒返回非 null） */
    adjustedResourceResult: TeamResourceResult
    promote: number
    /** 琉音好评转大 60 档（吃连携窗口）收敛终值（90 档 = promote − promoteHug60）。纯展示载荷，零求值影响。 */
    promoteHug60: number
    stunCoverage: number
    /**
     * 本轮**决算截断损失秒**（佩洛伊斯右分支：决算做完即清空窗口剩余失衡时间）。
     *
     * 为什么必须暴露（期 3 前置 / C 项，2026-10-20）：`stunCoverage` 的算式是
     * `clamp((stunCount × W − lost) / effTime)`，而 `stunCount` 在**本轮内**是未钳的池值；
     * `solveTeam` 的 CC-150 会在 cycle 停点把池钳到读入 K —— 那时若不同步重算覆盖率，
     * 同一份结果里「池 5 窗 / 覆盖率隐含 7 窗」就是两个物理量（实测 3 支队）。
     * 钳后重算需要这个损失秒，故提到返回面上。
     */
    stunVerdictLostSeconds: number
    resolvedAxes: StunAxis[]
    matchedPlanName: string | null
    /** 下一轮补齐量（= threadsNext.interactionTopUp）。展示请读 `threadsApplied.interactionTopUp`（CC-296/297）。 */
    interactionTopUp: InteractionTopUp
    /** 按本轮池反推的下一轮弹刀分配（= threadsNext.parrySplit）。展示请读 `threadsApplied.parrySplit`（CC-297）。 */
    parrySplit: ParrySplitResult
    /** 本轮实际用于喧响的特殊动作奖励（calcSpecialActionBonus 整份，含每槽次数）。CC-227：展示直读，不再在 useResourceCalc 另拼一份 */
    specialActionBonus: SpecialActionBonusResult
    // ⚠ 2026-10-23：`decibelGuarantee`（保底4喧响决策载荷）已随功能整体删除
    // （用户裁决「这个保底是余孽，不要再用了」）；原先在这里的字段注释一并删除。
    inStunAnomalyState: InStunAnomalySummary | null
    bossAnomalyState: BossAnomalyStateResult | null
    threadsNext: CalcRoundThreads
    /**
     * 本轮**输入**线程（已装入本轮计划的轮间量）。CC-297（取代 CC-296 的单字段 `interactionTopUpApplied`）：
     * 反馈线程的「本轮已装」与「下一轮算出」只在 stable 停点相等；外层落在环成员 / maxIter 时两者不等，
     * 而资源卡、stunCount、伤害都是按**已装**量算的 ⇒ 描述「这份计划」的展示一律读这里，不读 `*Next` 量。
     * 同 `interactionTopUp` / `parrySplit` 读 prev 的口径。纯展示载荷，零求值影响（runCalcRound 不改写 threads）。
     */
    threadsApplied: CalcRoundThreads
    /**
     * 本轮轴内**实际执行集合**（convergence `axisExecutedStack`；非轴 = null）。CC-299：
     * 它是 cfg.axisActionCounts / axisUltimateTotal 的唯一来源（CC-298 起按计数通道分窗），
     * 伤害侧轴内易伤分配（axisAllocation / attachedInAxisMap）与失衡轴页展示直接读它，不再在 useResourceCalc 另跑一遍栈。
     * 资源门控入参 = 本轮已装的上一轮闪能 / 单调喧响线程（同 threadsApplied 口径）。
     */
    axisStack: StackTraversalResult | null
    /**
     * CC-302：本轮是否**真的**按轴注入（convergence 局部 `axisActive`：轴开关 / 自动部署命中、生效轴非空、非 forceNoAxis 退化）。
     * 伤害池 / 轴窗口 overlay / 行级 stunOverride 的 `isAxis` 唯一来源——原先由展示用的 `stunAxisResult`（calcStunAxis 结果）
     * 真假值兼任，伤害池因此依赖一份纯展示计算；且与引擎是否注入轴块不同源。
     */
    axisActive: boolean
    /**
     * CC-303：Boss 弹刀反推（失衡次数四舍五入）本轮是否生效 + 击破位槽位（无 stun 特性槽位时回落 0 = 主C 承担）。
     * 交互栏 `parrySplitResult` 的门控与槽位唯一来源——原先 useResourceCalc 逐字复制了一份
     * 「parryTotal 三项 > 0 且失衡次数四舍五入勾选且（有击破位或队伍非空）」与「首个 stun 特性槽位」规则。
     */
    parrySplitGate: { active: boolean; breakerSlot: number }
  }
