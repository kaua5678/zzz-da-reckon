/**
 * 风蚀状态解析（规则 6 引擎落点，2026-09-25 CC-6d）。
 *
 * 取代原先 `core/anomalyPool.ts` 与 `core/anomalyPool/helpers.ts` 对
 * `@/mechanics/agents/velina#resolveVelinaCorrosion` 的两处**值导入**——引擎静态 import
 * 角色模块正是规则 6 要消灭的形状（判据 12 core 角色 import 棘轮盯着）。
 *
 * 现改为：引擎按**模块能力** `getAgentMechanic(cfg.agentId)?.anomalyCorrosion` 查询——
 * 但异常池契约是纯数据（`AnomalyPoolInput`），没有 agentId 派发上下文，故调用方把
 * `input.agentMechanics`（生产 = `getRegisteredAgentMechanics()`，见 `convergence.ts`）
 * 递进来，本函数**按列表顺序取第一个非 undefined 结果**。
 *
 * 本文件不写 agentId 字面量、不 import 角色模块（两条 core 棘轮盯着）；只 `import type`
 * 角色相关类型。
 *
 * CC-179（第 202 轮）：`agentMechanics` 在 `AnomalyPoolInput` 上改为必填，原「调用方不传 ⇒ 不结算风蚀」的
 * 已知语义差随之消失（不传会编译报错；测试不需要模块时显式传 `[]`）。
 */
import type { PanelValues } from '@/types/catalog'
import type { CorrosionSource, AnomalyEventRecord } from '@/types/resource'
import type { AgentMechanicModule } from '@/mechanics/types'

/**
 * 解析本队风蚀状态：按模块注册顺序取第一个认领的 `anomalyCorrosion` 结果。
 *
 * @param agentMechanics 已注册角色机制模块列表（CC-179 起必填）
 * @returns 风蚀状态；无模块认领（队里没有维琳娜）⇒ `undefined`
 */
export function resolveAnomalyCorrosion(
  agentMechanics: readonly AgentMechanicModule[],
  panels: readonly PanelValues[],
  turbulenceCount: number,
  windTriggerCount: number,
): CorrosionSource | undefined {
  for (const mech of agentMechanics) {
    const result = mech.anomalyCorrosion?.({ panels, turbulenceCount, windTriggerCount })
    if (result !== undefined) return result
  }
  return undefined
}

/**
 * CC-71：风蚀气旋异放事件记录——取第一个声明 `anomalyCorrosionEvents` 的在队模块（现唯一 = 维琳娜）；无 ⇒ []。
 * 调用方只在 `resolveAnomalyCorrosion` 有结果时调用。
 */
export function resolveAnomalyCorrosionEvents(
  agentMechanics: readonly AgentMechanicModule[],
  source: CorrosionSource,
): AnomalyEventRecord[] {
  for (const mech of agentMechanics) {
    if (mech.anomalyCorrosionEvents) return mech.anomalyCorrosionEvents(source)
  }
  return []
}
