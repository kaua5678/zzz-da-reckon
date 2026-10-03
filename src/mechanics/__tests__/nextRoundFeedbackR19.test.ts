import { describe, expect, it, vi } from 'vitest'
import { computed } from 'vue'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { createConvergenceRoundInputs, createRunCalcRound } from '@/composables/resourceCalc/convergence'
import { getAgentMechanic } from '@/mechanics'
import { setupHarness } from '@/test/harness'
import { collectNextRoundFeedback } from '@/composables/resourceCalc/helpers'
import type { AgentTeamConfigInput } from '@/mechanics/types'
import { initialCalcRoundThreads } from '@/composables/resourceCalc/roundThreads'
import type { AgentNextRoundFeedbackInput } from '@/mechanics/types'
import { emptyAnomalyPool } from '@/core/anomalyPool'

function feedback(agentId: string, overrides: Partial<AgentNextRoundFeedbackInput> = {}) {
  const cfg = { agentId, slot: 2 } as AgentNextRoundFeedbackInput['cfg']
  const hook = getAgentMechanic(agentId)?.nextRoundFeedback
  expect(hook, `${agentId}: feedback hook must be registered`).toBeTypeOf('function')
  return hook!({
    slot: 2, cfg, characters: [cfg],
    teamResult: { characters: [] } as never,
    // CC-435：adjustedResult 必填；未显式给时 = 覆盖后的 teamResult（流水线无调整时的同形传入）
    adjustedResult: overrides.adjustedResult ?? overrides.teamResult ?? ({ characters: [] } as never),
    anomalyPool: emptyAnomalyPool(), prevThreads: initialCalcRoundThreads(),
    combatTime: 180, getAgentSkills: () => undefined,
    ...overrides,
  })
}

const result = (count: number) => ({ characters: [{ agentId: '1431', executions: [{ source: 'gift', count }] }] }) as never

describe('C-α next-round feedback', () => {
  it('unregistered modules contribute nothing (reverse: registration is load-bearing)', () => {
    expect(getAgentMechanic('1481')?.nextRoundFeedback).toBeUndefined()
  })

  it('real runCalcRound threadsNext carries both registered feedback values with a leading empty slot', async () => {
    const { config, catalog } = await setupHarness([{ agentId: '' }, { agentId: '1431' }, { agentId: '1181', cinemaLevel: 1 }])
    config.autoYidhariAxis = false
    config.useStunAxis = false
    const calc = useResourceCalc()
    const inputs = createConvergenceRoundInputs({ configStore: config, catalogStore: catalog,
      panels: calc.panels, resourceConfig: calc.resourceConfig, globalAnomalyMultiplier: computed(() => 1) })
    const run = createRunCalcRound({
      configStore: config, catalogStore: catalog, panels: calc.panels, resourceConfig: calc.resourceConfig,
      computeWindowDuration: () => 10, computeStunCoverage: () => 0,
      ...inputs,
    })
    // Sentinels at the approved module seam isolate dispatcher/threads wiring from domain arithmetic.
    const ye = vi.spyOn(getAgentMechanic('1431')!, 'nextRoundFeedback').mockReturnValue({ yeshuguangGiftUlt: 7.25 })
    const grace = vi.spyOn(getAgentMechanic('1181')!, 'nextRoundFeedback').mockReturnValue({ graceC1Cycles: 3 })
    try {
      const out = run(2, initialCalcRoundThreads())
      expect((out?.threadsNext.moduleFeedback.yeshuguangGiftUlt ?? 0)).toBe(7.25)
      expect((out?.threadsNext.moduleFeedback.graceC1Cycles ?? 0)).toBe(3)
      expect(ye.mock.calls[0]![0].cfg.slot).toBe(1)
      expect(grace.mock.calls[0]![0].cfg.slot).toBe(2)
    } finally { ye.mockRestore(); grace.mockRestore() }
  })

  it('real dispatcher preserves disordered sparse slots; next-round energy consumes three cycles once', async () => {
    const { catalog } = await setupHarness([])
    const grace = { agentId: '1181', slot: 2, graceC1Cycles: 3.9, initialEnergyGift: 0 }
    const ye = { agentId: '1431', slot: 1, initialEnergyGift: 0 }
    const characters = [grace, ye] as unknown as AgentTeamConfigInput['characters']
    const next = collectNextRoundFeedback({
      characters, teamResult: result(100), adjustedResult: result(2.25),
      displayResult: result(200), anomalyPool: emptyAnomalyPool(),
      prevThreads: initialCalcRoundThreads(), catalogStore: catalog,
    })
    expect(next).toEqual({ graceC1Cycles: 3, yeshuguangGiftUlt: 2.25 })
    const threads = { ...initialCalcRoundThreads(), moduleFeedback: next }
    const input = { slot: 2, cfg: grace, characters, phase: 'converge', cinemaLevel: 1, threads } as unknown as AgentTeamConfigInput
    getAgentMechanic('1181')!.applyTeamConfig!(input)
    expect(characters.map(c => c.initialEnergyGift)).toEqual([6, 6])
    getAgentMechanic('1181')!.applyTeamConfig!(input)
    expect(characters.map(c => c.initialEnergyGift)).toEqual([6, 6])
    getAgentMechanic('1431')!.applyTeamConfig!({ ...input, slot: 1, cfg: characters[1]! })
    expect((ye as Record<string, unknown>).yeshuguangGiftUltCount).toBe(2.25)
    expect(collectNextRoundFeedback({
      characters: [], teamResult: result(100), adjustedResult: result(100), anomalyPool: emptyAnomalyPool(),
      prevThreads: threads, catalogStore: catalog,
    })).toEqual({})
  })

  it('C8: adjusted source wins; OR matches once, fractional and negative counts remain unchanged', () => {
    expect(feedback('1431', {
      teamResult: result(100), displayResult: result(200),
      adjustedResult: { characters: [
        { agentId: '1181', executions: [{ source: 'gift', count: 999 }] },
        { agentId: '1431', executions: [
          { source: 'gift', moveName: 'ordinary', count: 2.5 },
          { source: 'self', moveName: '好评转大·测试', count: 3.25 },
          { source: 'gift', moveName: '好评转大·测试', count: 1.5 },
          { source: 'gift', count: -0.5 },
          { source: 'gift' },
          { source: 'self', moveName: 'ordinary', count: 1000 },
        ] },
      ] } as never,
    })).toEqual({ yeshuguangGiftUlt: 6.75 })
  })

  it('C8: reads adjustedResult only — never team / display (CC-435: adjustedResult is required); absent character returns zero', () => {
    expect(feedback('1431', { adjustedResult: result(2.25), teamResult: result(100), displayResult: result(100) }))
      .toEqual({ yeshuguangGiftUlt: 2.25 })
    expect(feedback('1431', { adjustedResult: { characters: [] } as never, teamResult: result(100) }))
      .toEqual({ yeshuguangGiftUlt: 0 })
  })

  it.each([[3.9, 3], [-2.5, 0], [undefined, 0], ['4.9', 4]])('C10: own cfg %s → %s, not previous threads or compacted array index', (value, expected) => {
    const cfg = { agentId: '1181', slot: 2, graceC1Cycles: value } as never
    expect(feedback('1181', {
      cfg, characters: [cfg],
      prevThreads: { ...initialCalcRoundThreads(), moduleFeedback: { graceC1Cycles: 91 } },
    })).toEqual({ graceC1Cycles: expected })
  })
})
