import type { AnomalyPoolResult, StunAxis, TeamResourceResult, StunPoolResult, InStunAnomalySummary, SpecialActionBonusResult } from '@/types/resource'
import type { InteractionTopUp } from '@/mechanics/types'
import type { ParrySplitResult } from '@/core/parrySplit'
import type { BossAnomalyStateResult } from '@/core/stunAxis/inStunAnomaly'
import type { CalcRoundThreads } from './roundThreads'
import type { StackTraversalResult } from '@/core/stunAxisStack'

/** 单轮计算输出：下游 computed 消费的 13 字段 + 下一轮收敛线程 */
export interface CalcRoundResult {
    resourceResult: TeamResourceResult
    stunPool: StunPoolResult | null
    anomalyPool: AnomalyPoolResult | null
    adjustedResourceResult: TeamResourceResult | null
    promote: number
    /** 琉音好评转大 60 档（吃连携窗口）收敛终值（90 档 = promote − promoteHug60）。纯展示载荷，零求值影响。 */
    promoteHug60: number
    stunCoverage: number
    resolvedAxes: StunAxis[]
    matchedPlanName: string | null
    /** 下一轮补齐量（= threadsNext.interactionTopUp）。展示请读 `threadsApplied.interactionTopUp`（CC-296/297）。 */
    interactionTopUp: InteractionTopUp
    /** 按本轮池反推的下一轮弹刀分配（= threadsNext.parrySplit）。展示请读 `threadsApplied.parrySplit`（CC-297）。 */
    parrySplit: ParrySplitResult
    /** 本轮实际用于喧响的特殊动作奖励（calcSpecialActionBonus 整份，含每槽次数）。CC-227：展示直读，不再在 useResourceCalc 另拼一份 */
    specialActionBonus: SpecialActionBonusResult
    /**
     * 通用保底4喧响的本轮决策（CC-229，TeamConfigPage 提示直读；此前页面用收敛后的主C喧响重算缺口 = 补后剩余缺口，与引擎决策不同）。
     * active=false ⇒ 未勾选或本队由补齐角色（挂出 computeInteractionTopUp 者，如般岳）负责，通用口径不生效。
     */
    decibelGuarantee: {
      active: boolean
      /** 本轮结果里实际注入主C 的「只给喧响」弹刀次数 */
      parry: number
      /** 决策缺口：使 parry 取到当前值的那一轮的缺口（parry = ⌈basisShort / perParry⌉） */
      basisShort: number
      /** 本轮结果（已含注入）上的剩余缺口 */
      residualShort: number
      /** 剩余缺口 ≤ 1500（可补档） */
      roundable: boolean
      /** 单次弹刀个人喧响（PARRY_DECIBEL_BONUS） */
      perParry: number
    }
    inStunAnomalyState: InStunAnomalySummary | null
    bossAnomalyState: BossAnomalyStateResult | null
    threadsNext: CalcRoundThreads
    /**
     * 本轮**输入**线程（已装入本轮计划的轮间量）。CC-297（取代 CC-296 的单字段 `interactionTopUpApplied`）：
     * 反馈线程的「本轮已装」与「下一轮算出」只在 stable 停点相等；外层落在环成员 / maxIter 时两者不等，
     * 而资源卡、stunCount、伤害都是按**已装**量算的 ⇒ 描述「这份计划」的展示一律读这里，不读 `*Next` 量。
     * 同 `decibelGuarantee.parry` 读 prev 的口径。纯展示载荷，零求值影响（runCalcRound 不改写 threads）。
     */
    threadsApplied: CalcRoundThreads
    /**
     * 本轮轴内**实际执行集合**（convergence `axisExecutedStack`；非轴 = null）。CC-299：
     * 它是 cfg.axisActionCounts / axisUltimateTotal 的唯一来源（CC-298 起按计数通道分窗），
     * 伤害侧轴内易伤分配（axisAllocation / attachedInAxisMap）与失衡轴页展示直接读它，不再在 useResourceCalc 另跑一遍栈。
     * 资源门控入参 = 本轮已装的上一轮闪能 / 单调喧响线程（同 threadsApplied 口径）。
     */
    axisStack: StackTraversalResult | null
  }
