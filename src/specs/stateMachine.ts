import type { CounterStateMachineSpec } from './types'

export interface CounterStateMachineOptions {
  eventCount: number
  initialBudget?: number
  refundEnabled?: boolean
}

export interface CounterStateMachineResult {
  finalValue: number
  counts: Record<string, number>
  note?: string
}

export function simulateCounterStateMachine(
  machine: CounterStateMachineSpec,
  options: CounterStateMachineOptions,
): CounterStateMachineResult {
  const eventCount = Math.max(0, Math.floor(options.eventCount))
  let value = machine.initialValue
  let budget = Math.max(0, options.initialBudget ?? 0)
  const counts: Record<string, number> = {}

  for (const output of machine.outputs) {
    counts[output.id] = 0
  }

  for (let i = 0; i < eventCount; i++) {
    if (budget > 0 && value < machine.spendThreshold) {
      const remainingEvents = eventCount - i
      const gainNow = Math.min(
        machine.spendThreshold - value,
        budget / Math.max(1, remainingEvents),
      )
      value += gainNow
      budget -= gainNow
    }

    if (value >= machine.spendThreshold) {
      value -= machine.spendThreshold
      addCount(machine, counts, 'broad')
      addCount(machine, counts, 'boosted')
      if (options.refundEnabled && machine.refundPerSpend > 0) {
        value = Math.min(machine.maxValue, value + machine.refundPerSpend)
        addCount(machine, counts, 'refund')
      }
    } else {
      value = Math.min(machine.maxValue, value + machine.gainPerEvent)
      addCount(machine, counts, 'micro')
    }
  }

  return {
    finalValue: Math.max(0, Math.min(machine.maxValue, value)),
    counts,
    note: machine.note,
  }
}

function addCount(
  machine: CounterStateMachineSpec,
  counts: Record<string, number>,
  kind: 'micro' | 'broad' | 'boosted' | 'refund',
): void {
  for (const output of machine.outputs) {
    if (output.kind === kind) {
      counts[output.id] = (counts[output.id] ?? 0) + 1
    }
  }
}
