import { describe, expect, it } from 'vitest'
import { getAgentSpec } from '@/specs/registry'
import { simulateCounterStateMachine } from '@/specs/stateMachine'

function velinaCorrosionMachine() {
  return getAgentSpec('1561')!.stateMachines.find(machine => machine.id === 'velina_corrosion_state_machine')!
}

describe('counter state machine interpreter', () => {
  it('accumulates and spends corrosion on turbulence events', () => {
    const result = simulateCounterStateMachine(velinaCorrosionMachine(), {
      eventCount: 4,
    })

    expect(result.counts.microCycloneCount).toBe(3)
    expect(result.counts.broadCycloneCount).toBe(1)
    expect(result.finalValue).toBe(1)
  })

  it('applies cinema 2 wind-gain budget before spending', () => {
    const result = simulateCounterStateMachine(velinaCorrosionMachine(), {
      eventCount: 4,
      initialBudget: 2,
    })

    expect(result.counts.microCycloneCount).toBe(2)
    expect(result.counts.broadCycloneCount).toBe(2)
    expect(result.finalValue).toBe(0)
  })

  it('refunds corrosion after broad cyclone for cinema 6', () => {
    const result = simulateCounterStateMachine(velinaCorrosionMachine(), {
      eventCount: 5,
      refundEnabled: true,
    })

    expect(result.counts.microCycloneCount).toBe(3)
    expect(result.counts.broadCycloneCount).toBe(2)
    expect(result.counts.cinema6RefundCount).toBe(2)
    expect(result.finalValue).toBe(1)
  })
})
