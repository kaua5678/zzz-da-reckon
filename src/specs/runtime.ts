import type { PanelValues } from '@/types/catalog'
import type { AttributeConversionSpec } from './types'

export function applySpecAttributeConversions(
  panel: PanelValues,
  conversions: AttributeConversionSpec[],
  coverage = 1,
): void {
  for (const conversion of conversions) {
    const source = resolveAttributeSource(panel, conversion)
    const over = Math.max(0, source - conversion.threshold)
    const steps = Math.floor((over + 1e-9) / Math.max(0.0001, conversion.stepSize))
    let value = steps * conversion.valuePerStep * coverage * (conversion.coverage ?? 1)
    if (conversion.cap != null) {
      value = Math.min(conversion.cap, value)
    }
    panel[conversion.targetStat] = (panel[conversion.targetStat] ?? 0) + value
  }
}

function resolveAttributeSource(panel: PanelValues, conversion: AttributeConversionSpec): number {
  if (conversion.sourceValue === 'energyRegenTotal') {
    return (panel.energyRegen ?? 1.2) * (1 + (panel.energyRegenBonusPct ?? 0) / 100) + (panel.energyRegenBonusFlat ?? 0)
  }
  if (conversion.sourceValue === 'energyRegenOutOfCombat') {
    return panel.energyRegenOutOfCombat ?? (panel.energyRegen ?? 1.2)
  }
  return panel[conversion.sourceStat] ?? 0
}
