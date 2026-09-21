import { describe, expect, it, vi } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { outerFeedbackSignature } from '@/composables/resourceCalc/outerCycle'

// 只观察真实管线，不替换轮输出；能抓住“纯函数正确，但调用方传了上轮快照”的接线回归。
const observed = vi.hoisted(() => ({
  currentSignature: null as string | null,
  checks: [] as Array<{ passed: string; measured: string | null }>,
}))
vi.mock('@/composables/resourceCalc/convergence', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/composables/resourceCalc/convergence')>()
  return {
    ...actual,
    createRunCalcRound: (...factoryArgs: Parameters<typeof actual.createRunCalcRound>) => {
      const run = actual.createRunCalcRound(...factoryArgs)
      return (...args: Parameters<typeof run>) => {
        const out = run(...args)
        observed.currentSignature = out ? outerFeedbackSignature(out) : null
        return out
      }
    },
  }
})
vi.mock('@/composables/resourceCalc/outerCycle', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/composables/resourceCalc/outerCycle')>()
  return {
    ...actual,
    isOuterTwoCycle: (input: Parameters<typeof actual.isOuterTwoCycle>[0]) => {
      observed.checks.push({ passed: input.currentSignature, measured: observed.currentSignature })
      return actual.isOuterTwoCycle(input)
    },
  }
})

describe('外层反馈的相位接线', () => {
  it('判环收到的是本轮输出快照，不是尚未更新的上轮签名', async () => {
    const { config } = await setupHarness([
      { agentId: '1591', cinemaLevel: 6, parryCount: 8, dodgeCounterCount: 12, quickAssistCount: 4,
        chainCountPerStun: 2, blockCount: 4, perfectBlockCount: 5 },
      { agentId: '1011', cinemaLevel: 6 }, { agentId: '1211', cinemaLevel: 6 },
    ])
    for (const buff of config.globalBuffs) buff.enabled = false
    config.setMechanicSetting('1591.sigrid_lance_opportunity.sigrid_hit_opportunity_gain.rate', 0.5)
    observed.checks = []
    observed.currentSignature = null
    const rr = useResourceCalc().resourceResult.value
    expect(rr).toBeTruthy()
    expect(observed.checks.length, '必须实际走过多轮判据').toBeGreaterThan(1)
    expect(new Set(observed.checks.map(c => c.measured)).size, '签名必须变化，恒定快照看不见一轮滞后').toBeGreaterThan(1)
    for (const [i, check] of observed.checks.entries()) {
      expect(check.measured, `第 ${i + 1} 次判定必须有真实轮输出`).not.toBeNull()
      expect(check.passed, `第 ${i + 1} 次判定用了陈旧快照`).toBe(check.measured)
    }
  })

  it.each([0, 3])('锁定 %i 次失衡仍走反馈收敛，不进入自由失衡判环', async lock => {
    const { config } = await setupHarness([{ agentId: '1011' }])
    config.enemy.stunCountLock = lock
    observed.checks = []
    observed.currentSignature = null
    const rr = useResourceCalc().resourceResult.value!
    expect(rr).toBeTruthy()
    expect(observed.currentSignature, '锁定模式也必须计算反馈').not.toBeNull()
    expect(rr.plannedStunCount).toBe(lock)
    expect(rr.convergence.outerExit).toBe('stable')
    expect(observed.checks).toEqual([])
  })
})
