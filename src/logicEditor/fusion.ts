import type { RowFusionRule } from './types'

let activeRowFusions: RowFusionRule[] = []

export function setActiveRowFusionRules(rules: RowFusionRule[]): void {
  activeRowFusions = rules.filter(rule => rule.enabled)
}

export function getRowFusionMultiplier(moveId: string | undefined, rowId: string): number {
  if (!moveId) return 1
  let multiplier = 1
  for (const rule of activeRowFusions) {
    if (rule.moveId === moveId && rule.rowId === rowId) {
      multiplier *= rule.multiplier
    }
  }
  return multiplier
}
