/**
 * 平A时间权重·边际均衡器（第五轮：把 `iterate` 里等权分配的平A时间改成「边际均衡」默认）。
 *
 * 背景（用户口径 2026-08-29）：
 * - 战场预算模型正确：打完强力招式（强特/大招/连携）后残余时间 = 平A，可分配，**平A能力强的角色多平A**。
 * - 「能力」是 4 维产出（伤害 / 回能 / 喧响 / 积蓄·失衡），不能单字段加权，要用**边际分析**
 *   （单变量扰动 → 看团队总伤增量 → 取最大），即资源利用率页「全队边际收益」同款思路。
 * - 边际非单调（击破位时间→失衡次数→总伤有拐点），所以是坐标上升，不是闭式解。
 *
 * 本模块是**纯算法**（不依赖引擎）：`equalizeTimeWeights` 接收一个 `evaluate(weights)` 回调
 * 做有限差分的坐标上升，返回边际均衡后的权重向量。真实回调由编排层用 `calc.teamTotalDamage`
 * 的 set-read-restore 包装（同 computeOptimalTeamAllocation 的「临时应用→读伤害→还原」模式）。
 */

export interface TimeWeightEqualizeOptions {
  /** 单次扰动的权重步长（有限差分用） */
  step?: number
  /** 每次坐标上升在 min/max 槽之间转移的最大权重 */
  shiftStep?: number
  /** 最大迭代轮数 */
  maxIter?: number
  /** 边际差收敛阈值：max 边际 − min 边际 < eps 即停 */
  eps?: number
  /** 槽位权重下限（shift 时不低于它，避免把支援/防护或必要槽压到 0 后无法恢复） */
  minWeight?: number
}

export interface TimeWeightEqualizeResult {
  /** 均衡后的权重（按槽位下标，长度 = 输入长度；不可调槽位保持原值） */
  weights: number[]
  /** 均衡后的团队总伤（最后一次 evaluate 返回值） */
  damage: number
  /** 迭代轮数 */
  iterations: number
  /** 是否边际收敛（false = 达到 maxIter 上限仍未收敛） */
  converged: boolean
}

/**
 * 边际均衡（坐标上升）：把平A时间权重从「等权/初值」迭代转移到边际产出更高的槽位。
 *
 * 可调槽位 = 权重 > 0 的槽位（支援/防护 weight=0 天然不可调，不参与转移）。
 * 每轮：对每个可调槽做 +step 有限差分算边际，把 shiftStep 权重从「边际最低」移到「边际最高」，
 * 保持总权重守恒（时间守恒）。边际差 < eps 或到 maxIter 停止。
 *
 * @param evaluate  给定权重 → 团队总伤（纯读，调用方保证无副作用泄漏）
 * @param initial   初始权重（按槽位下标）
 * @param opts      步长/收敛参数
 */
export function equalizeTimeWeights(
  evaluate: (weights: number[]) => number,
  initial: number[],
  opts: TimeWeightEqualizeOptions = {},
): TimeWeightEqualizeResult {
  const step = opts.step ?? 0.5
  const shiftStep = opts.shiftStep ?? 1
  const maxIter = opts.maxIter ?? 8
  const eps = opts.eps ?? 1e-6
  const minWeight = opts.minWeight ?? 0

  const weights = initial.map(w => Math.max(0, w))
  // 可调槽位 = 初值 > 0（支援/防护 weight=0 不参与）
  const adjustable = weights.map((w, i) => (w > 0 ? i : -1)).filter(i => i >= 0)
  if (adjustable.length < 2) {
    return { weights: [...weights], damage: evaluate(weights), iterations: 0, converged: true }
  }

  let damage = evaluate(weights)
  let iterations = 0
  let converged = false

  for (let iter = 0; iter < maxIter; iter++) {
    iterations = iter + 1
    // 每个可调槽做一次 +step 有限差分
    const marginals = new Map<number, number>()
    for (const slot of adjustable) {
      weights[slot] += step
      const up = evaluate(weights)
      weights[slot] -= step
      marginals.set(slot, (up - damage) / step)
    }
    // 接收槽 = 边际最高者
    let maxSlot = adjustable[0]
    for (const slot of adjustable) {
      if (marginals.get(slot)! > marginals.get(maxSlot)!) maxSlot = slot
    }
    // 让出槽 = 边际最低者中「权重 > minWeight」的（给得出才算）
    let fromSlot = -1
    for (const slot of adjustable) {
      if (weights[slot] <= minWeight) continue
      if (fromSlot < 0 || marginals.get(slot)! < marginals.get(fromSlot)!) fromSlot = slot
    }
    if (fromSlot < 0 || fromSlot === maxSlot) {
      // 无可让出槽（全部到下限）或只剩一个可动槽 → 停止
      converged = fromSlot === maxSlot || (fromSlot < 0 && adjustable.length <= 1)
      break
    }
    const gap = marginals.get(maxSlot)! - marginals.get(fromSlot)!
    if (gap < eps) {
      converged = true
      break
    }
    // 从最低边际槽转移 shiftStep 到最高边际槽（不低于 minWeight）；
    // 单调守卫：只在总伤确实提高时才提交，否则回退并停（非凸景观/局部最优防退化）。
    const delta = Math.min(shiftStep, Math.max(0, weights[fromSlot] - minWeight))
    if (delta <= 0) break
    weights[fromSlot] -= delta
    weights[maxSlot] += delta
    const newDamage = evaluate(weights)
    if (newDamage > damage + eps) {
      damage = newDamage
    } else {
      weights[fromSlot] += delta
      weights[maxSlot] -= delta
      converged = true
      break
    }
  }

  return { weights: [...weights], damage, iterations, converged }
}
