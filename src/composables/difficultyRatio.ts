/**
 * 失衡窗口占比 —— 操作难度「非失衡占比修正」的**单一事实源**。
 *
 * 为什么单独成模块（而不是留在 `difficultyCurve.ts` 或 `teamCompare.ts`）：
 * 两处都要用它，而这两个模块的依赖方向是**单向**的（`difficultyCurve` → `teamCompare`，
 * 因为前者要用后者的 `computeDifficulty` / `liveInteractions`）。若把本函数留在任一侧，
 * 另一侧就得复制一份——复制版一旦漂移，同一支队在散点页与难度曲线页会得到不同的 x 轴
 * （2026-09-20 实机点通抓到过：散点页漏传修正，两图不同尺）。抽成无依赖叶子模块即可双向引用。
 *
 * ## 口径（用户裁决 2026-09-20）
 *
 * 取引擎的 **`calc.stunCoverage`**（`useResourceCalc` 计算，`stunSeconds = 次数 × 窗长 − 决算损失秒`）：
 *
 * 用户点名的场景 = **雨果多次结算让非失衡时间上升，弹刀等交互次数也跟着上升，但那不代表难度高**。
 * 决算（雨果强特终结 / 佩洛伊斯右分支）做完即**清空窗口剩余失衡时间** ⇒ 真失衡秒数比
 * 「次数 × 窗长」少。实测 雨果+琉音+卢西娅：权威 9.33% vs 近似 20.00%（差 10.67pp）
 * ⇒ 非失衡 90.7% vs 80.0% ⇒ 难度修正倍数 ×1.10 vs ×1.25。用近似值会把难度虚高 ~14%。
 *
 * 回退链：引擎值不可用（未收敛 / 无失衡 / 部分 mock 的 calc）→ 同源近似
 * `stunWindowFraction(次数, 窗长, 有效时间)`（**不含**决算损失，已知偏高）→ 0（= 不修正）。
 *
 * @fact engine:操作难度/非失衡占比数据源 口径: 失衡窗口占比取 `calc.stunCoverage`（含**决算截断损失秒**，`stunSeconds = 次数×窗长 − verdictSecondsLost`）；回退 `stunWindowFraction` 近似（不含决算损失，偏高）；取不到 = 0（不修正）。单源抽成叶子模块供 `teamCompare`（散点页）与 `difficultyCurve`（曲线页）共用——两处复制会漂移成「同队两图不同尺」 | 据 用户@2026-09-20「雨果多次结算让非失衡时间上升……但不代表难度高，所以你要做决算损失秒，算出真正的非失衡占比」 | 验 src/composables/__tests__/teamCompare.test.ts::逐类型公式 + src/composables/__tests__/difficultyCurve.test.ts | 锚 src/composables/difficultyRatio.ts#stunWindowRatioOf | 信 确认
 * ⟳复核: `calc.stunCoverage` 的口径（决算损失秒算法）或回退近似再动时，复核「雨果队权威 vs 近似差值」与「两页同值」两条 | 到期 2026-12-31
 */

/** 最小可用的 calc 形状（只取本模块需要的两个字段，便于部分 mock 的测试传入） */
export interface RatioCalcLike {
  resourceResult?: { value?: { totalTime?: number } | null }
  stunPoolResult?: { value?: { stunCount?: number } | null }
  /** 引擎算的失衡窗口占比（含决算损失秒）；部分 mock 可能没有 */
  stunCoverage?: { value?: number }
  windowDuration?: { value?: number }
}

/** 有效时间所需的敌人配置（只取两个字段） */
export interface RatioEnemyLike {
  battleTime?: number
  invincibleTime?: number
}

/** 失衡窗口占比的回退近似（不含决算损失秒；`stunWindowFraction` 的本地等价实现，避免引 core 依赖） */
function approxWindowFraction(stunCount: number, windowDuration: number, effectiveTime: number): number {
  if (effectiveTime <= 0 || stunCount <= 0 || windowDuration <= 0) return 0
  return Math.max(0, Math.min(1, (stunCount * windowDuration) / effectiveTime))
}

/**
 * 失衡窗口占比（0..1）。
 *
 * @param calc  资源计算结果（取 `stunCoverage`；缺失时回退用 `stunPoolResult` + `windowDuration` 近似）
 * @param enemy 敌人配置（`battleTime` / `invincibleTime`，仅回退路径需要）
 * @returns 0..1；返回 0 = 「取不到 ⇒ 不做非失衡占比修正」（与历史行为一致）
 */
export function stunWindowRatioOf(calc: RatioCalcLike, enemy: RatioEnemyLike = {}): number {
  const coverage = calc.stunCoverage?.value
  if (typeof coverage === 'number' && Number.isFinite(coverage) && coverage > 0) {
    return Math.max(0, Math.min(1, coverage))
  }
  // 回退：引擎值不可用 ⇒ 用「次数 × 窗长 / 有效时间」近似（**不含**决算损失，已知偏高）
  const stunCount = calc.stunPoolResult?.value?.stunCount ?? 0
  const windowDuration = calc.windowDuration?.value ?? 0
  const rr = calc.resourceResult?.value
  if (!rr || stunCount <= 0) return 0
  const effectiveTime = Math.max(0, (enemy.battleTime ?? rr.totalTime ?? 180) - (enemy.invincibleTime ?? 0))
  return approxWindowFraction(stunCount, windowDuration, effectiveTime)
}
