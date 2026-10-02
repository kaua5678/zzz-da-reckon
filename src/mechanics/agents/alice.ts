import type {
  AgentAnomalyTransformInput,
  AgentCharConfigInput,
  AgentEventInput,
  AgentMechanicModule,
  AgentPanelInput,
  AgentResourceInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
  ExtraAnomalyRowGroup,
  ExtraAnomalyRowsInput,
} from '../types'
import { EXTRA_ANOMALY_ROW_ORDER } from '../types'
import type { AgentSkills } from '@/types/catalog'
import type {
  CharacterOperationConfig,
  IterationState,
  SpecialResourceSection,
} from '@/types/resource'
import { ANOMALY_SINGLE_HIT_MULTIPLIER } from '@/core/anomalyPool/helpers'
import { isNumberedBasicSegment } from '@/data/basicSegment'
import { fmt } from '@/utils/format'
import { getAgentSpec } from '@/specs/registry'
import { specAdditionalAbilityActive } from '@/mechanics/additionalAbilityGates'
import { buildSpecAnomalyEvents } from '@/specs/mechanics'
import { computeSpecResources } from '@/specs/resources'
import { applySpecAttributeConversions } from '@/specs/runtime'
import { findMoveById, getRowValue } from '@/data/moveTableQueries'

const ALICE_AGENT_ID = '1401'
const SWORD_WILL_COST = 300
const SWORD_WILL_MOVE_ID = '1401012'
/** 四命强化后的普通攻击：星仪序曲（倍率表 Celestial Overture #5），强特每次伴随一次 */
const ALICE_ENHANCED_BASIC_MOVE = '1401005'

// ============ 畏缩机制常量 ============

/** 极性强击每次回复剑意（基础值，一命后变为 35） */
const POLARITY_ASSAULT_SWORD_WILL = 10
/** 一命：极性强击每次额外回复剑意（基础 10 + 额外 25 = 35） */
const C1_POLARITY_ASSAULT_SWORD_WILL = 35
/** 全队强击每次回复剑意 */
const TEAM_ASSAULT_SWORD_WILL = 10
/** 紊乱每次回复剑意 */
const DISORDER_SWORD_WILL = 30
/** 四命：攻击时无视目标 10% 物理伤害抗性 */
const C4_PHYSICAL_RES_REDUCTION = 10
/** 爱丽丝特殊开局喧响：额外 +1000（在通用 1000 基础上） */
const ALICE_INITIAL_DECIBEL_BONUS = 1000
/** 畏缩固定 DOT：每 tick 造成强击伤害的比例（%） */
const COWERING_DOT_RATIO = 2.5
/** 畏缩固定 DOT：tick 间隔（秒） */
const COWERING_DOT_INTERVAL = 0.95
/** 畏缩紊乱倍率加成：每剩余 1 秒物理异常时长 +%*/
const COWERING_DISORDER_BONUS_PER_SEC = 18
/** 畏缩紊乱倍率加成上限（%） */
const COWERING_DISORDER_BONUS_MAX = 180
/** 畏缩全局物理异常积蓄效率 +% */
const COWERING_BUILD_UP_EFFICIENCY = 25
/** 六命：每轮决胜状态最大额外攻击次数 */
const C6_MAX_TRIGGERS_PER_STATE = 6
/** 六命：额外攻击基础倍率 = 异常精通 × 3300%（小数 33） */
const C6_DAMAGE_RATIO = 33

// ============ applyPanel ============

function applyAlicePanel({ slot, agent, cinemaLevel, team, panel }: AgentPanelInput): void {
  const aa = specAdditionalAbilityActive(team, slot, agent)
  panel.aliceAdditionalAbilityActive = aa ? 1 : 0
  panel.aliceCinema1 = cinemaLevel >= 1 ? 1 : 0
  panel.aliceCinema2 = cinemaLevel >= 2 ? 1 : 0
  panel.aliceCinema4 = cinemaLevel >= 4 ? 1 : 0
  panel.aliceCinema6 = cinemaLevel >= 6 ? 1 : 0

  // 畏缩：全局物理异常积蓄效率 +25%（默认覆盖 100%）
  if (aa) {
    panel.physicalAnomalyBuildUpEfficiency = (panel.physicalAnomalyBuildUpEfficiency ?? 0) + COWERING_BUILD_UP_EFFICIENCY
  }

  // 一命目标减防 / 二命全队强击+紊乱增伤 已由 spec teamBuffs（alice_c1_enemy_def_reduction /
  // alice_c2_team_assault_damage）合并生效（enemy/team 目标，全队受益含爱丽丝自身），
  // 此处不再重复施加，防双计（SOP §3.5）。

  // 四命：攻击时无视目标 10% 物理伤害抗性
  if (cinemaLevel >= 4) {
    panel.enemyPhysicalResReduction = (panel.enemyPhysicalResReduction ?? 0) + C4_PHYSICAL_RES_REDUCTION
  }

  applySpecAttributeConversions(
    panel,
    getAgentSpec(ALICE_AGENT_ID)?.attributeConversions ?? [],
  )
  // 掌控转精通（>140 每点 +1.6）只由上面 spec `alice_mastery_to_proficiency` 执行（缺省 floor 整步）。
  // R6 C7（第 142 轮）删除了原来零读取的 `panel.aliceMasteryToProficiencyBonus`（连续公式）与 `cfg.aliceMasteryToProficiencyRate`：
  // 它们是同一机制的第二份常数，且口径（连续）与实际执行（取整）不同，只会误导。
}

// ============ buildCharConfig ============

/** 计算爱丽丝普攻秒均剑意（avg of attack_data_0 / actionTime，仅普通段） */
function calcSwordWillPerSec(skills: AgentSkills): number {
  const basic = skills.categories.find(c => c.id === 'basic')
  if (!basic) return 0

  const rates: number[] = []
  for (const move of basic.moves) {
    // 只取 #N 普通段（CC-320：单一事实源）
    if (!isNumberedBasicSegment(move) || !move.actionTime) continue

    // 排除强化平A（damage > 200%）和星芒圆舞曲段（attack_data=0）
    const damage = getRowValue(move, 'damage')
    if (damage > 200) continue

    const sw = getRowValue(move, 'attack_data_0')
    if (sw > 0) {
      rates.push(sw / move.actionTime)
    }
  }
  return rates.length > 0 ? rates.reduce((a, b) => a + b, 0) / rates.length : 0
}

/** 从倍率表找爱丽丝强特招式并提取剑意 */
function findExSpecialSwordWill(skills: AgentSkills): number {
  const special = skills.categories.find(c => c.id === 'special')
  if (!special) return 0

  for (const move of special.moves) {
    const name = move.name?.en?.toLowerCase() || ''
    if (name.includes('ex special') && move.energyCost && Object.keys(move.energyCost).length > 0) {
      return getRowValue(move, 'attack_data_0')
    }
  }
  return 0
}

function buildAliceCharConfig({
  slot,
  agent,
  skills,
  cinemaLevel,
  team,
  cfg,
  getRowValue,
}: AgentCharConfigInput): void {
  const aa = specAdditionalAbilityActive(team, slot, agent)
  const sw3 = findMoveById(skills, SWORD_WILL_MOVE_ID)
  const swPerSec = calcSwordWillPerSec(skills)
  const exSw = findExSpecialSwordWill(skills)

  const actionTime = sw3?.actionTime ?? 0
  // 合轴率使前台时间 = 1s：actionTime × (1 - comboAlignRatio) = 1 → ratio = 1 - 1/actionTime
  const comboAlignRatio = actionTime > 0 ? Math.max(0, 1 - (1 / actionTime)) : 0

  cfg.aliceEnabled = true
  cfg.aliceAdditionalAbilityActive = aa
  cfg.aliceSwordWillPerSec = swPerSec
  cfg.aliceExSpecialSwordWill = exSw
  cfg.aliceInitialSwordWill = aa ? SWORD_WILL_COST : 0
  cfg.aliceSwordWillMoveId = SWORD_WILL_MOVE_ID
  cfg.aliceSwordWillActionTime = actionTime
  cfg.aliceSwordWillDecibelRecovery = getRowValue(sw3, 'decibel_recovery')
  cfg.aliceSwordWillComboAlignRatio = comboAlignRatio

  // 一命：极性强击每次回复 35（基础 10 + 额外 25）
  cfg.alicePolarityAssaultSwordWill = cinemaLevel >= 1 ? C1_POLARITY_ASSAULT_SWORD_WILL : POLARITY_ASSAULT_SWORD_WILL

  // 二命：终结技命中触发一次极性强击
  cfg.aliceCinema2UltSpark = cinemaLevel >= 2

  // 爱丽丝特殊开局喧响：入场立即获得额外 1000 点（在通用 1000 之上）
  cfg.initialDecibelGift = (cfg.initialDecibelGift ?? 1000) + ALICE_INITIAL_DECIBEL_BONUS

  // 畏缩机制配置
  cfg.aliceTeamAssaultSwordWill = TEAM_ASSAULT_SWORD_WILL
  cfg.aliceDisorderSwordWill = DISORDER_SWORD_WILL
  // 全队强击 / 紊乱 的**次数**由 applyTeamConfig 的 converge 阶段按上一轮收敛值写入
  // （见 `applyTeamConfig` 本模块实现；build 阶段先置 0，语义与莱特 teamEnergyConsumed 同款）
  cfg.aliceTeamAssaultCount = (cfg as { aliceTeamAssaultCount?: number }).aliceTeamAssaultCount ?? 0
  cfg.aliceDisorderCount = (cfg as { aliceDisorderCount?: number }).aliceDisorderCount ?? 0
  cfg.aliceCoweringDotRatio = COWERING_DOT_RATIO
  cfg.aliceCoweringDotInterval = COWERING_DOT_INTERVAL
  cfg.aliceCoweringDisorderBonusPerSec = COWERING_DISORDER_BONUS_PER_SEC
  cfg.aliceCoweringDisorderBonusMax = COWERING_DISORDER_BONUS_MAX
}

// ============ buildExecutions ============

function buildAliceSwordWillSource(
  cfg: {
    aliceEnabled?: boolean
    aliceSwordWillPerSec?: number
    aliceExSpecialSwordWill?: number
    aliceInitialSwordWill?: number
    alicePolarityAssaultSwordWill?: number
    aliceTeamAssaultSwordWill?: number
    aliceDisorderSwordWill?: number
    aliceCinema2UltSpark?: boolean
  },
  state: { basicAttackTime: number; exSpecialCount: number; ultimateCount?: number },
  anomalyPoolData?: { assaultTriggerCount?: number; disorderCount?: number },
): AliceSwordWillSource | undefined {
  if (!cfg.aliceEnabled) return undefined
  const spec = getAgentSpec(ALICE_AGENT_ID)
  const resource = spec
    ? computeSpecResources(
        spec,
        cfg as unknown as CharacterOperationConfig,
        state as unknown as IterationState,
        {
          teamAssaultCount: anomalyPoolData?.assaultTriggerCount ?? 0,
          disorderCount: anomalyPoolData?.disorderCount ?? 0,
        },
      ).get('alice_sword_will')
    : undefined
  const sparkCount = resource?.spendCounts['final_spark'] ?? 0
  const sparkCost = resource?.spendCosts['final_spark'] ?? 0
  const perSpark = cfg.alicePolarityAssaultSwordWill ?? POLARITY_ASSAULT_SWORD_WILL
  return {
    initial: resource?.initialValue ?? cfg.aliceInitialSwordWill ?? 0,
    basicAttackGain: resource?.gains['alice_basic_gain'] ?? 0,
    exSpecialGain: resource?.gains['alice_ex_gain'] ?? 0,
    polarityAssaultGain: resource?.gains['alice_polarity_feedback'] ?? 0,
    polarityAssaultPerSpark: perSpark,
    teamAssaultGain: resource?.gains['alice_team_assault_gain'] ?? 0,
    disorderGain: resource?.gains['alice_disorder_gain'] ?? 0,
    c2UltSparkCount: resource?.bonusCount ?? 0,
    totalAvailable: resource?.total ?? 0,
    sparkCount,
    sparkCost,
    remaining: resource?.remaining ?? 0,
  }
}

/**
 * 从 cfg 取两条外部次数源，喂给 `buildAliceSwordWillSource` 的第 3 参。
 *
 * 为什么走 cfg 而不是调用点直接传异常池对象：这两个次数由**上一轮**异常池收敛值经
 * `applyTeamConfig`(converge) 写进 cfg（见模块的 applyTeamConfig 注释），
 * `buildExecutions` 跑的时机异常池还没算 ⇒ 它拿不到本轮值，只能读这个跨轮字段。
 *
 * ⚠ 修复前这里是**三个调用点都不传第 3 参** ⇒ `?? 0` 兜底 ⇒ spec 里声明
 * `status:"implemented"` 的两条 gain 规则恒产 0（结构性死参数，2026-09-15 实测）。
 */
export function cfgExternalCountsProbe(cfg: {
  aliceTeamAssaultCount?: number
  aliceDisorderCount?: number
  aliceAdditionalAbilityActive?: boolean
}): { assaultTriggerCount: number; disorderCount: number } {
  return {
    assaultTriggerCount: Math.max(0, cfg.aliceTeamAssaultCount ?? 0),
    // ⚠ 紊乱那条规则**带额外能力门控**：原文「队伍中存在另一名[异常]或[支援]角色时触发：
    // 队伍中任意角色触发[紊乱]效果时，爱丽丝回复30点[剑仪]」。门控未过 → 该收入为 0
    // （`aliceAdditionalAbilityActive` 由 buildAliceCharConfig 按 specAdditionalAbilityActive（spec 1401 additionalAbility）写）。
    // 不做这道门会把「单爱丽丝队」的剑仪算多。
    disorderCount: cfg.aliceAdditionalAbilityActive
      ? Math.max(0, cfg.aliceDisorderCount ?? 0)
      : 0,
  }
}

function buildAliceExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const smSrc = buildAliceSwordWillSource(cfg, state, cfgExternalCountsProbe(cfg))
  if (!smSrc || smSrc.sparkCount <= 0) return

  const actionTime = cfg.aliceSwordWillActionTime ?? 0
  const comboAlignRatio = cfg.aliceSwordWillComboAlignRatio ?? 0
  const decibelRecovery = cfg.aliceSwordWillDecibelRecovery ?? 0

  executions.push({
    moveId: cfg.aliceSwordWillMoveId ?? SWORD_WILL_MOVE_ID,
    moveName: '普通攻击：星芒圆舞曲 #3（剑意触发）',
    category: 'basic',
    count: smSrc.sparkCount,
    actionTime,
    comboAlignRatio,
    totalTime: smSrc.sparkCount * actionTime,
    totalComboAlignTime: smSrc.sparkCount * actionTime * comboAlignRatio,
    energyConsume: 0,
    totalEnergyConsume: 0,
    decibelRecovery,
    totalDecibelRecovery: smSrc.sparkCount * decibelRecovery,
    energyRecovery: 0,
    totalEnergyRecovery: 0,
  })

  // 四命：每次强特伴随一次强化后的普通攻击：星仪序曲（用于异常积蓄与伤害结算）
  const exSpecialCount = state.exSpecialCount ?? 0
  if (exSpecialCount > 0) {
    executions.push({
      moveId: ALICE_ENHANCED_BASIC_MOVE,
      moveName: '普通攻击：星仪序曲（强特伴随）',
      category: 'basic',
      count: exSpecialCount,
      actionTime: 0,
      comboAlignRatio: 0,
      totalTime: 0,
      totalComboAlignTime: 0,
      energyConsume: 0,
      totalEnergyConsume: 0,
      decibelRecovery: 0,
      totalDecibelRecovery: 0,
      energyRecovery: 0,
      totalEnergyRecovery: 0,
    })
  }
}

// ============ buildAnomalyEvents ============

function transformAliceAnomalyPool(input: AgentAnomalyTransformInput): void {
  // 自己的面板 = 派发方给的 `self`（r399 CC-373；原为 applyPanel 盖 `aliceEnabled` 再 `(p as any)` 扫面板认人）
  const panel = input.self.panel
  if (!panel || (panel.aliceCinema4 ?? 0) <= 0) return

  // 四命：强化后的普通攻击：星仪序曲（1401005）物理异常积蓄 +25%
  for (const contrib of input.elementMap.get('physical') ?? []) {
    if (contrib.moveId !== ALICE_ENHANCED_BASIC_MOVE) continue
    contrib.baseBuildUp *= 1.25
    contrib.perHitBuildUp *= 1.25
    contrib.totalBuildUp *= 1.25
  }
}

function buildAliceAnomalyEvents({ cfg, state, events }: AgentEventInput): void {
  const smSrc = buildAliceSwordWillSource(cfg, state, cfgExternalCountsProbe(cfg))
  if (!smSrc) return
  const spec = getAgentSpec(ALICE_AGENT_ID)
  if (!spec) return
  events.push(...buildSpecAnomalyEvents(spec, cfg, state, { aliceSparkCount: smSrc.sparkCount }))
}

// ============ buildResourceResult ============

function buildAliceResourceResult({ cfg, state }: AgentResourceResultInput): Partial<import('@/types/resource').CharacterResourceResult> {
  return {
    aliceSwordWillSource: buildAliceSwordWillSource(cfg, state, cfgExternalCountsProbe(cfg)),
  }
}

// ============ resourceSections ============

function buildAliceResourceSections({ result }: AgentResourceSectionsInput): SpecialResourceSection[] {
  const sm = result.aliceSwordWillSource
  if (!sm) return []

  const rows: { label: string; value: string; detail?: string }[] = [
    { label: '入场剑意', value: `+${fmt(sm.initial)}`, detail: sm.initial > 0 ? '额外能力：队伍中有异常/支援角色' : '额外能力未触发' },
    { label: '普攻剑意', value: `+${fmt(sm.basicAttackGain)}`, detail: '秒均剑意 × 普攻时间' },
    { label: '强特剑意', value: `+${fmt(sm.exSpecialGain)}`, detail: '单次强特剑意 × 强特次数' },
  ]

  if (sm.polarityAssaultGain > 0) {
    const c2Note = sm.c2UltSparkCount > 0 ? `（含二命终结技额外 ${sm.c2UltSparkCount} 次）` : ''
    rows.push({ label: '极性强击剑意', value: `+${fmt(sm.polarityAssaultGain)}`, detail: `每触发一次极性强击 +${sm.polarityAssaultPerSpark} · ${sm.sparkCount} 次${c2Note}` })
  }
  if (sm.teamAssaultGain > 0) {
    rows.push({ label: '全队强击剑意', value: `+${fmt(sm.teamAssaultGain)}`, detail: '每触发一次全队强击 +10' })
  }
  if (sm.disorderGain > 0) {
    rows.push({ label: '紊乱剑意', value: `+${fmt(sm.disorderGain)}`, detail: '每触发一次紊乱 +30' })
  }

  rows.push({ label: '剑意消耗', value: `-${fmt(sm.sparkCost)}`, detail: `300 × ${sm.sparkCount} 次 = 星芒圆舞曲 #3` })

  return [{
    id: 'alice-sword-will',
    title: '爱丽丝剑意',
    summary: `星芒圆舞曲 #3 × ${sm.sparkCount} 次 · 结余 ${fmt(sm.remaining)}`,
    rows,
    footer: `总剑意 ${fmt(sm.totalAvailable)} → ${sm.sparkCount} 次星芒圆舞曲 #3，前台总耗时 ${fmt(sm.sparkCount)} 秒（含合轴减免）`,
  }]
}

// ============ 模块导出 ============

/**
 * 从异常池结果汇总爱丽丝两条外部次数源（剑仪 gain 用）。
 *
 * - **强击次数** = **只算 `physical`**，且**只算爱丽丝自己触发的那部分**（见函数体；类型名里的 Team 是历史名）（属性积蓄条打满触发的那种强击）。
 * - **紊乱次数** = `disorderCount`（引擎已按 `min(Σ触发−1, 2×(Σ−max))` 算好）。
 *
 * ⚠ **`physical_polar_assault` 必须排除（否则双计）**——这条是实测+原文一起定的：
 *   ① 原文（`data/raw/nanoka_missing/full/1401.json` 核心被动）：
 *      「爱丽丝**通过属性异常积蓄**触发[强击]时，回复10点[剑仪]」——限定「通过积蓄触发」；
 *      而极性强击的定义是「**无视属性积蓄进度**造成一次原本[强击]效果X%的伤害」
 *      ⇒ 极性强击**不走积蓄条**，不属于本规则覆盖的事件。
 *   ② 极性强击有**自己**的 gain 规则：spec `feedbackGainRules[alice_polarity_feedback]`，
 *      countSource = `totalSparkCount`（每次星芒圆舞曲#3 触发一次极性强击），
 *      value = 10（1命后 35）。实测探针：9 次 spark → `polarityAssaultGain = 90`。
 *   ⇒ 若这里再把 `physical_polar_assault` 的 9 次按 +10 计入，同一批极性强击就拿了两遍剑意。
 *
 * ⚠ 注意与 `core/anomalyPool/helpers.ts:976` 的口径区别：那里算**物理失衡次数**时
 * `physical + physical_polar_assault` 相加是**对的**（两者都是「一次强击事件」，都削韧）；
 * 本函数算的是**剑仪收入**，规则文本限定「通过积蓄触发」⇒ 只取 `physical`。两处口径不同是
 * 因为问的问题不同，不是不一致。
 *
 * 提取逻辑留在模块侧，避免编排层新增 agentId 分支（规则 6 棘轮）。返回 null = 本队无爱丽丝。
 */
export function aliceExternalCountsOf(
  anomalyPool: {
    perElement?: ReadonlyArray<{ element: string; triggerCount?: number; perSlotTriggerCounts?: readonly number[] }>
    disorderCount?: number
  } | null | undefined,
  /** 爱丽丝所在槽位（编排层从 rr 里数出来；-1 = 本队无爱丽丝 ⇒ 返回 null） */
  aliceSlot: number,
): { assaultCount: number; disorderCount: number } | null {
  if (aliceSlot < 0 || !anomalyPool) return null
  let assaultCount = 0
  for (const prog of anomalyPool.perElement ?? []) {
    // 只取 physical：极性强击（physical_polar_assault）不走积蓄条、另有 alice_polarity_feedback
    // 规则（见函数头注释②），此处计入即双计。
    if (prog.element !== 'physical') continue
    // 只取**爱丽丝自己**触发的那部分：原文「**爱丽丝**通过属性异常积蓄触发[强击]时，回复10点」
    // ——主语是她自己，队友触发的强击不给她的剑仪（对比紊乱那条是「队伍中**任意角色**触发」）。
    // 实测（爱丽丝+柚叶+悠真）：physical 16 次 = 爱丽丝 11 / 柚叶 5 / 悠真 0，
    // 用 team 口径会多算 45%。perSlotTriggerCounts 缺省（老结果对象）时退回整元素计数。
    const perSlot = prog.perSlotTriggerCounts
    assaultCount += perSlot && aliceSlot >= 0 && aliceSlot < perSlot.length
      ? (perSlot[aliceSlot] ?? 0)
      : (prog.triggerCount ?? 0)
  }
  return { assaultCount, disorderCount: anomalyPool.disorderCount ?? 0 }
}

/**
 * 从资源结果里数出爱丽丝的槽位（-1 = 本队无爱丽丝）。
 * 与模块能力 `giftedPolarAssaultCount` 同款：提取逻辑留模块侧，编排层不写 agentId 字面量（规则 6 棘轮）。
 */
export function aliceSlotOf(rr: { characters: Array<{ slot?: number; agentId?: string }> } | null | undefined): number {
  if (!rr) return -1
  return rr.characters.find(c => c.agentId === ALICE_AGENT_ID)?.slot ?? -1
}

export const aliceMechanic: AgentMechanicModule = {
  id: 'agent:alice',
  agentIds: [ALICE_AGENT_ID],
  name: '爱丽丝',
  description: '剑意专属资源：技能命中积累剑意，300点触发星芒圆舞曲#3（可合轴），生成极性强击。畏缩状态下敌人每0.95秒受到强击伤害2.5%的固定异常伤害，紊乱倍率随物理异常剩余时长提升。',
  applyPanel: applyAlicePanel,
  // CC-38b：原导出 helper aliceSparkCountOf（编排层按身份查找）→ 模块能力
  giftedPolarAssaultCount: (c) => c.aliceSwordWillSource?.sparkCount ?? 0,
  // CC-25：畏缩配置（原 roundInputs.ts aliceInfo 内联，默认值逐字搬迁）；未启用爱丽丝机制 ⇒ null
  anomalyPoolSetup: (cfg) => cfg.aliceEnabled
    ? { coweringConfig: { dotRatio: cfg.aliceCoweringDotRatio ?? 2.5, dotInterval: cfg.aliceCoweringDotInterval ?? 0.95, disorderBonusPerSec: cfg.aliceCoweringDisorderBonusPerSec ?? 18, disorderBonusMax: cfg.aliceCoweringDisorderBonusMax ?? 180, assaultBaseMultiplier: 853 } }
    : null,
  /**
   * CC-22：剑仪外部次数源的「下一轮注入」。原先 `convergence.ts` 直接 import
   * `aliceExternalCountsOf` + `aliceSlotOf` 现场算（编排层直连角色模块）；现走通用派发器
   * `collectNextRoundFeedback`（anomalyPool = 同一个 ap1，slot = cfg.slot）。爱丽丝不在队 ⇒
   * 派发器不调本钩子 ⇒ 键缺席 ⇒ 编排层 `?? 0`，与原 `null → ?? 0` 逐位等价。
   * ⚠ assault 是**爱丽丝自己**触发的 physical 强击（不是全队），口径见 `aliceExternalCountsOf`。
   */
  nextRoundFeedback: ({ slot, anomalyPool }) => {
    const counts = aliceExternalCountsOf(anomalyPool, slot)
    return counts ? { aliceTeamAssaultCount: counts.assaultCount, aliceDisorderCount: counts.disorderCount } : undefined
  },
  buildCharConfig: buildAliceCharConfig,
  buildExecutions: buildAliceExecutions,
  transformAnomalyPool: transformAliceAnomalyPool,
  buildAnomalyEvents: buildAliceAnomalyEvents,
  buildResourceResult: buildAliceResourceResult,
  resourceSections: buildAliceResourceSections,
  /**
   * 剑仪的两条**外部次数源**注入（全队强击 / 紊乱）。
   *
   * 为什么需要这个钩子（2026-09-15 实测的结构性缺口）：spec `1401.json` 的
   * `alice_team_assault_gain` / `alice_disorder_gain` 两条 gain 规则声明 `status:"implemented"`，
   * 但 `buildAliceSwordWillSource` 的第 3 参 `anomalyPoolData` 在**三个调用点都没传**
   * ⇒ 两条收入恒为 0（`?? 0` 兜底），**声明已实现、结构上拿不到数**。
   *
   * 口径（与莱特 `teamEnergyConsumed` 同款的三相位纪律）：
   * - `build`：次数全未知 ⇒ 置 0（等价于修复前的行为，首轮不吃这两条收入）；
   * - `converge`：带**上一轮**收敛出的异常池次数 ⇒ 写进 cfg，本轮 buildExecutions 消费；
   * - `postRound`：不动（这两个次数不是本模块产出的，是异常池的产物，由编排层在
   *   converge 阶段带进来；本模块只做消费者）。
   *
   * ⚠ 为什么不用 `buildExecutions` 直接读异常池：`buildExecutions` 在异常池**之前**跑
   * （异常池要消费执行行），读不到本轮次数——这正是它必须走跨轮反馈的原因（同
   * `vivianAnomalyTriggers` / `consumedTeamEnergy` 的存在理由）。
   */
  applyTeamConfig: ({ characters, phase, threads }) => {
    if (phase === 'build') {
      for (const c of characters) {
        if (c.agentId !== ALICE_AGENT_ID) continue
        const cc = c as { aliceTeamAssaultCount?: number; aliceDisorderCount?: number }
        cc.aliceTeamAssaultCount = 0
        cc.aliceDisorderCount = 0
      }
      return
    }
    if (phase !== 'converge') return
    for (const c of characters) {
      if (c.agentId !== ALICE_AGENT_ID) continue
      const cc = c as { aliceTeamAssaultCount?: number; aliceDisorderCount?: number }
      // CC-22：两条次数改从 `threads`（上一轮收敛快照）读，不再占 AgentTeamConfigInput 专用字段；
      // 产出方 = 本模块 `nextRoundFeedback`（下方）。threads 缺省 ⇒ 0（与原入参缺省逐位等价）。
      cc.aliceTeamAssaultCount = Math.max(0, (threads?.moduleFeedback?.aliceTeamAssaultCount ?? 0))
      cc.aliceDisorderCount = Math.max(0, (threads?.moduleFeedback?.aliceDisorderCount ?? 0))
    }
  },
  // 伴随事件：三蓄 SW3(1401012) 末尾赠送极性强击（polar_assault），易伤跟随父动作
  attachedEvents: { '1401012': ['polar_assault'] },
  /**
   * 爱丽丝专属异常附加行（CC-19b 2026-09-26，设计稿 `docs/mcp-cc19-extra-anomaly-rows.md` §7.1）：
   * 极性强击（块 2，order 20，**不看命座**）/ 六命决胜状态额外攻击（块 4，order 40）/ 畏缩 DOT（块 5，order 50）。
   * 自 `damagePoolAnomaly.ts` 原块 2/4/5 逐字迁入，字段与出现顺序照抄（对象键顺序可能进 rowsnap 哈希）；
   * 三块都读 `input.panel`（= `panelAt(damagePanels, slot)`），异常进度/轴内占比/机制滑块/异常池由消费端以闭包注入。
   */
  extraAnomalyRows: ({
    slot, charResult, panel, cinemaLevel, isAxis, stunCoverage,
    anomalyProgress, ultimateInAxisFraction, axisInUnits, getMechanicSetting, anomalyPool,
    axisStunFor, teamAgentId, agentName, directDamage, anomalyDamage,
  }: ExtraAnomalyRowsInput) => {
    const groups: ExtraAnomalyRowGroup[] = []

    // ---- 极性强击伤害（赠送触发，不走虚拟面板） ----
    const polarAssaultProg = anomalyProgress('physical_polar_assault')
    const polarAssaultSlot = slot
    const polarAlicePanel = panel
    if (polarAssaultProg && polarAssaultProg.triggerCount > 0 && polarAlicePanel) {
      // 轴模式：极性强击易伤跟随父动作 SW3(1401012) 的轴内占比；影画2 终结技额外触发的
      // 极性强击（c2UltSparkCount）跟随终结技轴内占比——按次数加权（2026-08 审计补接）
      const sw3Frac = axisStunFor('polar_assault')
      const aliceSm = charResult?.aliceSwordWillSource
      const ultExtra = Math.max(0, Math.floor(aliceSm?.c2UltSparkCount ?? 0))
      const sw3Count = Math.max(0, Math.floor(polarAssaultProg.triggerCount) - ultExtra)
      const polarStunFor = polarAssaultProg.triggerCount > 0
        ? (sw3Count * sw3Frac + ultExtra * ultimateInAxisFraction(polarAssaultSlot)) / polarAssaultProg.triggerCount
        : stunCoverage
      // 结算面板减防减抗由 calcAnomalyDamage 内部读取（CC-175）；极性强击没有面板外额外量（CC-177 走 input.anomalyDamage）
      const result = anomalyDamage({
        panel: polarAlicePanel,
        settlementPanel: polarAlicePanel,
        baseMultiplier: ANOMALY_SINGLE_HIT_MULTIPLIER.physical,
        element: 'physical',
        stunned: polarStunFor,
      })
      const perDamage = result.damage
      groups.push({ order: EXTRA_ANOMALY_ROW_ORDER.polarAssault, rows: [{
        id: 'polar-assault-damage',
        slot: polarAssaultSlot,
        agentId: teamAgentId(polarAssaultSlot),
        agentName: agentName(teamAgentId(polarAssaultSlot), polarAssaultSlot),
        type: '极性强击',
        name: `极性强击（三蓄赠送）`,
        element: 'physical_polar_assault',
        source: `三蓄赠送触发 · 无视积蓄进度 · 爱丽丝面板`,
        count: polarAssaultProg.triggerCount,
        perDamage,
        totalDamage: perDamage * polarAssaultProg.triggerCount,
        multiplier: ANOMALY_SINGLE_HIT_MULTIPLIER.physical,
        note: `${ANOMALY_SINGLE_HIT_MULTIPLIER.physical}% 单次 × 爱丽丝面板 · 赠送触发不耗异常条${isAxis ? ` · 易伤按触发源加权轴内占比 ${fmt(polarStunFor, 2)}（SW3 ${fmt(sw3Frac, 2)}${ultExtra > 0 ? ` ×${sw3Count} + 终结 ${fmt(ultimateInAxisFraction(polarAssaultSlot), 2)} ×${ultExtra}` : ''}）` : ''}`,
      }] })
    }

    // ---- 爱丽丝六命决胜状态额外攻击 ----
    const aliceSlot = slot
    const aliceCinema = cinemaLevel
    const alicePanel = panel
    if (aliceCinema >= 6 && alicePanel) {
      const aliceResult = charResult
      const smSrc = aliceResult?.aliceSwordWillSource

      if (smSrc && smSrc.sparkCount > 0) {
        // 状态进入次数 = sparkCount + ultimateCount（每次星芒圆舞曲#3 或终结技进入/刷新决胜状态）
        const ultimateCount = aliceResult.ultimateCount
        const stateEntries = smSrc.sparkCount + ultimateCount

        // 每状态额外攻击次数（默认5次；单轮最多6次，1秒CD）
        const perStateCount = getMechanicSetting('alice.cinema6PerStateCount', 5)

        // 总触发次数 = 状态进入次数 × 每次攻击次数
        const totalTriggers = stateEntries * perStateCount

        if (totalTriggers > 0) {
          // 附伤随决胜状态进入（SW3 1401012 / 终结技）触发 → 轴内易伤 = 状态进入的加权轴内占比
          // （用户口径 2026-08：6命附伤事件和动作绑定，理应该伴随计数并且吃易伤）；非轴回落全局覆盖率
          const sw3Frac = isAxis && smSrc.sparkCount > 0
            ? Math.max(0, Math.min(1, (axisInUnits(`${aliceSlot}:1401012`)) / smSrc.sparkCount))
            : stunCoverage
          const ultFrac = ultimateInAxisFraction(aliceSlot)
          const stateFrac = stateEntries > 0
            ? (smSrc.sparkCount * sw3Frac + ultimateCount * ultFrac) / stateEntries
            : stunCoverage
          // 乘区口径（用户 2026-09-03）：附伤占攻击区(异常精通)×倍率区(3300%)两个基础区，
          // 其余增伤/防御/抗性/易伤/暴击乘区全吃（同简 6 命附伤）→ 走伤害池直伤同一入参拼装（input.directDamage，CC-176：含侵染区）；
          // 攻击本体必定暴击（原文：额外攻击必定暴击）→ critMode='crit'
          const proficiency = alicePanel.anomalyProficiency ?? 0
          const result = directDamage({
            panel: alicePanel,
            element: 'physical',
            skillMultiplier: C6_DAMAGE_RATIO * 100,
            stunned: stateFrac,
            critMode: 'crit',
            count: totalTriggers,
            basisValueOverride: proficiency,
            basisLabelOverride: '异常精通',
          })

          groups.push({ order: EXTRA_ANOMALY_ROW_ORDER.decisiveC6, rows: [{
            id: 'alice-c6-decisive-extra-attack',
            slot: aliceSlot,
            agentId: teamAgentId(aliceSlot),
            agentName: agentName(teamAgentId(aliceSlot), aliceSlot),
            type: '爱丽丝6命附伤',
            name: '爱丽丝6命决胜状态额外攻击',
            element: 'physical',
            source: '三蓄/终结技进入决胜状态 → 全队攻击额外命中',
            count: totalTriggers,
            perDamage: totalTriggers > 0 ? result.damage / totalTriggers : 0,
            totalDamage: result.damage,
            note: `异常精通 ${fmt(proficiency)} × 3300% 标准直伤管线（增伤/防御/抗性/易伤全吃）× 必定暴击 → 单次 ${fmt(totalTriggers > 0 ? result.damage / totalTriggers : 0)} · 状态进入 ${stateEntries} 次 × 每次 ${perStateCount} 次 = ${totalTriggers} 次${isAxis ? ` · 易伤按状态进入加权轴内占比 ${fmt(stateFrac, 2)}（SW3 ${fmt(sw3Frac, 2)} / 终结 ${fmt(ultFrac, 2)}）` : ''}`,
          }] })
        }
      }
    }

    // ---- 爱丽丝被动 DOT（异常池 coweringDot 入池；畏缩/任意异常状态期间每 0.95s 强击伤害 2.5%） ----
    const coweringDot = anomalyPool?.coweringDot
    if (aliceSlot >= 0 && coweringDot && coweringDot.totalDotDamage > 0) {
      groups.push({ order: EXTRA_ANOMALY_ROW_ORDER.coweringDot, rows: [{
        id: 'alice-cowering-dot',
        slot: aliceSlot,
        agentId: teamAgentId(aliceSlot),
        agentName: agentName(teamAgentId(aliceSlot), aliceSlot),
        type: '畏缩 DOT',
        name: '爱丽丝畏缩 DOT',
        element: 'physical',
        source: '畏缩状态 · 每 0.95s 强击伤害 2.5%',
        count: coweringDot.totalTicks,
        perDamage: coweringDot.dotDamagePerTick,
        totalDamage: coweringDot.totalDotDamage,
        note: `畏缩 DOT：每 ${coweringDot.dotInterval}s 造成强击伤害 ${coweringDot.dotRatio}% · ${fmt(coweringDot.totalTicks)} tick`,
      }] })
    }

    return groups
  },
  settings: [
    {
      id: 'alice.cinema6PerStateCount',
      label: '爱丽丝 6 命每状态额外攻击次数',
      description: '每次进入决胜状态（星芒圆舞曲#3 或终结技），额外攻击最多触发 6 次（1 秒 CD）。默认 5 次（考虑 CD 空转）。轴短或操作密集可调高到 6；浪费较多可调低。',
      default: 5,
      min: 0,
      max: C6_MAX_TRIGGERS_PER_STATE,
      step: 1,
      suffix: '次',
    },
  ],
}

/**
 * D2（CC-359）：本模块私有的 cfg 字段——只有本文件读写，声明随模块走，不再堆在 `types/resource/config.ts`。
 * 仍是 `CharacterOperationConfig` 的成员（模块扩充，纯类型、零运行时）；被第二处引用时请迁回公共接口。
 */
declare module '@/types/resource/config' {
  interface CharacterOperationConfig {
    /** 爱丽丝额外能力是否触发：队伍中存在另一名异常或支援角色 */
    aliceAdditionalAbilityActive?: boolean
    /** 爱丽丝普攻秒均剑意回复（attack_data[0]/actionTime 平均） */
    aliceSwordWillPerSec?: number
    /** 爱丽丝强特单次剑意回复（attack_data[0]） */
    aliceExSpecialSwordWill?: number
    /** 爱丽丝入场剑意赠送（额外能力=300，否则0） */
    aliceInitialSwordWill?: number
    /** 爱丽丝星芒圆舞曲 #3 move id = 1401012 */
    aliceSwordWillMoveId?: string
    /** 爱丽丝星芒圆舞曲 #3 actionTime = 3.983 */
    aliceSwordWillActionTime?: number
    /** 爱丽丝星芒圆舞曲 #3 喧响回复 = 76.6975 */
    aliceSwordWillDecibelRecovery?: number
    /** 爱丽丝星芒圆舞曲 #3 合轴率：设默认使前台时间=1s */
    aliceSwordWillComboAlignRatio?: number
    /** 爱丽丝极性强击每次回复剑意 = 10 */
    alicePolarityAssaultSwordWill?: number
    /** 爱丽丝全队强击每次回复剑意 = 10 */
    aliceTeamAssaultSwordWill?: number
    /** 爱丽丝紊乱每次回复剑意 = 30 */
    aliceDisorderSwordWill?: number
    /** 爱丽丝畏缩 DOT 伤害比例（% 强击伤害），默认 2.5 */
    aliceCoweringDotRatio?: number
    /** 爱丽丝畏缩 DOT 间隔（秒），默认 0.95 */
    aliceCoweringDotInterval?: number
    /** 爱丽丝畏缩紊乱倍率加成每剩余秒数（%），默认 18 */
    aliceCoweringDisorderBonusPerSec?: number
    /** 爱丽丝畏缩紊乱倍率加成上限（%），默认 180 */
    aliceCoweringDisorderBonusMax?: number
    /** 爱丽丝二命：终结技命中触发极性强击（额外 spark） */
    aliceCinema2UltSpark?: boolean
    /** 是否为爱丽丝，用于剑意专属资源 */
    aliceEnabled?: boolean
    /**
     * 爱丽丝剑仪：**全队强击次数**（`physical` + `physical_polar_assault` 两键触发数之和）。
     * 由爱丽丝模块的 `applyTeamConfig` 在 converge 阶段按**上一轮**异常池收敛值写入
     * （异常池在 `buildExecutions` 之后才算 ⇒ 只能跨轮反馈，同 `teamEnergyConsumed`）。
     * 对应 spec `alice_team_assault_gain` 的 `countSource: teamAssaultCount`。
     */
    aliceTeamAssaultCount?: number
    /** 爱丽丝剑仪：**全队紊乱次数**（上一轮异常池收敛值）。对应 spec `alice_disorder_gain` */
    aliceDisorderCount?: number
  }
}

/**
 * D2（CC-359/360）：本模块自产自读的跨轮反馈键（nextRoundFeedback 产出、下一轮本模块读回），声明随模块走，不堆在 `mechanics/types.ts`。
 * 仍是 `ModuleFeedback` 的成员（模块扩充，纯类型、零运行时）；被第二处引用时请迁回公共接口。
 */
declare module '@/mechanics/types' {
  interface ModuleFeedback {
    /** 爱丽丝剑仪：爱丽丝自己触发的强击次数（字段名里的 Team 是历史名，口径见 alice.ts `aliceExternalCountsOf`） */
    aliceTeamAssaultCount?: number
    /** 爱丽丝剑仪：全队紊乱次数 */
    aliceDisorderCount?: number
  }
}

/**
 * D2（CC-359/360）：本模块私有的结果字段——只有本文件读写，声明随模块走，不堆在 `types/resource/agentResources.ts`。
 * 仍是 `CharacterResourceResult` 的成员（模块扩充，纯类型、零运行时）；被第二处引用时请迁回公共接口。
 */
declare module '@/types/resource/agentResources' {
  interface CharacterResourceResult {
    /** 爱丽丝剑意资源明细 */
    aliceSwordWillSource?: AliceSwordWillSource
  }
}

// ===== 本模块私有的结果类型（D2 / CC-360：原在 types/resource/agentResources.ts，只有本文件引用）=====

/** 爱丽丝剑意资源明细 */
export interface AliceSwordWillSource {
  /** 额外能力入场赠送，默认300 */
  initial: number
  /** 普攻段获得的剑意 = basicAttackTime × swordWillPerSec */
  basicAttackGain: number
  /** 强特获得的剑意 = exSpecialCount × exSpecialSwordWill */
  exSpecialGain: number
  /** 极性强击获得的剑意 = sparkCount × polarityAssaultSwordWill */
  polarityAssaultGain: number
  /** 每次极性强击回复剑意量（C0=10，C1=35） */
  polarityAssaultPerSpark: number
  /** 全队强击获得的剑意 = 全队强击触发次数 × 10 */
  teamAssaultGain: number
  /** 紊乱回复剑意 = 紊乱次数 × 30 */
  disorderGain: number
  /** 二命终结技额外触发极性强击次数 */
  c2UltSparkCount: number
  /** 总可用剑意 = initial + basicAttackGain + exSpecialGain + polarityAssaultGain + teamAssaultGain + disorderGain */
  totalAvailable: number
  /** 星芒圆舞曲 #3 触发次数 = floor(totalAvailable / 300) + c2UltSparkCount */
  sparkCount: number
  /** 星芒圆舞曲 #3 总消耗 = sparkCount × 300 */
  sparkCost: number
  /** 结余剑意 */
  remaining: number
}
