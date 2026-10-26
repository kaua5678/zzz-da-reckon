import { agentSpecs } from '@/specs/registry'
import type { RowFusionRule } from './types'

/**
 * spec 声明的行融合规则（`specs/agents/*.json#rowFusions`）→ 运行时规则表。
 *
 * beta 冻结 spec（`beta: true`）不进默认规则：冻结旧版是只读历史，其 id 与正主同名，
 * 混入会造成同 id 双规则。
 *
 * 生效时机：启动入口激活一次（生产 `useCalculatorStartup`、测试 `setupHarness`）——
 * 原「逻辑编辑」页下线后，spec 声明是这条通道的唯一来源。
 */
export function defaultRowFusionRules(): RowFusionRule[] {
  return agentSpecs.filter(spec => !spec.beta).flatMap(spec =>
    spec.rowFusions.map(fusion => ({
      id: fusion.id,
      specId: spec.id,
      name: `${spec.name}·${fusion.name}`,
      agentId: fusion.agentId,
      moveId: fusion.moveId,
      rowId: fusion.rowId,
      multiplier: fusion.multiplier,
      enabled: fusion.enabled,
      note: fusion.note,
    })),
  )
}
