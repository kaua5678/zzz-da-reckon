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

/**
 * 属性数值口径的元素解析（用户口径 2026-09-05）：雅的烈霜(frostfire)在一切【元素→数值】查找里
 * 按冰族读——冰伤/敌方冰抗/冰减抗/冰积蓄效率等全同冰。烈霜的特别之处只在异常身份：独立积蓄槽、
 * 可与冰互相紊乱（而非同种覆盖）——身份判断（覆盖/紊乱/持续时间/阈值）继续用 getBaseElement /
 * 精确元素 key，不经过本映射。与 VARIANT_ELEMENT_TO_BASE 的区别：后者是"继承基础元素公式"的
 * 变种登记表（会把身份语义一并带过去），frostfire 有独立的持续时间/紊乱公式，不进那张表。
 * （CC-224 自 core/anomalyPool/helpers.ts 逐字迁入，helpers 原名转出。）
 */
export function resolveStatElement(element?: string): string | undefined {
  if (!element) return element
  const base = getBaseElement(element)
  return base === 'frostfire' ? 'ice' : base
}

/** 元素限定的异常积蓄效率（百分点；按基础元素读 `<元素>AnomalyBuildUpEfficiency`，无该字段的元素为 0） */
export function elementAnomalyBuildUpEfficiency(panel: PanelValues, element: string): number {
  const baseElement = getBaseElement(element)
  if (baseElement === 'electric') return panel.electricAnomalyBuildUpEfficiency ?? 0
  if (baseElement === 'physical') return panel.physicalAnomalyBuildUpEfficiency ?? 0
  if (baseElement === 'ether') return panel.etherAnomalyBuildUpEfficiency ?? 0
  return 0
}

/**
 * 异常积蓄的「异常掌控区 × 积蓄效率区」（CC-429 单一事实源；引擎 `calcPerHitBuildUp` 与 StatPanel 展示共用）。
 * - 掌控区 = floor(anomalyMastery) / 100，无上限（整数截断是引擎口径，展示层不得自己抄一份）
 * - 效率区 = 1 + (面板通用效率 + 元素限定效率 + 行级招式限定效率) / 100，全部**加算**
 * 乘法顺序 `base × 掌控 × 效率` 与改前引擎逐字一致（零差快照位级不变）；展示层传 `base = 1` 得到「当前面板积蓄乘数」。
 * 积蓄抗性区不在这里（它依赖敌方抗性，展示层不显示）。
 */
export function anomalyBuildUpAfterMasteryAndEfficiency(
  baseBuildUp: number,
  panel: PanelValues,
  element: string,
  rowEfficiencyBonusPct = 0,
): number {
  const mastery = Math.floor(panel.anomalyMastery ?? 0)
  const afterMastery = baseBuildUp * (mastery / 100)
  const buildUpEff = (panel.anomalyBuildUpEfficiency ?? 0)
    + elementAnomalyBuildUpEfficiency(panel, element)
    + rowEfficiencyBonusPct
  return afterMastery * (1 + buildUpEff / 100)
}
