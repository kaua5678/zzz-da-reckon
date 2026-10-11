/**
 * Boss 预设弹刀拆分（用户口径 2026-08）：
 * 击破位弹刀 = 按「失衡次数四舍五入」反推（在击破位当前输入之上补足缺口），主C = 正常弹刀总数 − 击破位正常弹刀。
 *
 * 两类弹刀：
 * - 正常弹刀（parryTotal）：轻弹刀 + 支援突击 + 喧响 215，按失衡四舍五入反推拆分击破/主C；
 * - 不带支援突击的弹刀（parryNoFollowUpTotal）：只有轻弹刀倍率行 + 喧响 215、无支援突击行，
 *   boss 机制强制、非用户可调 → **对半分**（用户口径 2026-09-10：「不带支援突击的弹刀**必须对半分**，
 *   「强制归击破位」是错的——那是把「补失衡」误解成「只有击破弹刀」；删掉」，奇数时击破位多 1）。
 *   其失衡值先从缺口里扣（击破位承担的那一半）。
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

/**
 * 失衡次数「四舍五入」的目标次数（单一事实源：收敛层反推与页面未达成提示同引）。
 *
 * ⚠ 名字沿革：原叫「保底4失衡」。用户裁决 2026-10-11 改名——**保底**是「一定要凑到 4」，
 * 而实测凑不动：算法的必要资源已经打满，剩下的交互占比很小，硬向上取就会超时（般岳厚轴反复
 * 因此弃轴）。改成**四舍五入**后口径 = 对**补的弹刀次数**取整（见 `roundedParryCount`），
 * 「尽力而为」不变，只削掉余量 < 半刀的那一次。
 */
export const GUARANTEE_STUN_TARGET = 4

/**
 * 补的弹刀次数取整：**四舍五入**（用户裁决 2026-10-11），取代原来的「总是向上取（ceil）」。
 *
 * > 「保底你也说了，很严格，总是出问题超时。我们的算法已经把必要资源都打出去了，
 * >  剩下的交互其实占比较小，硬是要**向上取**就很难，**四舍五入**是合适的。」
 *
 * 口径 = 对**交互次数**取整，不是对缺口设门槛：
 * - 旧（ceil）：缺口 0.1 刀也补 1 刀 ⇒ 为最后一次失衡硬塞一整刀，撑爆时间预算（般岳厚轴反复弃轴）；
 * - 新（round）：只削掉**余量 < 半刀**的那一次；缺口 9.9 刀仍补 10 刀（**尽力而为不变**）。
 *
 * ⚠ 为什么不是「缺口 > 半格 ⇒ 补 0」（本函数初版写法，已被 3 条集成测试否决）：
 * 那会让「离目标还有 9.9 刀」的队**一刀都不补**，与「尽力而为」相悖。
 * 四舍五入的正确落点是**取整那一步**，不是「补不补」那个开关。
 */
export function roundedParryCount(remainingGap: number, perParryDaze: number): number {
  if (!(perParryDaze > 0)) return 0
  return Math.round(Math.max(0, remainingGap) / perParryDaze)
}

export interface ParrySplitInput {
  /** 目标失衡次数（UI「失衡次数四舍五入」= 4） */
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
  /** 击破位不带支援突击弹刀 = 对半分中的击破位一半（奇数时多 1） */
  breakerNoFollowUp: number
  /** 主C 不带支援突击弹刀 = 对半分中的主C 一半 */
  mainDpsNoFollowUp: number
  /** 击破位正常弹刀反推补齐量（≥0，已按 parryTotal 封顶） */
  topUp: number
  /** 击破位正常弹刀每次有效失衡（实测值，随线程携带：击破位 0 弹刀时无行、沿用上轮） */
  perParryDaze: number
  /** 击破位不带支援突击弹刀每次有效失衡（实测值，随线程携带） */
  perNoFollowUpDaze: number
}

export function computeParrySplit(input: ParrySplitInput): ParrySplitResult {
  const target = Math.max(1, Math.floor(input.targetStunCount) || GUARANTEE_STUN_TARGET)
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

  // 不带支援突击弹刀对半分后，**击破位那一半**的失衡值先从缺口里扣（用户口径 2026-09-10）
  const noFollowUpBreakerHalf = noFollowUpTotal - Math.floor(noFollowUpTotal / 2)
  const noFollowUpDazeTotal = noFollowUpBreakerHalf * noFollowDaze
  const remainingGap = Math.max(0, neededStun - Math.max(0, input.nonParryStun) - noFollowUpDazeTotal)
  // 四舍五入（用户裁决 2026-10-11）：只削掉余量 < 半刀的那一次，缺口大时仍尽力补（见 roundedParryCount）。
  const neededParries = roundedParryCount(remainingGap, daze)

  // 封顶：击破位正常弹刀不超 parryTotal，超出部分不再补（缺口可能补不满）
  const cappedParries = Math.max(0, Math.min(neededParries, parryTotal))
  const breakerParry = Math.max(breakerInput, cappedParries)
  const topUp = Math.max(0, Math.min(breakerParry - breakerInput, parryTotal - breakerInput))
  // 主C：用户已填（>0）不覆盖；否则拿剩余（parryTotal − 击破位）
  const mainDpsParry = mainDpsInput > 0 ? mainDpsInput : Math.max(0, parryTotal - breakerParry)

  // 不带支援突击弹刀：**对半分**（用户口径 2026-09-10；奇数时击破位多 1，因为失衡值只由击破位那半贡献）
  const mainDpsNoFollowUp = Math.floor(noFollowUpTotal / 2)
  const breakerNoFollowUp = noFollowUpTotal - mainDpsNoFollowUp

  return {
    breakerParry,
    mainDpsParry,
    breakerNoFollowUp,
    mainDpsNoFollowUp,
    topUp,
    perParryDaze: daze,
    perNoFollowUpDaze: noFollowDaze,
  }
}

/**
 * 「失衡次数四舍五入」未达成诊断（CC-156，2026-09-28）：勾选后，弹刀反推在预算内补不满目标次数时，
 * 引擎按实际池计数继续算（不硬凑）——此前这一降级**静默**发生（`ParrySplitResult.reached` 算了却零读取，
 * 且比的是单轮池计数）。本函数按**最终**失衡池计数判定，返回 null = 已达成；否则给出原因供页面如实显示。
 * - `parry-exhausted`：Boss 正常弹刀已全部反推给击破位仍不够（预算用满）；
 * - `no-parry-budget`：当前 Boss 没有可反推的弹刀预算（拆分未激活）；
 * - `other`：预算未用满却未达成（如主C 手填弹刀占用了预算）。
 */
export interface GuaranteeStunShortfall {
  target: number
  stunCount: number
  cause: 'parry-exhausted' | 'no-parry-budget' | 'other'
}
export function guaranteeStunShortfall(
  stunCount: number,
  split: { breakerParry: number; parryTotal: number } | null,
): GuaranteeStunShortfall | null {
  // CC-181：目标固定取弹刀反推同一常量（convergence 传 `targetStunCount: GUARANTEE_STUN_TARGET`）；
  // 原默认形参全仓无人传，留着只会让诊断与反推有机会用两个目标
  const target = GUARANTEE_STUN_TARGET
  if (stunCount >= target) return null
  const cause: GuaranteeStunShortfall['cause'] = !split
    ? 'no-parry-budget'
    : split.parryTotal > 0 && split.breakerParry >= split.parryTotal ? 'parry-exhausted' : 'other'
  return { target, stunCount, cause }
}
