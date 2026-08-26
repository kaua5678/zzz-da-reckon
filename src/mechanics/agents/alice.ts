import type {
  AgentAnomalyTransformInput,
  AgentCharConfigInput,
  AgentEventInput,
  AgentMechanicModule,
  AgentPanelInput,
  AgentResourceInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
  MechanicTeamMember,
} from '../types'
import type { AgentSkills, SkillMove } from '@/types/catalog'
import type {
  CharacterOperationConfig,
  IterationState,
  SpecialResourceSection,
} from '@/types/resource'
import { fmt } from '@/utils/format'
import { getAgentSpec } from '@/specs/registry'
import { buildSpecAnomalyEvents } from '@/specs/mechanics'
import { computeSpecResources } from '@/specs/resources'
import { applySpecAttributeConversions } from '@/specs/runtime'

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
const MASTERY_TO_PROFICIENCY_RATE = 1.6
/** 六命：每轮决胜状态最大额外攻击次数 */
const C6_MAX_TRIGGERS_PER_STATE = 6
/** 六命：额外攻击基础倍率 = 异常精通 × 3300%（小数 33） */
const C6_DAMAGE_RATIO = 33

function getRowValue(move: SkillMove | null | undefined, rowId: string): number {
  if (!move) return 0
  const row = move.rows.find(r => r.id === rowId)
  return row?.values[0] ?? 0
}

function findMoveById(skills: AgentSkills | undefined, moveId: string): SkillMove | null {
  if (!skills) return null
  for (const cat of skills.categories) {
    const move = cat.moves.find(m => m.id === moveId)
    if (move) return move
  }
  return null
}

/** 爱丽丝额外能力：队伍中存在另一名「异常」或「支援」角色 */
function isAdditionalAbilityActive(team: MechanicTeamMember[], slot: number): boolean {
  return team.some(member => {
    if (member.slot === slot || !member.agent) return false
    return member.agent.specialty === 'anomaly' || member.agent.specialty === 'support'
  })
}

// ============ applyPanel ============

function applyAlicePanel({ slot, agent, cinemaLevel, team, panel }: AgentPanelInput): void {
  const aa = isAdditionalAbilityActive(team, slot)
  panel.aliceEnabled = 1
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
  panel.aliceMasteryToProficiencyBonus = Math.max(0, (panel.anomalyMastery ?? 0) - 140) * MASTERY_TO_PROFICIENCY_RATE
}

// ============ buildCharConfig ============

/** 计算爱丽丝普攻秒均剑意（avg of attack_data_0 / actionTime，仅普通段） */
function calcSwordWillPerSec(skills: AgentSkills): number {
  const basic = skills.categories.find(c => c.id === 'basic')
  if (!basic) return 0

  const rates: number[] = []
  for (const move of basic.moves) {
    const name = move.name?.en || ''
    // 只取 #N 普通段
    if (!name.match(/#\d+/)) continue
    if (name.toLowerCase().includes('dash') || name.toLowerCase().includes('dodge')) continue
    if (!move.actionTime || move.actionTime <= 0) continue

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
  const aa = isAdditionalAbilityActive(team, slot)
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

  // 六命配置
  if (cinemaLevel >= 6) {
    cfg.aliceCinema6Enabled = true
    cfg.aliceCinema6MaxTriggers = C6_MAX_TRIGGERS_PER_STATE
    cfg.aliceCinema6DamageRatio = C6_DAMAGE_RATIO
  }

  // 畏缩机制配置
  cfg.aliceTeamAssaultSwordWill = TEAM_ASSAULT_SWORD_WILL
  cfg.aliceDisorderSwordWill = DISORDER_SWORD_WILL
  cfg.aliceCoweringDotRatio = COWERING_DOT_RATIO
  cfg.aliceCoweringDotInterval = COWERING_DOT_INTERVAL
  cfg.aliceCoweringDisorderBonusPerSec = COWERING_DISORDER_BONUS_PER_SEC
  cfg.aliceCoweringDisorderBonusMax = COWERING_DISORDER_BONUS_MAX
  cfg.aliceCoweringBuildUpEfficiency = COWERING_BUILD_UP_EFFICIENCY
  cfg.aliceMasteryToProficiencyRate = MASTERY_TO_PROFICIENCY_RATE
}

// ============ buildExecutions ============

export function aliceSwordWillTotal(
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
  /** 来自异常池的额外数据（极性强击=spark 自身计算，全队强击和紊乱需外部传入） */
  anomalyPoolData?: { assaultTriggerCount?: number; disorderCount?: number },
): { total: number; basicAttackGain: number; exSpecialGain: number; polarityAssaultGain: number; teamAssaultGain: number; disorderGain: number; c2UltSparkCount: number } {
  if (!cfg.aliceEnabled) return { total: 0, basicAttackGain: 0, exSpecialGain: 0, polarityAssaultGain: 0, teamAssaultGain: 0, disorderGain: 0, c2UltSparkCount: 0 }

  const spec = getAgentSpec(ALICE_AGENT_ID)
  if (!spec) return { total: 0, basicAttackGain: 0, exSpecialGain: 0, polarityAssaultGain: 0, teamAssaultGain: 0, disorderGain: 0, c2UltSparkCount: 0 }

  const resource = computeSpecResources(
    spec,
    cfg as unknown as CharacterOperationConfig,
    state as unknown as IterationState,
    {
      teamAssaultCount: anomalyPoolData?.assaultTriggerCount ?? 0,
      disorderCount: anomalyPoolData?.disorderCount ?? 0,
    },
  ).get('alice_sword_will')
  if (!resource) return { total: 0, basicAttackGain: 0, exSpecialGain: 0, polarityAssaultGain: 0, teamAssaultGain: 0, disorderGain: 0, c2UltSparkCount: 0 }

  return {
    total: resource.total,
    basicAttackGain: resource.gains['alice_basic_gain'] ?? 0,
    exSpecialGain: resource.gains['alice_ex_gain'] ?? 0,
    polarityAssaultGain: resource.gains['alice_polarity_feedback'] ?? 0,
    teamAssaultGain: resource.gains['alice_team_assault_gain'] ?? 0,
    disorderGain: resource.gains['alice_disorder_gain'] ?? 0,
    c2UltSparkCount: resource.bonusCount,
  }
}

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
  const details = aliceSwordWillTotal(cfg, state, anomalyPoolData)
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
    basicAttackGain: details.basicAttackGain,
    exSpecialGain: details.exSpecialGain,
    polarityAssaultGain: details.polarityAssaultGain,
    polarityAssaultPerSpark: perSpark,
    teamAssaultGain: details.teamAssaultGain,
    disorderGain: details.disorderGain,
    c2UltSparkCount: details.c2UltSparkCount,
    totalAvailable: details.total,
    sparkCount,
    sparkCost,
    remaining: resource?.remaining ?? 0,
  }
}

/** 导出的类型别名，方便其他模块引用 */
type AliceSwordWillSource = import('@/types/resource').AliceSwordWillSource

function buildAliceExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const smSrc = buildAliceSwordWillSource(cfg, state)
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
  const aliceIdx = input.panels.findIndex(p => (p as any).aliceEnabled)
  if (aliceIdx < 0) return
  const panel = input.panels[aliceIdx]
  if ((panel.aliceCinema4 ?? 0) <= 0) return

  // 四命：强化后的普通攻击：星仪序曲（1401005）物理异常积蓄 +25%
  for (const contrib of input.elementMap.get('physical') ?? []) {
    if (contrib.moveId !== ALICE_ENHANCED_BASIC_MOVE) continue
    contrib.baseBuildUp *= 1.25
    contrib.perHitBuildUp *= 1.25
    contrib.totalBuildUp *= 1.25
  }
}

function buildAliceAnomalyEvents({ cfg, state, events }: AgentEventInput): void {
  const smSrc = buildAliceSwordWillSource(cfg, state)
  if (!smSrc) return
  const spec = getAgentSpec(ALICE_AGENT_ID)
  if (!spec) return
  events.push(...buildSpecAnomalyEvents(spec, cfg, state, { aliceSparkCount: smSrc.sparkCount }))
}

// ============ buildResourceResult ============

function buildAliceResourceResult({ cfg, state }: AgentResourceResultInput): Partial<import('@/types/resource').CharacterResourceResult> {
  return {
    aliceSwordWillSource: buildAliceSwordWillSource(cfg, state),
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

export const aliceMechanic: AgentMechanicModule = {
  id: 'agent:alice',
  agentIds: [ALICE_AGENT_ID],
  name: '爱丽丝',
  description: '剑意专属资源：技能命中积累剑意，300点触发星芒圆舞曲#3（可合轴），生成极性强击。畏缩状态下敌人每0.95秒受到强击伤害2.5%的固定异常伤害，紊乱倍率随物理异常剩余时长提升。',
  applyPanel: applyAlicePanel,
  buildCharConfig: buildAliceCharConfig,
  buildExecutions: buildAliceExecutions,
  transformAnomalyPool: transformAliceAnomalyPool,
  buildAnomalyEvents: buildAliceAnomalyEvents,
  buildResourceResult: buildAliceResourceResult,
  resourceSections: buildAliceResourceSections,
  // 伴随事件：三蓄 SW3(1401012) 末尾赠送极性强击（polar_assault），易伤跟随父动作
  attachedEvents: { '1401012': ['polar_assault'] },
  settings: [
    {
      id: 'alice.cinema6PerStateCount',
      label: '爱丽丝 6 命每状态额外攻击次数',
      description: '每次进入决胜状态（星芒圆舞曲#3 或终结技），额外攻击最多触发 6 次（1 秒 CD）。默认 5 次（考虑 CD 空转）。轴短或操作密集可调高到 6；浪费较多可调低。',
      default: 5,
      min: 0,
      max: 6,
      step: 1,
      suffix: '次',
    },
  ],
}
