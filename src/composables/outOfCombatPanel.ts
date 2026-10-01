/**
 * 局外面板（配置页「局外」模式）。
 *
 * 第 195 轮（CC-169）：直接取引擎的局外面板 `computePanelPhases(slot).outOfCombat`，删掉本文件原先的独立组装。
 * - 为什么：各角色「初始 X」转化（applyPanel / buildCharConfig 的 `outOfCombatPanel`，20+ 个模块）读的就是这个面板；
 *   用户看「局外」就是为了核对这些「初始属性」。原实现（CC-51 照搬初始提交的页面写法）另起一份组装：
 *   队友 buff 用原始上下文（缺门控 / 接收槽过滤 / 来源修正）、覆盖率只含音擎表，并把启用的全局 Buff
 *   **事后叠加到局外**——而引擎把全局 Buff 当**局内**效果（`resolveSlotPanelBuffInputs` 里 `scope: 'inCombat'`）。
 *   于是「局外」展示的数值不是引擎拿去做转化的数值。
 * - 口径变化：启用的全局 Buff 不再出现在「局外」，只出现在「局内」（与引擎一致）。伤害零影响（纯展示）。
 * - 回退点：revert 该提交（或恢复「对 result.outOfCombat 逐条 applyTargetedStat 全局 Buff」的循环）。
 */
import type { PanelValues } from '@/types/catalog'
import type { ConfigModel } from '@/stores/config'
import type { useCatalogStore } from '@/stores/catalog'
import { computePanelPhases } from './resourceCalc/panelPhases'

export function computeOutOfCombatPanel(
  slot: number,
  configStore: ConfigModel,
  catalogStore: ReturnType<typeof useCatalogStore>,
): PanelValues | null {
  const phases = computePanelPhases(slot, configStore, catalogStore)
  return phases ? { ...phases.outOfCombat } : null
}
