/**
 * 「A 配置打了 x 分，换成 B 配置的伤害，其他都不变，会打多少分」——副词条 A/B 对比卡里的分数换算。
 *
 * 用户口径（2026-10-27）：「副词条对比页面可以比较 AB 两个装备的伤害。我想再加一个显示，根据伤害之比，
 * 填写普通还是绝境（血量曲线不同），再填写其中一个伤害 A 或者 B 的分数，可以算出另一个配置的分数。
 * 让用户知道，如果你是 A 配置打了 x 分，换成 b 配置的伤害，其他都不变，你会打多少分。」
 *
 * ## 为什么不能「分数 × 伤害比」
 * 伤害分曲线是**分段线性**的（`data/deadlyAssaultScore.ts#SCORE_CURVES`）：普通 17–14 管最划算（960 分/管）、
 * 9–7 管最亏（520 分/管）。同一份「伤害 +10%」落在不同血段换到的分数完全不同，
 * 所以必须走 **反解 A 的血量比例 → × 伤害之比 → 正算回分数**（`scoreForDamageRatioOfRatio`）。
 * 实测反例（判据里钉住）：36000 分 + 10% 伤害 = 38205 分，不是 39600。
 *
 * ## 两个口径都如实转
 * - **难度**：普通（defense）/ 绝境（critical_assault）——两条曲线血总量不同（87.4 vs 158 管），斜率也不同；
 * - **伤害口径**：全队 / 该角色自身（取 A/B 对比同一口径的伤害之比，锁失衡次数那一份，不含「多打一次失衡」的离散跳变）。
 *
 * ## 操作分
 * 危局单房 65000 = 伤害分 60000 + 操作分 5000。分数换算只作用在伤害分上；
 * 操作分按「其他都不变」**原样加回**（不随配装缩放的近似：打得快会改变操作分，这里不臆测）。
 *
 * @fact engine:deadlyAssaultScore/配置换算 口径: 「A 打 x 分换成 B 的伤害能打多少」= 反解 A 的伤害/血量比例 → × 伤害之比（B/A 或 A/B，锁失衡口径）→ 正算回伤害分；操作分原样加回、不参与曲线；非线性曲线禁止「分数 × 伤害比」 | 据 用户@2026-10-27 | 验 src/composables/__tests__/substatScoreConvert.test.ts | 锚 src/composables/substatScoreConvert.ts#buildScoreConversion | 信 确认
 * ⟳复核: 危局分数曲线（data/deadlyAssaultScore.ts#SCORE_CURVES）改动或新增档位时，复算本模块的换算样例并同步判据里的实测数字 | 到期 2027-02-28
 */
import {
  DEADLY_ASSAULT_SCORE_CAP,
  damageRatioForScore,
  scoreForDamageRatioOfRatio,
  type DeadlyAssaultMode,
} from '@/data/deadlyAssaultScore'

/** 伤害口径：全队总伤 / 该角色自身伤害（与 `compareDiscPlans` 的两个读数一一对应） */
export type ScoreReadout = 'team' | 'own'

/** 已知分数的是哪一套配置（另一套就是要算的那套） */
export type ScoreSide = 'a' | 'b'

/** 操作分上限（危局单房 65000 = 伤害分 60000 + 操作分 5000） */
export const OPERATION_SCORE_CAP = 5000

export const SCORE_SIDE_LABEL: Readonly<Record<ScoreSide, string>> = { a: 'A', b: 'B' }

export interface ScoreConversionInput {
  mode: DeadlyAssaultMode
  /** 已知分数的那一套 */
  knownSide: ScoreSide
  /** 已知配置的分数（含操作分）；`null` = 还没填 */
  score: number | null
  /** 操作分（0~5000，默认 0）：原样加回，不参与曲线换算 */
  operationScore?: number
  /** A / B 的伤害读数（调用方按同一个口径取：全队 或 该角色自身） */
  aDamage: number
  bDamage: number
}

export interface ScoreConversionResult {
  mode: DeadlyAssaultMode
  /** 已知 / 待算 的配置名（A / B） */
  fromLabel: string
  toLabel: string
  /** 待算配置 ÷ 已知配置 的伤害之比 */
  damageRatio: number
  /** 已知配置的伤害（readout 口径下的绝对值，仅用于展示） */
  knownDamage: number
  targetDamage: number
  /** 反解出的「伤害/血量」比例（0~1） */
  ratioFrom: number
  ratioTo: number
  /** 分数拆成「伤害分 + 操作分」两段 */
  damageScoreFrom: number
  damageScoreTo: number
  operationScore: number
  /** 最终分数（伤害分 + 操作分） */
  scoreFrom: number
  scoreTo: number
  /** scoreTo − scoreFrom */
  delta: number
  /** true = 换算后的血量比例被曲线端点钳住（打死了 / 0），比例不再线性可信 */
  clamped: boolean
}

/** 操作分钳到 [0, 5000]；非法值按 0 */
export function clampOperationScore(v: number | null | undefined): number {
  if (v == null || !Number.isFinite(v)) return 0
  return Math.min(OPERATION_SCORE_CAP, Math.max(0, v))
}

/**
 * 用户看到的**总分** → 真正进曲线的那一段（伤害分）+ 操作分。
 *
 * 用户口径（2026-10-28）：「操作分默认 5000，让用户少填一次。最好加个总分框，用户看到的分数就是总分，
 * 他来填总分我们默认操作分 5000（也能改），然后 −5000 自动算出伤害分，再进行下面的换算。」
 *
 * 钳制：操作分先钳到 [0, 5000]；伤害分钳到 [0, 60000]（总分比操作分低 ⇒ 伤害分 0，不产生负数）。
 */
export function splitTotalScore(
  total: number | null | undefined,
  operationScore: number | null | undefined,
): { damageScore: number; operationScore: number } {
  const op = clampOperationScore(operationScore)
  if (total == null || !Number.isFinite(total)) return { damageScore: 0, operationScore: op }
  const damageScore = Math.min(DEADLY_ASSAULT_SCORE_CAP, Math.max(0, total - op))
  return { damageScore, operationScore: op }
}

/**
 * 分数换算主函数。返回 `null` 的情形（展示层据此提示，不编数）：
 * 没填分数、A/B 伤害有一边 ≤ 0、分数非有限数。
 */
export function buildScoreConversion(input: ScoreConversionInput): ScoreConversionResult | null {
  const { mode, knownSide, score, aDamage, bDamage } = input
  if (score == null || !Number.isFinite(score)) return null
  const knownDamage = knownSide === 'a' ? aDamage : bDamage
  const targetDamage = knownSide === 'a' ? bDamage : aDamage
  if (!(knownDamage > 0) || !(targetDamage > 0)) return null

  // 曲线只吃伤害分：先从总分里剥掉操作分（同一份钳制逻辑，见 splitTotalScore），换算完再加回去
  const { damageScore: damageScoreFrom, operationScore } = splitTotalScore(score, input.operationScore)
  const ratioFrom = damageRatioForScore(damageScoreFrom, mode)
  const damageRatio = targetDamage / knownDamage
  const conv = scoreForDamageRatioOfRatio(damageScoreFrom, damageRatio, mode)
  const damageScoreTo = conv.score
  const scoreTo = damageScoreTo + operationScore
  return {
    mode,
    fromLabel: SCORE_SIDE_LABEL[knownSide],
    toLabel: SCORE_SIDE_LABEL[knownSide === 'a' ? 'b' : 'a'],
    damageRatio,
    knownDamage,
    targetDamage,
    ratioFrom,
    ratioTo: conv.ratioB,
    damageScoreFrom,
    damageScoreTo,
    operationScore,
    scoreFrom: damageScoreFrom + operationScore,
    scoreTo,
    delta: scoreTo - (damageScoreFrom + operationScore),
    clamped: conv.clamped,
  }
}

/** 两个伤害口径的中文标签（UI 单一来源，别在模板里手写） */
export const SCORE_READOUT_LABEL: Readonly<Record<ScoreReadout, string>> = {
  team: '全队伤害',
  own: '该角色自身伤害',
}
