import type { AgentMechanicModule } from './types'
import type { MechanicSetting } from '@/types/resource'
import { agentSpecs } from '@/specs/registry'
import { specToMechanicModule } from '@/specs/mechanics'

const agentMechanics = new Map<string, AgentMechanicModule>()
const settingDefaults = new Map<string, MechanicSetting>()

/** 注册角色机制模块。重复 agentId 或非法模块会在启动阶段直接抛错。 */
export function registerAgentMechanic(module: AgentMechanicModule): void {
  if (!module?.id) throw new Error('[mechanics] module id is required')
  if (!Array.isArray(module.agentIds) || module.agentIds.length === 0) {
    throw new Error(`[mechanics] module ${module.id} must declare agentIds`)
  }

  for (const agentId of module.agentIds) {
    if (!agentId) throw new Error(`[mechanics] module ${module.id} contains empty agentId`)
    if (agentMechanics.has(agentId)) {
      const existing = agentMechanics.get(agentId)!
      throw new Error(`[mechanics] agent ${agentId} already registered by ${existing.id}`)
    }
    agentMechanics.set(agentId, module)
  }

  const spec = agentSpecs.find(item => item.agentIds.some(id => module.agentIds.includes(id)))
  if (spec) {
    const specSettings = specToMechanicModule(spec).settings ?? []
    const existingIds = new Set((module.settings ?? []).map(setting => setting.id))
    const merged = [
      ...(module.settings ?? []),
      ...specSettings.filter(setting => !existingIds.has(setting.id)),
    ]
    if (merged.length > 0) module.settings = merged
  }

  for (const setting of module.settings ?? []) {
    if (!setting?.id) throw new Error(`[mechanics] module ${module.id} contains setting without id`)
    if (settingDefaults.has(setting.id)) {
      throw new Error(`[mechanics] setting ${setting.id} already registered`)
    }
    settingDefaults.set(setting.id, setting)
  }
}

export function getAgentMechanic(agentId: string): AgentMechanicModule | undefined {
  return agentMechanics.get(agentId)
}

export function getRegisteredAgentMechanics(): AgentMechanicModule[] {
  return [...new Set(agentMechanics.values())]
}

export function getMechanicSetting(id: string): MechanicSetting | undefined {
  return settingDefaults.get(id)
}

export function getRegisteredMechanicSettings(): MechanicSetting[] {
  return [...settingDefaults.values()]
}
