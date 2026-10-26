import type {
  CharacterOperationConfig,
  IterationState,
  MechanicSetting,
  SpecResourceResult,
} from '@/types/resource'
import type { AgentMechanicSpec, ResourceRuleSpec, ResourceSpec } from './types'
import { cfgMechanicSetting } from '@/utils/mechanicSettingCfg'
import { readCfgField } from './cfgField'
import { agentSpecs } from './registry'

export interface SpecResourceContext {
  broadCycloneCount?: number
  disorderCount?: number
  /**
   * 霜灼·破 次数（雅 1091）：**已由模块算好的次数**（= min(烈霜异常触发次数, 1+⌊战斗时间/10⌋) × 利用率，再吃次数上限滑块）。
   * 为什么由模块算而不是解释器读 state：这条次数带 10s CD 与「对带冰焰的敌人施加霜寒」的触发条件，
   * 解释器只认 state 标量（原实现 `floor(state.exSpecialCount)` 是把强特次数冒充霜灼·破次数，
   * 实测方向都会反：紊乱少的队反而多给）。次数由模块 `miyabiFrostburnBreakCountOf` 产出，
   * 与 1500% 直伤行的次数**同源**（规则 11：一个数只有一份算法）。
   */
  frostburnBreakCount?: number
  /**
   * 平A命中类计数（`countSource: basicAttackCount`）的模块侧覆盖位：给了就用它，没给才回落
   * `floor(state.basicAttackTime / 2)`。用途 = 「这条收入的触发条件带**命座**门控」而命座不是状态量
   * （雅 1091 的影画二「风花#5 命中 +1 落霜」：C0/C1 该收入恒 0，模块按 cinemaLevel 决定给不给）。
   * 默认不改变任何既有消费方（1241/1521/1531 都不传本字段）。
   */
  basicAttackCount?: number
  teamAssaultCount?: number
  chainCountTotal?: number
  dodgeCounterCount?: number
  parryCount?: number
  teamFrontlineSeconds?: number
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
      const countOverride = rule.countSource === 'totalSparkCount' ? totalSparkCount : undefined
      const gain = resolveGain(rule, cfg, state, context, countOverride)
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
    return Math.max(0, Number(readCfgField(cfg, resource.initialValueField) ?? 0) || 0)
  }
  return resource.initialValue ?? 0
}

function resolveGain(
  rule: ResourceRuleSpec,
  cfg: CharacterOperationConfig,
  state: IterationState,
  context: SpecResourceContext,
  countOverride?: number,
): number {
  const count = countOverride ?? resolveGainCount(rule, cfg, state, context)
  const amount = applyAdjustable(rule, cfg, resolveRuleAmount(rule, cfg))
  return count * amount * (rule.coverage ?? 1)
}

function applyAdjustable(
  rule: ResourceRuleSpec,
  cfg: CharacterOperationConfig,
  amount: number,
): number {
  return rule.adjustable ? amount * adjustableRate(cfg, rule.adjustable) : amount
}

/**
 * spec `adjustable` 比例的唯一读法（CC-511）：缺省 / 非有限取声明 default，再钳到声明区间
 * （null 不可达：写入侧恒为数字）。解释器按规则自带的声明读；手写模块按 id 读，见 `specAdjustableRate`。
 */
function adjustableRate(cfg: unknown, adjustable: MechanicSetting): number {
  const raw = cfgMechanicSetting(cfg, adjustable.id, adjustable.default)
  return Math.max(adjustable.min ?? 0, Math.min(adjustable.max ?? Infinity, raw))
}

/** spec 声明的全部 `adjustable`（增益 / 消耗 / 反馈规则）；`specToMechanicModule` 把它们摊进模块 settings */
export function specAdjustables(spec: AgentMechanicSpec): MechanicSetting[] {
  return spec.resources
    .flatMap(resource => [...resource.gainRules, ...resource.spendRules, ...(resource.feedbackGainRules ?? [])])
    .flatMap(rule => (rule.adjustable ? [rule.adjustable] : []))
}

let adjustableById: Map<string, MechanicSetting> | undefined
/**
 * 手写模块自己算 spec 资源时按 id 读 `adjustable` 比例（洛克茜风能 / 风眼、橘福福威势；r753 CC-536）：
 * 默认值与区间都取 spec 声明，与解释器同一读法；id 未在 spec 声明 ⇒ 抛错。
 * 此前两处各手抄一份：橘福福 fallback 1 + 只钳下界，洛克茜 fallback 1 + 私有 `clampRate` 钳 [0, 2]。
 */
export function specAdjustableRate(cfg: unknown, id: string): number {
  // beta 冻结 spec（`beta: true`，id 形如 `1091v1`）不进全局裸 id 表：其 adjustable id 与正主
  // 同名，glob 序（`<id>v1.json` 排 `<id>.json` 后）会让冻结定义**覆盖**正主——洛克茜/橘福福这类
  // 手写模块按 id 解析就会拿到旧版区间。代价（已知边界）：beta 副本模块若也走本函数，解析到的是
  // 正主当前定义；仅当两版改过该滑块区间/缺省才有差异，且用户值仍来自各自槽位 cfg。
  adjustableById ??= new Map(
    agentSpecs.filter(spec => !spec.beta).flatMap(spec => specAdjustables(spec)).map(adjustable => [adjustable.id, adjustable]),
  )
  const adjustable = adjustableById.get(id)
  if (!adjustable) throw new Error(`[specAdjustableRate] ${id} 未在 spec 声明`)
  return adjustableRate(cfg, adjustable)
}

function resolveGainCount(
  rule: ResourceRuleSpec,
  cfg: CharacterOperationConfig,
  state: IterationState,
  context: SpecResourceContext,
): number {
  switch (rule.countSource) {
    case 'exSpecialCount':
      return Math.max(0, Math.floor(state.exSpecialCount))
    case 'energySpent':
      return Math.max(0, Math.floor(state.exSpecialCount)) * Math.max(0, cfg.exSpecialEnergyConsume || 45)
    case 'ultimateCount':
      return Math.max(0, Math.floor(state.ultimateCount))
    case 'basicTime':
      return Math.max(0, state.basicAttackTime)
    case 'frontlineTime':
      return Math.max(0, state.frontlineTime)
    case 'backstageTime':
      return Math.max(0, state.backstageTime)
    case 'battleTime':
      // 全战斗时间（接战状态 = 整场战斗，如星徽·比利决意缓慢回复 2 点/秒）
      return Math.max(0, cfg.battleTime)
    case 'chainCountTotal':
      return Math.max(0, Math.floor(state.chainCountTotal))
    case 'dodgeCounterCount':
      return Math.max(0, cfg.dodgeCounterCount)
    case 'parryCount':
      return Math.max(0, cfg.parryCount)
    case 'blockCount':
      // 金身格挡/动力压制格挡等次数（主页交互次数，用户填写）
      return Math.max(0, cfg.blockCount)
    case 'perfectBlockCount':
      // 强特完美格挡次数（主页交互栏填写；佩洛伊斯日珥回复来源）
      return Math.max(0, cfg.perfectBlockCount)
    case 'teamFrontlineSeconds':
      return Math.max(0, context.teamFrontlineSeconds ?? 0)
    case 'fixed':
      return Math.max(0, Math.floor(rule.count ?? 1))
    case 'teamAssaultCount':
      return Math.max(0, context.teamAssaultCount ?? 0)
    case 'disorderCount':
      return Math.max(0, context.disorderCount ?? 0)
    case 'frostburnBreakCount':
      // 次数 = 模块注入（雅 1091 的霜灼·破：烈霜异常触发次数 ∩ 10s CD）。
      // 缺省 0（不再是 exSpecialCount）：缺省必须表达「没给」，不能用别的量顶替。
      return Math.max(0, Math.floor(context.frostburnBreakCount ?? 0))
    case 'basicAttackCount':
      // 模块可覆盖（命座门控类收入）：缺省仍是 floor(平A时间/2)，与历史口径逐位一致
      return Math.max(0, Math.floor(context.basicAttackCount ?? state.basicAttackTime / 2))
    case 'cfgField':
      // 次数由模块写入 cfg 字段（countField），如星徽·比利招式命中决意合计（attack_data_0）
      return Math.max(0, Number(readCfgField(cfg, rule.countField ?? '') ?? 0) || 0)
    default:
      return 0
  }
}

function resolveRuleAmount(rule: ResourceRuleSpec, cfg: CharacterOperationConfig): number {
  if (rule.valueSource === 'cfgField' && rule.valueField) {
    return Math.max(0, Number(readCfgField(cfg, rule.valueField) ?? 0) || 0)
  }
  return rule.amountPerCount ?? (typeof rule.amount === 'number' ? rule.amount : 0)
}

function resolveBonusCount(
  rule: ResourceRuleSpec,
  cfg: CharacterOperationConfig,
  state: IterationState,
): number {
  if (rule.bonusCountSource !== 'ultimateCount' || !rule.bonusEnabledField) return 0
  return readCfgField(cfg, rule.bonusEnabledField) ? Math.max(0, Math.floor(state.ultimateCount)) : 0
}

/**
 * 某资源某条 spendRule 的单次消耗（CC-501）：机制模块要在 spec 之外复算「次数 × 单价」时从这里读，
 * 不要把 spec 里的数字手抄成模块常量（yixuan 术法值 120 曾是一份手抄副本）。规则不存在 ⇒ 0。
 */
export function specSpendCost(spec: AgentMechanicSpec, resourceId: string, ruleId: string): number {
  const rule = spec.resources.find(r => r.id === resourceId)?.spendRules.find(r => r.id === ruleId)
  return parseCost(rule?.cost)
}

function parseCost(cost: string | number | undefined): number {
  if (typeof cost === 'number') return Math.max(0, cost)
  const parsed = Number.parseFloat(String(cost ?? ''))
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0
}
