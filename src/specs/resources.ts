import type {
  CharacterOperationConfig,
  IterationState,
} from '@/types/resource'
import type { AgentMechanicSpec, ResourceRuleSpec, ResourceSpec } from './types'

export interface SpecResourceContext {
  broadCycloneCount?: number
  disorderCount?: number
  teamAssaultCount?: number
  chainCountTotal?: number
  dodgeCounterCount?: number
  parryCount?: number
  quickAssistCount?: number
  teamFrontlineSeconds?: number
}

export interface SpecResourceResult {
  id: string
  name: string
  initialValue: number
  maxValue: number | null
  totalGain: number
  gains: Record<string, number>
  bonusCount: number
  total: number
  remaining: number
  spendCounts: Record<string, number>
  spendCosts: Record<string, number>
}

export function computeSpecResources(
  spec: AgentMechanicSpec,
  cfg: CharacterOperationConfig,
  state: IterationState,
  context: SpecResourceContext = {},
): Map<string, SpecResourceResult> {
  const results = new Map<string, SpecResourceResult>()

  for (const resource of spec.resources) {
    results.set(resource.id, computeOneResource(resource, cfg, state, context))
  }

  return results
}

function computeOneResource(
  resource: ResourceSpec,
  cfg: CharacterOperationConfig,
  state: IterationState,
  context: SpecResourceContext,
): SpecResourceResult {
  const initialValue = resolveInitialValue(resource, cfg)
  let totalGain = 0
  const gains: Record<string, number> = {}

  resource.gainRules.forEach((rule, index) => {
    const gain = resolveGain(rule, cfg, state, context)
    gains[rule.id ?? `gain_${index}`] = gain
    totalGain += gain
  })

  const spendCounts: Record<string, number> = {}
  const spendCosts: Record<string, number> = {}
  const bonusCount = resource.spendRules[0]
    ? resolveBonusCount(resource.spendRules[0], cfg, state)
    : 0

  if (resource.feedbackGainRules?.length) {
    const baseRule = resource.spendRules[0]
    const baseCost = parseCost(baseRule?.cost)
    const baseSparkCount = baseCost > 0 ? Math.floor((initialValue + totalGain) / baseCost) : 0
    const totalSparkCount = baseSparkCount + bonusCount

    for (const rule of resource.feedbackGainRules) {
      const count = rule.countSource === 'totalSparkCount'
        ? totalSparkCount
        : resolveGainCount(rule, cfg, state, context)
      const amount = applyAdjustable(rule, cfg, resolveRuleAmount(rule, cfg))
      const gain = count * amount * (rule.coverage ?? 1)
      gains[rule.id ?? 'feedback_gain'] = gain
      totalGain += gain
    }

    spendCounts[baseRule?.id ?? 'base_spark'] = baseSparkCount
    spendCosts[baseRule?.id ?? 'base_spark'] = baseSparkCount * baseCost
  }

  // 上限是单次存量上限，不是整局全局上限；全局资源按总回复与总消耗计算，不截断。
  const total = initialValue + totalGain
  let remaining = total

  resource.spendRules.forEach((rule, index) => {
    const cost = parseCost(rule.cost)
    let count = cost > 0 ? Math.floor(remaining / cost) : 0
    if (rule.bonusCountSource === 'ultimateCount' && rule.bonusEnabledField) {
      count += bonusCount
    }
    const spendCost = count * cost
    const key = rule.id ?? `spend_${index}`
    spendCounts[key] = count
    spendCosts[key] = spendCost
    if (rule.deduct !== false) {
      remaining -= spendCost
    }
  })

  return {
    id: resource.id,
    name: resource.name,
    initialValue,
    maxValue: resource.maxValue ?? null,
    totalGain,
    gains,
    bonusCount,
    total,
    remaining: Math.max(0, remaining),
    spendCounts,
    spendCosts,
  }
}

function resolveInitialValue(resource: ResourceSpec, cfg: CharacterOperationConfig): number {
  if (resource.initialValueSource === 'cfgField' && resource.initialValueField) {
    const record = cfg as unknown as Record<string, unknown>
    return Math.max(0, Number(record[resource.initialValueField] ?? 0) || 0)
  }
  return resource.initialValue ?? 0
}

function resolveGain(
  rule: ResourceRuleSpec,
  cfg: CharacterOperationConfig,
  state: IterationState,
  context: SpecResourceContext,
): number {
  const count = resolveGainCount(rule, cfg, state, context)
  const amount = applyAdjustable(rule, cfg, resolveRuleAmount(rule, cfg))
  return count * amount * (rule.coverage ?? 1)
}

function applyAdjustable(
  rule: ResourceRuleSpec,
  cfg: CharacterOperationConfig,
  amount: number,
): number {
  const adjustable = rule.adjustable
  if (!adjustable) return amount
  const record = cfg as unknown as Record<string, unknown>
  const raw = Number(record[`setting:${adjustable.id}`] ?? adjustable.default)
  const rate = Number.isFinite(raw)
    ? Math.max(adjustable.min ?? 0, Math.min(adjustable.max ?? Infinity, raw))
    : adjustable.default
  return amount * rate
}

function resolveGainCount(
  rule: ResourceRuleSpec,
  cfg: CharacterOperationConfig,
  state: IterationState,
  context: SpecResourceContext,
): number {
  switch (rule.countSource) {
    case 'exSpecialCount':
      return Math.max(0, Math.floor(state.exSpecialCount ?? 0))
    case 'energySpent':
      return Math.max(0, Math.floor(state.exSpecialCount ?? 0)) * Math.max(0, cfg.exSpecialEnergyConsume || 45)
    case 'ultimateCount':
      return Math.max(0, Math.floor(state.ultimateCount ?? 0))
    case 'basicTime':
      return Math.max(0, state.basicAttackTime ?? 0)
    case 'frontlineTime':
      return Math.max(0, state.frontlineTime ?? 0)
    case 'backstageTime':
      return Math.max(0, state.backstageTime ?? 0)
    case 'battleTime':
      // 全战斗时间（接战状态 = 整场战斗，如星徽·比利决意缓慢回复 2 点/秒）
      return Math.max(0, cfg.battleTime ?? 180)
    case 'chainCountTotal':
      return Math.max(0, Math.floor(state.chainCountTotal ?? 0))
    case 'dodgeCounterCount':
      return Math.max(0, cfg.dodgeCounterCount ?? 0)
    case 'parryCount':
      return Math.max(0, cfg.parryCount ?? 0)
    case 'blockCount':
      // 金身格挡/动力压制格挡等次数（主页交互次数，用户填写）
      return Math.max(0, cfg.blockCount ?? 0)
    case 'quickAssistCount':
      return Math.max(0, cfg.quickAssistCount ?? 0)
    case 'teamFrontlineSeconds':
      return Math.max(0, context.teamFrontlineSeconds ?? 0)
    case 'fixed':
      return Math.max(0, Math.floor(rule.count ?? 1))
    case 'teamAssaultCount':
      return Math.max(0, context.teamAssaultCount ?? 0)
    case 'disorderCount':
      return Math.max(0, context.disorderCount ?? 0)
    case 'frostburnBreakCount':
      return Math.max(0, Math.floor(state.exSpecialCount ?? 0))
    case 'basicAttackCount':
      return Math.max(0, Math.floor((state.basicAttackTime ?? 0) / 2))
    case 'cfgField':
      // 次数由模块写入 cfg 字段（countField），如星徽·比利招式命中决意合计（attack_data_0）
      return Math.max(0, Number((cfg as unknown as Record<string, unknown>)[rule.countField ?? ''] ?? 0) || 0)
    default:
      return 0
  }
}

function resolveRuleAmount(rule: ResourceRuleSpec, cfg: CharacterOperationConfig): number {
  if (rule.valueSource === 'cfgField' && rule.valueField) {
    const record = cfg as unknown as Record<string, unknown>
    return Math.max(0, Number(record[rule.valueField] ?? 0) || 0)
  }
  return rule.amountPerCount ?? (typeof rule.amount === 'number' ? rule.amount : 0)
}

function resolveBonusCount(
  rule: ResourceRuleSpec,
  cfg: CharacterOperationConfig,
  state: IterationState,
): number {
  if (rule.bonusCountSource !== 'ultimateCount' || !rule.bonusEnabledField) return 0
  const record = cfg as unknown as Record<string, unknown>
  return record[rule.bonusEnabledField] ? Math.max(0, Math.floor(state.ultimateCount)) : 0
}

function parseCost(cost: string | number | undefined): number {
  if (typeof cost === 'number') return Math.max(0, cost)
  const parsed = Number.parseFloat(String(cost ?? ''))
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0
}
