import type { AgentMechanicModule } from './types'
import type { MechanicSetting } from '@/types/resource'
import type { AutoAxisPresetHints } from '@/data/stunAxisPresets'
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

/**
 * 自动失衡轴选档提示（CC-60；CC-246 自 composables/agentMechanicView 迁入）：由注册表派生的纯声明读取，
 * 生产入口 resourceCalc/roundInputs#autoPreset 传给 data `selectAutoStunAxisPreset`（data 层不 import mechanics）。
 * 放在 mechanics 而非展示门面：管线层不得反向依赖展示层 composable（锁 resourceCalcStoreDeps.test）。
 */
export const AUTO_AXIS_PRESET_HINTS: AutoAxisPresetHints = {
  isChapterOwner: id => !!getAgentMechanic(id)?.axisPresetChapterOwner,
  isPreferred: id => !!getAgentMechanic(id)?.axisPresetPreferred,
}

export function getRegisteredAgentMechanics(): AgentMechanicModule[] {
  return [...new Set(agentMechanics.values())]
}

export function getRegisteredMechanicSettings(): MechanicSetting[] {
  return [...settingDefaults.values()]
}
