import { shallowRef } from 'vue'
import type { RowFusionRule } from './types'

type EffectiveFusion = Pick<RowFusionRule, 'moveId' | 'rowId' | 'multiplier'>

// The container is reactive, but its values are independent of editable drafts.
// getRowValue consumers inside computed() must see activation, disabling and history navigation.
const activeRowFusions = shallowRef<EffectiveFusion[]>([])

export function setActiveRowFusionRules(rules: RowFusionRule[]): void {
  const next = rules.filter(rule => rule.enabled).map(({ moveId, rowId, multiplier }) => ({ moveId, rowId, multiplier }))
  const previous = activeRowFusions.value
  // Metadata changes / repeated saves must not invalidate expensive calculation consumers.
  if (next.length === previous.length && next.every((rule, index) => {
    const old = previous[index]
    return old.moveId === rule.moveId && old.rowId === rule.rowId && Object.is(old.multiplier, rule.multiplier)
  })) return
  activeRowFusions.value = next
}

export function getRowFusionMultiplier(moveId: string | undefined, rowId: string): number {
  if (!moveId) return 1
  let multiplier = 1
  for (const rule of activeRowFusions.value) {
    if (rule.moveId === moveId && rule.rowId === rowId) {
      multiplier *= rule.multiplier
    }
  }
  return multiplier
}
