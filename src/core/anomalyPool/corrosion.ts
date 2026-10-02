/**
 * 风蚀状态解析（规则 6 引擎落点，2026-09-25 CC-6d）。
 *
 * 取代原先 `core/anomalyPool.ts` 与 `core/anomalyPool/helpers.ts` 对
 * `@/mechanics/agents/velina#resolveVelinaCorrosion` 的两处**值导入**——引擎静态 import
 * 角色模块正是规则 6 要消灭的形状（判据 12 core 角色 import 棘轮盯着）。
 *
 * 现改为：引擎按**模块能力** `anomalyCorrosion` 查询。异常池契约是纯数据（`AnomalyPoolInput`），
 * 调用方把 `input.teamMechanics`（**在队**模块 + 槽位；生产 = `teamMechanicSlots(configStore.team)`，
 * 见 `composables/resourceCalc/roundInputs.ts`）递进来，本函数按列表（= 注册）顺序取第一个非 undefined 结果，
 * 并给每个模块附上自己的 `self {slot, panel}`。
 *
 * r399 CC-373：原参数是 `agentMechanics`（**全部已注册**模块、无槽位）⇒ 维琳娜只能在面板上盖
 * `velinaEnabled` 再扫 `panels` 认自己；现只对在队模块派发并给身份，标记已删。
 *
 * 本文件不写 agentId 字面量、不 import 角色模块（两条 core 棘轮盯着）；只 `import type`
 * 角色相关类型。
 */
import type { PanelValues } from '@/types/catalog'
import type { CorrosionSource, AnomalyEventRecord } from '@/types/resource'
import type { TeamMechanic } from '@/mechanics/types'
import { panelAt } from '../panel'

/**
 * 解析本队风蚀状态：按注册顺序取第一个认领的 `anomalyCorrosion` 结果。
 *
 * @param teamMechanics 在队角色机制模块 + 槽位
 * @param panels 本次结算用的面板（`self.panel` 从这里按槽位取，调用方传哪份就读哪份）
 * @returns 风蚀状态；无模块认领（队里没有维琳娜）⇒ `undefined`
 */
export function resolveAnomalyCorrosion(
  teamMechanics: readonly TeamMechanic[],
  panels: readonly PanelValues[],
  turbulenceCount: number,
  windTriggerCount: number,
): CorrosionSource | undefined {
  for (const { module, slot } of teamMechanics) {
    if (!module.anomalyCorrosion) continue
    const result = module.anomalyCorrosion({ self: { slot, panel: panelAt(panels, slot) }, turbulenceCount, windTriggerCount })
    if (result !== undefined) return result
  }
  return undefined
}

/**
 * CC-71：风蚀气旋异放事件记录——取第一个声明 `anomalyCorrosionEvents` 的在队模块（现唯一 = 维琳娜）；无 ⇒ []。
 * 调用方只在 `resolveAnomalyCorrosion` 有结果时调用。
 */
export function resolveAnomalyCorrosionEvents(
  teamMechanics: readonly TeamMechanic[],
  source: CorrosionSource,
): AnomalyEventRecord[] {
  for (const { module } of teamMechanics) {
    if (module.anomalyCorrosionEvents) return module.anomalyCorrosionEvents(source)
  }
  return []
}
