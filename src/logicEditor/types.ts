/**
 * 行融合规则：spec `rowFusions` 声明 → 倍率表取值处按 moveId + rowId 相乘。
 *
 * 原「逻辑编辑」页（可视化增删改规则）已于 2026-10-26 下线；默认规则现在只来自
 * spec 声明（`specs/agents/*.json#rowFusions`），运行时快照见 `fusion.ts`。
 */
export interface RowFusionRule {
  id: string
  specId?: string
  name: string
  agentId: string
  moveId: string
  rowId: string
  multiplier: number
  enabled: boolean
  note: string
}
