/**
 * Buff 系统核心 - 收集、过滤、应用 buff 效果
 * 支持 fixed / derived / stacked 三种效果类型
 */
import { addPanelStat, getPanelStat, setPanelStat } from '@/utils/panelStat'
import type {
  Agent, WEngine, DriveDiscSet, BuffEffect, BuffGroup,
  PanelValues, StatId, TeammateBuff, DriveDiscConfig, SkillDamageTarget, BuffScope, EffectRequirement, StatRules
} from '@/types/catalog'
import { GENERATED_ENEMY_DEBUFF_STAT_IDS, LEGACY_ENEMY_DEBUFF_STAT_IDS, normalizeEnemyDebuffStatAlias } from '@/utils/enemyDebuffStats'
import { elementStatKey, type ElementStatKind } from '@/utils/elementStatKeys'
import { wEngineConditionMet, wEngineEffectRequirementMet, type WEngineConditionContext } from '@/core/wengineConditions'

import { normalizeSkillDamageTarget } from '@/data/skillDamageTargets'
import { calcEnergyRegenTotal, calcFlashEnergyRegenTotal } from '@/data/agentPanelStats'
import { evalSandboxedFormula } from '@/utils/formulaSandbox'

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

/**
 * skillTag → 招式族。CC-105（R5 D21）：补 `assistAttack → assist`（31800 混沌爵士 4pc「[支援攻击]伤害提升」
 * 修前被静默丢弃）。未登记的 tag 仍被忽略——`skillTargetsCoverage.test.ts` 会对 catalog 中出现的
 * 每个 tag 报错，新增 tag 时在这里登记。
 */
const SKILL_TAG_TARGET: Record<string, SkillDamageTarget> = {
  exSpecial: 'exSpecial',
  dashAttack: 'dashAttack',
  additionalAttack: 'additionalAttack',
  assistAttack: 'assist',
}

function effectSkillDamageTargets(effect: BuffEffect): SkillDamageTarget[] {
  const explicit = effect.targetSkillType
  if (explicit) return [normalizeSkillDamageTarget(explicit)]

  const targets = effect.target?.skillTargets ?? []
  const result: SkillDamageTarget[] = []
  for (const target of targets) {
    if (target.kind === 'skillType' && target.skillType) result.push(normalizeSkillDamageTarget(target.skillType))
    if (target.kind === 'skillTag' && target.skillTag && SKILL_TAG_TARGET[target.skillTag]) result.push(SKILL_TAG_TARGET[target.skillTag])
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
    addPanelStat(panel, key, value)
    return
  }
  applyStat(panel, normalizedStat, value, mode)
}

export function getTargetedStat(panel: PanelValues, stat: string, targetSkillType?: string): number {
  const target = normalizeSkillDamageTarget(targetSkillType)
  const all = getPanelStat(panel, stat) ?? 0
  if (target === 'all') return all
  return all + (getPanelStat(panel, targetedStatKey(stat, target)) ?? 0)
}

/** CC-338：按元素族 + 招式目标读取面板字段（内部经 elementStatKey → resolveStatElement 单一来源） */
export function getTargetedElementStat(
  panel: PanelValues,
  kind: ElementStatKind,
  element: string | undefined | null,
  targetSkillType?: string,
): number {
  const stat = elementStatKey(kind, element)
  return stat ? getTargetedStat(panel, stat, targetSkillType) : 0
}

export function getTargetedStatExtra(panel: PanelValues, stat: string, targetSkillType?: string): number {
  const target = normalizeSkillDamageTarget(targetSkillType)
  if (target === 'all') return 0
  return getPanelStat(panel, targetedStatKey(stat, target)) ?? 0
}

export function getSkillDmgBonus(panel: PanelValues, targetSkillType?: string): number {
  return getTargetedStat(panel, 'skillDmgBonus', targetSkillType)
}

export function getStunBuildUpBonus(panel: PanelValues, targetSkillType?: string): number {
  return getTargetedStat(panel, 'stunBuildUpBonus', targetSkillType)
}

function addPanelValue(panel: PanelValues, stat: string, value: number): void {
  addPanelStat(panel, stat, value)
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

interface StatAccumState {
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

/**
 * 单批次累加器（r401 CC-375）：按**面板对象**存在模块级 WeakMap 里。
 * r401 前挂在面板的隐藏键 `__hpAccum` 等上（`(panel as any)[key] = state`）——把对象塞进「全是 number」的
 * `PanelValues`，展开拷贝会把累加器（同一引用）一起带走（`applyBuffs` 因此先 finalize 拷贝），测试快照得跳过 `__` 键，
 * 且 `__xxxAccum` 恰好匹配 S4 计划的 `${string}__${string}` 模板签名。语义不变：同一面板对象在 finalize 前共享状态；
 * 新对象（含展开拷贝）没有状态 ≡ 旧写法「拷贝后立即 finalize」。用累加器的只有下面 5 个属性，旧 finalize 删的正是这 5 个键。
 */
type AccumStat = CoreBaseStat | 'impact' | 'anomalyMastery'
const batchAccum = new WeakMap<PanelValues, Map<AccumStat, StatAccumState>>()

function getAccumState(panel: PanelValues, stat: AccumStat): StatAccumState {
  let byStat = batchAccum.get(panel)
  if (!byStat) {
    byStat = new Map()
    batchAccum.set(panel, byStat)
  }
  const existing = byStat.get(stat)
  if (existing) return existing
  const state: StatAccumState = { base: panel[stat] ?? 0, pct: 0, flat: 0 }
  byStat.set(stat, state)
  return state
}

function recalcAccumStat(panel: PanelValues, stat: AccumStat, state: StatAccumState): void {
  // 同一批次内：先汇总百分比，再统一乘入，最后加固定值。
  // 例如：最终局内攻击 = 局外攻击 × (1 + Σ局内大攻击) + Σ局内小攻击。
  panel[stat] = state.base * (1 + state.pct / 100) + state.flat
}

function applyCoreStatBonus(panel: PanelValues, stat: CoreStatBonus, value: number): void {
  const meta = CORE_STAT_BY_BONUS[stat]
  if (!meta) return
  const state = getAccumState(panel, meta.base)
  if (meta.kind === 'pct') state.pct += value
  else state.flat += value
  recalcAccumStat(panel, meta.base, state)
}

function applyPhaseScalarStatBonus(panel: PanelValues, stat: PhaseScalarStatBonus, value: number): void {
  const meta = PHASE_SCALAR_STAT_BY_BONUS[stat]
  if (!meta) return
  applyScalarStatBonus(panel, meta.base, value, meta.kind)
}

function applyScalarStatBonus(panel: PanelValues, stat: 'impact' | 'anomalyMastery', value: number, mode: string): void {
  const state = getAccumState(panel, stat)
  if (mode === 'pct') state.pct += value
  else state.flat += value
  recalcAccumStat(panel, stat, state)
}

/** 清理 applyStat 在单个批次内使用的累计状态 */
export function finalizeCoreStatBonuses(panel: PanelValues): PanelValues {
  batchAccum.delete(panel)
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
  const mod = effect.modificationValues?.value
  const modPerStack = effect.modificationValues?.valuePerStack
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
          mode: s.mode,
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
  matchSpecialty: boolean,
  gate?: WEngineConditionContext,
): CollectedBuffs {
  const out: BuffEffect[] = []
  const inCombat: BuffEffect[] = []

  if (!matchSpecialty) return { outOfCombat: out, inCombat }

  const addEffects = (group: BuffGroup | null) => {
    if (!wEngineConditionMet(group?.condition, gate)) return
    for (let e of extractEffects(group)) {
      if (!wEngineEffectRequirementMet(e.requirement, gate)) continue
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
 * requirement 门槛（@fact 驱动盘/requirement 三种判据 | 据 本任务 2026-09-05·复核@2026-09-18 | 验 discSetEffects.test.ts | 锚 src/core/buff.ts#collectDriveDiscBuffs | 信 高）：
 *   - outOfCombatStat：局外面板属性 ≥ min——**分两条路求值，别混**：
 *       ① **selfBuff 侧**（本函数）读 `ctx.outOfCombatStats` = 装备者**精确局外面板**，由 `calcPanel`
 *          两段式求得（第一段不含门槛效果算出局外面板，第二段据此判定）——荆棘玫瑰 def 1000/1800、
 *          折枝剑歌 anomalyMastery 115。CC-108（R5 D26）前这里是漏音擎与局外 buff 的 `roughStats` 粗算。
 *       ② **teamBuff 侧**（`inCombatBuffs.ts#discTeamRequirementMet`）读已算好的精确局外面板
 *          `wearerPanel`——山大王 critRate 50。两侧口径现已相同（都是精确局外面板），只是求值通道不同。
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

export interface DiscSetRequirementContext {
  agent: Agent
  /** 装备者精确局外面板（4 件套 outOfCombatStat 门槛判据，键为面板字段名；CC-108） */
  outOfCombatStats: Readonly<Record<string, number>>
}

/**
 * 驱动盘门槛判定（CC-337：selfBuff 与 inCombatBuffs#teamBuff 共用唯一实现）：
 * 装备者特化 / 属性 + 精确局外面板属性门槛（未传面板或字段缺失时按不满足处理）。
 */
export function discRequirementMet(
  req: EffectRequirement | undefined,
  agent: Agent,
  outOfCombatStats?: Readonly<Record<string, number>> | PanelValues,
): boolean {
  if (!req) return true
  if (req.specialty && agent.specialty !== req.specialty) return false
  if (req.attribute && agent.attribute !== req.attribute) return false
  const statReq = parseOutOfCombatStatRequirement(req.outOfCombatStat)
  if (statReq) {
    const value = outOfCombatStats ? (outOfCombatStats as Readonly<Record<string, number>>)[statReq.stat] : undefined
    if (value == null || value < statReq.min) return false
  }
  return true
}

/** {attribute} 模板按装备者属性落成具体 stat（自由蓝调 4pc：对应属性异常积蓄抗性降低；CC-337 selfBuff/teamBuff 单源复用）。
 * 属性 id 是小写（ether/fire/…），敌方减益 stat 名里属性段首字母大写（enemyEther…）。 */
export function resolveDiscStatTemplate(effect: BuffEffect, attribute: string): BuffEffect {
  const stat = effect.stat as string
  if (!stat.includes('{attribute}')) return effect
  return { ...effect, stat: resolveAttributeTemplateStat(stat, attribute) as StatId }
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
        if (!discRequirementMet(e.requirement, ctx.agent, ctx.outOfCombatStats)) continue
        out.push(resolveDiscStatTemplate(e, ctx.agent.attribute))
      }
    }

    // 4件套效果
    if (count >= 4 && set.fourPiece?.selfBuff) {
      const group = set.fourPiece.selfBuff
      if (!discRequirementMet(group.requirement, ctx.agent, ctx.outOfCombatStats)) continue
      for (let e of group.effects ?? []) {
        if (!discRequirementMet(e.requirement, ctx.agent, ctx.outOfCombatStats)) continue
        e = resolveDiscStatTemplate(e, ctx.agent.attribute)
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
  if (stat === 'energyRegenTotal') return calcEnergyRegenTotal(panel)
  if (stat === 'flashEnergyRegenTotal') return calcFlashEnergyRegenTotal(panel)
  return getPanelStat(panel, stat)
}

function cloneEffectWithSourceValue(effect: BuffEffect, buff: TeammateBuff, sourcePanels?: SourcePanelsByOwner): BuffEffect {
  if (!effect.sourceStat || !effect.sourcePanelPhase) return effect
  const ownerKeys = [buff.ownerId, buff.teammateId].filter(Boolean)
  for (const ownerKey of ownerKeys) {
    const panel = sourcePanels?.[ownerKey]?.[effect.sourcePanelPhase]
    const value = panel ? getPanelSourceStatValue(panel, effect.sourceStat) : undefined
    if (typeof value === 'number' && Number.isFinite(value)) {
      const dynamicSkillLevel = panel ? 12 + Math.max(0, panel.skillLevelBonus) : undefined
      // `p` 变量（公式第三变量）：来源角色的潜能觉醒档位。与 `dynamicSkillLevel` 同源同款
      // ——`core/panel.ts:353` 把 `potentialLevel` 盖章进源面板，故这里直接读它。
      const dynamicPotentialLevel = panel?.potentialLevel
      return { ...effect, dynamicSourceValue: value, dynamicSkillLevel, dynamicPotentialLevel }
    }
  }
  return effect
}

function isExcludedForTarget(effect: BuffEffect, buff: TeammateBuff, targetAgent?: Agent): boolean {
  if (!targetAgent) return false
  const excluded = [
    ...(effect.excludeTargetAgentIds ?? []),
    ...(buff.excludeTargetAgentIds ?? []),
  ]
  return excluded.includes(targetAgent.id)
}

function collectTeammateBuffs(teammateBuffs: TeammateBuff[], sourcePanels?: SourcePanelsByOwner, targetAgent?: Agent): CollectedBuffs {
  const out: BuffEffect[] = []
  const inCombat: BuffEffect[] = []

  for (const buff of teammateBuffs) {
    // `singleSourced`（原 `hidden`，R65 改名）条不进数值通道：数值由模块/helpers 单通道接入，防双计。
    if (buff.singleSourced === true) continue
    for (const rawEffect of buff.effects) {
      if (isExcludedForTarget(rawEffect, buff, targetAgent)) continue
      const e = cloneEffectWithSourceValue(rawEffect, buff, sourcePanels)
      if (buff.scope === 'outOfCombat') out.push(e)
      else inCombat.push(e)
    }
  }

  return { outOfCombat: out, inCombat }
}

/**
 * 该驱动盘配置的 4 件套 selfBuff 是否带 outOfCombatStat 门槛（CC-108）。
 * `calcPanel` 据此决定是否做第二段收集；没有门槛时一段即可，结果与两段相同。
 */
export function discSelfBuffNeedsOutOfCombatPanel(config: DriveDiscConfig, setsMap: Map<string, DriveDiscSet>): boolean {
  const group = config.fourPieceSetId ? setsMap.get(config.fourPieceSetId)?.fourPiece?.selfBuff : undefined
  if (!group) return false
  if (parseOutOfCombatStatRequirement(group.requirement?.outOfCombatStat)) return true
  return (group.effects ?? []).some(e => parseOutOfCombatStatRequirement(e.requirement?.outOfCombatStat) != null)
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
  config: { cinemaLevel: number; wEngineModLevel: number; sourcePanelsByOwner?: SourcePanelsByOwner; statRules?: StatRules | null; enemyWeakness?: readonly string[]; outOfCombatStats?: Readonly<Record<string, number>> }
): CollectedBuffs {
  const matchSpecialty = wEngine ? wEngine.specialty === agent.specialty : false
  const agentBuffs = collectAgentBuffs(agent, config.cinemaLevel)
  const wEngineBuffs = wEngine
    ? collectWEngineBuffs(wEngine, config.wEngineModLevel, matchSpecialty, {
        wearerAttribute: agent.attribute,
        wearerSpecialty: agent.specialty,
        wearerAgentId: agent.id,
        enemyWeakness: config.enemyWeakness,
      })
    : { outOfCombat: [] as BuffEffect[], inCombat: [] as BuffEffect[] }

  // 4 件套 outOfCombatStat 门槛读装备者**精确局外面板**（CC-108，R5 D26）：由 `calcPanel` 两段式求得后
  // 经 `config.outOfCombatStats` 传入。未传（第一段）⇒ 空表 ⇒ 带属性门槛的效果一律不发放。
  // 旧的 `roughStats` 粗算只含「角色白值 + 主副词条」，漏掉音擎白值（baseStat=def 的音擎）、音擎副属性、
  // 本套 2 件套防御 +16% 与全部局外 buff，与数据 condition「按装备者最终局外防御力自动判定」不符，已删除。
  const outOfCombatStats = config.outOfCombatStats ?? {}

  const discBuffs = collectDriveDiscBuffs(driveDiscConfig, setsMap, { agent, outOfCombatStats })
  const teamBuffs = collectTeammateBuffs(teammateBuffs, config.sourcePanelsByOwner, agent)

  return mergeBuffs(mergeBuffs(mergeBuffs(agentBuffs, wEngineBuffs), discBuffs), teamBuffs)
}

/**
 * `formula` 通道的三个只读变量（**契约**，改签名即改口径）：
 * - `x` = `effect.sourceStat` 在**来源角色面板**（`sourcePanelPhase` 相位）上的值
 *   （`dynamicSourceValue` 优先；无源面板时回落 `source.defaultValue`）。特殊名见
 *   `getPanelSourceStatValue`：`energyRegenTotal` / `flashEnergyRegenTotal` 是算式合成值。
 * - `s` = 来源角色**技能等级**（12 + `skillLevelBonus`；无源面板时 12）。耀嘉音咏叹华彩用。
 * - `p` = 来源角色**潜能觉醒档位**（1..6；无源面板时 6 = 满档）。2026-09-20 round 60 新增，
 *   与 `s` 同款「源面板只读量」——存在的理由：丽娜（1211）大扫除的转模系数**随潜能档位变**
 *   而基数取**同一来源面板的穿透率** ⇒ 单变量 `x` 表达不了「两轴」。
 *   ⚠ 与 `sourceStat: 'potentialLevel'`（把档位当 `x`，1381 零号·安比先例）不冲突：那条只用一轴。
 */
function evalFormulaExpression(expression: string, x: number, s: number, p: number): number {
  // 沙箱（白名单 + helper 名单）走 `utils/formulaSandbox`（CC-504，与难度公式同一份）；不合法 / 抛错 ⇒ 0，
  // 合法结果原样返回（历史行为：不对非有限做兜底，由下游 `Number()` / 乘区处理）。
  const r = evalSandboxedFormula(expression, { x, s, p })
  return r.ok ? r.value : 0
}

function getEffectSourceValue(effect: BuffEffect, panel?: PanelValues): number {
  const source = effect.source
  const panelValue = effect.sourceStat && panel ? getPanelStat(panel, effect.sourceStat) : undefined
  return Number(effect.dynamicSourceValue ?? panelValue ?? source?.defaultValue ?? effect.defaultSourceValue ?? 0)
}

function evalFormulaEffect(effect: BuffEffect, panel?: PanelValues): number {
  return evalFormulaExpression(
    effect.formula?.expression ?? '0',
    getEffectSourceValue(effect, panel),
    effect.dynamicSkillLevel ?? 12,
    effect.dynamicPotentialLevel ?? 6,
  )
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
    // 角色专属面板属性（`@/data/agentPanelStats`，如蕾米埃尔 14 项）也走这里：`emptyPanel()` 已按表铺好初值，
    // 按键名直加即可（CC-34a 2026-09-27 删掉了与本分支等价的 14 个逐字段 case）。
    default:
      if (!(stat in panel)) setPanelStat(panel, stat, 0)
      setPanelStat(panel, stat, (getPanelStat(panel, stat) as number) + value)
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
