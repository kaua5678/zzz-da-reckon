/**
 * 帷幕触发信息解析（规则 6 引擎落点，2026-09-25 CC-6b）。
 *
 * 取代原先散在 `core/resource/helpers.ts#iterateBody` 与 `core/resource.ts` 收敛后两处的
 * 角色专属数学：按 `agentId === '1451'` 找卢西娅槽 → 调 `computeLuciaCurtainTriggers`
 * （含直接读**队友槽** `yidhariSlot` 的 `ultimateCount`）。这正是规则 6 要消灭的形状
 * （引擎替某个角色认人 + 读别的槽位中间态）。
 *
 * 现改为：
 *   · 帷幕提供者按**模块能力** `getAgentMechanic(cfg.agentId)?.curtainTriggers` 找槽；
 *   · 「队友开帷幕」按**跨槽供给类别** `crossAgentSupply.kind='curtain-open'` 收集成标量
 *     （伊德海莉每次终结技开一次帷幕，见 `yidhari.ts`），能力函数只吃标量；
 *   · 本文件不写 agentId 字面量、不 import 角色模块（两条 core 棘轮盯着）。
 *
 * ⚠ **前提（2026-09-25 lead 裁决 §6-2）**：当前**唯一帷幕提供者 = 唯一外部回血源 = 卢西娅**，
 * 故 `providerSlot` 同时充当「外部回血源槽」（`resource.ts` 装配段按它取 `ultimateCount` 折算
 * 伊德海莉回血）。**出现第二个帷幕提供者时必须把回血源拆成独立能力**（新 kind 或独立字段），
 * 不能继续复用 `providerSlot`——否则外部回血会按错误的槽位算。
 */
import type { CharacterOperationConfig, IterationState } from '@/types/resource'
import { getAgentMechanic } from '@/mechanics/registry'
import { crossAgentSupplyCountOf, findCrossAgentSupplySlots } from './crossAgentSupply'

export interface CurtainInfo {
  /** 帷幕提供者槽位（无提供者 = -1） */
  providerSlot: number
  /** 本态下的帷幕触发总次数（含队友开帷幕；15s CD 封顶 × 利用率滑块已折算） */
  triggers: number
  /** 队友开帷幕总量（引擎按 `curtain-open` 收集；无队友时为 0） */
  teammateOpenCount: number
}

const NO_CURTAIN: CurtainInfo = { providerSlot: -1, triggers: 0, teammateOpenCount: 0 }

/**
 * 解析本态下的帷幕信息。`states` 与 `configs` 同序（引擎内两者恒等长）。
 * 契约：纯查询，不写 cfg；`curtainTriggers` 能力本身是纯函数。
 */
export function curtainInfoOf(
  configs: CharacterOperationConfig[],
  states: IterationState[],
  totalTime: number,
): CurtainInfo {
  const providerSlot = configs.findIndex(c => getAgentMechanic(c.agentId)?.curtainTriggers)
  if (providerSlot < 0) return NO_CURTAIN
  const teammateOpenCount = findCrossAgentSupplySlots(configs, 'curtain-open')
    .reduce((n, s) => n + crossAgentSupplyCountOf(configs, states, s, { totalTime, stunCount: 0 }), 0)
  const triggers = getAgentMechanic(configs[providerSlot].agentId)!.curtainTriggers!({
    cfg: configs[providerSlot],
    state: states[providerSlot],
    teammateOpenCount,
    totalTime,
  })
  return { providerSlot, triggers, teammateOpenCount }
}
