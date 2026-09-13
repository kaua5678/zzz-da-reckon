/**
 * 非轴降配的候选 scale 搜索策略（从 `useResourceCalc#stageResolveFeasibility` 抽出，纯函数、无 store/pinia 依赖）。
 *
 * 背景（2026-09-13 复现定性，完整数字见 `.claude/task-ledger-calc-core.md` round 13 与
 * `docs/ENGINE_PIPELINE_GUIDE.md` 坑19 判据⑤）：降配要在「缩交互次数」的若干档里挑**最大可行**档
 * （保留最多交互）。这里只放**纯策略**，试算本身（`runOuterLoop`）由调用方经 `evaluate` 注入。
 *
 * @fact engine:降配搜索/非下闭可行集 口径: 候选 scale 必须**由大到小逐个试**、首个「三臂不比基线更差且截断≤1s」者采纳（= 该网格上的最大可行档）；不得改「先探最小档、失败即跳过」的成本闸门——实测可行集**非 scale 下闭**（全库进入枚举 21 队中 7 队「存在可行 x 且存在 y<x 不可行」，3 队最小档不可行但更大档可行），该闸门前提为假、会漏掉更大档 | 据 实测@2026-09-13（受控：同配置只变候选集/顺序；单跑 vs 混跑逐位相同 ⇒ 非状态泄漏） | 验 src/composables/__tests__/feasibilitySearch.test.ts | 锚 src/composables/resourceCalc/feasibilitySearch.ts#selectDownscaleScale | 信 确认
 */

/** 降配候选档（严格递减）。顺序即语义：由大到小，首个可行即最大可行。 */
export const DOWNSCALE_SCALES: readonly number[] = [0.875, 0.75, 0.625, 0.5, 0.375, 0.25, 0.125, 0.0625]

/** `selectDownscaleScale` 的单档试算产物：`accepted` = 是否采纳，`value` = 该档完整结果（供调用方使用）。 */
export interface DownscaleOutcome<T> {
  accepted: boolean
  value: T
}

/**
 * 按传入顺序（调用方保证由大到小）返回**首个被采纳**的档；全部不采纳返回 `null`。
 *
 * **不是**「最小可行」也不是「最小截断」：候选递减 + 首个命中 ⇒ 语义 = 该网格上的**最大可行档**
 * （保留最多用户交互）。**惰性**：命中即返回，后续档不再试算（成本 ≤ 档数）。
 */
export function selectDownscaleScale<T>(
  scales: readonly number[],
  evaluate: (scale: number) => DownscaleOutcome<T>,
): { scale: number; value: T } | null {
  for (const scale of scales) {
    const outcome = evaluate(scale)
    if (outcome.accepted) return { scale, value: outcome.value }
  }
  return null
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
