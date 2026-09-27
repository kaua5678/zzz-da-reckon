import type { PanelValues } from '@/types/catalog'
import type { AttributeConversionSpec } from './types'

/**
 * 可选来源面板（R6 C7 §2.5-①，第 143 轮）。**opt-in**：不传时只读 `panel`，`sourcePanelPhase` 仅作文档（迁移前行为）。
 * 传了 `outOfCombat` 时，声明 `sourcePanelPhase: 'outOfCombat'` 的条目改从局外面板读 `sourceStat`（只读不写）。
 * ⚠ 给已有调用点补传 sources 可能改数值（例：1451 lucia_c6_hp_to_atk 声明局外、现按局内执行），须走 CC 卡。
 */
export interface SpecConversionSources {
  outOfCombat?: Readonly<PanelValues>
}

export function applySpecAttributeConversions(
  panel: PanelValues,
  conversions: AttributeConversionSpec[],
  coverage = 1,
  sources?: SpecConversionSources,
): void {
  for (const conversion of conversions) {
    const source = resolveAttributeSource(panel, conversion, sources)
    const over = Math.max(0, source - conversion.threshold)
    const steps = conversion.stepRounding === 'none'
      ? over / Math.max(0.0001, conversion.stepSize)
      : Math.floor((over + 1e-9) / Math.max(0.0001, conversion.stepSize))
    // 先封顶、再乘覆盖率（R6 C7 §2.5-②，第 144 轮）：覆盖率是时间占比，满额值按时间加权才对；
    // 旧写法 min(cap, 值×覆盖率) 在覆盖率<1 且超上限时偏高。改动时全仓覆盖率恒为 1（调用方不传或传 1、
    // spec 仅 1451 lucia_c6_hp_to_atk 写 coverage:1）⇒ 逐位零差。
    let value = steps * conversion.valuePerStep
    if (conversion.cap != null) {
      value = Math.min(conversion.cap, value)
    }
    value = value * coverage * (conversion.coverage ?? 1)
    panel[conversion.targetStat] = (panel[conversion.targetStat] ?? 0) + value
  }
}

function resolveAttributeSource(panel: PanelValues, conversion: AttributeConversionSpec, sources?: SpecConversionSources): number {
  if (conversion.sourceValue === 'energyRegenTotal') {
    return (panel.energyRegen ?? 1.2) * (1 + (panel.energyRegenBonusPct ?? 0) / 100) + (panel.energyRegenBonusFlat ?? 0)
  }
  if (conversion.sourceValue === 'energyRegenOutOfCombat') {
    return panel.energyRegenOutOfCombat ?? (panel.energyRegen ?? 1.2)
  }
  const from: Readonly<PanelValues> = conversion.sourcePanelPhase === 'outOfCombat' && sources?.outOfCombat ? sources.outOfCombat : panel
  return from[conversion.sourceStat] ?? 0
}
