/**
 * 内层不动点「浮点噪声环」判据（core/resource/floatNoiseCycle.ts）：
 * - 纯函数面：1 ulp 交替 = 噪声环；任一字段 Δ≥1（真整数环）/ 嵌套快照差 1e-6 相对 = 不是。
 * - 引擎面：1431/1341/1031（估计/行单源后内层是 ρ≈0.17 的连续收缩、浮点无精确不动点）冷算必须 converged=true
 *   ——2026-09-19 前该队 iter=20 撞顶 / 进环后按旧口径 clean=false（详见 floatNoiseCycle.ts 头注释）。
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { calcTeamResources, clearWarmStartCache, INNER_LOOP_MAX_ITERATIONS } from '@/core/resource'
import { isFloatNoiseCycle } from '@/core/resource/floatNoiseCycle'
import type { IterationState } from '@/types/resource'

/** 单槽状态；`over` 允许塞任意嵌套快照字段（energySource 等按 unknown 结构比较，不受 TS 形状约束） */
function state(over: Record<string, unknown> = {}): IterationState {
  return {
    basicAttackTime: 25.94937036135673, exSpecialCount: 7, ultimateCount: 1, chainCountTotal: 8,
    totalEnergy: 450.1531290593207, totalDecibel: 5732.0768835503195, necessaryTime: 91.48715704581691,
    frontlineTime: 117.4, backstageTime: 0, comboAlignTime: 0, comboAlignCredit: 0,
    ...over,
  } as unknown as IterationState
}
/** 环成员 = 全队快照：这里用「1431 槽变化 + 一个恒定队友槽」的两人队 */
const mate = state({ basicAttackTime: 25.94937036135673, exSpecialCount: 5, necessaryTime: 0.9168 })
const team = (s: IterationState): IterationState[] => [s, mate]

describe('浮点噪声环判据', () => {
  it('1 ulp 交替的 2-循环 = 噪声环（含嵌套快照同步抖动）', () => {
    const a = state({ energySource: { total: 450.1531290593207, parts: [1.25, 2.5] } })
    const b = state({
      basicAttackTime: 25.949370361356728, necessaryTime: 91.48715704581693,
      energySource: { total: 450.15312905932063, parts: [1.25, 2.5] },
    })
    expect(isFloatNoiseCycle([team(a), team(b)])).toBe(true)
    expect(isFloatNoiseCycle([team(a), team(b), team(a)])).toBe(true)
    expect(isFloatNoiseCycle([team(a)])).toBe(true)
  })

  it('真整数环（次数 Δ=1）/ 实数次数 Δ=1e-3 / 嵌套快照差 1e-6 相对 / 结构不同 ⇒ 不是噪声环', () => {
    const a = state({ energySource: { total: 450 } })
    expect(isFloatNoiseCycle([team(a), team(state({ exSpecialCount: 6, energySource: { total: 450 } }))])).toBe(false)
    expect(isFloatNoiseCycle([team(a), team(state({ exSpecialCount: 7.001, energySource: { total: 450 } }))])).toBe(false)
    expect(isFloatNoiseCycle([team(a), team(state({ energySource: { total: 450.00045 } }))])).toBe(false)
    expect(isFloatNoiseCycle([team(a), team(state({ energySource: { total: 450, extra: 1 } }))])).toBe(false)
    expect(isFloatNoiseCycle([team(a), team(state())])).toBe(false)
    // 队友槽变了（哪怕 1431 槽一致）也不是噪声环
    expect(isFloatNoiseCycle([team(a), [a, state({ ...mate, exSpecialCount: 4 } as unknown as Record<string, unknown>)]])).toBe(false)
  })
})

describe('内层连续收缩队的收敛标志', () => {
  beforeEach(() => clearWarmStartCache())

  it('1431/1341/1031：冷算 converged=true，且不是靠撞上限（iterations < 上限）', async () => {
    await setupHarness([{ agentId: '1431' }, { agentId: '1341' }, { agentId: '1031' }])
    const cfg = JSON.parse(JSON.stringify(useResourceCalc().resourceConfig.value!))
    expect(cfg.maxIterations).toBe(INNER_LOOP_MAX_ITERATIONS)
    const cold = calcTeamResources(cfg)
    expect(cold.converged).toBe(true)
    expect(cold.iterations).toBeLessThan(INNER_LOOP_MAX_ITERATIONS)
  })
})
