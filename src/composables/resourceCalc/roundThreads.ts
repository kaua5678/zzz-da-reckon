/**
 * 外层不动点「收敛线程」：runCalcRound 相邻轮之间传递的反馈量集合。
 *
 * 历史形态：runCalcRound 挂 21 个 prev* 位置参数 + 19 个同名字段返回，每加一个跨轮反馈
 * （如薇薇安双源、普罗米娅触发命中）就要在签名/调用点/返回体三处同步加一行——漏一处即
 * 静默断链。结构体化后：新增反馈 = CalcRoundThreads 加一个字段 + 初值 + 轮内读写（**模块下一轮反馈**例外：CC-31 起走 `moduleFeedback` 字典，键加在 `mechanics/types.ts` 的 `ModuleFeedback`，编排层零改动；CC-314 起字典整体入外层签名，收敛判据也不用改）。
 * ⚠ 反馈签名的显式投影单源 = outerCycle.ts#outerFeedbackSignature；玄墨次数的自由失衡
 * 判稳仍在 runOuterLoop。这不是对整份结构体自动比对：新增会独立变化的线程时，必须
 * 同步评估终止判据并补真实管线测试。“字段传到了下一轮”不代表求解器会等到它稳定。
 *
 * 语义约定（与旧位置参数版逐字段等价）：
 * - 轮内持久（null 轮不清零）：goodReview / energyBySlot / interactionTopUp / parrySplit / decibelParry / decibelParryBasisShort
 *   —— 它们的下一轮值在 runCalcRound 内部已由 prev 兜底（如 interactionTopUpNext 初值 = prev.interactionTopUp）。
 * - 其余字段：null 轮（runCalcRound 返回 null，如无失衡行队伍）重置为初值。
 */
import type { ModuleFeedback } from '@/mechanics/types'
import type { InteractionTopUp } from '@/mechanics/types'
import type { ParrySplitResult } from '@/core/parrySplit'

/** CC-194：postRound 相位的次数类入参（下一轮派发用）；下标与 `characters` 同序 */
export interface PostRoundInput {
  exCounts: number[]
  ultimateCounts: number[]
  // CC-316：不再记录失衡次数——postRound 派发直接读本轮 countStun（原先的上一轮值滞后一拍）
}

export interface CalcRoundThreads {
  /** 琉音好评总量（条件轴解析输入；-1 = 无琉音） */
  goodReview: number
  /** 各槽位能量总额（条件轴解析输入） */
  energyBySlot: Record<number, number>
  /** 异常/紊乱/乱流喧响奖励（按槽位，上一轮异常池回填） */
  anomalyDecibelBonus: number[]
  /** 般岳轴模式自动补齐（弹刀/双反） */
  interactionTopUp: InteractionTopUp
  /** Boss 预设弹刀反推拆分（保底4失衡） */
  parrySplit: ParrySplitResult | null
  /** 后台合轴自动填充（agentId → 自动对数）：由模块 backstageAutoFill 声明驱动，编排层通用反推 */
  backstageAuto: Record<string, number> | null
  /** 全队终结总次数（橘福福影画2 威势） */
  teamUltimateForJufufu: number
  /**
   * 各模块 `nextRoundFeedback` 的合并结果（CC-31：原 14 个角色具名字段收拢为字典，键定义见
   * `mechanics/types.ts#ModuleFeedback`）。**缺键 = 0**，读侧 `threads.moduleFeedback.<键> ?? 0`。
   */
  moduleFeedback: Readonly<ModuleFeedback>
  /** 失衡内异常系统 v2：平均每窗异常触发次数（南宫羽颤音自动层数） */
  inStunWindowTriggers: number
  /** 全队以太帷幕开启总次数（照霜寒开帷幕 + 爱芮/叶瞬光终结技 + 千夏强特；叶瞬光溯影惊鸿/爱芮合作舞台/千夏磨爪器消费） */
  teamVeilCountTotal: number
  /** 通用保底4喧响：弹刀补齐量（非般岳队伍） */
  decibelParry: number
  /**
   * 通用保底4喧响：使 `decibelParry` 取到当前值的那一轮的喧响缺口（恒有 decibelParry = ⌈basis / 215⌉）。
   * CC-229：只在 decibelParry 增大时随之更新 ⇒ 是 decibelParry 的从属量、不独立变化，
   * 故不必进 outerCycle#outerFeedbackSignature（decibelParry 已在其中）。供 TeamConfigPage「诚实显示」直读。
   */
  decibelParryBasisShort: number
  /** 时间轴喧响轨：各槽上一轮收敛的喧响产出（slot → 点；首轮空对象 = 轨未启动） */
  decibelRegenBySlot: Record<number, number>
  /**
   * CC-194：上一轮收敛的 `applyTeamConfig({phase:'postRound'})` 输入（全队强特/终结次数；失衡次数自 CC-316 起由派发处取本轮 countStun）。
   * 本轮在 converge 之前用它对**本轮新克隆的 cfg** 派发 postRound。旧实现在本轮末尾对本轮克隆派发，
   * 而下一轮会从 `base.characters` 重新克隆，写入全部丢失（扳机冥狱恒 0、千夏自身次数、安比影画4 回能）。
   * null = 首轮 / null 轮（不派发，与旧首轮行为一致）。
   */
  postRoundInput: PostRoundInput | null
  /** 上一轮失衡池整数次数（坑36：轴内块数落地与池同源——0 命轴决算次数 = 轴认领块 × 池窗口数） */
  prevPoolStunCount?: number
}

export function initialCalcRoundThreads(): CalcRoundThreads {
  return {
    goodReview: -1,
    energyBySlot: {},
    anomalyDecibelBonus: [],
    interactionTopUp: { parry: 0, dual: 0, requiredSeconds: 0, illegal: false },
    parrySplit: null,
    backstageAuto: null,
    teamUltimateForJufufu: 0,
    moduleFeedback: {},
    inStunWindowTriggers: 0,
    teamVeilCountTotal: 0,
    decibelParry: 0,
    decibelParryBasisShort: 0,
    decibelRegenBySlot: {},
    prevPoolStunCount: undefined,
    postRoundInput: null,
  }
}

/**
 * null 轮（runCalcRound 返回 null）的线程回退：持久组保留，其余重置初值。
 * 与旧版 calcOutput 里 `?? prev` / `?? 0` 混合更新规则逐字段等价。
 */
export function threadsAfterNullRound(prev: CalcRoundThreads): CalcRoundThreads {
  return {
    ...initialCalcRoundThreads(),
    goodReview: prev.goodReview,
    energyBySlot: prev.energyBySlot,
    interactionTopUp: prev.interactionTopUp,
    parrySplit: prev.parrySplit,
    backstageAuto: prev.backstageAuto,
    decibelParry: prev.decibelParry,
    decibelParryBasisShort: prev.decibelParryBasisShort,
  }
}
