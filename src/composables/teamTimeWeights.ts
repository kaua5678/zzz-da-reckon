/** 平A时间权重均衡的引擎适配；策略与批量计算共用，避免调用入口反向依赖。 */
import { equalizeTimeWeights } from '@/composables/timeWeightBalancer'
import type { ConfigModel } from '@/stores/config'
import type { ResourceCalc as Calc } from '@/composables/useResourceCalc'

/**
 * 把 applyTeamToStore 设好的默认平A权重（0/1 等权）重均衡到「边际产出更高」的槽位。
 *
 * 用 set-read-restore（同 computeOptimalTeamAllocation 的「临时应用→读伤害→还原」模式）经
 * `calc.teamTotalDamage` 做有限差分坐标上升（纯算法见 timeWeightBalancer.equalizeTimeWeights）。
 * 支援/防护（weight=0）不参与转移；时间总权重守恒。
 *
 * 返回均衡后的权重向量（按槽位）与均衡后总伤。均衡后权重已写回 store，后续读 teamTotalDamage 同源。
 */
export function optimizeTeamTimeWeights(
  calc: Calc,
  configStore: ConfigModel,
  opts: { step?: number; shiftStep?: number; maxIter?: number } = {},
): { weights: number[]; damage: number; balanced: boolean } {
  const initial = [0, 1, 2].map(s => Math.max(0, Number(configStore.team[s]?.basicAttackTimeWeight ?? 0)))
  const adjustableCount = initial.filter(w => w > 0).length
  if (adjustableCount < 2) {
    return { weights: initial, damage: calc.teamTotalDamage.value, balanced: false }
  }
  const evaluate = (w: number[]) => {
    for (let s = 0; s < 3; s++) configStore.setActionCount(s, 'basicAttackTimeWeight', Math.max(0, w[s]))
    return calc.teamTotalDamage.value
  }
  const r = equalizeTimeWeights(evaluate, initial, {
    step: opts.step ?? 0.5,
    shiftStep: opts.shiftStep ?? 1,
    maxIter: opts.maxIter ?? 3,
  })
  for (let s = 0; s < 3; s++) configStore.setActionCount(s, 'basicAttackTimeWeight', r.weights[s])
  return { weights: r.weights, damage: r.damage, balanced: true }
}

