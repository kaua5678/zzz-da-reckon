/**
 * Buff 系统核心 - 收集、过滤、应用 buff 效果
 * 支持 fixed / derived / stacked 三种效果类型
 */
import type {
  Agent, WEngine, DriveDiscSet, BuffEffect, BuffGroup,
  PanelValues, StatId, TeammateBuff, DriveDiscConfig, SkillDamageTarget, BuffScope, EffectRequirement, StatRules
} from '@/types/catalog'
import { GENERATED_ENEMY_DEBUFF_STAT_IDS, LEGACY_ENEMY_DEBUFF_STAT_IDS, normalizeEnemyDebuffStatAlias } from '@/utils/enemyDebuffStats'

/** 收集的 buff 列表 */


export const SKILL_DMG_TARGETS: SkillDamageTarget[] = [
  'all', 'basic', 'special', 'exSpecial', 'ultimate', 'chain', 'assist', 'dodgeCounter', 'dashAttack', 'additionalAttack',
]

export const SKILL_DMG_TARGET_LABELS: Record<SkillDamageTarget, string> = {
  all: '全部招式',
  basic: '普通攻击',
  special: '特殊技',
  exSpecial: '强化特殊技',
  ultimate: '终结技',
  chain: '连携技',
  assist: '支援技',
  dodgeCounter: '闪避反击',
  dashAttack: '冲刺攻击',
  additionalAttack: '追加攻击',
}

export function normalizeSkillDamageTarget(target?: string): SkillDamageTarget {
  if (target && (SKILL_DMG_TARGETS as string[]).includes(target)) return target as SkillDamageTarget
  return 'all'
}

function targetedStatKey(stat: string, target?: string): string {
  const normalized = normalizeSkillDamageTarget(target)
  return normalized === 'all' ? stat : `${stat}__${normalized}`
}

const TARGETABLE_STATS = new Set([
  'skillDmgBonus',
  'stunBuildUpBonus',
  'critDmg',
  'critRate',
  'sharpCritDmg',
  'dmgBonus',
  'physicalDmg',
  'fireDmg',
  'iceDmg',
  'electricDmg',
  'etherDmg',
  'windDmg',
  'lumifluxDmg',
  'penDmgBonus',
  'sheerDmgBonus',
  'physicalSheerDmg',
  'fireSheerDmg',
  'iceSheerDmg',
  'electricSheerDmg',
  'etherSheerDmg',
  'windSheerDmg',
  'lumifluxSheerDmg',
  'physicalCritDmg',
  'fireCritDmg',
  'iceCritDmg',
  'electricCritDmg',
  'etherCritDmg',
  'windCritDmg',
  'lumifluxCritDmg',
  'sharpDmgBonus',
  'physicalSharpDmg',
  'fireSharpDmg',
  'iceSharpDmg',
  'electricSharpDmg',
  'etherSharpDmg',
  'windSharpDmg',
  'lumifluxSharpDmg',
  ...GENERATED_ENEMY_DEBUFF_STAT_IDS,
  ...LEGACY_ENEMY_DEBUFF_STAT_IDS,
])

function effectSkillDamageTargets(effect: BuffEffect): SkillDamageTarget[] {
  const explicit = effect.targetSkillType
  if (explicit) return [normalizeSkillDamageTarget(explicit)]

  const targets = effect.target?.skillTargets ?? []
  const result: SkillDamageTarget[] = []
  for (const target of targets) {
    if (target.kind === 'skillType' && target.skillType) result.push(normalizeSkillDamageTarget(target.skillType))
    if (target.kind === 'skillTag' && target.skillTag === 'exSpecial') result.push('exSpecial')
    if (target.kind === 'skillTag' && target.skillTag === 'dashAttack') result.push('dashAttack')
    if (target.kind === 'skillTag' && target.skillTag === 'additionalAttack') result.push('additionalAttack')
  }
  const unique = Array.from(new Set(result))
  return unique.length > 0 ? unique : ['all']
}

export function applyTargetedStat(
  panel: PanelValues,
  stat: StatId,
  value: number,
  mode: string,
  targetSkillType?: string,
): void {
  const target = normalizeSkillDamageTarget(targetSkillType)
  const normalizedStat = normalizeEnemyDebuffStatAlias(stat)
  if (TARGETABLE_STATS.has(stat) && target !== 'all') {
    const key = targetedStatKey(normalizedStat, target)
    panel[key] = (panel[key] ?? 0) + value
    return
  }
  applyStat(panel, normalizedStat, value, mode)
}

export function getTargetedStat(panel: PanelValues, stat: string, targetSkillType?: string): number {
  const target = normalizeSkillDamageTarget(targetSkillType)
  const all = panel[stat] ?? 0
  if (target === 'all') return all
  return all + (panel[targetedStatKey(stat, target)] ?? 0)
}

export function getTargetedStatExtra(panel: PanelValues, stat: string, targetSkillType?: string): number {
  const target = normalizeSkillDamageTarget(targetSkillType)
  if (target === 'all') return 0
  return panel[targetedStatKey(stat, target)] ?? 0
}

export function getSkillDmgBonus(panel: PanelValues, targetSkillType?: string): number {
  return getTargetedStat(panel, 'skillDmgBonus', targetSkillType)
}

export function getStunBuildUpBonus(panel: PanelValues, targetSkillType?: string): number {
  return getTargetedStat(panel, 'stunBuildUpBonus', targetSkillType)
}

function addPanelValue(panel: PanelValues, stat: string, value: number): void {
  panel[stat] = (panel[stat] ?? 0) + value
}

function applyLegacyEnemyAlias(panel: PanelValues, stat: string, value: number): boolean {
  const normalizedStat = normalizeEnemyDebuffStatAlias(stat)
  if (normalizedStat !== stat) {
    addPanelValue(panel, normalizedStat, value)
    return true
  }
  return false
}

type CoreBaseStat = 'hp' | 'atk' | 'def'
type CorePctStat = 'hpPct' | 'atkPct' | 'defPct'
  | 'outOfCombatHpPct' | 'outOfCombatAtkPct' | 'outOfCombatDefPct'
  | 'inCombatHpPct' | 'inCombatAtkPct' | 'inCombatDefPct'
type CoreFlatStat = 'hpFlat' | 'atkFlat' | 'defFlat'
  | 'outOfCombatHpFlat' | 'outOfCombatAtkFlat' | 'outOfCombatDefFlat'
  | 'inCombatHpFlat' | 'inCombatAtkFlat' | 'inCombatDefFlat'
type CoreStatBonus = CorePctStat | CoreFlatStat

type PhaseScalarPctStat = 'impactPct' | 'outOfCombatImpactPct' | 'inCombatImpactPct'
type PhaseScalarFlatStat = 'impactFlat' | 'outOfCombatImpactFlat' | 'inCombatImpactFlat'
type PhaseScalarStatBonus = PhaseScalarPctStat | PhaseScalarFlatStat

interface CoreStatAccumState {
  base: number
  pct: number
  flat: number
}

interface ScalarStatAccumState {
  base: number
  pct: number
  flat: number
}

const CORE_STAT_BY_BONUS: Partial<Record<StatId, { base: CoreBaseStat; kind: 'pct' | 'flat' }>> = {
  hpPct: { base: 'hp', kind: 'pct' },
  hpFlat: { base: 'hp', kind: 'flat' },
  atkPct: { base: 'atk', kind: 'pct' },
  atkFlat: { base: 'atk', kind: 'flat' },
  defPct: { base: 'def', kind: 'pct' },
  defFlat: { base: 'def', kind: 'flat' },
  outOfCombatHpPct: { base: 'hp', kind: 'pct' },
  outOfCombatHpFlat: { base: 'hp', kind: 'flat' },
  outOfCombatAtkPct: { base: 'atk', kind: 'pct' },
  outOfCombatAtkFlat: { base: 'atk', kind: 'flat' },
  outOfCombatDefPct: { base: 'def', kind: 'pct' },
  outOfCombatDefFlat: { base: 'def', kind: 'flat' },
  inCombatHpPct: { base: 'hp', kind: 'pct' },
  inCombatHpFlat: { base: 'hp', kind: 'flat' },
  inCombatAtkPct: { base: 'atk', kind: 'pct' },
  inCombatAtkFlat: { base: 'atk', kind: 'flat' },
  inCombatDefPct: { base: 'def', kind: 'pct' },
  inCombatDefFlat: { base: 'def', kind: 'flat' },
}

const PHASE_SCALAR_STAT_BY_BONUS: Partial<Record<StatId, { base: 'impact'; kind: 'pct' | 'flat' }>> = {
  impactPct: { base: 'impact', kind: 'pct' },
  impactFlat: { base: 'impact', kind: 'flat' },
  outOfCombatImpactPct: { base: 'impact', kind: 'pct' },
  outOfCombatImpactFlat: { base: 'impact', kind: 'flat' },
  inCombatImpactPct: { base: 'impact', kind: 'pct' },
  inCombatImpactFlat: { base: 'impact', kind: 'flat' },
}

function coreAccumKey(base: CoreBaseStat): string {
  return `__${base}Accum`
}

function getCoreAccumState(panel: PanelValues, base: CoreBaseStat): CoreStatAccumState {
  const key = coreAccumKey(base)
  const existing = (panel as any)[key] as CoreStatAccumState | undefined
  if (existing) return existing
  const state: CoreStatAccumState = { base: panel[base] ?? 0, pct: 0, flat: 0 }
  ;(panel as any)[key] = state
  return state
}

function recalcCoreStat(panel: PanelValues, base: CoreBaseStat, state: CoreStatAccumState): void {
  // 同一批次内：先汇总百分比，再统一乘入，最后加固定值。
  // 例如：最终局内攻击 = 局外攻击 × (1 + Σ局内大攻击) + Σ局内小攻击。
  panel[base] = state.base * (1 + state.pct / 100) + state.flat
}

function applyCoreStatBonus(panel: PanelValues, stat: CoreStatBonus, value: number): void {
  const meta = CORE_STAT_BY_BONUS[stat]
  if (!meta) return
  const state = getCoreAccumState(panel, meta.base)
  if (meta.kind === 'pct') state.pct += value
  else state.flat += value
  recalcCoreStat(panel, meta.base, state)
}

function applyPhaseScalarStatBonus(panel: PanelValues, stat: PhaseScalarStatBonus, value: number): void {
  const meta = PHASE_SCALAR_STAT_BY_BONUS[stat]
  if (!meta) return
  applyScalarStatBonus(panel, meta.base, value, meta.kind)
}

function scalarAccumKey(stat: string): string {
  return `__${stat}Accum`
}

function getScalarAccumState(panel: PanelValues, stat: string): ScalarStatAccumState {
  const key = scalarAccumKey(stat)
  const existing = (panel as any)[key] as ScalarStatAccumState | undefined
  if (existing) return existing
  const state: ScalarStatAccumState = { base: panel[stat] ?? 0, pct: 0, flat: 0 }
  ;(panel as any)[key] = state
  return state
}

function recalcScalarStat(panel: PanelValues, stat: string, state: ScalarStatAccumState): void {
  // 同一批次内：百分比加成先汇总乘基础值，再加固定值。
  panel[stat] = state.base * (1 + state.pct / 100) + state.flat
}

function applyScalarStatBonus(panel: PanelValues, stat: StatId, value: number, mode: string): void {
  const state = getScalarAccumState(panel, stat)
  if (mode === 'pct') state.pct += value
  else state.flat += value
  recalcScalarStat(panel, stat, state)
}

/** 清理 applyStat 在单个批次内使用的累计状态 */
export function finalizeCoreStatBonuses(panel: PanelValues): PanelValues {
  delete (panel as any).__hpAccum
  delete (panel as any).__atkAccum
  delete (panel as any).__defAccum
  delete (panel as any).__impactAccum
  delete (panel as any).__anomalyMasteryAccum
  return panel
}

export interface CollectedBuffs {
  outOfCombat: BuffEffect[]
  inCombat: BuffEffect[]
}

/** 从 buff group 中提取 effects */
function extractEffects(group: BuffGroup | null | undefined): BuffEffect[] {
  if (!group || !group.effects) return []
  return group.effects.filter(e => e && e.stat)
}

/** 按音擎精修等级替换固定值/每层值 */
export function applyWEngineModLevel(effect: BuffEffect, modLevel: number): BuffEffect {
  const mod = (effect as any).modificationValues?.value
  const modPerStack = (effect as any).modificationValues?.valuePerStack
  let next = effect
  if (mod && modLevel >= 1 && modLevel <= mod.length) {
    next = { ...next, value: mod[modLevel - 1] }
  }
  if (modPerStack && modLevel >= 1 && modLevel <= modPerStack.length) {
    next = { ...next, valuePerStack: modPerStack[modLevel - 1] }
  }
  return next
}

/** 收集角色自身的 buff */
function collectAgentBuffs(agent: Agent, cinemaLevel: number): CollectedBuffs {
  const out: BuffEffect[] = []
  const inCombat: BuffEffect[] = []

  const cb = agent.combatBuffs
  if (cb) {
    // 核心被动
    for (const e of extractEffects(cb.corePassive)) {
      if (cb.corePassive?.scope === 'outOfCombat') out.push(e)
      else inCombat.push(e)
    }
    // 额外能力
    for (const e of extractEffects(cb.additionalAbility)) {
      if (cb.additionalAbility?.scope === 'outOfCombat') out.push(e)
      else inCombat.push(e)
    }
    // 影画
    for (const cinema of cb.cinemaBuffs ?? []) {
      if (cinema.cinemaLevel > cinemaLevel) continue
      for (const e of extractEffects(cinema.buff)) {
        if (cinema.buff?.scope === 'outOfCombat') out.push(e)
        else inCombat.push(e)
      }
    }
  }

  // 核心技等级加成
  if (agent.coreSkill?.levels) {
    const maxLevel = agent.coreSkill.levels[agent.coreSkill.levels.length - 1]
    if (maxLevel?.stats) {
      for (const s of maxLevel.stats) {
        inCombat.push({
          id: `coreSkill_${s.stat}`,
          type: 'fixed',
          stat: s.stat,
          mode: s.mode as any,
          value: s.value,
        })
      }
    }
  }

  return { outOfCombat: out, inCombat }
}

/** 收集音擎 buff */
function collectWEngineBuffs(
  wEngine: WEngine,
  modLevel: number,
  matchSpecialty: boolean
): CollectedBuffs {
  const out: BuffEffect[] = []
  const inCombat: BuffEffect[] = []

  if (!matchSpecialty) return { outOfCombat: out, inCombat }

  const addEffects = (group: BuffGroup | null) => {
    for (let e of extractEffects(group)) {
      e = applyWEngineModLevel(e, modLevel)
      if (group?.scope === 'outOfCombat') out.push(e)
      else inCombat.push(e)
    }
  }

  addEffects(wEngine.effect?.selfBuff)
  addEffects(wEngine.effect?.teamBuff)

  return { outOfCombat: out, inCombat }
}

/**
 * 收集驱动盘套装 buff
 *
 * requirement 门槛（@fact 驱动盘/requirement 三种判据 | 据 本任务 2026-09-05 | 验 discSetEffects.test.ts | 锚 src/core/buff.ts#collectDriveDiscBuffs | 信 高）：
 *   - outOfCombatStat：局外面板属性 ≥ min（粗算口径：基础值 + 主词条，不含副词条）——棘刺玫瑰 def 1000/1800、折枝剑歌 anomalyMastery 115
 *   - specialty / attribute：装备者特化 / 属性匹配——拂晓生花 4pc 强攻限定、拂晓行纪 4pc 以太限定
 * stat 模板：`enemy{attribute}AnomalyResReduction` 的 {attribute} 按装备者属性替换（自由蓝调 4pc）。
 */
function parseOutOfCombatStatRequirement(raw: unknown): { stat: string; min: number } | null {
  if (raw && typeof raw === 'object') {
    const rec = raw as { stat?: unknown; min?: unknown }
    if (typeof rec.stat === 'string' && typeof rec.min === 'number') return { stat: rec.stat, min: rec.min }
    return null
  }
  if (typeof raw === 'string') {
    const match = raw.match(/stat=(\w+).*min=(\d+)/)
    if (match) return { stat: match[1], min: Number(match[2]) }
  }
  return null
}

/** 结构化属性门槛解析（teamBuff 通道复用；导出仅为 inCombatBuffs 门槛判断） */
export const parseStatRequirement = parseOutOfCombatStatRequirement

export interface DiscSetRequirementContext {
  agent: Agent
  /** 粗算局外面板属性（套装门槛判据），键为 statId */
  roughStats: Record<string, number>
}

function discRequirementMet(req: EffectRequirement | undefined, ctx: DiscSetRequirementContext): boolean {
  if (!req) return true
  if (req.specialty && ctx.agent.specialty !== req.specialty) return false
  if (req.attribute && ctx.agent.attribute !== req.attribute) return false
  const statReq = parseOutOfCombatStatRequirement(req.outOfCombatStat)
  if (statReq && (ctx.roughStats[statReq.stat] ?? 0) < statReq.min) return false
  return true
}

function discEffectPassesRequirement(effect: BuffEffect, ctx: DiscSetRequirementContext): boolean {
  return discRequirementMet(effect.requirement, ctx)
}

/** {attribute} 模板按装备者属性落成具体 stat（自由蓝调 4pc：对应属性异常积蓄抗性降低）。
 * 属性 id 是小写（ether/fire/…），敌方减益 stat 名里属性段首字母大写（enemyEther…）。 */
function resolveDiscStatTemplate(effect: BuffEffect, ctx: DiscSetRequirementContext): BuffEffect {
  const stat = effect.stat as string
  if (!stat.includes('{attribute}')) return effect
  return { ...effect, stat: resolveAttributeTemplateStat(stat, ctx.agent.attribute) as StatId }
}

/** 属性模板解析（导出给 teamBuff 通道：自由蓝调挂在敌人 8s，全队同属性积蓄都吃，按装备者属性落键） */
export function resolveAttributeTemplateStat(stat: string, attribute: string): string {
  const capitalized = attribute.charAt(0).toUpperCase() + attribute.slice(1)
  return stat.replace('{attribute}', capitalized)
}

function collectDriveDiscBuffs(
  config: DriveDiscConfig,
  setsMap: Map<string, DriveDiscSet>,
  ctx: DiscSetRequirementContext,
): CollectedBuffs {
  const out: BuffEffect[] = []
  const inCombat: BuffEffect[] = []

  const setCounts = new Map<string, number>()
  if (config.fourPieceSetId) setCounts.set(config.fourPieceSetId, 4)
  if (config.twoPieceSetId && config.twoPieceSetId !== config.fourPieceSetId) {
    setCounts.set(config.twoPieceSetId, 2)
  }

  for (const [setId, count] of setCounts) {
    const set = setsMap.get(setId)
    if (!set) continue

    // 2件套效果（count>=2 时生效）
    if (count >= 2 && set.twoPiece?.effects) {
      for (const e of set.twoPiece.effects) {
        if (!discEffectPassesRequirement(e, ctx)) continue
        out.push(resolveDiscStatTemplate(e, ctx))
      }
    }

    // 4件套效果
    if (count >= 4 && set.fourPiece?.selfBuff) {
      const group = set.fourPiece.selfBuff
      if (!discRequirementMet(group.requirement, ctx)) continue
      for (let e of group.effects ?? []) {
        if (!discEffectPassesRequirement(e, ctx)) continue
        e = resolveDiscStatTemplate(e, ctx)
        if (group.scope === 'outOfCombat') out.push(e)
        else inCombat.push(e)
      }
    }
  }

  return { outOfCombat: out, inCombat }
}

/** 收集队友 buff */
export type SourcePanelsByOwner = Record<string, Partial<Record<BuffScope, PanelValues>>>

function getPanelSourceStatValue(panel: PanelValues, stat: string): number | undefined {
  if (stat === 'energyRegenTotal') {
    return (panel.energyRegen ?? 0) * (1 + (panel.energyRegenBonusPct ?? 0) / 100) + (panel.energyRegenBonusFlat ?? 0)
  }
  if (stat === 'flashEnergyRegenTotal') {
    return (panel.flashEnergyRegen ?? 0) * (1 + (panel.flashEnergyRegenBonusPct ?? 0) / 100) + (panel.flashEnergyRegenBonusFlat ?? 0)
  }
  return panel[stat]
}

function cloneEffectWithSourceValue(effect: BuffEffect, buff: TeammateBuff, sourcePanels?: SourcePanelsByOwner): BuffEffect {
  if (!effect.sourceStat || !effect.sourcePanelPhase) return effect
  const ownerKeys = [buff.ownerId, buff.teammateId].filter(Boolean)
  for (const ownerKey of ownerKeys) {
    const panel = sourcePanels?.[ownerKey]?.[effect.sourcePanelPhase]
    const value = panel ? getPanelSourceStatValue(panel, effect.sourceStat) : undefined
    if (typeof value === 'number' && Number.isFinite(value)) {
      const dynamicSkillLevel = panel ? 12 + Math.max(0, panel.skillLevelBonus ?? 0) : undefined
      return { ...effect, dynamicSourceValue: value, dynamicSkillLevel }
    }
  }
  return effect
}

function isExcludedForTarget(effect: BuffEffect, buff: TeammateBuff, targetAgent?: Agent): boolean {
  if (!targetAgent) return false
  const targetIds = [targetAgent.id, targetAgent.teammateBuffId].filter(Boolean)
  const excluded = [
    ...((effect as any).excludeTargetAgentIds ?? []),
    ...((buff as any).excludeTargetAgentIds ?? []),
  ]
  return targetIds.some(id => excluded.includes(id))
}

function collectTeammateBuffs(teammateBuffs: TeammateBuff[], sourcePanels?: SourcePanelsByOwner, targetAgent?: Agent): CollectedBuffs {
  const out: BuffEffect[] = []
  const inCombat: BuffEffect[] = []

  for (const buff of teammateBuffs) {
    if (buff.hidden) continue
    for (const rawEffect of buff.effects) {
      if (isExcludedForTarget(rawEffect, buff, targetAgent)) continue
      const e = cloneEffectWithSourceValue(rawEffect, buff, sourcePanels)
      if (buff.scope === 'outOfCombat') out.push(e)
      else inCombat.push(e)
    }
  }

  return { outOfCombat: out, inCombat }
}

/** 合并两组 buff */
function mergeBuffs(a: CollectedBuffs, b: CollectedBuffs): CollectedBuffs {
  return {
    outOfCombat: [...a.outOfCombat, ...b.outOfCombat],
    inCombat: [...a.inCombat, ...b.inCombat],
  }
}

/** 主收集函数 */
export function collectAllBuffs(
  agent: Agent,
  wEngine: WEngine | undefined,
  driveDiscConfig: DriveDiscConfig,
  setsMap: Map<string, DriveDiscSet>,
  teammateBuffs: TeammateBuff[],
  config: { cinemaLevel: number; wEngineModLevel: number; sourcePanelsByOwner?: SourcePanelsByOwner; statRules?: StatRules | null }
): CollectedBuffs {
  const matchSpecialty = wEngine ? wEngine.specialty === agent.specialty : false
  const agentBuffs = collectAgentBuffs(agent, config.cinemaLevel)
  const wEngineBuffs = wEngine
    ? collectWEngineBuffs(wEngine, config.wEngineModLevel, matchSpecialty)
    : { outOfCombat: [] as BuffEffect[], inCombat: [] as BuffEffect[] }

  // 粗算局外面板属性，供套装 requirement 门槛判断。口径：基础值 + 固定主词条 + 主词条满值 +
  // 副词条步数（不含局内 buff；常量取 statRules.driveDisc，缺省回落到 S 级满值字面量）。
  // ——棘刺玫瑰 def≥1000/1800 需要副词条才可能到二档，粗算必须含副词条。
  const discStatRules = config.statRules
  const discConfig = driveDiscConfig
  const maxMain = discStatRules?.driveDisc?.sRankMaxMainStat ?? {}
  const subStep = discStatRules?.driveDisc?.sRankSubStatBaseStep ?? {}
  const defPctMainCount = ([4, 5, 6] as const).filter(s => discConfig.mainStats?.[s] === 'defPct').length
  const defPctSubSteps = discConfig.subStatAllocation?.defPct ?? 0
  const defFlatSubSteps = discConfig.subStatAllocation?.defFlat ?? 0
  const roughDef = agent.level60.defBase
    * (1 + (maxMain.defPct ?? 48) / 100 * defPctMainCount + (subStep.defPct ?? 4.8) / 100 * defPctSubSteps)
    + (maxMain.defFlat ?? 184) // 3号位固定主词条（%作用于白值，固定值后加——与面板累加器同口径）
    + (subStep.defFlat ?? 15) * defFlatSubSteps
  const hasAmMain = discConfig.mainStats?.[6] === 'anomalyMastery'
  const roughStats: Record<string, number> = {
    def: roughDef,
    anomalyMastery: agent.level60.anomalyMastery + (hasAmMain ? maxMain.anomalyMastery ?? 30 : 0),
    critRate: (agent.level60.critRate ?? 5)
      + (discConfig.mainStats?.[4] === 'critRate' ? maxMain.critRate ?? 24 : 0)
      + (subStep.critRate ?? 2.4) * (discConfig.subStatAllocation?.critRate ?? 0),
  }

  const discBuffs = collectDriveDiscBuffs(driveDiscConfig, setsMap, { agent, roughStats })
  const teamBuffs = collectTeammateBuffs(teammateBuffs, config.sourcePanelsByOwner, agent)

  return mergeBuffs(mergeBuffs(mergeBuffs(agentBuffs, wEngineBuffs), discBuffs), teamBuffs)
}

function evalFormulaExpression(expression: string, x: number, s: number): number {
  const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max)
  const floor = Math.floor
  const max = Math.max
  const min = Math.min
  const safeExpression = expression.trim()
  if (!/^[0-9xXsS+\-*/().,\s_a-zA-Z]+$/.test(safeExpression)) return 0
  try {
    return Function('x', 's', 'clamp', 'floor', 'max', 'min', `return (${safeExpression})`)(x, s, clamp, floor, max, min)
  } catch {
    return 0
  }
}

function getEffectSourceValue(effect: BuffEffect, panel?: PanelValues): number {
  const source = (effect as any).source
  const panelValue = effect.sourceStat && panel ? panel[effect.sourceStat] : undefined
  return Number(effect.dynamicSourceValue ?? panelValue ?? source?.defaultValue ?? effect.defaultSourceValue ?? 0)
}

function evalFormulaEffect(effect: BuffEffect, panel?: PanelValues): number {
  return evalFormulaExpression(effect.formula?.expression ?? '0', getEffectSourceValue(effect, panel), effect.dynamicSkillLevel ?? 12)
}

/** 应用单个 buff 效果到面板 */
export function applyEffect(panel: PanelValues, effect: BuffEffect, coverage?: number): void {
  const cov = coverage ?? effect.coverage?.default ?? 1
  if (cov <= 0) return

  let value = 0

  switch (effect.type) {
    case 'fixed':
      value = effect.value * cov
      break
    case 'derived': {
      const sourceValue = getEffectSourceValue(effect)
      const ratio = (effect.ratio ?? 0) / 100
      const base = sourceValue * ratio
      value = effect.cap ? Math.min(base, effect.cap) : base
      value *= cov
      break
    }
    case 'stacked': {
      const stacks = effect.defaultStacks ?? effect.maxStacks ?? 1
      const perStack = effect.valuePerStack ?? effect.value
      value = perStack * stacks * cov
      break
    }
    case 'formula':
      value = evalFormulaEffect(effect, panel) * cov
      break
  }

  for (const target of effectSkillDamageTargets(effect)) {
    applyTargetedStat(panel, effect.stat, value, effect.mode, target)
  }
}

/** 应用单个属性加成 */
export function applyStat(panel: PanelValues, stat: StatId, value: number, mode: string): void {
  if (applyLegacyEnemyAlias(panel, stat, value)) return
  if (CORE_STAT_BY_BONUS[stat]) {
    applyCoreStatBonus(panel, stat as CoreStatBonus, value)
    return
  }
  if (PHASE_SCALAR_STAT_BY_BONUS[stat]) {
    applyPhaseScalarStatBonus(panel, stat as PhaseScalarStatBonus, value)
    return
  }

  switch (stat) {
    case 'hpFlat': applyCoreStatBonus(panel, stat, value); break
    case 'hpPct': applyCoreStatBonus(panel, stat, value); break
    case 'atkFlat': applyCoreStatBonus(panel, stat, value); break
    case 'atkPct': applyCoreStatBonus(panel, stat, value); break
    case 'defFlat': applyCoreStatBonus(panel, stat, value); break
    case 'defPct': applyCoreStatBonus(panel, stat, value); break
    case 'impactPct': applyPhaseScalarStatBonus(panel, stat, value); break
    case 'impactFlat': applyPhaseScalarStatBonus(panel, stat, value); break
    case 'critRate': panel.critRate += value; break
    case 'critDmg': panel.critDmg += value; break
    case 'sharpCritDmg': panel.sharpCritDmg += value; break
    case 'impact':
      applyScalarStatBonus(panel, stat, value, mode)
      break
    case 'anomalyProficiency': panel.anomalyProficiency += value; break
    case 'anomalyMastery': applyScalarStatBonus(panel, stat, value, mode); break
    case 'anomalyMasteryFlat': applyScalarStatBonus(panel, 'anomalyMastery', value, 'flat'); break
    case 'energyRegen':
      // mode=pct：能量回复百分比加成（作用于基础回能）
      // mode=flat：能量回复固定加成（直接加点数/秒）
      if (mode === 'pct') {
        panel.energyRegenBonusPct += value
      } else {
        panel.energyRegenBonusFlat += value
      }
      break
    case 'flashEnergyRegen':
      if (mode === 'pct') {
        panel.flashEnergyRegenBonusPct += value
      } else {
        panel.flashEnergyRegenBonusFlat += value
      }
      break
    case 'penRatio': panel.penRatio += value; break
    case 'penFlat': panel.penFlat += value; break
    case 'dmgBonus': panel.dmgBonus += value; break
    case 'physicalDmg': panel.physicalDmg += value; break
    case 'fireDmg': panel.fireDmg += value; break
    case 'iceDmg': panel.iceDmg += value; break
    case 'electricDmg': panel.electricDmg += value; break
    case 'etherDmg': panel.etherDmg += value; break
    case 'windDmg': panel.windDmg += value; break
    case 'lumifluxDmg': panel.lumifluxDmg += value; break
    case 'penDmgBonus': panel.penDmgBonus += value; break
    case 'sheerForceFlat': panel.sheerForceFlat += value; break
    case 'sheerDmgBonus': panel.sheerDmgBonus += value; break
    case 'sharpDmgBonus': panel.sharpDmgBonus += value; break
    // 失衡相关
    case 'stunBuildUpBonus': panel.stunBuildUpBonus += value; break
    case 'stunDmgMultiplierBonus': panel.stunDmgMultiplierBonus += value; break
    case 'stunDmgMultiplierBonusAlways': panel.stunDmgMultiplierBonusAlways += value; break
    case 'stunDmgMultiplierBonusCapAlways': panel.stunDmgMultiplierBonusCapAlways += value; break
    // 异常积蓄相关
    case 'anomalyBuildUpEfficiency': panel.anomalyBuildUpEfficiency += value; break
    case 'electricAnomalyBuildUpEfficiency': panel.electricAnomalyBuildUpEfficiency += value; break
    case 'physicalAnomalyBuildUpEfficiency': panel.physicalAnomalyBuildUpEfficiency += value; break
    case 'etherAnomalyBuildUpEfficiency': panel.etherAnomalyBuildUpEfficiency += value; break
    // 异常伤害相关
    case 'anomalyDmgBonus': panel.anomalyDmgBonus += value; break
    case 'anomalyDamageBonus': panel.anomalyDmgBonus += value; break
    case 'windAnomalyDmgBonus': panel.windAnomalyDmgBonus += value; break
    case 'turbulenceDamageBonus': panel.turbulenceDamageBonus += value; break
    case 'anomalyReleaseDmgBonus': panel.anomalyReleaseDmgBonus += value; break
    case 'remielleRefringeCoefficient': panel.remielleRefringeCoefficient += value; break
    case 'remielleRefringeCoefficientBonusPct': panel.remielleRefringeCoefficientBonusPct += value; break
    case 'remielleLuminizeMultiplierBonus': panel.remielleLuminizeMultiplierBonus += value; break
    case 'remielleCinema4LuminizeMultiplierBonus': panel.remielleCinema4LuminizeMultiplierBonus += value; break
    case 'remielleCinema1SpecialVoidflareCount': panel.remielleCinema1SpecialVoidflareCount += value; break
    case 'remielleCinema1SpecialVoidflareDamage': panel.remielleCinema1SpecialVoidflareDamage += value; break
    case 'remielleFlowerFeatherDanceDecibelPerUse': panel.remielleFlowerFeatherDanceDecibelPerUse += value; break
    case 'remielleFlowerFeatherDanceCount': panel.remielleFlowerFeatherDanceCount += value; break
    case 'remielleCinema4SpecialVoidflareRefillCount': panel.remielleCinema4SpecialVoidflareRefillCount += value; break
    case 'remielleCinema6LuminizeTriggerMultiplier': panel.remielleCinema6LuminizeTriggerMultiplier += value; break
    case 'remielleCinema6SpecialVoidflareTriggerMultiplier': panel.remielleCinema6SpecialVoidflareTriggerMultiplier += value; break
    case 'remielleCinema6FleetingGraceVoidflareTriggerMultiplier': panel.remielleCinema6FleetingGraceVoidflareTriggerMultiplier += value; break
    case 'remielleCinema6SpecialVoidflareCount': panel.remielleCinema6SpecialVoidflareCount += value; break
    case 'remielleCinema6SpecialVoidflareDamageRatio': panel.remielleCinema6SpecialVoidflareDamageRatio += value; break
    case 'skillLevelBonus': panel.skillLevelBonus += value; break
    case 'anomalyCritRate': panel.anomalyCritRate += value; break
    case 'anomalyCritDmg': panel.anomalyCritDmg += value; break
    case 'assaultCritRate': panel.assaultCritRate += value; break
    case 'assaultCritDmg': panel.assaultCritDmg += value; break
    case 'enemyAssaultDefReduction': panel.enemyAssaultDefReduction += value; break
    // 能量/资源相关
    case 'energyGainEfficiency': panel.energyGainEfficiency += value; break
    case 'flashEnergyGainEfficiency': panel.flashEnergyGainEfficiency += value; break
    case 'decibelGainEfficiency': panel.decibelGainEfficiency += value; break
    // 敌方减益
    case 'enemyDefReduction': panel.enemyDefReduction += value; break
    case 'enemyDefFlatReduction': panel.enemyDefFlatReduction += value; break
    case 'enemyAnomalyDefReduction': panel.enemyAnomalyDefReduction += value; break
    case 'enemyLumifluxResReduction': panel.enemyLumifluxResReduction += value; break
    case 'enemyPhysicalDefReduction': panel.enemyPhysicalDefReduction += value; break
    case 'enemyFireDefReduction': panel.enemyFireDefReduction += value; break
    case 'enemyIceDefReduction': panel.enemyIceDefReduction += value; break
    case 'enemyElectricDefReduction': panel.enemyElectricDefReduction += value; break
    case 'enemyEtherDefReduction': panel.enemyEtherDefReduction += value; break
    case 'enemyWindDefReduction': panel.enemyWindDefReduction += value; break
    case 'enemyResReduction': panel.enemyResReduction += value; break
    case 'enemyPhysicalResReduction': panel.enemyPhysicalResReduction += value; break
    case 'enemyFireResReduction': panel.enemyFireResReduction += value; break
    case 'enemyIceResReduction': panel.enemyIceResReduction += value; break
    case 'enemyElectricResReduction': panel.enemyElectricResReduction += value; break
    case 'enemyEtherResReduction': panel.enemyEtherResReduction += value; break
    case 'enemyWindResReduction': panel.enemyWindResReduction += value; break
    case 'enemyStunResReduction': panel.enemyStunResReduction += value; break
    case 'enemyPhysicalStunResReduction': panel.enemyPhysicalStunResReduction += value; break
    case 'enemyFireStunResReduction': panel.enemyFireStunResReduction += value; break
    case 'enemyIceStunResReduction': panel.enemyIceStunResReduction += value; break
    case 'enemyElectricStunResReduction': panel.enemyElectricStunResReduction += value; break
    case 'enemyEtherStunResReduction': panel.enemyEtherStunResReduction += value; break
    case 'enemyWindStunResReduction': panel.enemyWindStunResReduction += value; break
    case 'enemyAnomalyResReduction': panel.enemyAnomalyResReduction += value; break
    case 'enemyPhysicalAnomalyResReduction': panel.enemyPhysicalAnomalyResReduction += value; break
    case 'enemyFireAnomalyResReduction': panel.enemyFireAnomalyResReduction += value; break
    case 'enemyIceAnomalyResReduction': panel.enemyIceAnomalyResReduction += value; break
    case 'enemyElectricAnomalyResReduction': panel.enemyElectricAnomalyResReduction += value; break
    case 'enemyEtherAnomalyResReduction': panel.enemyEtherAnomalyResReduction += value; break
    case 'enemyWindAnomalyResReduction': panel.enemyWindAnomalyResReduction += value; break
    case 'enemyDamageTakenBonus': panel.enemyDamageTakenBonus += value; break
    case 'enemyCritDmgTakenBonus': panel.enemyCritDmgTakenBonus += value; break
    case 'enemyStunTakenBonus': panel.enemyStunTakenBonus += value; break
    // 兼容别名：采集/旧数据曾用 enemyStunDurationBonusSeconds（无消费端），映射到角色级失衡时长字段
    case 'enemyStunDurationBonusSeconds': panel.stunDurationBonusSeconds += value; break
    case 'anomalyBuildUpEfficiencyOnStunBonus': panel.anomalyBuildUpEfficiencyOnStunBonus += value; break
    case 'anomalyBuildUpEfficiencyOnStunChainBonus': panel.anomalyBuildUpEfficiencyOnStunChainBonus += value; break
    case 'infectionZoneBonus': panel.infectionZoneBonus += value; break
    case 'disorderDamageBonus': panel.disorderDamageBonus += value; break
    case 'disorderBaseMultiplierBonus': panel.disorderBaseMultiplierBonus += value; break
    case 'anomalyDurationBonusSeconds': panel.anomalyDurationBonusSeconds += value; break
    default:
      if (!(stat in panel)) panel[stat] = 0
      panel[stat] += value
      break
  }
}

/** 应用一组 buff 效果 */
export function applyBuffs(
  panel: PanelValues,
  effects: BuffEffect[],
  coverageMap?: Map<string, number>
): PanelValues {
  const result = { ...panel }
  finalizeCoreStatBonuses(result)
  for (const e of effects) {
    if (!e.stat) continue
    const cov = coverageMap?.get(e.id)
    applyEffect(result, e, cov)
  }
  return finalizeCoreStatBonuses(result)
}
