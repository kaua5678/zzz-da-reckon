import type { PanelValues } from '@/types/catalog'

/**
 * 异常元素的纯规则（单一来源，CC-223）：变种元素 → 基础元素、元素限定的异常积蓄效率。
 *
 * 放在 `src/data/`（先例 `sharpCritMultiplier.ts` / `critMultiplier.ts`）：展示层（StatPanel）不得 import `@/core`，
 * 引擎侧 `core/anomalyPool/helpers.ts` 从这里取并原名 re-export（`VARIANT_ELEMENT_TO_BASE` / `getBaseElement`），既有 import 零改动。
 * CC-223 前 StatPanel 的「异常积蓄乘区」只认 electric，物理（简 / 派派 / 爱丽丝）和以太（薇薇安）的元素积蓄效率被漏显示。
 */

/**
 * 变种元素到基础元素的映射。
 * 变种元素的积蓄上限、持续时间、紊乱/乱流倍率均继承基础元素的值。
 * 变种元素之间在紊乱系统中视为不同元素（如 physical 和 physical_polar_assault 可互紊）。
 */
export const VARIANT_ELEMENT_TO_BASE: Record<string, string> = {
  'physical_polar_assault': 'physical',  // 爱丽丝极性强击变种
  'ether_ink': 'ether',                  // 仪玄的玄墨（独立积蓄槽，可与以太互紊）
  // 'frostfire': 'ice',                // 雅的烈霜设为冰变种时可加此行（当前 frostfire 独立）
  // 'physical_accumulation': 'physical', // 叶瞬光的积蓄（待实现）
}

/** 获取基础元素（变种 → 基础，非变种返回自身） */
export function getBaseElement(element: string): string {
  return VARIANT_ELEMENT_TO_BASE[element] ?? element
}

/** 元素限定的异常积蓄效率（百分点；按基础元素读 `<元素>AnomalyBuildUpEfficiency`，无该字段的元素为 0） */
export function elementAnomalyBuildUpEfficiency(panel: PanelValues, element: string): number {
  const baseElement = getBaseElement(element)
  if (baseElement === 'electric') return panel.electricAnomalyBuildUpEfficiency ?? 0
  if (baseElement === 'physical') return panel.physicalAnomalyBuildUpEfficiency ?? 0
  if (baseElement === 'ether') return panel.etherAnomalyBuildUpEfficiency ?? 0
  return 0
}
