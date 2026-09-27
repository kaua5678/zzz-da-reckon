/**
 * 展示层读取角色模块**声明式数据**的只读门面（CC-47，2026-09-27，判据 7「展示层越层 import」还款）。
 *
 * views/components 不直接 import '@/mechanics'（判据 7），改经本文件取模块声明：
 * settings（机制设置表）/ combos（轴连段定义）/ resourceSections（资源卡专属分区）。
 * 纯转发：不计算、不缓存；语义与原展示层内联写法逐位一致（见各函数注释）。
 */
import { getAgentMechanic } from '@/mechanics'
import type { AgentMechanicModule, AxisEditorBlockMark } from '@/mechanics/types'
import type { MechanicSetting } from '@/types/resource'

/**
 * 队伍各槽模块声明的机制设置，按 `setting.id` 去重、**先出现的槽位优先**；
 * 顺序 = 槽位顺序 × 模块内声明顺序；空槽跳过。
 * 原位置：ResourceUtilizationPage.vue `mechanicSettings`、ImpactChart.vue `settingMap`（两处同口径）。
 */
export function teamMechanicSettings(
  team: ReadonlyArray<{ agentId?: string | null } | null | undefined>,
): MechanicSetting[] {
  const seen = new Set<string>()
  const out: MechanicSetting[] = []
  for (const char of team) {
    if (!char?.agentId) continue
    for (const setting of getAgentMechanic(char.agentId)?.settings ?? []) {
      if (seen.has(setting.id)) continue
      seen.add(setting.id)
      out.push(setting)
    }
  }
  return out
}

/** 角色模块声明的轴连段（原位置：StunAxisPage.vue 轴块候选列表） */
export function agentCombos(agentId: string | null | undefined): AgentMechanicModule['combos'] {
  return agentId ? getAgentMechanic(agentId)?.combos : undefined
}

export type AgentResourceSectionsInput = Parameters<NonNullable<AgentMechanicModule['resourceSections']>>[0]
export type AgentResourceSections = ReturnType<NonNullable<AgentMechanicModule['resourceSections']>>

/**
 * 资源卡专属分区；模块未声明 ⇒ []。按方法调用（保留 this 绑定，与原 `?.resourceSections?.(…)` 一致）。
 * 原位置：ResourceResultCard.vue `specialResourceSections`。
 */
export function agentResourceSections(
  agentId: string | null | undefined,
  input: AgentResourceSectionsInput,
): AgentResourceSections {
  const mod = agentId ? getAgentMechanic(agentId) : undefined
  return mod?.resourceSections?.(input) ?? []
}

export type AgentAxisBlockMarksInput = Parameters<NonNullable<AgentMechanicModule['axisEditorBlockMarks']>>[0]

/**
 * 轴编辑器逐块标注（CC-48）：模块能力 `axisEditorBlockMarks`；未声明或空 id ⇒ 空 Map。
 * 原位置：StunAxisPage.vue 直调 computeBanyueMingwangBlocks / computeYixuanNingshenBlocks。
 */
export function agentAxisBlockMarks(
  agentId: string | null | undefined,
  input: AgentAxisBlockMarksInput,
): Map<string, AxisEditorBlockMark> {
  const mod = agentId ? getAgentMechanic(agentId) : undefined
  return mod?.axisEditorBlockMarks?.(input) ?? new Map()
}

/** 轴编辑器招式元数据（CC-48）：模块声明 `axisMoveMeta`；原位置 StunAxisPage.vue 读 BANYUE_AXIS_MOVE_META */
export function agentAxisMoveMeta(agentId: string | null | undefined): AgentMechanicModule['axisMoveMeta'] {
  return agentId ? getAgentMechanic(agentId)?.axisMoveMeta : undefined
}
