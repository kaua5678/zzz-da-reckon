/**
 * Boss 预设弹刀拆分（用户口径 2026-08）：
 * 击破位弹刀 = 按「保底4失衡」反推（在击破位当前输入之上补足缺口），主C = 正常弹刀总数 − 击破位正常弹刀。
 *
 * 两类弹刀：
 * - 正常弹刀（parryTotal）：轻弹刀 + 支援突击 + 喧响 215，按保底4失衡反推拆分击破/主C；
 * - 不带支援突击的弹刀（parryNoFollowUpTotal）：只有轻弹刀倍率行 + 喧响 215、无支援突击行，
 *   boss 机制强制、非用户可调 → **全部归击破位**，其失衡值先从缺口里扣掉。
 *
 * 反推口径（防振荡）：
 * - 非弹刀失衡基数 = 全队有效失衡值 − 击破位弹刀行贡献（轻弹刀 + 支援突击，行 count 随弹刀次数缩放）；
 * - 击破位需补正常弹刀 T = ceil((达成保底所需总失衡值 − 非弹刀基数 − 无突击弹刀失衡) / 正常弹刀每次失衡)；
 * - 有效次数 = max(输入, T)（尊重用户输入，封顶 parryTotal）。
 * 因 T 只依赖非弹刀基数（与当前注入量无关），轮间单调收敛，不会 0↔T 振荡。
 *
 * 纯函数，输入 = 失衡池一轮结果 + 击破位每次弹刀的有效失衡值；输出 = 下一轮拆分。
 * 消费端：useResourceCalc 外层不动点线程（prevParrySplit，般岳轴自动补齐同款），
 * 数据源：boss-presets.json defaults.parryTotal / parryNoFollowUpTotal（叶释渊 13 / 司祭 15 等）。
 */

export interface ParrySplitInput {
  /** 保底失衡次数（UI「保底4失衡」= 4） */
  targetStunCount: number
  /** 当前轮失衡池收敛出的失衡次数（原始池计数，未做时间可行性截断） */
  stunCount: number
  /** 非弹刀失衡基数 = 失衡池 totalStunBuildUp − 击破位弹刀行贡献（消费端已剔除） */
  nonParryStun: number
  /** Boss 失衡条（一次失衡所需失衡值） */
  bossStunValue: number
  /** 失衡值返还比例（0~0.25，雨果决算；第 1 次失衡满额） */
  stunRefundRatio: number
  /** 正常弹刀每次的有效失衡（轻弹刀 + 支援突击 两行 perHitStun 之和）；≤0 = 无招架失衡来源 */
  perParryDaze: number
  /** 不带支援突击弹刀每次的有效失衡（仅轻弹刀 perHitStun） */
  perNoFollowUpDaze: number
  /** 正常弹刀总次数（叶释渊 13）；0 = 无正常弹刀 */
  parryTotal: number
  /** 不带支援突击弹刀总次数（司祭 15）；0 = 无该类型 */
  parryNoFollowUpTotal: number
  /** 击破位当前输入正常弹刀次数（尊重用户输入，只在其上补足） */
  breakerInput: number
  /** 主C 当前输入正常弹刀次数（>0 = 用户已手填，不覆盖） */
  mainDpsInput: number
}

export interface ParrySplitResult {
  /** 击破位正常弹刀 = clamp(max(输入, T), 0, parryTotal) */
  breakerParry: number
  /** 主C 正常弹刀：用户已填 >0 用用户值；否则 = max(0, parryTotal − breakerParry) */
  mainDpsParry: number
  /** 击破位不带支援突击弹刀 = parryNoFollowUpTotal（全部归击破位） */
  breakerNoFollowUp: number
  /** 主C 不带支援突击弹刀（恒 0） */
  mainDpsNoFollowUp: number
  /** 击破位正常弹刀反推补齐量（≥0，已按 parryTotal 封顶） */
  topUp: number
  /** 当前轮是否已达成保底失衡次数 */
  reached: boolean
  /** 击破位正常弹刀每次有效失衡（实测值，随线程携带：击破位 0 弹刀时无行、沿用上轮） */
  perParryDaze: number
  /** 击破位不带支援突击弹刀每次有效失衡（实测值，随线程携带） */
  perNoFollowUpDaze: number
}

export function computeParrySplit(input: ParrySplitInput): ParrySplitResult {
  const target = Math.max(1, Math.floor(input.targetStunCount) || 4)
  const bossStun = Math.max(0, input.bossStunValue)
  const refund = Math.min(1, Math.max(0, input.stunRefundRatio))
  const parryTotal = Math.max(0, Math.floor(input.parryTotal))
  const noFollowUpTotal = Math.max(0, Math.floor(input.parryNoFollowUpTotal))
  const breakerInput = Math.max(0, Math.floor(input.breakerInput))
  const mainDpsInput = Math.max(0, Math.floor(input.mainDpsInput))
  const daze = Math.max(0, input.perParryDaze)
  const noFollowDaze = Math.max(0, input.perNoFollowUpDaze)

  // 失衡池公式（core/stunPool.ts）：total ≥ bossStunValue → 1 + floor((total − bossStunValue)/有效条)
  // 达成 target 次失衡所需总失衡值 = bossStunValue + (target − 1) × bossStunValue × (1 − 返还比例)
  const costPerExtra = bossStun > 0 ? bossStun * (1 - refund) : 0
  const neededStun = bossStun > 0 ? bossStun + (target - 1) * costPerExtra : 0

  // 不带支援突击弹刀全部归击破位（boss 强制、非用户可调），其失衡值先扣掉
  const noFollowUpDazeTotal = noFollowUpTotal * noFollowDaze
  const remainingGap = Math.max(0, neededStun - Math.max(0, input.nonParryStun) - noFollowUpDazeTotal)
  const neededParries = daze > 0 ? Math.ceil(remainingGap / daze) : 0

  // 封顶：击破位正常弹刀不超 parryTotal，超出部分不再补（缺口可能补不满）
  const cappedParries = Math.max(0, Math.min(neededParries, parryTotal))
  const breakerParry = Math.max(breakerInput, cappedParries)
  const topUp = Math.max(0, Math.min(breakerParry - breakerInput, parryTotal - breakerInput))
  // 主C：用户已填（>0）不覆盖；否则拿剩余（parryTotal − 击破位）
  const mainDpsParry = mainDpsInput > 0 ? mainDpsInput : Math.max(0, parryTotal - breakerParry)

  return {
    breakerParry,
    mainDpsParry,
    breakerNoFollowUp: noFollowUpTotal,
    mainDpsNoFollowUp: 0,
    topUp,
    reached: input.stunCount >= target,
    perParryDaze: daze,
    perNoFollowUpDaze: noFollowDaze,
  }
}
