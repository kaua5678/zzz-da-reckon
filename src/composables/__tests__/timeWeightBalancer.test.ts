/**
 * 边际均衡器纯算法测试：坐标上升把权重转移到边际更高的槽位、保持总权重守恒、收敛判据正确。
 */
import { describe, expect, it } from 'vitest'
import { equalizeTimeWeights } from '@/composables/timeWeightBalancer'

describe('equalizeTimeWeights（纯算法）', () => {
  it('线性边际 → 全部权重收敛到边际最高的槽位（角点解）', () => {
    // damage = 3w0 + 2w1 + 1w2，边际恒 [3,2,1]，最优 = 全部给槽0
    const evaluate = (w: number[]) => 3 * w[0] + 2 * w[1] + 1 * w[2]
    const r = equalizeTimeWeights(evaluate, [1, 1, 1], { shiftStep: 1, maxIter: 20 })
    expect(r.weights[0]).toBeCloseTo(3, 1)
    expect(r.weights[1]).toBeCloseTo(0, 1)
    expect(r.weights[2]).toBeCloseTo(0, 1)
    // 总权重守恒
    expect(r.weights.reduce((a, b) => a + b, 0)).toBeCloseTo(3, 5)
  })

  it('凹边际（m−w）→ 收敛到边际均衡（非角点），总权重守恒', () => {
    // damage = Σ (m_i·w_i − 0.5·w_i²)，边际 = m_i − w_i；均衡时 w_i = m_i − λ
    // m=[3,2,1]、总权重 3 → 均衡 w=[2,1,0]（λ=1，边际全 1）
    const m = [3, 2, 1]
    const evaluate = (w: number[]) => w.reduce((s, wi, i) => s + m[i] * wi - 0.5 * wi * wi, 0)
    const r = equalizeTimeWeights(evaluate, [1, 1, 1], { step: 0.01, shiftStep: 0.5, maxIter: 60, eps: 0.01 })
    expect(r.weights[0]).toBeCloseTo(2, 1)
    expect(r.weights[1]).toBeCloseTo(1, 1)
    expect(r.weights[2]).toBeCloseTo(0, 1)
    expect(r.weights.reduce((a, b) => a + b, 0)).toBeCloseTo(3, 5)
    expect(r.converged).toBe(true)
  })

  it('支援/防护槽（初值 0）不可调，权重保持 0', () => {
    const evaluate = (w: number[]) => 3 * w[0] + 0 * w[1] + 1 * w[2]
    const r = equalizeTimeWeights(evaluate, [1, 0, 1], { shiftStep: 1, maxIter: 20 })
    expect(r.weights[1]).toBe(0) // 支援槽不可调
    expect(r.weights[0]).toBeCloseTo(2, 1)
    expect(r.weights[2]).toBeCloseTo(0, 1)
  })

  it('单调不减：均衡后的伤害 ≥ 初始等权伤害', () => {
    const m = [4, 2, 1]
    const evaluate = (w: number[]) => w.reduce((s, wi, i) => s + m[i] * wi - 0.5 * wi * wi, 0)
    const initial = [1, 1, 1]
    const base = evaluate(initial)
    const r = equalizeTimeWeights(evaluate, initial, { maxIter: 30, shiftStep: 0.5 })
    expect(r.damage).toBeGreaterThanOrEqual(base - 1e-9)
  })
})
