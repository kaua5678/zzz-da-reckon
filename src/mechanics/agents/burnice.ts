import type {
  AgentCharConfigInput,
  AgentEventInput,
  AgentMechanicModule,
  AgentPanelInput,
  AgentResourceInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
} from '../types'
import type { AgentSkills, PanelValues, SkillMove } from '@/types/catalog'
import type { BurniceMechanicSource, CharacterResourceResult, MechanicSetting } from '@/types/resource'
import { fmt } from '@/utils/format'
import { minusInvincibleTime } from '@/core/effectiveTime'

const BURNICE_AGENT_ID = '1171'
const IGNITION_INITIAL = 100
const IGNITION_C1_EXTRA = 40
const IGNITION_CAP = Number.POSITIVE_INFINITY
const IGNITION_PER_ENERGY = 1.4
const IGNITION_PER_ULTIMATE = 50
const IGNITION_THRESHOLD = 50
const EMBER_COST = 8
const EMBER_COOLDOWN_SECONDS = 1.5
const EMBER_DAMAGE_RATIO = 3.5
const EMBER_DAMAGE_C1_BONUS_RATIO = 1
const EMBER_BUILD_UP_PER_HIT = 60
const EMBER_BUILD_UP_EFFICIENCY_C1_BONUS_PCT = 25
const CINEMA2_TEAM_PEN_RATIO = 20
const CINEMA4_CRIT_RATE_BONUS = 30
const CINEMA4_DOUBLE_SPRAY_EXTRA_SECONDS = 1
const CINEMA6_SPECIAL_EMBER_RATIO = 0.6
const CINEMA6_SPECIAL_EMBER_COOLDOWN_SECONDS = 0.5
const CINEMA6_FIRE_RES_IGNORE = 25
const BURN_BASE_MULTIPLIER = 50
const CINEMA6_BURN_BURST_MULTIPLIER = 1800
const CINEMA6_BURN_BURST_COOLDOWN_SECONDS = 20
const STIRRING_IGNITION_COST = 20
const FLOW_FIRE_THRESHOLD = 12
const FLOW_COUNT_PER_STIRRING_EMBER = 2
const MIXED_FLAME_BLEND_1_MOVE = '1171006'
const MIXED_FLAME_BLEND_2_MOVE = '1171007'
const TOSSING_MOVE_ID = '1171026'
const TOSSING_DAMAGE_FALLBACK = 400.1
const STIRRING_DAMAGE_FALLBACK = 250.8 * 0.5 + 466
const FLOWFIRE_RELEASE_MULTIPLIER = 300
const POTENTIAL_ENERGY_REGEN_THRESHOLD = 1.8
const POTENTIAL_MASTERY_PER_0_1 = 2.5
const POTENTIAL_DMG_PER_0_1 = 2
const POTENTIAL_MASTERY_CAP = 25
const POTENTIAL_DMG_CAP = 20
const EMBER_COOLDOWN_POTENTIAL_SECONDS = 1.35

const SINGLE_SPRAY_MAX_SECONDS = 1.89
const DOUBLE_SPRAY_MAX_SECONDS = 2.274
const SINGLE_SPRAY_PER_SECOND = 12.5
const DOUBLE_SPRAY_PER_SECOND = 25
const SINGLE_EXPLOSION_COST = 5
const DOUBLE_EXPLOSION_COST = 10
const SINGLE_EXPLOSION_TIME = 0.315
const DOUBLE_EXPLOSION_TIME = 1.1
const SINGLE_SUSTAINED_MOVE = '1171010'
const SINGLE_EXPLOSION_MOVE = '1171011'
const DOUBLE_SUSTAINED_MOVE = '1171012'
const DOUBLE_EXPLOSION_MOVE = '1171013'
const SINGLE_SUSTAINED_BASE = 1088.3
const SINGLE_EXPLOSION_BASE = 193.5
const DOUBLE_SUSTAINED_BASE = 1916.2
const DOUBLE_EXPLOSION_BASE = 574.2
const STANDARD_EX_COST = (
  (SINGLE_SPRAY_MAX_SECONDS * SINGLE_SPRAY_PER_SECOND + SINGLE_EXPLOSION_COST)
  + (DOUBLE_SPRAY_MAX_SECONDS * DOUBLE_SPRAY_PER_SECOND + DOUBLE_EXPLOSION_COST)
) / 2

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function getRowValue(move: SkillMove | null | undefined, rowId: string): number {
  if (!move) return 0
  return move.rows.find(row => row.id === rowId)?.values[0] ?? 0
}

function rawRowValue(move: SkillMove | null | undefined, rowId: string): number {
  if (!move) return 0
  return move.rows.find(row => row.id === rowId)?.values[0] ?? 0
}

function findMoveById(skills: AgentSkills | undefined, moveId: string): SkillMove | null {
  if (!skills) return null
  for (const category of skills.categories) {
    const move = category.moves.find(item => item.id === moveId)
    if (move) return move
  }
  return null
}

/**
 * 柏妮思强特/燃点/余烬：
 * 强特按“全局次数 × 可调单次时长”近似：单双喷默认次数相等，持续倍率按时长等比缩放，
 * 时长为 0 时该型不放（爆炸也不放）；燃点上限只约束单次存量，整局获得与消耗不设总上限。
 */
export function computeBurniceMechanic(input: {
  exSpecialCount: number
  totalTime: number
  atk: number
  anomalyProficiency: number
  cinemaLevel?: number
  energyRegen: number
  ultimateCount: number
  singleSpraySeconds: number
  doubleSpraySeconds: number
  stirringCount?: number
  stirringActionTime?: number
  flowCountUtilization?: number
  stirringDamageRatio?: number
  tossingDamageRatio?: number
  tossingActionTime?: number
}): BurniceMechanicSource {
  // 强特已按单双喷平均成虚拟强特，允许小数计数（期望值模型）。
  const exCount = Math.max(0, input.exSpecialCount)
  const cinemaLevel = Math.max(0, Math.floor(input.cinemaLevel ?? 0))
  const doubleSprayMaxSeconds = DOUBLE_SPRAY_MAX_SECONDS + (cinemaLevel >= 4 ? CINEMA4_DOUBLE_SPRAY_EXTRA_SECONDS : 0)
  const s1 = clamp(input.singleSpraySeconds, 0, SINGLE_SPRAY_MAX_SECONDS)
  const s2 = clamp(input.doubleSpraySeconds, 0, doubleSprayMaxSeconds)
  let singleCount = exCount / 2
  let doubleCount = exCount / 2
  if (s1 <= 0) singleCount = 0
  if (s2 <= 0) doubleCount = 0

  const singleCastEnergy = s1 > 0 ? s1 * SINGLE_SPRAY_PER_SECOND + SINGLE_EXPLOSION_COST : 0
  const doubleCastEnergy = s2 > 0 ? s2 * DOUBLE_SPRAY_PER_SECOND + DOUBLE_EXPLOSION_COST : 0
  const singleCastTime = s1 > 0 ? s1 + SINGLE_EXPLOSION_TIME : 0
  const doubleCastTime = s2 > 0 ? s2 + DOUBLE_EXPLOSION_TIME : 0
  const totalExEnergy = singleCount * singleCastEnergy + doubleCount * doubleCastEnergy
  const totalExTime = singleCount * singleCastTime + doubleCount * doubleCastTime
  const singleSustainedMultiplier = s1 > 0 ? SINGLE_SUSTAINED_BASE * (s1 / SINGLE_SPRAY_MAX_SECONDS) : 0
  const doubleSustainedMultiplier = s2 > 0 ? DOUBLE_SUSTAINED_BASE * (s2 / doubleSprayMaxSeconds) : 0

  const ignitionFromEnergy = totalExEnergy * IGNITION_PER_ENERGY
  const ultimateIgnitionGain = Math.max(0, Math.floor(input.ultimateCount)) * IGNITION_PER_ULTIMATE
  const initialIgnition = IGNITION_INITIAL + (cinemaLevel >= 1 ? IGNITION_C1_EXTRA : 0)
  const totalIgnition = initialIgnition + ignitionFromEnergy + ultimateIgnitionGain
  const specialStateActive = totalIgnition >= IGNITION_THRESHOLD

  const energyRegen = Math.max(0, input.energyRegen)
  const potentialActive = energyRegen >= POTENTIAL_ENERGY_REGEN_THRESHOLD
  const overCount = potentialActive ? Math.floor((energyRegen - POTENTIAL_ENERGY_REGEN_THRESHOLD + 1e-9) / 0.1) : 0
  const potentialAnomalyMasteryBonus = Math.min(POTENTIAL_MASTERY_CAP, overCount * POTENTIAL_MASTERY_PER_0_1)
  const potentialDmgBonus = Math.min(POTENTIAL_DMG_CAP, overCount * POTENTIAL_DMG_PER_0_1)
  const emberCooldownSeconds = potentialActive ? EMBER_COOLDOWN_POTENTIAL_SECONDS : EMBER_COOLDOWN_SECONDS
  const cooldownLimit = Math.floor(Math.max(0, input.totalTime) / emberCooldownSeconds)
  const budgetLimit = Math.floor(totalIgnition / EMBER_COST)
  const emberTriggerCount = Math.min(cooldownLimit, budgetLimit)
  const masteryBonusPct = Math.min(30, Math.floor(Math.max(0, input.anomalyProficiency) / 10))
  const emberDamageRatio = EMBER_DAMAGE_RATIO + (cinemaLevel >= 1 ? EMBER_DAMAGE_C1_BONUS_RATIO : 0)
  const emberBuildUpEfficiencyBonusPct = cinemaLevel >= 1 ? EMBER_BUILD_UP_EFFICIENCY_C1_BONUS_PCT : 0
  const emberBuildUpPerHit = EMBER_BUILD_UP_PER_HIT
  const emberDamagePerHit = input.atk * emberDamageRatio * (1 + masteryBonusPct / 100)
  const cinema6SpecialEmberPerCast = cinemaLevel >= 6 && s2 > 0
    ? Math.max(1, Math.ceil((s2 + DOUBLE_EXPLOSION_TIME) / CINEMA6_SPECIAL_EMBER_COOLDOWN_SECONDS))
    : 0
  const cinema6SpecialEmberCount = cinemaLevel >= 6 ? doubleCount * cinema6SpecialEmberPerCast : 0
  const cinema6SpecialEmberBaseRatio = cinemaLevel >= 6
    ? CINEMA6_SPECIAL_EMBER_RATIO
    : 0
  const cinema6SpecialEmberDamageRatio = cinema6SpecialEmberBaseRatio * 100
  const cinema6SpecialEmberDamagePerHit = input.atk * cinema6SpecialEmberBaseRatio
  const cinema6SpecialEmberTotalDamage = cinema6SpecialEmberDamagePerHit * cinema6SpecialEmberCount
  const cinema6BurnBurstCount = cinemaLevel >= 6
    ? Math.min(doubleCount, Math.max(0, Math.floor(input.totalTime / CINEMA6_BURN_BURST_COOLDOWN_SECONDS) - 1))
    : 0
  const cinema6BurnBurstDamageRatio = cinemaLevel >= 6
    ? BURN_BASE_MULTIPLIER * CINEMA6_BURN_BURST_MULTIPLIER / 100
    : 0

  const stirringMaxCount = Math.floor(Math.max(0, totalIgnition - emberTriggerCount * EMBER_COST) / STIRRING_IGNITION_COST)
  const requestedStirring = Math.max(0, Math.floor(input.stirringCount ?? 0))
  const stirringCount = Math.min(requestedStirring === 0 ? stirringMaxCount : requestedStirring, stirringMaxCount)
  const stirringIgnitionSpent = stirringCount * STIRRING_IGNITION_COST
  const stirringFreeEmberCount = stirringCount
  const emberTotalTriggerCount = emberTriggerCount + stirringFreeEmberCount
  const flowCountUtilization = clamp(input.flowCountUtilization ?? 1, 0, 1)
  const flowCountRaw = emberTriggerCount + stirringFreeEmberCount * FLOW_COUNT_PER_STIRRING_EMBER
  const flowCountEffective = Math.floor(flowCountRaw * flowCountUtilization)
  const flowFireCount = Math.floor(flowCountEffective / FLOW_FIRE_THRESHOLD)
  const tossingCount = flowFireCount
  const releaseCount = tossingCount
  const stirringDamageRatio = input.stirringDamageRatio ?? STIRRING_DAMAGE_FALLBACK
  const tossingDamageRatio = input.tossingDamageRatio ?? TOSSING_DAMAGE_FALLBACK

  return {
    initialIgnition,
    ignitionFromEnergy,
    ultimateIgnitionGain,
    totalIgnition,
    ignitionCap: IGNITION_CAP,
    specialStateActive,
    emberTriggerCount,
    emberCost: EMBER_COST,
    emberDamageRatio: emberDamageRatio * 100,
    emberDamageRatioWithMastery: emberDamageRatio * (1 + masteryBonusPct / 100) * 100,
    emberDamagePerHit,
    emberTotalDamage: emberDamagePerHit * emberTotalTriggerCount,
    emberBuildUpPerHit,
    emberBuildUpEfficiencyBonusPct,
    emberTotalBuildUp: emberBuildUpPerHit * emberTotalTriggerCount,
    emberTotalTriggerCount,
    stirringMaxCount,
    stirringCount,
    stirringIgnitionCost: STIRRING_IGNITION_COST,
    stirringIgnitionSpent,
    stirringFreeEmberCount,
    stirringDamageRatio,
    stirringActionTimeSeconds: input.stirringActionTime ?? 0,
    flowCountRaw,
    flowCountUtilization,
    flowCountEffective,
    flowFireCount,
    tossingCount,
    tossingMoveId: TOSSING_MOVE_ID,
    tossingDamageRatio,
    tossingActionTimeSeconds: input.tossingActionTime ?? 0,
    releaseMultiplier: FLOWFIRE_RELEASE_MULTIPLIER,
    releaseCount,
    cinemaLevel,
    cinema2TeamPenRatio: cinemaLevel >= 2 ? CINEMA2_TEAM_PEN_RATIO : 0,
    cinema4CritRateBonus: cinemaLevel >= 4 ? CINEMA4_CRIT_RATE_BONUS : 0,
    cinema4DoubleSprayMaxSeconds: doubleSprayMaxSeconds,
    cinema6FireResIgnore: cinemaLevel >= 6 ? CINEMA6_FIRE_RES_IGNORE : 0,
    cinema6SpecialEmberCount,
    cinema6SpecialEmberPerCast,
    cinema6SpecialEmberBaseRatio: cinema6SpecialEmberBaseRatio * 100,
    cinema6SpecialEmberDamageRatio,
    cinema6SpecialEmberDamagePerHit,
    cinema6SpecialEmberTotalDamage,
    cinema6BurnBurstCount,
    cinema6BurnBurstMultiplier: cinemaLevel >= 6 ? CINEMA6_BURN_BURST_MULTIPLIER : 0,
    cinema6BurnBurstDamageRatio,
    potentialAnomalyMasteryBonus,
    potentialDmgBonus,
    emberCooldownSeconds,
    singleCastCount: singleCount,
    doubleCastCount: doubleCount,
    singleSpraySeconds: s1,
    doubleSpraySeconds: s2,
    singleCastEnergy,
    doubleCastEnergy,
    singleCastTime,
    doubleCastTime,
    totalExEnergy,
    totalExTime,
    singleSustainedMultiplier,
    singleExplosionMultiplier: s1 > 0 ? SINGLE_EXPLOSION_BASE : 0,
    doubleSustainedMultiplier,
    doubleExplosionMultiplier: s2 > 0 ? DOUBLE_EXPLOSION_BASE : 0,
    note: '强特：单喷持续1.89s/12.5每秒/爆炸5，双喷2.274s/25每秒/爆炸10；持续倍率按耗时等比缩放，时长为0则该型不放。燃点：进场100（1命+40），每消耗1能量+1.4，终结技+50，单次存量上限不限制整局消耗；余烬每8燃点一次，350%攻击火伤、基础积蓄60，1命后450%攻击且余烬积蓄效率+25%（仅余烬）。2命全队穿透+20%；4命强特/支援/余烬暴击率+30%、双喷上限+1s；6命双喷触发60%特殊余烬、火抗无视25%、灼烧迸发=50%×1800%=900%（20s一次）。潜能沸点派对按局外回能判定≥1.8。',
  }
}

function applyBurnicePanel({ panel }: AgentPanelInput): void {
  const totalRegen = resolveEnergyRegenTotal(panel)
  const over = Math.max(0, totalRegen - POTENTIAL_ENERGY_REGEN_THRESHOLD)
  if (over <= 0) return
  const overCount = Math.floor((over + 1e-9) / 0.1)
  panel.anomalyMastery = (panel.anomalyMastery ?? 0) + Math.min(POTENTIAL_MASTERY_CAP, overCount * POTENTIAL_MASTERY_PER_0_1)
  panel.dmgBonus = (panel.dmgBonus ?? 0) + Math.min(POTENTIAL_DMG_CAP, overCount * POTENTIAL_DMG_PER_0_1)
}

function resolveEnergyRegenTotal(panel: PanelValues): number {
  // 潜能沸点派对按“初始/局外能量自动回复”判定。
  if (panel.energyRegenOutOfCombat != null && Number.isFinite(panel.energyRegenOutOfCombat)) {
    return panel.energyRegenOutOfCombat
  }
  return (panel.energyRegen ?? 1.2) * (1 + (panel.energyRegenBonusPct ?? 0) / 100) + (panel.energyRegenBonusFlat ?? 0)
}

function cfgSetting(cfg: AgentCharConfigInput['cfg'], id: string, fallback: number): number {
  const record = cfg as unknown as Record<string, unknown>
  const value = record[`setting:${id}`]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function buildBurniceCharConfig({ skills, cinemaLevel, cfg }: AgentCharConfigInput): void {
  cfg.burniceCinemaLevel = cinemaLevel
  cfg.burniceSingleSpraySeconds = clamp(cfgSetting(cfg, 'burnice.singleSpraySeconds', SINGLE_SPRAY_MAX_SECONDS), 0, SINGLE_SPRAY_MAX_SECONDS)
  const doubleSprayMax = DOUBLE_SPRAY_MAX_SECONDS + (cinemaLevel >= 4 ? CINEMA4_DOUBLE_SPRAY_EXTRA_SECONDS : 0)
  cfg.burniceDoubleSpraySeconds = clamp(cfgSetting(cfg, 'burnice.doubleSpraySeconds', DOUBLE_SPRAY_MAX_SECONDS), 0, doubleSprayMax)
  cfg.burniceStirringCount = Math.max(0, Math.floor(cfgSetting(cfg, 'burnice.stirringCount', 0)))
  cfg.burniceFlowCountUtilization = clamp(cfgSetting(cfg, 'burnice.flowCountUtilization', 1), 0, 1)
  const blend1Damage = rawRowValue(findMoveById(skills, MIXED_FLAME_BLEND_1_MOVE), 'damage') || 250.8
  const blend2Damage = rawRowValue(findMoveById(skills, MIXED_FLAME_BLEND_2_MOVE), 'damage') || 466
  cfg.burniceStirringDamageRatio = blend1Damage * 0.5 + blend2Damage
  cfg.burniceTossingDamageRatio = rawRowValue(findMoveById(skills, TOSSING_MOVE_ID), 'damage') || TOSSING_DAMAGE_FALLBACK
  cfg.burniceStirringActionTimeSeconds = findMoveById(skills, MIXED_FLAME_BLEND_2_MOVE)?.actionTime ?? 0
  cfg.burniceTossingActionTimeSeconds = findMoveById(skills, TOSSING_MOVE_ID)?.actionTime ?? 0
  cfg.skipGenericExSpecial = true
  const s1 = cfg.burniceSingleSpraySeconds ?? 0
  const s2 = cfg.burniceDoubleSpraySeconds ?? 0
  const c1 = s1 > 0 ? s1 * SINGLE_SPRAY_PER_SECOND + SINGLE_EXPLOSION_COST : 0
  const c2 = s2 > 0 ? s2 * DOUBLE_SPRAY_PER_SECOND + DOUBLE_EXPLOSION_COST : 0
  cfg.exSpecialEnergyConsume = c1 + c2 > 0 ? (c1 + c2) / 2 : STANDARD_EX_COST
  cfg.mechanicRowValues = {
    [SINGLE_SUSTAINED_MOVE]: getRowValue(findMoveById(skills, SINGLE_SUSTAINED_MOVE), 'damage') || SINGLE_SUSTAINED_BASE,
    [SINGLE_EXPLOSION_MOVE]: getRowValue(findMoveById(skills, SINGLE_EXPLOSION_MOVE), 'damage') || SINGLE_EXPLOSION_BASE,
    [DOUBLE_SUSTAINED_MOVE]: getRowValue(findMoveById(skills, DOUBLE_SUSTAINED_MOVE), 'damage') || DOUBLE_SUSTAINED_BASE,
    [DOUBLE_EXPLOSION_MOVE]: getRowValue(findMoveById(skills, DOUBLE_EXPLOSION_MOVE), 'damage') || DOUBLE_EXPLOSION_BASE,
  }
}

function buildBurniceResourceResult({ cfg, state }: AgentResourceResultInput): Partial<CharacterResourceResult> {
  return {
    burniceMechanicSource: computeBurniceMechanic({
      exSpecialCount: state.exSpecialCount,
      totalTime: minusInvincibleTime(state.frontlineTime + state.backstageTime, cfg),
      atk: cfg.panel.atk ?? 0,
      anomalyProficiency: cfg.panel.anomalyProficiency ?? 0,
      cinemaLevel: cfg.burniceCinemaLevel ?? 0,
      energyRegen: resolveEnergyRegenTotal(cfg.panel),
      ultimateCount: state.ultimateCount,
      singleSpraySeconds: cfg.burniceSingleSpraySeconds ?? SINGLE_SPRAY_MAX_SECONDS,
      doubleSpraySeconds: cfg.burniceDoubleSpraySeconds ?? DOUBLE_SPRAY_MAX_SECONDS,
      stirringCount: cfg.burniceStirringCount ?? 0,
      stirringActionTime: cfg.burniceStirringActionTimeSeconds ?? 0,
      flowCountUtilization: cfg.burniceFlowCountUtilization ?? 1,
      stirringDamageRatio: cfg.burniceStirringDamageRatio ?? STIRRING_DAMAGE_FALLBACK,
      tossingDamageRatio: cfg.burniceTossingDamageRatio ?? TOSSING_DAMAGE_FALLBACK,
      tossingActionTime: cfg.burniceTossingActionTimeSeconds ?? 0,
    }),
  }
}

function pushEx(
  executions: AgentResourceInput['executions'],
  moveId: string,
  count: number,
  actionTime: number,
  multiplier: number,
  override: boolean,
  energyConsume: number,
): void {
  if (count <= 0 || !moveId) return
  executions.push({
    moveId,
    moveName: moveId,
    category: 'special',
    count,
    actionTime,
    comboAlignRatio: 0,
    totalTime: count * actionTime,
    totalComboAlignTime: 0,
    energyConsume,
    totalEnergyConsume: count * energyConsume,
    decibelRecovery: 0,
    totalDecibelRecovery: 0,
    energyRecovery: 0,
    totalEnergyRecovery: 0,
    damageMultiplier: multiplier,
    damageMultiplierOverride: override,
  })
}

function buildBurniceExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const source = computeBurniceMechanic({
    exSpecialCount: state.exSpecialCount,
    totalTime: minusInvincibleTime(state.frontlineTime + state.backstageTime, cfg),
    atk: cfg.panel.atk ?? 0,
    anomalyProficiency: cfg.panel.anomalyProficiency ?? 0,
    cinemaLevel: cfg.burniceCinemaLevel ?? 0,
    energyRegen: resolveEnergyRegenTotal(cfg.panel),
    ultimateCount: state.ultimateCount,
    singleSpraySeconds: cfg.burniceSingleSpraySeconds ?? SINGLE_SPRAY_MAX_SECONDS,
      doubleSpraySeconds: cfg.burniceDoubleSpraySeconds ?? DOUBLE_SPRAY_MAX_SECONDS,
      stirringCount: cfg.burniceStirringCount ?? 0,
      stirringActionTime: cfg.burniceStirringActionTimeSeconds ?? 0,
      flowCountUtilization: cfg.burniceFlowCountUtilization ?? 1,
      stirringDamageRatio: cfg.burniceStirringDamageRatio ?? STIRRING_DAMAGE_FALLBACK,
      tossingDamageRatio: cfg.burniceTossingDamageRatio ?? TOSSING_DAMAGE_FALLBACK,
      tossingActionTime: cfg.burniceTossingActionTimeSeconds ?? 0,
  })
  const row = cfg.mechanicRowValues ?? {}
  pushEx(executions, SINGLE_SUSTAINED_MOVE, source.singleCastCount, source.singleSpraySeconds, source.singleSustainedMultiplier, true, source.singleCastCount > 0 ? source.singleSpraySeconds * SINGLE_SPRAY_PER_SECOND : 0)
  pushEx(executions, SINGLE_EXPLOSION_MOVE, source.singleCastCount, SINGLE_EXPLOSION_TIME, row[SINGLE_EXPLOSION_MOVE] ?? SINGLE_EXPLOSION_BASE, false, SINGLE_EXPLOSION_COST)
  pushEx(executions, DOUBLE_SUSTAINED_MOVE, source.doubleCastCount, source.doubleSpraySeconds, source.doubleSustainedMultiplier, true, source.doubleCastCount > 0 ? source.doubleSpraySeconds * DOUBLE_SPRAY_PER_SECOND : 0)
  pushEx(executions, DOUBLE_EXPLOSION_MOVE, source.doubleCastCount, DOUBLE_EXPLOSION_TIME, row[DOUBLE_EXPLOSION_MOVE] ?? DOUBLE_EXPLOSION_BASE, false, DOUBLE_EXPLOSION_COST)
}

function buildBurniceAnomalyEvents({ cfg, state, events }: AgentEventInput): void {
  const source = computeBurniceMechanic({
    exSpecialCount: state.exSpecialCount,
    totalTime: minusInvincibleTime(state.frontlineTime + state.backstageTime, cfg),
    atk: cfg.panel.atk ?? 0,
    anomalyProficiency: cfg.panel.anomalyProficiency ?? 0,
    cinemaLevel: cfg.burniceCinemaLevel ?? 0,
    energyRegen: resolveEnergyRegenTotal(cfg.panel),
    ultimateCount: state.ultimateCount,
    singleSpraySeconds: cfg.burniceSingleSpraySeconds ?? SINGLE_SPRAY_MAX_SECONDS,
      doubleSpraySeconds: cfg.burniceDoubleSpraySeconds ?? DOUBLE_SPRAY_MAX_SECONDS,
      stirringCount: cfg.burniceStirringCount ?? 0,
      stirringActionTime: cfg.burniceStirringActionTimeSeconds ?? 0,
      flowCountUtilization: cfg.burniceFlowCountUtilization ?? 1,
      stirringDamageRatio: cfg.burniceStirringDamageRatio ?? STIRRING_DAMAGE_FALLBACK,
      tossingDamageRatio: cfg.burniceTossingDamageRatio ?? TOSSING_DAMAGE_FALLBACK,
      tossingActionTime: cfg.burniceTossingActionTimeSeconds ?? 0,
  })
  if (source.releaseCount <= 0) return
  events.push({
    eventId: 'burnice_flowfire_release',
    eventName: '灼热抛接法·异放',
    eventType: 'release',
    element: 'dominant',
    carrierMoveId: TOSSING_MOVE_ID,
    carrierMoveName: 'EX Special Attack: Intense Heat Tossing Method',
    count: source.releaseCount,
    formula: `releaseMultiplier = ${FLOWFIRE_RELEASE_MULTIPLIER}`,
    fields: ['flowFireCount', 'tossingCount', `releaseMultiplier=${FLOWFIRE_RELEASE_MULTIPLIER}`],
    note: '消耗1点[流火]发动灼热抛接法并触发一次300%异放；基础属性提供者取基底异常元素的主要施加者。',
  })
}

function buildBurniceResourceSections({ result }: AgentResourceSectionsInput) {
  const source = result.burniceMechanicSource
  if (!source) return []
  return [
    {
      id: 'burnice-ex',
      title: '柏妮思强特（固定次数 × 可调时长）',
      summary: `单喷 × ${source.singleCastCount}（${fmt(source.singleSpraySeconds)}s）· 双喷 × ${source.doubleCastCount}（${fmt(source.doubleSpraySeconds)}s）`,
      rows: [
        { label: '单喷单次', value: `${fmt(source.singleCastEnergy)}能 / ${fmt(source.singleCastTime)}s`, detail: `${fmt(source.singleSustainedMultiplier)}%持续 + ${fmt(source.singleExplosionMultiplier)}%爆炸` },
        { label: '双喷单次', value: `${fmt(source.doubleCastEnergy)}能 / ${fmt(source.doubleCastTime)}s`, detail: `${fmt(source.doubleSustainedMultiplier)}%持续 + ${fmt(source.doubleExplosionMultiplier)}%爆炸` },
        { label: '强特总耗能', value: fmt(source.totalExEnergy) },
        { label: '强特总时间', value: `${fmt(source.totalExTime)}s` },
      ],
      footer: '持续倍率按单次时长/满时长等比缩放；时长为 0 时该型不放（爆炸也不放）。',
    },
    {
      id: 'burnice-stirring',
      title: '柏妮思搅拌式（支援攻击）',
      summary: `实际 ${source.stirringCount}/${source.stirringMaxCount} 次 · 附带余烬 ${source.stirringFreeEmberCount} 次`,
      rows: [
        { label: '融合倍率', value: `${fmt(source.stirringDamageRatio)}%`, detail: 'Mixed Flame Blend #1 × 0.5 + Mixed Flame Blend #2' },
        { label: '单次燃点消耗', value: `-${source.stirringIgnitionCost}` },
        { label: '总燃点消耗', value: `-${fmt(source.stirringIgnitionSpent)}`, detail: '从余烬预算后的溢出燃点支付' },
        { label: '附带余烬', value: `${source.stirringFreeEmberCount} 次`, detail: '每次搅拌式额外触发一次不消耗燃点的余烬' },
        { label: '分类', value: '支援攻击', detail: '可吃支援攻击相关buff，含4命暴击率+30%' },
      ],
      footer: '次数默认按溢出燃点自动取上限，可在资源利用率页手动调整。',
    },
    {
      id: 'burnice-flowfire',
      title: '柏妮思流火·灼热抛接法',
      summary: `流火计数 ${source.flowCountEffective}/${source.flowCountRaw} · 抛接法 ${source.tossingCount} 次`,
      rows: [
        { label: '流火计数来源', value: `普通余烬 ${source.emberTriggerCount} + 搅拌式附带余烬 ${source.stirringFreeEmberCount} × 2`, detail: `合计 ${source.flowCountRaw} 点` },
        { label: '利用率', value: `${Math.round(source.flowCountUtilization * 100)}%`, detail: '默认100%，可调低模拟浪费' },
        { label: '有效计数', value: `${source.flowCountEffective}`, detail: `${source.flowCountRaw} × ${Math.round(source.flowCountUtilization * 100)}% 向下取整` },
        { label: '流火生成', value: `${source.flowFireCount} 点`, detail: `每 ${FLOW_FIRE_THRESHOLD} 点计数生成 1 点[流火]` },
        { label: '灼热抛接法', value: `${source.tossingCount} 次 × ${fmt(source.tossingDamageRatio)}%`, detail: '消耗1点[流火]发动一次 EX Special Attack: Intense Heat Tossing Method' },
        { label: '异放', value: `${source.releaseCount} 次 × ${source.releaseMultiplier}%`, detail: '基础属性提供者取基底异常元素的主要施加者' },
      ],
      footer: '流火计数利用率与搅拌式次数均在资源利用率页可调。',
    },
    {
      id: 'burnice-ignition',
      title: '柏妮思燃点',
      summary: `${fmt(source.totalIgnition)}/${Number.isFinite(source.ignitionCap) ? source.ignitionCap : '∞'} · 燃油特调 ${source.specialStateActive ? '生效' : '未生效'}`,
      rows: [
        { label: '进场燃点', value: `+${source.initialIgnition}` },
        { label: '强特耗能累积', value: `+${fmt(source.ignitionFromEnergy)}`, detail: `每消耗1能量 +${IGNITION_PER_ENERGY}` },
        { label: '终结技回复', value: `+${source.ultimateIgnitionGain}`, detail: `每次终结技 +${IGNITION_PER_ULTIMATE}` },
        { label: '状态阈值', value: `${IGNITION_THRESHOLD}`, detail: '达到50点进入燃油特调，直到燃点耗尽' },
      ],
      footer: source.note,
    },
    {
      id: 'burnice-ember',
      title: '柏妮思余烬',
      summary: `触发 ${source.emberTotalTriggerCount} 次 · 总伤害 ${fmt(source.emberTotalDamage)} · 总基础积蓄 ${fmt(source.emberTotalBuildUp)}`,
      rows: [
        { label: '单次消耗', value: `-${source.emberCost} 燃点` },
        { label: '伤害倍率', value: `${fmt(source.emberDamageRatio)}%`, detail: '基础350%，1命+100%攻击；再乘精通加成' },
        { label: '单次伤害', value: fmt(source.emberDamagePerHit), detail: `${fmt(source.emberDamageRatio)}%攻击 × (1 + 精通加成)` },
        { label: '单次基础积蓄', value: fmt(source.emberBuildUpPerHit), detail: '固定60，不因1命改变' },
        { label: '余烬积蓄效率', value: `${source.emberBuildUpEfficiencyBonusPct}%`, detail: '1命+25%（效率区），仅余烬招式生效，其他招式吃不到' },
        { label: '普通触发', value: `${source.emberTriggerCount} 次`, detail: `队友命中灼伤触发，按燃点预算与${source.emberCooldownSeconds}秒CD取小` },
        { label: '搅拌式附带', value: `${source.stirringFreeEmberCount} 次`, detail: '不消耗燃点，每次搅拌式附带一次' },
        { label: '潜能掌控', value: `+${source.potentialAnomalyMasteryBonus}`, detail: `初始回能≥1.8，每0.1点+2.5，上限25` },
        { label: '潜能增伤', value: `+${source.potentialDmgBonus}%`, detail: `每0.1点+2%，上限20%` },
      ],
      footer: '余烬只有伤害与火属性异常积蓄：单次350%攻击火伤、基础积蓄60；1命后450%攻击，余烬积蓄效率+25%（效率区，仅余烬）。',
    },
    {
      id: 'burnice-cinema',
      title: '柏妮思命座（C1/C2/C4/C6）',
      summary: `C1 初始燃点 ${fmt(source.initialIgnition)} · C2 全队穿透 +${source.cinema2TeamPenRatio}% · C6 特殊余烬 ${fmt(source.cinema6SpecialEmberCount)} 次`,
      rows: [
        { label: 'C1 开局燃点', value: `+${source.cinemaLevel >= 1 ? 40 : 0}`, detail: '基础100，1命开局额外+40' },
        { label: 'C2 全队穿透', value: `+${source.cinema2TeamPenRatio}%`, detail: '全队穿透率+20%，由队友Buff自动生效' },
        { label: 'C4 暴击率', value: `+${source.cinema4CritRateBonus}%`, detail: '强化特殊技/支援攻击/余烬招式，其他招式不生效' },
        { label: 'C4 双喷时长', value: `${fmt(source.cinema4DoubleSprayMaxSeconds)}s`, detail: '基础2.274s，4命上限+1s' },
        { label: 'C6 特殊余烬', value: `${fmt(source.cinema6SpecialEmberCount)} 次 × ${fmt(source.cinema6SpecialEmberDamageRatio)}%`, detail: `每双喷${source.cinema6SpecialEmberPerCast}次（按0.5s CD），固定60%攻击，不吃1命/精通加成` },
        { label: 'C6 火抗无视', value: `-${source.cinema6FireResIgnore}%`, detail: '双份/特殊余烬/灼烧伤害生效' },
        { label: 'C6 灼烧迸发', value: `${fmt(source.cinema6BurnBurstCount)} 次 × ${fmt(source.cinema6BurnBurstDamageRatio)}%`, detail: `灼烧基础50% × 1800% = ${fmt(source.cinema6BurnBurstDamageRatio)}%一次；同一目标20秒最多一次，180s 上限8次（留1次冗余）` },
      ],
      footer: '命座计算按当前影画等级自动开关；覆盖率默认满覆盖。',
    },
  ]
}

const settings: MechanicSetting[] = [
  {
    id: 'burnice.singleSpraySeconds',
    label: '柏妮思单喷持续秒数',
    description: '0 表示不放单喷（爆炸也不放）；默认拉满 1.89 秒。',
    default: 1.89,
    min: 0,
    max: 1.89,
    step: 0.01,
    suffix: '秒',
  },
  {
    id: 'burnice.doubleSpraySeconds',
    label: '柏妮思双喷持续秒数',
    description: '0 表示不放双喷（爆炸也不放）；默认拉满 2.274 秒，4命后上限提升到 3.274 秒。',
    default: 2.274,
    min: 0,
    max: 3.274,
    step: 0.01,
    suffix: '秒',
  },
  {
    id: 'burnice.stirringCount',
    label: '柏妮思搅拌式次数',
    description: '0 表示自动按溢出燃点取上限；手动设置时不能超过能打的上限。',
    default: 0,
    min: 0,
    max: 200,
    step: 1,
    suffix: '次',
  },
  {
    id: 'burnice.flowCountUtilization',
    label: '柏妮思流火计数利用率',
    description: '默认 100%。小于 100% 表示计数有浪费，按 12 点计数 = 1 点[流火]结算。',
    default: 1,
    min: 0,
    max: 1,
    step: 0.05,
    suffix: '%',
  },
]

export const burniceMechanic: AgentMechanicModule = {
  id: 'agent:burnice',
  agentIds: [BURNICE_AGENT_ID],
  name: '柏妮思',
  description: '强特按全局次数×可调时长近似：单双喷默认均分，持续倍率按时长缩放，时长为0不放；燃点/余烬按全局获得与消耗结算。',
  applyPanel: applyBurnicePanel,
  buildCharConfig: buildBurniceCharConfig,
  buildExecutions: buildBurniceExecutions,
  buildAnomalyEvents: buildBurniceAnomalyEvents,
  buildResourceResult: buildBurniceResourceResult,
  resourceSections: buildBurniceResourceSections,
  settings,
  attachedEvents: {
    [DOUBLE_SUSTAINED_MOVE]: ['burnice-c6-special-ember', 'burnice-c6-burn-burst'],
  },
}
