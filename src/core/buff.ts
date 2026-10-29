/**
 * Buff 系统核心 - 收集、过滤、应用 buff 效果
 * 支持 fixed / derived / stacked 三种效果类型
 */
import { addPanelStat, getPanelStat, setPanelStat } from '@/utils/panelStat'
import type {
  Agent, WEngine, DriveDiscSet, BuffEffect, BuffGroup, BuffEffectOrigin,
  PanelValues, StatId, TeammateBuff, DriveDiscConfig, SkillDamageTarget, BuffScope, EffectRequirement, StatRules
} from '@/types/catalog'
import { localized } from '@/utils/format'
import { GENERATED_ENEMY_DEBUFF_STAT_IDS, LEGACY_ENEMY_DEBUFF_STAT_IDS, normalizeEnemyDebuffStatAlias } from '@/utils/enemyDebuffStats'
import { elementStatKey, type ElementStatKind } from '@/utils/elementStatKeys'
import { wEngineConditionMet, wEngineEffectRequirementMet, type WEngineConditionContext } from '@/core/wengineConditions'

import { normalizeSkillDamageTarget, SKILL_TAG_TARGET } from '@/data/skillDamageTargets'
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
  'penDmgBonus',
  'sheerDmgBonus',
  'physicalSheerDmg',
  'fireSheerDmg',
  'iceSheerDmg',
  'electricSheerDmg',
  'etherSheerDmg',
  'windSheerDmg',
  'physicalCritDmg',
  'fireCritDmg',
  'iceCritDmg',
  'electricCritDmg',
  'etherCritDmg',
  'windCritDmg',
  'sharpDmgBonus',
  'physicalSharpDmg',
  'fireSharpDmg',
  'iceSharpDmg',
  'electricSharpDmg',
  'etherSharpDmg',
  'windSharpDmg',
  ...GENERATED_ENEMY_DEBUFF_STAT_IDS,
  ...LEGACY_ENEMY_DEBUFF_STAT_IDS,
])

// skillTag → 招式族（`SKILL_TAG_TARGET`）住在 `@/data/skillDamageTargets`（2026-10-18 下沉）：
// 展示层（驱动盘套装效果行的定向标签）与引擎必须用同一张表，而 `src/utils` 不能 import `@/core`。
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

/**
 * 面板字段**别名归一**（单一事实源，2026-10-20）。
 *
 * 数据（catalog / teammate-buffs）里同一个面板字段有多种写法，引擎在 `applyStat` 的 switch 里
 * 用并列 case 收口（如 `anomalyDmgBonus` 与 `anomalyDamageBonus` 都加到 `panel.anomalyDmgBonus`）。
 * 这带来一个隐蔽风险：**任何按 stat 名建索引的展示层都会把同一个字段拆成两栏**
 * （用户实测：「风化/风属性异常伤害提升 anomalyDamageBonus 怎么区分成两个栏了」）。
 *
 * ⇒ 凡「按 stat 建键」的地方（属性矩阵 / 贡献账）必须先过本函数，与引擎落点同源。
 * 新增别名时**只改这里**，并把 `applyStat` 的对应 case 指向同一字段（两者由测试钉住一致）。
 */
export function normalizePanelStatAlias(stat: string): string {
  switch (stat) {
    case 'anomalyDamageBonus': return 'anomalyDmgBonus'
    default: return stat
  }
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

/**
 * 当前面板所属的 buff 批次相位（`outOfCombat` / `inCombat`）。
 * 与累加器同款 WeakMap（不进 PanelValues 对象），用于把累加器的输入量记到
 * 带相位前缀的键上（`inCombatDefPct` / `outOfCombatDefPct`）。
 */
const batchPhase = new WeakMap<PanelValues, 'outOfCombat' | 'inCombat'>()

/**
 * 盖章本面板的 buff 批次相位（供 `recordAccumInputs` 决定把大/小词条记到哪个前缀的键上）。
 *
 * 为什么需要显式导出：局外批次的效果由 `applyDriveDiscConfig` 的 `extraEffects` 参数应用，
 * 那条路径不经过 `applyBuffs` 的 phase 形参 ⇒ 不在这里盖，局外大/小词条会被误记成局内
 * （实测：`inCombatDefPct` 出现在局外面板上，而 `outOfCombatDefPct` 查不到）。
 */
/** 返回一个已盖章相位的新面板（相位随浅拷贝继承，供 `applyDriveDiscConfig` 这类内部会拷贝的入口用） */
export function withPhaseMark(panel: PanelValues, phase: 'outOfCombat' | 'inCombat'): PanelValues {
  const next = { ...panel }
  markBuffPhase(next, phase)
  return next
}

export function markBuffPhase(panel: PanelValues, phase: 'outOfCombat' | 'inCombat'): void {
  batchPhase.set(panel, phase)
  // 同时写一个**数值键**：`applyDriveDiscConfig` / `applyBuffs` 都做 `{ ...panel }` 浅拷贝，
  // WeakMap 状态不会跟着走，而 number 会。没有它，局外批次在第一次拷贝后就退化成局内前缀
  // （实测：`inCombatDefFlat=184` 出现在 withDiscs 上，主词条被误记成局内）。
  setPanelStat(panel, PHASE_KEY, phase === 'outOfCombat' ? 0 : 1)
}

/** 面板上承载「当前批次相位」的数值键（0 = 局外，1 = 局内；仅展示/记账用，不参与伤害） */
const PHASE_KEY = '__buffPhase'

function phaseOfPanel(panel: PanelValues): 'outOfCombat' | 'inCombat' {
  const fromMap = batchPhase.get(panel)
  if (fromMap) return fromMap
  return getPanelStat(panel, PHASE_KEY) === 0 ? 'outOfCombat' : 'inCombat'
}

function getAccumState(panel: PanelValues, stat: AccumStat): StatAccumState {
  let byStat = batchAccum.get(panel)
  if (!byStat) {
    byStat = new Map()
    batchAccum.set(panel, byStat)
  }
  const existing = byStat.get(stat)
  if (existing) return existing
  /**
   * 新面板对象（`{ ...panel }` 拷贝）拿不到上一批的累加器状态 ⇒ 从**当前面板值**重新起算：
   * 当前值已是上一批的合成结果，所以本批的 `base` 就是它，`pct`/`flat` 归零。
   *
   * ⚠ 曾试过「跨批次继承上一批的 pct/flat」（`readAccumInputs`）——**那是错的**：
   * `panel[stat]` 已经是 `base×(1+pct)+flat` 的合成值，再用**上一批的 base** 套 `base×(1+pct+新pct)`
   * 等于把旧 pct 又乘了一遍（实测克拉蕾防御：真实 160% 被算成 208%，多出 48%）。
   * 跨批次的可读性由「当前批次的记录」提供即可；历史批次的量已沉进面板合成值里，不需要也不该重算。
   */
  /**
   * 起点 = **本批次进入时的面板值**，`pct`/`flat` 归零。
   *
   * ⚠ 曾试过「把起点记到面板上、下一批次继承」（`priorBase`）——**那是错的**，实测把
   * 防御 48%+96% 算成了 192%（翻倍）：同一批次内 `applyStat` 会被调用多次，第一次调用
   * 就把 `__base` 写进面板，第二次读到自己刚写的值……循环放大。
   *
   * 正确语义：**每个面板对象 = 一个独立累加批次**。`finalizeCoreStatBonuses` 在批次边界清状态，
   * 新对象（含浅拷贝）本就该从当前值重新起算——这既是 `applyBuffs`/多次
   * `applyDriveDiscConfig` 幂等的前提，也是「大/小词条可读」只需要看**本批次**记录的原因。
   */
  /**
   * 起点 = **本批次进入时的面板值**；`finalizeCoreStatBonuses` 之后以当前值为新基数
   * （契约见 `batchAccum.test.ts`「finalize 后以当前值为新基数」）。
   *
   * ⚠ 曾两次试图「跨批次锁定/继承起点」，都被本判据证伪，且会让同一份主词条被重复计入：
   * 防御 48%+96%+16%+48%（音擎）本应 208%，锁定基数的写法反而把它算成 192%/其他错值。
   * 正确模型就是最简单那个：**一个面板对象 = 一个累加批次，finalize 断开批次**。
   */
  const state: StatAccumState = { base: panel[stat] ?? 0, pct: 0, flat: 0 }
  byStat.set(stat, state)
  return state
}

/**
 * 累加器把「大/小词条各多少」**留在面板上**（2026-10-20，用户：「基础、加成和最终…局内局外，
 * 大词条小词条分别多少」）。
 *
 * 修前 `recalcAccumStat` 只写合成结果（`panel.def = base×(1+%)+flat`），把 `pct` / `flat` 两个输入
 * 直接丢掉 ⇒ 面板上 `defPct`/`inCombatDefPct` 恒为 `undefined`，属性账读不到「大防御给了多少」，
 * 用户看到的就是「克拉蕾的局内大防御、局外大防御都没算」（实测：def 872→2870 却查不到加成明细）。
 *
 * 落点用**带相位前缀的键**（`outOfCombatDefPct` / `inCombatDefPct` …），与 `CORE_STAT_BY_BONUS` 里
 * 已有的相位键同名同义——它们本来就是「本相位累计的加成量」，此前只做加法输入、没有可读出口。
 * 这是**纯附加**：合成值算式一字未改，任何读 `panel.def` 的地方行为不变。
 */
function recalcAccumStat(panel: PanelValues, stat: AccumStat, state: StatAccumState): void {
  // 同一批次内：先汇总百分比，再统一乘入，最后加固定值。
  // 例如：最终局内攻击 = 局外攻击 × (1 + Σ局内大攻击) + Σ局内小攻击。
  panel[stat] = state.base * (1 + state.pct / 100) + state.flat
}



/** 相位前缀的「加成输入量」键（`inCombatAtkPct` 一类）；非核心属性返回 undefined */
function accumInputKeys(stat: AccumStat, phase: 'outOfCombat' | 'inCombat'): { pct: string; flat: string } | undefined {
  const prefix = phase === 'outOfCombat' ? 'outOfCombat' : 'inCombat'
  const cap = stat.charAt(0).toUpperCase() + stat.slice(1)
  if (stat === 'impact') return { pct: `${prefix}ImpactPct`, flat: `${prefix}ImpactFlat` }
  // anomalyMastery 走 scalar 通道（无相位键），不入本表
  if (stat === 'anomalyMastery') return undefined
  return { pct: `${prefix}${cap}Pct`, flat: `${prefix}${cap}Flat` }
}

function applyCoreStatBonus(panel: PanelValues, stat: CoreStatBonus, value: number): void {
  const meta = CORE_STAT_BY_BONUS[stat]
  if (!meta) return
  const state = getAccumState(panel, meta.base)
  if (meta.kind === 'pct') state.pct += value
  else state.flat += value
  recalcAccumStat(panel, meta.base, state)
  recordAccumInputs(panel, meta.base, state)
}

/**
 * 把累加器当前的大/小词条累计量**写成可读的面板字段**（带相位前缀）。
 *
 * 相位由键名决定（`inCombat*Pct` / `outOfCombat*Pct`），所以这里按「谁在累加」判断：
 * `applyBuffs` 的局外批次只会遇到 `outOfCombat*` 与无前缀键，局内批次只会遇到 `inCombat*` 与无前缀键。
 * 无前缀键（`atkPct` 一类，数据里「由来源 scope 决定相位」）两个相位都可能出现 ⇒ 只记录到
 * **当前批次的主导相位**（由调用方在 applyBuffs 前盖章），缺省记局内（局内批次是绝大多数）。
 */
function recordAccumInputs(panel: PanelValues, stat: AccumStat, state: StatAccumState): void {
  const phase = phaseOfPanel(panel)
  void phase
  const keys = accumInputKeys(stat, phase)
  if (!keys) return
  /**
   * **本批次**的累计量（不是历史累计）——所以直接覆盖写，不做加法。
   *
   * ⚠ 曾写成「读取已有值再累加」/「把起点存面板供下一批继承」，实测导致同一份配置
   * 算出 192%/208% 这种翻倍值（`applyDriveDiscConfig` 在某些路径下会被调用多次）。
   * 覆盖写保证：**面板上的键 == 当前这一批真正加进去的量**，与 `entry` 逐条上报一一对应。
   */
  setPanelStat(panel, keys.pct, state.pct)
  setPanelStat(panel, keys.flat, state.flat)
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

/**
 * 给效果盖来源标签（属性矩阵：让每一格数值都能回溯到提供者）。
 * 纯附加字段 ⇒ 引擎数值路径零影响；展示层按它把贡献摆进矩阵的行列。
 */
function withOrigin(effect: BuffEffect, origin: BuffEffectOrigin): BuffEffect {
  return { ...effect, origin }
}

/** 收集角色自身的 buff */
function collectAgentBuffs(agent: Agent, cinemaLevel: number): CollectedBuffs {
  const out: BuffEffect[] = []
  const inCombat: BuffEffect[] = []
  const provider = localized(agent.name, agent.id)

  const cb = agent.combatBuffs
  if (cb) {
    // 核心被动
    for (const e of extractEffects(cb.corePassive)) {
      const tagged = withOrigin(e, { kind: 'agent', provider, slot: -1, source: '核心被动', contentSlot: '核心被动' })
      if (cb.corePassive?.scope === 'outOfCombat') out.push(tagged)
      else inCombat.push(tagged)
    }
    // 额外能力
    for (const e of extractEffects(cb.additionalAbility)) {
      const tagged = withOrigin(e, { kind: 'agent', provider, slot: -1, source: '额外能力', contentSlot: '额外能力' })
      if (cb.additionalAbility?.scope === 'outOfCombat') out.push(tagged)
      else inCombat.push(tagged)
    }
    // 影画
    for (const cinema of cb.cinemaBuffs) {
      if (cinema.cinemaLevel > cinemaLevel) continue
      for (const e of extractEffects(cinema.buff)) {
        const tagged = withOrigin(e, { kind: 'agent', provider, slot: -1, source: `影画${cinema.cinemaLevel}`, contentSlot: `影画${cinema.cinemaLevel}` })
        if (cinema.buff?.scope === 'outOfCombat') out.push(tagged)
        else inCombat.push(tagged)
      }
    }
  }

  // 核心技等级加成
  if (agent.coreSkill.levels) {
    const maxLevel = agent.coreSkill.levels[agent.coreSkill.levels.length - 1]
    if (maxLevel?.stats) {
      for (const s of maxLevel.stats) {
        inCombat.push({
          id: `coreSkill_${s.stat}`,
          type: 'fixed',
          stat: s.stat,
          mode: s.mode,
          value: s.value,
          origin: { kind: 'agent', provider, slot: -1, source: '核心技等级' },
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
  /** 同名被动已被更早槽位的装备者占用 ⇒ 本装备者只吃自己的 selfBuff（如后场回能），teamBuff 份不再发（同名不叠加） */
  suppressTeamBuff = false,
): CollectedBuffs {
  const out: BuffEffect[] = []
  const inCombat: BuffEffect[] = []

  if (!matchSpecialty) return { outOfCombat: out, inCombat }

  const provider = localized(wEngine.name, String(wEngine.id))
  const addEffects = (group: BuffGroup | null) => {
    if (!wEngineConditionMet(group?.condition, gate)) return
    for (let e of extractEffects(group)) {
      if (!wEngineEffectRequirementMet(e.requirement, gate)) continue
      e = applyWEngineModLevel(e, modLevel)
      const tagged = withOrigin(e, { kind: 'wEngine', provider, slot: -1, source: '音擎效果', contentSlot: `音擎效果:${wEngine.id}` })
      if (group?.scope === 'outOfCombat') out.push(tagged)
      else inCombat.push(tagged)
    }
  }

  addEffects(wEngine.effect.selfBuff)
  if (!suppressTeamBuff) addEffects(wEngine.effect.teamBuff)

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
    if ('stat' in raw && 'min' in raw && typeof raw.stat === 'string' && typeof raw.min === 'number') return { stat: raw.stat, min: raw.min }
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
  const stat = effect.stat
  if (!stat.includes('{attribute}')) return effect
  return { ...effect, stat: resolveAttributeTemplateStat(stat, attribute) }
}

/** 属性模板解析（导出给 teamBuff 通道：自由蓝调挂在敌人 8s，全队同属性积蓄都吃，按装备者属性落键） */
export function resolveAttributeTemplateStat(stat: string, attribute: string): string {
  const capitalized = attribute.charAt(0).toUpperCase() + attribute.slice(1)
  return stat.replace('{attribute}', capitalized)
}

/**
 * **每套驱动盘穿了几件**的唯一解析（单一事实源）。
 *
 * 形态只有两种（用户 2026-10-29：2+2+2 是真实存在的配装，不是「4 件套 + 2 件套」的变体）：
 *   · `thirdTwoPieceSetId` 空 ⇒ **4+2**：fourPieceSetId = 4 件、twoPieceSetId = 2 件
 *     （两套同 id ⇒ 仍按 4 件计，与实机「6 件同套只吃 2pc+4pc」一致）；
 *   · `thirdTwoPieceSetId` 置位 ⇒ **2+2+2**：三套各 2 件，**没有任何套装到 4 件**
 *     ⇒ 4 件段（自身 + 团队）一律不生效；若两个字段填了同一套，那套就是 4 件（等同实机）。
 *
 * 消费者：`collectDriveDiscBuffs`（本文件）、`inCombatBuffs#collectTeamBuffs`（4 件套团队段）、
 * `discFourPieceSetIdOf`（面板/UI 判定）、`utils/discEffectRows`（效果清单展示）。
 * ⚠ 禁止在别处再写一份「有没有 4 件套」的判定——两处各判一次正是本仓踩过的坑型。
 */
export function resolveDiscSetPieces(config: DriveDiscConfig): Map<string, number> {
  const counts = new Map<string, number>()
  const add = (id: string | undefined, n: number) => { if (id) counts.set(id, (counts.get(id) ?? 0) + n) }
  if (config.thirdTwoPieceSetId) {
    add(config.fourPieceSetId, 2)
    add(config.twoPieceSetId, 2)
    add(config.thirdTwoPieceSetId, 2)
  } else {
    add(config.fourPieceSetId, 4)
    if (config.twoPieceSetId && config.twoPieceSetId !== config.fourPieceSetId) add(config.twoPieceSetId, 2)
  }
  return counts
}

/** 真正凑够 4 件的那套 id（2+2+2 形态恒 undefined ⇒ 4 件段不收集）；4 件套团队段与展示同读此判定 */
export function discFourPieceSetIdOf(config: DriveDiscConfig): string | undefined {
  if (!config.fourPieceSetId) return undefined
  return (resolveDiscSetPieces(config).get(config.fourPieceSetId) ?? 0) >= 4 ? config.fourPieceSetId : undefined
}

function collectDriveDiscBuffs(
  config: DriveDiscConfig,
  setsMap: Map<string, DriveDiscSet>,
  ctx: DiscSetRequirementContext,
): CollectedBuffs {
  const out: BuffEffect[] = []
  const inCombat: BuffEffect[] = []

  for (const [setId, count] of resolveDiscSetPieces(config)) {
    const set = setsMap.get(setId)
    if (!set) continue

    const setProvider = localized(set.name, String(set.id))
    // 2件套效果（count>=2 时生效）
    if (count >= 2 && set.twoPiece?.effects) {
      for (const e of set.twoPiece.effects) {
        if (!discRequirementMet(e.requirement, ctx.agent, ctx.outOfCombatStats)) continue
        out.push(withOrigin(
          resolveDiscStatTemplate(e, ctx.agent.attribute),
          { kind: 'driveDisc', provider: setProvider, slot: -1, source: '套装 2pc', contentSlot: `套装2pc:${setId}` },
        ))
      }
    }

    // 4件套效果
    if (count >= 4 && set.fourPiece.selfBuff) {
      const group = set.fourPiece.selfBuff
      if (!discRequirementMet(group.requirement, ctx.agent, ctx.outOfCombatStats)) continue
      for (let e of group.effects) {
        if (!discRequirementMet(e.requirement, ctx.agent, ctx.outOfCombatStats)) continue
        const tagged = withOrigin(
          resolveDiscStatTemplate(e, ctx.agent.attribute),
          { kind: 'driveDisc', provider: setProvider, slot: -1, source: '套装 4pc', contentSlot: `套装4pc:${setId}` },
        )
        if (group.scope === 'outOfCombat') out.push(tagged)
        else inCombat.push(tagged)
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
      // 提供者归属（2026-10-20 用户纠正：「危局buff 你的归属是队友。这显然是环境。boss 给的 buff 也该归于 boss」）：
      //   - `sourceKind === 'global'`（危局 buff 牌 / boss 层 / 用户手填的全局行，见 panelPhases 的
      //     `globalAsTeammateBuffs`）⇒ kind = 'team'，提供者 = 该行自己的名字（「危局buff」「boss」…），
      //     **不是**任何队友；
      //   - 角色类（`sourceCategory === 'agent'`）⇒ 队友；
      //   - 其余（音擎/驱动盘团队段）⇒ 环境类。
      const kind: BuffEffectOrigin['kind'] = buff.sourceKind === 'global'
        ? 'team'
        : (buff.sourceCategory === 'agent' ? 'teammate' : 'team')
      const tagged = withOrigin(e, {
        kind,
        provider: localized(buff.ownerName, buff.ownerId),
        slot: -1,
        source: localized(buff.sourceLabel, buff.id),
        // 内容标识：环境类用行名（危局buff / boss），队友类用「来源·buffId」保证唯一
        contentSlot: kind === 'team'
          ? `环境:${localized(buff.ownerName, buff.ownerId)}`
          : `队友:${buff.id}`,
      })
      if (buff.scope === 'outOfCombat') out.push(tagged)
      else inCombat.push(tagged)
    }
  }

  return { outOfCombat: out, inCombat }
}

/**
 * 该驱动盘配置的 4 件套 selfBuff 是否带 outOfCombatStat 门槛（CC-108）。
 * `calcPanel` 据此决定是否做第二段收集；没有门槛时一段即可，结果与两段相同。
 */
export function discSelfBuffNeedsOutOfCombatPanel(config: DriveDiscConfig, setsMap: Map<string, DriveDiscSet>): boolean {
  // 2+2+2（第三套置位）⇒ 没有 4 件套自身段可收，无需第二段扫（`discFourPieceSetIdOf` 即此判定）
  const fourId = discFourPieceSetIdOf(config)
  const group = fourId ? setsMap.get(fourId)?.fourPiece.selfBuff : undefined
  if (!group) return false
  if (parseOutOfCombatStatRequirement(group.requirement?.outOfCombatStat)) return true
  return group.effects.some(e => parseOutOfCombatStatRequirement(e.requirement?.outOfCombatStat) != null)
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
  // 同名音擎被动不叠加（自身通路侧）：teammateBuffs 已按槽位序先到先得去重 ⇒ 列表里若已有
  // 同 id 的音擎团队效果而装备者不是它（更早槽位的队友先装了同名），本装备者不再给自己发 teamBuff 份。
  // selfBuff（如啜泣摇篮的后场回能）各装各的，不受此抑制。
  const samePassiveTakenByTeammate = wEngine
    ? teammateBuffs.some(b => b.id === `wengine-team-${wEngine.id}` && b.teammateId !== agent.id)
    : false
  const wEngineBuffs = wEngine
    ? collectWEngineBuffs(wEngine, config.wEngineModLevel, matchSpecialty, {
        wearerAttribute: agent.attribute,
        wearerSpecialty: agent.specialty,
        wearerAgentId: agent.id,
        enemyWeakness: config.enemyWeakness,
      }, samePassiveTakenByTeammate)
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

/**
 * 效果**数值**求值（应用与展示共用单一事实源，2026-10-20 属性矩阵抽出）。
 *
 * `applyEffect` 原把「算值」与「写面板」写在一起，展示层（属性矩阵）要显示每格贡献却拿不到值，
 * 只能自己重算一遍 —— 那正是「两处各写一遍」的老毛病。抽出本函数后两者同源：
 * 面板里加了什么，矩阵格子里就显示什么。
 *
 * 返回 null = 该效果不产生数值（覆盖率 0 / 无 stat）；调用方据此跳过。
 */
export function resolveEffectValue(effect: BuffEffect, panel: PanelValues, coverage?: number): number | null {
  if (!effect.stat) return null
  const cov = coverage ?? effect.coverage?.default ?? 1
  if (cov <= 0) return null

  switch (effect.type) {
    case 'fixed':
      return effect.value * cov
    case 'derived': {
      const sourceValue = getEffectSourceValue(effect)
      const ratio = (effect.ratio ?? 0) / 100
      const base = sourceValue * ratio
      return (effect.cap ? Math.min(base, effect.cap) : base) * cov
    }
    case 'stacked':
      return effect.valuePerStack * effect.defaultStacks * cov
    case 'formula':
      return evalFormulaEffect(effect, panel) * cov
    default:
      return null
  }
}

/** 应用单个 buff 效果到面板 */
export function applyEffect(panel: PanelValues, effect: BuffEffect, coverage?: number): void {
  const value = resolveEffectValue(effect, panel, coverage)
  if (value === null) return

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

/**
 * @fact core/buff/两批求值 口径: 同一 buff 批次内先落全部 fixed/derived/stacked、再统一求 formula；formula 的 x 因此读该相位**最终**面板值（不再读「效果应用那一刻」的快照） | 据 用户@2026-10-20「肯定按照真实的来啊」+ 1581 异化系数实测（局外 AP 502 → 应局内 648） | 验 src/core/__tests__/remielleSourcePhase.test.ts | 锚 src/core/buff.ts#applyBuffs | 信 确认
 * ⟳复核: 若新增「formula 读 formula」的数据（一条转模吃另一条转模的结果）⇒ 本函数要显式排序，不能依赖 effects 数组顺序 | 到期 2027-06-30
 */
/** 应用一组 buff 效果 */
export function applyBuffs(
  panel: PanelValues,
  effects: BuffEffect[],
  coverageMap?: Map<string, number>,
  /** 本批次所属相位（只用于把累加器的「大/小词条输入」记到带相位前缀的键上；不影响任何数值） */
  phase?: 'outOfCombat' | 'inCombat',
): PanelValues {
  const result = { ...panel }
  finalizeCoreStatBonuses(result)
  if (phase) batchPhase.set(result, phase)
  // ★ 两批求值（2026-10-20，用户裁决「异化按真实的来」）：**加成批 → 派生批**。
  //
  // 根因：`formula` 效果的 x = `getEffectSourceValue` 读**当前**面板值，而字段顺序 = buff 数组拼接顺序
  // （`mergeBuffs` 依次 agentBuffs → wEngine → disc → teammate）。于是「按自身某个属性转模」的效果
  // 读到的是**它前面那几条**加成之后的快照，而不是该相位的最终值。
  // 实测（1581 蕾米埃尔，局内批次）：`remielle_refringe_coefficient_from_ap` 排在 own buffs 首位，
  // 只读到**局外**异常精通 502（音擎 14158 +96 与驱动盘 34100 +50 都在它之后进面板）
  // ⇒ 异化系数 10.04%，而最终局内精通 648 应为 12.96%（资源卡展示与伤害管线的另一半偏差来源）。
  //
  // 契约：**同一批次内先落全部 fixed/derived/stacked，再求全部 formula**。formula 之间仍按声明顺序
  // （现无「formula 读 formula」的数据；出现时必须显式排序，不得依赖数组拼接顺序）。
  for (const e of effects) {
    if (!e.stat || e.type === 'formula') continue
    applyEffect(result, e, coverageMap?.get(e.id))
  }
  for (const e of effects) {
    if (!e.stat || e.type !== 'formula') continue
    applyEffect(result, e, coverageMap?.get(e.id))
  }
  return finalizeCoreStatBonuses(result)
}
