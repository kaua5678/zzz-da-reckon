import type { AgentMechanicSpec } from './types'

const specModules = import.meta.glob('./agents/*.json', { eager: true })

export const agentSpecs: AgentMechanicSpec[] = Object.values(specModules)
  .map(module => (module as { default?: unknown }).default ?? module)
  .map(spec => spec as AgentMechanicSpec)

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

export function summarizeAgentSpecs(): Array<{
  id: string
  name: string
  agentIds: string[]
  status: string
  conversions: number
  resources: number
  fusions: number
  events: number
  notes: string[]
}> {
  return agentSpecs.map(spec => ({
    id: spec.id,
    name: spec.name,
    agentIds: spec.agentIds,
    status: spec.status,
    conversions: spec.attributeConversions.length,
    resources: spec.resources.length,
    fusions: spec.rowFusions.length,
    events: spec.events.length,
    notes: spec.notes,
  }))
}
