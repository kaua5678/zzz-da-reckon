import type { AgentMechanicModule, TeamMechanic } from './types'
import type { MechanicSetting } from '@/types/resource'
import type { AutoAxisPresetHints } from '@/data/stunAxisPresets'

const agentMechanics = new Map<string, AgentMechanicModule>()
const settingDefaults = new Map<string, MechanicSetting>()

/** 注册角色机制模块。重复 agentId 或非法模块会在启动阶段直接抛错。 */
export function registerAgentMechanic(module: AgentMechanicModule): void {
  if (!module.id) throw new Error('[mechanics] module id is required')
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

  // settings 按**模块**归属（跨模块同 id 允许并存）；`settingDefaults` 是全局裸 id 索引，
  // **首注册优先**：活体模块在 mechanics/index.ts 先注册、beta 冻结副本后注册 ⇒ 活体缺省胜出。
  // 动机（2026-10-24 beta 快照）：测试服角色旧版冻结成副本模块（`<id>v<n>`）后，其滑块 id 与
  // 正主相同——若全局抛错，快照直接打死启动。语义口径：同名滑块 = 全局一个取值槽，
  // 用户设过值则两版共享同一值（对比两版强度时口径一致）；未设值时按首注册（活体）缺省。
  // 模块内同 id 重复声明仍是录入错误，照抛。
  const seen = new Set<string>()
  for (const setting of module.settings ?? []) {
    if (!setting.id) throw new Error(`[mechanics] module ${module.id} contains setting without id`)
    if (seen.has(setting.id)) {
      throw new Error(`[mechanics] module ${module.id} declares setting ${setting.id} twice`)
    }
    seen.add(setting.id)
    if (!settingDefaults.has(setting.id)) settingDefaults.set(setting.id, setting)
  }
}

export function getAgentMechanic(agentId: string): AgentMechanicModule | undefined {
  return agentMechanics.get(agentId)
}

/**
 * 「放进轴不起作用」的招式（唯一实现，CC-393 由 composables/agentMechanicView 下沉到本层）：
 * 模块声明的 `axisHiddenMoves` ∪ `attachedEvents` 全部子行（伴随行跟随父动作的轴内占比，自身放置不计，CC-392）。
 * 消费方：轴编辑器候选池（经 agentMechanicView 门面）与 [表] 直读判定（resourceCalc/axisTableDirect）。
 *
 * CC-402：额外参数 `executedMoveIds`（本角色**有执行行**的 moveId 集合）——给了才展开 `moveBranchGroups`：
 * 组内任一成员有执行行 ⇒ 组内其余成员并入隐藏集（同一动作的互斥分支，另一分支以 [表] 出现即双计）。
 * 不传 ⇒ 行为与旧签名逐位一致（展示门面 `agentMechanicView#agentAxisHiddenMoves` 不传）。
 */
export function axisHiddenMovesOf(
  agentId: string | null | undefined,
  executedMoveIds?: ReadonlySet<string>,
): readonly string[] {
  const mod = agentId ? agentMechanics.get(agentId) : undefined
  if (!mod) return []
  const out = [...(mod.axisHiddenMoves ?? []), ...Object.values(mod.attachedEvents ?? {}).flat()]
  if (executedMoveIds) {
    for (const group of mod.moveBranchGroups ?? []) {
      if (!group.some(id => executedMoveIds.has(id))) continue
      for (const id of group) {
        if (!executedMoveIds.has(id) && !out.includes(id)) out.push(id)
      }
    }
  }
  return out
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

/**
 * 机制滑块解析（`setting id → 当前值`，用户值优先、缺省回落声明 default）。
 *
 * 单一事实源：编排层 `composables/resourceCalc/panelPhases.ts#resolveMechanicSettings` 与
 * store 的配装推荐（`applyBuildRecommendationForSlot` 的副词条基线面板）都必须用同一份解析，
 * 否则两处面板的滑块取值会分叉（2026-10-18 百暴溢出修复时把这条抽到 mechanics 层，
 * store 与 composables 都能 import，而不必让 store 反向依赖 composables）。
 */
export function resolveMechanicSettingMap(
  values: Readonly<Record<string, number>>,
  settings: readonly MechanicSetting[] = getRegisteredMechanicSettings(),
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const setting of settings) {
    const value = values[setting.id]
    out[setting.id] = typeof value === 'number' && Number.isFinite(value) ? value : setting.default
  }
  return out
}
