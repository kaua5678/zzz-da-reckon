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
    /**
     * 本轮**已装入**计划的补齐量（= 本轮输入 threads.interactionTopUp；`interactionTopUp` 是算出的下一轮量）。
     * CC-296：展示读这个——两者只在收敛时相等；保底4喧响的补齐线程在外层按环内选点落在「装了 N、下一轮算 0」的
     * 成员上时，读下一轮量会让交互栏显示 0 而资源卡显示已装的 N。同 `decibelGuarantee.parry` 读 prev 的口径。纯展示载荷。
     */
    interactionTopUpApplied: InteractionTopUp
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
  }
