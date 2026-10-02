import type { AgentMechanicModule, TeamMechanic } from './types'
import type { MechanicSetting } from '@/types/resource'
import type { AutoAxisPresetHints } from '@/data/stunAxisPresets'

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

  // spec 声明的 settings 合并已移至注册入口 mechanics/index.ts#registerWithSpecSettings（CC-247：
  // 本文件保持纯叶子——core 按 C1 只认 registry，registry 若值导入 specs 会把 specs 运行时 / data 行查询 /
  // logicEditor 全局快照带进 core 运行时闭包；锁 coreRuntimeDeps.test）。

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
 * 「放进轴不起作用」的招式（唯一实现，CC-393 由 composables/agentMechanicView 下沉到本层）：
 * 模块声明的 `axisHiddenMoves` ∪ `attachedEvents` 全部子行（伴随行跟随父动作的轴内占比，自身放置不计，CC-392）。
 * 消费方：轴编辑器候选池（经 agentMechanicView 门面）与 [表] 直读判定（resourceCalc/axisTableDirect）。
 */
export function axisHiddenMovesOf(agentId: string | null | undefined): readonly string[] {
  const mod = agentId ? agentMechanics.get(agentId) : undefined
  if (!mod) return []
  return [...(mod.axisHiddenMoves ?? []), ...Object.values(mod.attachedEvents ?? {}).flat()]
}

type TeamLike = ReadonlyArray<{ agentId?: string | null } | null | undefined>

/**
 * 模块在队槽位（r399 CC-373）：队中第一个 agentId ∈ `module.agentIds` 的槽位；不在队 ⇒ -1。
 * 「按模块派发、钩子要知道我是谁」的派发点共用的**唯一定位器**（`teamMechanicSlots`、
 * `composables/resourceCalc/damagePool.ts#releaseModifierSelf`）——模块不再往自己面板盖标记、再扫面板认自己。
 */
export function findModuleSlot(module: Pick<AgentMechanicModule, 'agentIds'>, team: TeamLike): number {
  return team.findIndex(c => !!c?.agentId && module.agentIds.includes(c.agentId))
}

/**
 * 在队模块 + 槽位（r399 CC-373），**按注册顺序**排列（不是槽位顺序：多个模块的同类钩子按注册顺序执行，
 * 与原「遍历全部已注册模块」的调用顺序一致）。不在队的模块不出现 ⇒ 钩子只对在队模块派发。
 * 生产入口：`composables/resourceCalc/roundInputs.ts` → `AnomalyPoolInput.teamMechanics`。
 */
export function teamMechanicSlots(
  team: TeamLike,
  modules: readonly AgentMechanicModule[] = getRegisteredAgentMechanics(),
): TeamMechanic[] {
  const out: TeamMechanic[] = []
  for (const module of modules) {
    const slot = findModuleSlot(module, team)
    if (slot >= 0) out.push({ module, slot })
  }
  return out
}

/**
 * 交互补齐产出者槽位（CC-293）：队中第一个挂出 `computeInteractionTopUp` 能力的槽位；无 ⇒ -1。
 * convergence 找槽与 useResourceCalc 交互栏懒守卫共用（两处判定同源）；能力存在即声明，不另设旗标。
 */
export function findInteractionTopUpSlot(team: ReadonlyArray<{ agentId?: string | null } | null | undefined>): number {
  return team.findIndex(c => !!c?.agentId && typeof getAgentMechanic(c.agentId)?.computeInteractionTopUp === 'function')
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
