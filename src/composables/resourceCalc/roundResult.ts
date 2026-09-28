import type { AnomalyPoolResult, StunAxis, TeamResourceResult, StunPoolResult, InStunAnomalySummary, SpecialActionBonusResult } from '@/types/resource'
import type { InteractionTopUp } from '@/mechanics/types'
import type { ParrySplitResult } from '@/core/parrySplit'
import type { BossAnomalyStateResult } from '@/core/stunAxis/inStunAnomaly'
import type { CalcRoundThreads } from './roundThreads'

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
    interactionTopUp: InteractionTopUp
    parrySplit: ParrySplitResult
    /** 本轮实际用于喧响的特殊动作奖励（calcSpecialActionBonus 整份，含每槽次数）。CC-227：展示直读，不再在 useResourceCalc 另拼一份 */
    specialActionBonus: SpecialActionBonusResult
    inStunAnomalyState: InStunAnomalySummary | null
    bossAnomalyState: BossAnomalyStateResult | null
    threadsNext: CalcRoundThreads
  }
