/**
 * 展示层读取角色模块**声明式数据**的只读门面（CC-47，2026-09-27，判据 7「展示层越层 import」还款）。
 *
 * views/components 不直接 import '@/mechanics'（判据 7），改经本文件取模块声明：
 * settings（机制设置表）/ combos（轴连段定义）/ resourceSections（资源卡专属分区）。
 * 纯转发：不计算、不缓存；语义与原展示层内联写法逐位一致（见各函数注释）。
 */
import { AUTO_AXIS_PRESET_HINTS, getAgentMechanic, getRegisteredAgentMechanics } from '@/mechanics'
import type { AgentMechanicModule, AxisEditorBlockMark, CharacterCountInputDecl } from '@/mechanics/types'
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

/** 轴编辑器候选池隐藏的招式（CC-57）：模块声明 `axisHiddenMoves`；原位置 StunAxisPage.vue 写死 1051/1051012 */
export function agentAxisHiddenMoves(agentId: string | null | undefined): readonly string[] {
  return (agentId ? getAgentMechanic(agentId)?.axisHiddenMoves : undefined) ?? []
}

/** 轴编辑器候选块名后缀（CC-57）：模块声明 `axisMoveSuffix`；未声明 ⇒ ''。原位置 StunAxisPage.vue 写死 1371 + 1371022/1371026 */
export function agentAxisMoveSuffix(agentId: string | null | undefined, moveId: string): string {
  return (agentId ? getAgentMechanic(agentId)?.axisMoveSuffix?.[moveId] : undefined) ?? ''
}

export type ReleaseShareDecl = NonNullable<AgentMechanicModule['releaseShare']>

/**
 * 队伍里声明了「异放占比可调」的角色（CC-55）：按槽位顺序、按 namespace 去重；空槽 / catalog 查不到跳过。
 * 每个角色同时按 `agent.id` 与 `agent.teammateBuffId` 查模块——与原展示层写死判断
 * `agent?.id === '1171' || agent?.teammateBuffId === '1171'`（ResourceUtilizationPage / ImpactChart）同口径。
 */
export function teamReleaseShares(
  team: ReadonlyArray<{ agentId?: string | null } | null | undefined>,
  getAgent: (id: string) => { id: string } | null | undefined,
): ReleaseShareDecl[] {
  const out: ReleaseShareDecl[] = []
  const seen = new Set<string>()
  for (const char of team) {
    if (!char?.agentId) continue
    const agent = getAgent(char.agentId)
    if (!agent) continue
    const decl = getAgentMechanic(agent.id)?.releaseShare
    if (!decl || seen.has(decl.namespace)) continue
    seen.add(decl.namespace)
    out.push(decl)
  }
  return out
}

type AgentIdentity = { id: string }
/** 按 `agent.id` 查模块（CC-276：别名字段 teammateBuffId 退役，不再查第二次） */
function identityModules(agent: AgentIdentity | null | undefined): AgentMechanicModule[] {
  const mod = agent ? getAgentMechanic(agent.id) : undefined
  return mod ? [mod] : []
}

export type TeammateSplitDecl = NonNullable<AgentMechanicModule['teammateSplit']>

/**
 * 队伍里第一个声明 `teammateSplit` 的槽位（CC-56）；无 ⇒ null。
 * 原位置：ResourceUtilizationPage.vue `remielleQSetting` 的 `findIndex(agent?.id === '1581' || agent?.teammateBuffId === '1581')`。
 */
export function teamTeammateSplit(
  team: ReadonlyArray<{ agentId?: string | null } | null | undefined>,
  getAgent: (id: string) => AgentIdentity | null | undefined,
): { slot: number; split: TeammateSplitDecl } | null {
  for (let slot = 0; slot < team.length; slot++) {
    const char = team[slot]
    if (!char?.agentId) continue
    for (const mod of identityModules(getAgent(char.agentId))) {
      if (mod.teammateSplit) return { slot, split: mod.teammateSplit }
    }
  }
  return null
}

/**
 * 角色是否「拥有」轴预设里的 60/90 转大块（CC-58）：模块声明 `ownsPromoteVariantAxisBlocks`（CC-43e），
 * 与编排层 `roundInputs.ts#buildStackAxes` 同源（按 agentId 派发，=== true）。现唯一声明：琉音。
 */
export function agentOwnsPromoteVariantAxisBlocks(agentId: string | null | undefined): boolean {
  return !!agentId && getAgentMechanic(agentId)?.ownsPromoteVariantAxisBlocks === true
}

/** 队伍里第一个转大块拥有者的槽位；无 ⇒ -1（CC-58；原 StunAxisPage `findIndex(c => c.agentId === '1481')`） */
export function teamPromoteVariantOwnerSlot(team: ReadonlyArray<{ agentId?: string | null } | null | undefined>): number {
  return team.findIndex(c => agentOwnsPromoteVariantAxisBlocks(c?.agentId))
}

export type AxisRageCombosDecl = NonNullable<AgentMechanicModule['axisRageCombos']>

/** 轴编辑器怒相连段块声明（CC-59）：模块声明 `axisRageCombos`；未声明 ⇒ undefined。原位置 StunAxisPage 写死 1471 + 两个连段 comboId */
export function agentAxisRageCombos(agentId: string | null | undefined): AxisRageCombosDecl | undefined {
  return agentId ? getAgentMechanic(agentId)?.axisRageCombos : undefined
}

export type AxisExtraBlockDecl = ReturnType<NonNullable<AgentMechanicModule['axisExtraBlocks']>>[number]

/** 轴编辑器角色专属块（CC-61）：模块声明 `axisExtraBlocks`；未声明 ⇒ []。原位置 StunAxisPage 写死 1571（诺姆转连携）/ 1591（破阵连段） */
export function agentAxisExtraBlocks(
  agentId: string | null | undefined,
  input: { cinemaLevel: number; actionTimeOf: (moveId: string) => number },
): readonly AxisExtraBlockDecl[] {
  return (agentId ? getAgentMechanic(agentId)?.axisExtraBlocks?.(input) : undefined) ?? []
}

export type AxisWindowLaneKind = NonNullable<AgentMechanicModule['axisWindowLane']>

/** 队伍里第一个声明了该种窗口 lane 的槽位；无 ⇒ -1（CC-62；原 StunAxisPage `findIndex(c => c.agentId === 1471 / 1371)`） */
export function teamAxisWindowLaneSlot(team: ReadonlyArray<{ agentId?: string | null } | null | undefined>, kind: AxisWindowLaneKind): number {
  return team.findIndex(c => !!c?.agentId && getAgentMechanic(c.agentId)?.axisWindowLane === kind)
}

export type { CharacterCountInputDecl }

/** 角色专属计数输入框声明（CC-65；原 TeamConfigPage 写死 v-if 块）；无 ⇒ [] */
export function agentCharacterCountInputs(agentId: string | null | undefined): ReadonlyArray<CharacterCountInputDecl> {
  return (agentId ? getAgentMechanic(agentId)?.characterCountInputs : undefined) ?? []
}

/** 输入框显示值（CC-65；与原页面 :value 表达式逐值一致） */
export function characterCountInputValue(inp: Pick<CharacterCountInputDecl, 'mode'>, raw: number | null | undefined): number | null {
  if (inp.mode === 'autoIfNonPositive') return (raw ?? 0) > 0 ? (raw as number) : null
  if (inp.mode === 'autoNegOne') return (raw ?? -1) < 0 ? -1 : (raw as number)
  return raw ?? 0
}

/** 输入框被清空（null）时写入的值（CC-65；原页面 `v ?? 0` / `v ?? -1`） */
export function characterCountInputClearValue(inp: Pick<CharacterCountInputDecl, 'mode'>): number {
  return inp.mode === 'autoNegOne' ? -1 : 0
}

/** 交互栏专属输入框（格挡 / 双反）声明（CC-65b；原 TeamConfigPage 写死 1471/1531）；无 ⇒ {} */
export function agentInteractionInputs(agentId: string | null | undefined): NonNullable<AgentMechanicModule['interactionInputs']> {
  return (agentId ? getAgentMechanic(agentId)?.interactionInputs : undefined) ?? {}
}

/** 队里是否有「保底4嗔火」开关归属角色（CC-65b；原 TeamConfigPage teamHasBanyue 写死） */
export function teamHasGuaranteeFuryOwner(team: ReadonlyArray<{ agentId?: string | null } | null | undefined>): boolean {
  return team.some(c => !!c?.agentId && !!getAgentMechanic(c.agentId)?.ownsGuaranteeFury)
}

// AUTO_AXIS_PRESET_HINTS 已迁至 mechanics/registry.ts（CC-246：管线层 roundInputs 不再反向依赖本展示门面）

/** 队中第一个「章」档位归属角色的槽位；无 ⇒ -1（CC-60；原 StunAxisPage 写死 some/find agentId === 伊德海莉） */
export function teamAxisPresetChapterOwnerSlot(team: ReadonlyArray<{ agentId?: string | null } | null | undefined>): number {
  return team.findIndex(c => !!c?.agentId && AUTO_AXIS_PRESET_HINTS.isChapterOwner(c.agentId))
}

/** 队里是否有「预设优先」角色（CC-60；原 StunAxisPage 写死 some agentId === 琉音） */
export function teamHasAxisPresetPreferred(team: ReadonlyArray<{ agentId?: string | null } | null | undefined>): boolean {
  return team.some(c => !!c?.agentId && AUTO_AXIS_PRESET_HINTS.isPreferred(c.agentId))
}

/**
 * StunAxisPage 自动轴横幅的「有X/无X」标签（CC-79；原页面写死 '有琉' / '无琉'）。
 * 在队的「预设优先」声明者 ⇒ `有` + 各自简称（去重，按槽位序，'/' 连接）；
 * 一个都不在 ⇒ `无` + 全部已注册声明者简称（按注册序）。现唯一声明者琉音 ⇒ 与原文案逐字相同。
 */
export function axisPresetPreferredLabel(team: ReadonlyArray<{ agentId?: string | null } | null | undefined>): string {
  const shortOf = (m: AgentMechanicModule): string => m.axisPresetPreferredShort ?? m.name ?? m.agentIds[0] ?? m.id
  const present: string[] = []
  for (const c of team) {
    const m = c?.agentId ? getAgentMechanic(c.agentId) : undefined
    if (m?.axisPresetPreferred && !present.includes(shortOf(m))) present.push(shortOf(m))
  }
  if (present.length > 0) return `有${present.join('/')}`
  const all = [...new Set(getRegisteredAgentMechanics().filter(m => m.axisPresetPreferred).map(shortOf))]
  return `无${all.join('/')}`
}

/** ResourceResultCard 腐蚀状态机展示声明（CC-66；原组件写死维琳娜）；无 ⇒ undefined */
export function agentResultCardCorrosion(agentId: string | null | undefined): AgentMechanicModule['resultCardCorrosion'] {
  return agentId ? getAgentMechanic(agentId)?.resultCardCorrosion : undefined
}

/** 队伍对比难度表的角色专属交互类型（CC-68；按队伍顺序去重；原 teamCompare.ts 写死般岳） */
export function teamCompareInteractionTypes(team: ReadonlyArray<string | null | undefined>): string[] {
  const out: string[] = []
  for (const id of team) {
    for (const t of Object.values((id ? getAgentMechanic(id)?.interactionFieldTypes : undefined) ?? {})) if (t && !out.includes(t)) out.push(t)
  }
  return out
}

/** CC-259：反查——某槽角色把专属交互类型名映射到哪个引擎字段（未声明 ⇒ undefined；预设交互写引擎用） */
export function interactionFieldForType(agentId: string | null | undefined, type: string): 'blockCount' | 'dualCounterCount' | undefined {
  const m = agentId ? getAgentMechanic(agentId)?.interactionFieldTypes : undefined
  if (!m) return undefined
  for (const [field, t] of Object.entries(m)) if (t === type) return field as 'blockCount' | 'dualCounterCount'
  return undefined
}

/** CC-258：某槽角色对某引擎交互字段的专属类型名（未声明 ⇒ undefined，调用方回落全局类型名） */
export function interactionFieldTypeOf(agentId: string | null | undefined, field: string): string | undefined {
  const m = agentId ? getAgentMechanic(agentId)?.interactionFieldTypes : undefined
  return m ? (m as Readonly<Record<string, string | undefined>>)[field] : undefined
}
