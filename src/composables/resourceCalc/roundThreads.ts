/**
 * 外层不动点「收敛线程」：runCalcRound 相邻轮之间传递的反馈量集合。
 *
 * 历史形态：runCalcRound 挂 21 个 prev* 位置参数 + 19 个同名字段返回，每加一个跨轮反馈
 * （如薇薇安双源、普罗米娅触发命中）就要在签名/调用点/返回体三处同步加一行——漏一处即
 * 静默断链。结构体化后：新增反馈 = CalcRoundThreads 加一个字段 + 初值 + 轮内读写。
 * ⚠ 收敛判据在 useResourceCalc.runOuterLoop 里**手写**（ultSeq/anomalySeq/topUpSeq/
 * parrySplitSeq/decibelParrySeq/auricInkFlash 六项），不是对整份结构体自动比对——新增线程
 * 字段若会独立震荡（如 lighterTeamEnergy / promia* 这类只影响伤害、不改变终结技/喧响序列
 * 的反馈），记得同步加进收敛判据，否则会提前判 stable（2026-08 曾试图整份指纹比对，
 * 校准 MAE 劣化 ~0.8% 后回退，见 runArchiveCalibration 棘轮）。
 *
 * 语义约定（与旧位置参数版逐字段等价）：
 * - 轮内持久（null 轮不清零）：goodReview / energyBySlot / banyueTopUp / parrySplit / decibelParry
 *   —— 它们的下一轮值在 runCalcRound 内部已由 prev 兜底（如 banyueTopUpNext 初值 = prev.banyueTopUp）。
 * - 其余字段：null 轮（runCalcRound 返回 null，如无失衡行队伍）重置为初值。
 */
import type { BanyueInteractionTopUp } from '@/mechanics/agents/banyue'
import type { ParrySplitResult } from '@/core/parrySplit'

export interface CalcRoundThreads {
  /** 琉音好评总量（条件轴解析输入；-1 = 无琉音） */
  goodReview: number
  /** 各槽位能量总额（条件轴解析输入） */
  energyBySlot: Record<number, number>
  /** 仪玄玄墨异常触发回闪能次数（10s CD 封顶 18） */
  auricInkFlash: number
  /** 异常/紊乱/乱流喧响奖励（按槽位，上一轮异常池回填） */
  anomalyDecibelBonus: number[]
  /** 般岳轴模式自动补齐（弹刀/双反） */
  banyueTopUp: BanyueInteractionTopUp
  /** Boss 预设弹刀反推拆分（保底4失衡） */
  parrySplit: ParrySplitResult | null
  /** 仪玄符法千重类终结次数（橘福福额外能力 +300 喧响） */
  yixuanFuFaForJufufu: number
  /** 全队终结总次数（橘福福影画2 威势） */
  teamUltimateForJufufu: number
  /** 琉音转大赠送的叶瞬光逐云次数 */
  yeshuguangGiftUlt: number
  /** 露西 C6 队友强特合计（C1 回能预估） */
  lucyTeammateEx: number
  /** 莱特后场：全队常态能量消耗（applyTeamConfig converge 输入） */
  lighterTeamEnergy: number
  /** 格莉丝影画1 全队回能轮换数 */
  graceC1Cycles: number
  /** 零号·安比：队友追加攻击命中折算白雷层数 */
  anbyZeroTeammateWl: number
  /** 薇薇安落羽生花源1：全队强特命中次数 */
  vivianTeamEx: number
  /** 薇薇安落羽生花源2：全队异常触发次数 */
  vivianAnomalyTriggers: number
  /** 普罗米娅·霜刑：触发命中数 */
  promiaTriggerHits: number
  /** 普罗米娅·霜刑：队友异放次数 */
  promiaTeammateReleases: number
  /** 普罗米娅自身异放回喧响（绝裁/影画6 各 +100） */
  promiaReleaseDecibel: number
  /** 失衡内异常系统 v2：平均每窗异常触发次数（南宫羽颤音自动层数） */
  inStunWindowTriggers: number
  /** 艾莲影画4 冻结次数（异常池 ice 触发数） */
  ellenFreezeCount: number
  /** 通用保底4喧响：弹刀补齐量（非般岳队伍） */
  decibelParry: number
  /** 时间轴喧响轨：各槽上一轮收敛的喧响产出（slot → 点；首轮空对象 = 轨未启动） */
  decibelRegenBySlot: Record<number, number>
  /** 时间轴喧响轨：上一轮失衡次数（与本轮相等才启用轨——防早期轮窗口失真螺旋） */
  trackStunCount?: number
}

export function initialCalcRoundThreads(): CalcRoundThreads {
  return {
    goodReview: -1,
    energyBySlot: {},
    auricInkFlash: 0,
    anomalyDecibelBonus: [],
    banyueTopUp: { parry: 0, dual: 0 },
    parrySplit: null,
    yixuanFuFaForJufufu: 0,
    teamUltimateForJufufu: 0,
    yeshuguangGiftUlt: 0,
    lucyTeammateEx: 0,
    lighterTeamEnergy: 0,
    graceC1Cycles: 0,
    anbyZeroTeammateWl: 0,
    vivianTeamEx: 0,
    vivianAnomalyTriggers: 0,
    promiaTriggerHits: 0,
    promiaTeammateReleases: 0,
    promiaReleaseDecibel: 0,
    inStunWindowTriggers: 0,
    ellenFreezeCount: 0,
    decibelParry: 0,
    decibelRegenBySlot: {},
    trackStunCount: undefined,
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
    banyueTopUp: prev.banyueTopUp,
    parrySplit: prev.parrySplit,
    decibelParry: prev.decibelParry,
  }
}
