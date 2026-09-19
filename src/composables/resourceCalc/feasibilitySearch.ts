/**
 * 非轴降配的候选 scale 搜索策略（从 `useResourceCalc#stageResolveFeasibility` 抽出，纯函数、无 store/pinia 依赖）。
 *
 * 背景（2026-09-13 复现定性，完整数字见 `docs/ENGINE_PIPELINE_GUIDE.md` 坑19 判据⑤）：
 * 降配要在「缩交互次数」的若干档里挑**最大可行**档
 * （保留最多交互）。这里只放**纯策略**，试算本身（`runOuterLoop`）由调用方经 `evaluate` 注入。
 *
 * @fact engine:降配搜索/非下闭可行集 口径: 候选 scale 必须**由大到小逐个试**、首个「三臂不比基线更差且截断≤1s」者采纳（= 该网格上的最大可行档）；不得改「先探最小档、失败即跳过」的成本闸门——实测可行集**非 scale 下闭**（全库进入枚举 21 队中 7 队「存在可行 x 且存在 y<x 不可行」，3 队最小档不可行但更大档可行），该闸门前提为假、会漏掉更大档 | 据 实测@2026-09-13（受控：同配置只变候选集/顺序；单跑 vs 混跑逐位相同 ⇒ 非状态泄漏） | 验 src/composables/__tests__/feasibilitySearch.test.ts | 锚 src/composables/resourceCalc/feasibilitySearch.ts#selectDownscaleScale | 信 确认
 */

/** 降配候选档（严格递减）。顺序即语义：由大到小，首个可行即最大可行。 */
export const DOWNSCALE_SCALES: readonly number[] = [0.875, 0.75, 0.625, 0.5, 0.375, 0.25, 0.125, 0.0625]

/**
 * `selectDownscaleScale` 的单档试算产物：
 * - `accepted`：通过**相对**验收（三臂不比基线更差 + 截断 ≤ 容差）——「比现状好」；
 * - `feasible`：在 `accepted` 之上还满足**绝对**可行（`downscaleTrialFeasible`：净占用不超预算 + 截断 ≤ 容差）
 *   ——「真装得进 180s」。省略（undefined）= 沿用旧单层语义：accepted 即最终采纳。
 * - `value`：该档完整结果（供调用方使用）。
 */
export interface DownscaleOutcome<T> {
  accepted: boolean
  feasible?: boolean
  value: T
}

/**
 * 按传入顺序（调用方保证由大到小）选档，**两层字典序**：
 *   1. 首个 `feasible`（绝对可行）者立即采纳 = 该网格上**真装得下的最大档**；
 *   2. 无人绝对可行 ⇒ 退回首个 `accepted`（相对更好）者 = 旧语义；
 *   3. 全部不采纳 ⇒ `null`（保基线态）。
 *
 * 为什么要两层（R32 债 2 刀 1 暴露，2026-09-18）：旧单层「首个 accepted 即停」把**相对**验收当成了终点——
 * `yixuan-roxy-lucia` 在 scale=0.875 上「比基线好」（超预算 3.78→1.74s、截断 10.7→0.9s）就被采纳，
 * 而 0.625 档「真可行」（超预算 0.22s、截断 0）永远试不到。此前它恰好选到 0.625 只是因为 0.875 档
 * 被**假截断**（毫秒残差被整数装包放大成 1.6s）误拒——刀 1 消灭假截断后，这条掩盖就没了。
 * 用户口径「交互只取达成目标的**最少要求**」的目标 = 装进 180s，不是「比原来少超一点」；
 * 相对臂只该是**兜底**（全档都装不下时至少别更差），不该压过绝对可行。
 *
 * **不是**「最小可行」也不是「最小截断」：候选递减 + 首个绝对可行即停 ⇒ 语义 = 该网格上的
 * **最大真可行档**（保留最多用户交互）。**惰性**：绝对可行即返回；只有相对可行时才扫完全表
 * （成本 ≤ 档数，与结构性溢出队原本就付满 8 次同量级）。
 */
export function selectDownscaleScale<T>(
  scales: readonly number[],
  evaluate: (scale: number) => DownscaleOutcome<T>,
): { scale: number; value: T } | null {
  let fallback: { scale: number; value: T } | null = null
  for (const scale of scales) {
    const outcome = evaluate(scale)
    if (!outcome.accepted) continue
    // 旧单层语义（feasible 未声明）或绝对可行：首个命中即最大档
    if (outcome.feasible !== false) return { scale, value: outcome.value }
    if (fallback == null) fallback = { scale, value: outcome.value }
  }
  return fallback
}

/**
 * 降配试算验收判据（三臂，各相对**降配前基线态**、带量化容差）：
 *   ① 截断不更多；② 净占用不更超预算；③ 省下的时间不许变成新留白。
 * 三条一起 = 「不比改动前更差，且尽量消掉截断」⇒ 相对棘轮构造上不可能变红。
 *
 * 注意本判据**不含**「截断 ≤ 1s」那条硬门槛——调用方需另加（见 `stageResolveFeasibility`）。
 */
export function downscaleTrialAccepted(args: {
  trialNet: number
  trialTruncation: number
  baseNet: number
  baseTruncation: number
  stunEffTime: number
  toleranceSeconds: number
}): boolean {
  const { trialNet, trialTruncation, baseNet, baseTruncation, stunEffTime, toleranceSeconds } = args
  const baseOver = Math.max(0, baseNet - stunEffTime)
  const baseSlack = Math.max(0, stunEffTime - baseNet)
  return trialTruncation <= baseTruncation + toleranceSeconds
    && Math.max(0, trialNet - stunEffTime) <= baseOver + toleranceSeconds
    && Math.max(0, stunEffTime - trialNet) <= baseSlack + toleranceSeconds
}

/**
 * 降配试算**绝对**可行判据（不看基线）：截断 ≤ 容差 **且** 净占用超预算 ≤ 容差 ⇒ 这档真的装进了 180s。
 * 与 `downscaleTrialAccepted` 的分工：相对臂回答「比现状好吗」，本判据回答「达成目标了吗」；
 * `selectDownscaleScale` 先找达成目标的最大档，找不到才退回「比现状好」。
 * 容差与截断硬门槛同源（`TIME_BUDGET_TOLERANCE_SECONDS` = 1s 量化地板，坑 12「不追求精确 0」）。
 */
// @fact engine:降配搜索/绝对可行优先 口径: 降配选档两层字典序——首个「截断≤容差 且 净占用超预算≤容差」的绝对可行档优先（= 真装进 180s 的最大档），无绝对可行档才退回首个「三臂不比基线更差」的相对档；相对臂是兜底不是终点（yixuan-roxy-lucia 曾靠假截断误拒 0.875 才碰巧选到真可行的 0.625，刀 1 去掉假截断后暴露） | 据 用户裁决@2026-09-18「治根」·R32 | 验 src/composables/__tests__/feasibilitySearch.test.ts | 锚 src/composables/resourceCalc/feasibilitySearch.ts#downscaleTrialFeasible | 信 确认
// ⟳复核: DOWNSCALE_SCALES 网格或 TIME_BUDGET_TOLERANCE_SECONDS 再动时，复核「退回相对档」的队数（R32 实测全库 0 队走兜底）是否仍为 0 | 到期 2026-12-31
export function downscaleTrialFeasible(args: {
  trialNet: number
  trialTruncation: number
  stunEffTime: number
  toleranceSeconds: number
}): boolean {
  const { trialNet, trialTruncation, stunEffTime, toleranceSeconds } = args
  return trialTruncation <= toleranceSeconds
    && Math.max(0, trialNet - stunEffTime) <= toleranceSeconds
}
