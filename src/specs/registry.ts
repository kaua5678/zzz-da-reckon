import type { AgentMechanicSpec } from './types'

/** 直接转型：字段形状由 validate:data 的 JSON 契约按 AgentMechanicSpec 校验（scripts/lib/json-contract.mjs），语义由 validate:specs 查 */
export const agentSpecs = Object.values(import.meta.glob('./agents/*.json', { eager: true, import: 'default' })) as AgentMechanicSpec[]

export function getAgentSpec(agentId: string): AgentMechanicSpec | undefined {
  return agentSpecs.find(spec => spec.agentIds.includes(agentId))
}

export function getAgentSpecsByAgentId(): Map<string, AgentMechanicSpec> {
  const map = new Map<string, AgentMechanicSpec>()
  for (const spec of agentSpecs) {
    for (const agentId of spec.agentIds) {
      map.set(agentId, spec)
    }
  }
  return map
}
