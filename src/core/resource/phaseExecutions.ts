/**
 * 物化 + **相位写入**（阶段1 第二刀，2026-09-09；CC-4 外提，2026-09-25）。
 *
 * 产行钩子对 cfg 只读，相位状态由引擎在此按**同一个 state** 补写。与旧口径「写在 buildExecutions
 * 里」逐位等价（同一调用点、同一 state、同一值），但产行函数变纯——`materializeRows` 不再需要为
 * 这些字段兜底快照/恢复。
 * 注意：`materializeRows` 内部**不**调本包装（那条路径会快照/恢复，写入本就该被丢弃）。
 *
 * 依赖方向：只依赖 `./helpers#buildExecutions` 与 `@/mechanics#getAgentMechanic`；
 * 不得 import `core/resource.ts`（防循环依赖）。
 */
import type { CharacterOperationConfig, IterationState, SkillExecution } from '@/types/resource'
import { getAgentMechanic } from '@/mechanics/registry'
import { buildExecutions } from './helpers'

export function buildExecutionsWithPhase(
  cfg: CharacterOperationConfig,
  state: IterationState,
  chainCountTotal: number,
  teamFrontlineSeconds: number,
  moduleInputRows?: SkillExecution[],
): SkillExecution[] {
  const rows = buildExecutions(cfg, state, chainCountTotal, teamFrontlineSeconds, moduleInputRows)
  getAgentMechanic(cfg.agentId)?.materializePhaseState?.({ cfg, state, executions: rows, teamFrontlineSeconds })
  return rows
}
