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
 * ⚠ **已知语义差（lead 已核，可接受）**：调用方**不传** `agentMechanics` 且面板带
 * `velinaEnabled` 时，旧式（直接调 `resolveVelinaCorrosion`）仍会结算风蚀、新式不结算。
 * 仓库内唯一不传的调用方是 `src/core/anomalyPool/__tests__/onStunBuildup.test.ts`，
 * 其面板无 `velinaEnabled` ⇒ 两边都是 `undefined`（逐位等价）。
 */
import type { PanelValues } from '@/types/catalog'
import type { VelinaCorrosionSource } from '@/types/resource'
import type { AgentMechanicModule } from '@/mechanics/types'

/**
 * 解析本队风蚀状态：按模块注册顺序取第一个认领的 `anomalyCorrosion` 结果。
 *
 * @param agentMechanics 已注册角色机制模块列表；`undefined` = 调用方未提供 ⇒ 返回 `undefined`
 * @param fallbackRate C2 风化获得风蚀的期望利用率；`undefined` 原样透传给能力函数，
 *   由模块侧 `resolveVelinaCorrosion` 的默认参数 `2/3` 兜底——引擎**不补默认值**
 * @returns 风蚀状态；无模块认领（队里没有维琳娜）⇒ `undefined`
 */
export function resolveAnomalyCorrosion(
  agentMechanics: readonly AgentMechanicModule[] | undefined,
  panels: readonly PanelValues[],
  turbulenceCount: number,
  windTriggerCount: number,
  fallbackRate?: number,
): VelinaCorrosionSource | undefined {
  if (!agentMechanics) return undefined
  for (const mech of agentMechanics) {
    const result = mech.anomalyCorrosion?.({ panels, turbulenceCount, windTriggerCount, fallbackRate })
    if (result !== undefined) return result
  }
  return undefined
}
