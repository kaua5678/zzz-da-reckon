/**
 * 积蓄池计算引擎
 *
 * 核心机制（来源：啵啵獭「绝区零底层机制」异常学）：
 *
 * 1. 积蓄上限公式：
 *    实际上限 = 基础值(3000) × boss系数 × 危局异常系数 × 累计系数 × 元素特殊系数
 *
 * 2. 累计系数：每触发一次该属性异常，下一管的积蓄上限比上次多2%（向下取整）
 *    即第N管的累计系数 ≈ 1.02^N，最多到1.02^9（第10管起不再增加）
 *
 * 3. 元素特殊系数：
 *    - 冰/火/电/以太：正常，无特殊系数
 *    - 物理：始终多20%（×1.2）
 *    - 风：第1管为基础值的50%，第2管为90%，第3管起与火电一致
 *
 * 4. 累积阈值比较：因为每管上限不同，不能用"总积蓄值 ÷ 固定上限"
 *    预计算累积阈值（前缀和）：threshold[N] = Σ cap[0..N]
 *    比较总积蓄值 >= threshold[N] × boss系数 × 危局系数 即可得到触发管数
 *    与逐管扣减数学等价，但更直观
 *
 * 5. 紊乱：新异常覆盖老异常时触发（需要不同属性异常交替覆盖）
 *    紊乱次数 = min(sum - 1, 2 × (sum - max))
 *      sum = 所有元素触发次数之和，max = 最大元素触发次数
 *      sum-1 = 序列最大覆盖次数（最后一个异常不被覆盖）
 *      2×(sum-max) = 非多数元素能分隔的多数元素次数
 *    验证：6火10电 → sum=16, max=10 → min(15, 12)=12 ✓
 *         4火4电 → sum=8, max=4 → min(7, 8)=7 ✓（旧公式多算1次）
 *
 * 6. 乱流（风属性）：风属性角色将其他元素的DoT转化为乱流伤害
 *    DoT伤害归零（火/电/以太的DoT被乱流吞了）
 *    乱流视为维琳娜触发，结算区用风角色面板
 *    异常质量来自非风角色，T = 非风异常默认持续时间（风化不被覆盖）
 *    乱流继承异常增伤和异常暴击
 *    乱流3秒CD；单次30秒风化可容纳10次，计算器按多次风化窗口合并，不封顶
 *
 * 7. 异常覆盖率：
 *    总DoT时间 = Σ(各元素触发次数 × 该元素默认持续时间)
 *    有效DoT时间 = 总DoT时间 - boss无敌时间
 *    覆盖率 = 有效DoT时间 / 总战斗时间
 */
import type { PanelValues } from '@/types/catalog'
import type {
  AnomalyPoolResult, AnomalyProgress, AnomalyContribution,
  AnomalyCoverageResult, AnomalyEventRecord,
  DisorderDamageResult, DisorderDamageDetail,
  TurbulenceDamageResult, TurbulenceDamageDetail,
  DisorderFormula, TurbulenceFormula, VelinaCorrosionSource,
  StandardDotDamageResult, StandardDotDamageDetail,
  AliceCoweringDotResult,
} from '@/types/resource'
import { fmt } from '@/utils/format'
import { enemyDebuffElementStatId } from '@/utils/enemyDebuffStats'
import { simulateVelinaCorrosionState } from '@/mechanics/agents/velina'

// ============ 喧响奖励常量 ============

export const ANOMALY_DECIBEL_BONUS = 170   // 触发属性异常奖励
export const DISORDER_DECIBEL_BONUS = 85    // 触发紊乱奖励
export const TURBULENCE_DECIBEL_BONUS = 85  // 触发乱流奖励

// ============ 伤害计算常量 ============

/** 等级基数（60级固定常量，来源：穿透防御学） */
export const LEVEL_COEFF_60 = 794

/** 60级等级系数 = 1 + 1/59 × (60 - 1) = 2 */
export const LEVEL_MULT_60 = 2

/** 乱流CD（秒）：乱流槽位 = floor(风化时长 / CD) */
export const TURBULENCE_CD_SECONDS = 3

// ============ 变种异常元素映射（新增） ============

/**
 * 变种异常（Variant Anomaly）机制
 *
 * 某些角色的特殊异常虽然底层属性与标准异常相同，但在紊乱系统中应视为不同的异常类型，
 * 使它们之间可以互相紊乱。
 *
 * 变种元素 → 基础元素映射：
 *   - physical_polar_assault（极性强击）→ physical（强击）：极性强击与普通强击是同一类“一次强击事件”，
 *     只是极性强击可与强击附带的畏缩状态互相紊乱
 *
 * 待实现（仅留注释）：
 *   - ether_ink → ether：仪玄的玄墨，可与以太互相紊乱
 *   - physical_accumulation → physical：叶瞬光的积蓄，可与物理互相紊乱
 *
 * 冻结（ice）与烈霜（frostfire）不加入基础元素映射：两者都有独立的持续时间/紊乱公式，
 * 紊乱系统按不同元素 key 天然允许互紊；双方都携带霜寒状态，霜寒使敌人受到暴击伤害+10%。
 *
 * 变种元素的积蓄上限、持续时间、紊乱/乱流倍率均继承基础元素的值。
 * 变种元素之间在紊乱系统中视为不同元素（如 physical 和 physical_polar_assault 可互紊）。
 */
export const VARIANT_ELEMENT_TO_BASE: Record<string, string> = {
  'physical_polar_assault': 'physical',  // 爱丽丝极性强击变种
  'ether_ink': 'ether',                  // 仪玄的玄墨（独立积蓄槽，可与以太互紊）
  // 'frostfire': 'ice',                // 雅的烈霜设为冰变种时可加此行（当前 frostfire 独立）
  // 'physical_accumulation': 'physical', // 叶瞬光的积蓄（待实现）
}

/** 获取基础元素（变种 → 基础，非变种返回自身） */
export function getBaseElement(element: string): string {
  return VARIANT_ELEMENT_TO_BASE[element] ?? element
}

/** 判断两个元素是否为变种关系（即基础元素相同但变种 ID 不同的两个元素） */
export function isVariantPair(a: string, b: string): boolean {
  if (a === b) return false
  return getBaseElement(a) === getBaseElement(b)
}

// ============ 积蓄上限表（原有，保持不变） ============

/**
 * 积蓄上限表（基础值 × 累计系数 × 元素特殊系数）
 *
 * 数据来源：啵啵獭异常学 + 用户整理的「不同属性积蓄上限.txt」
 * 实际使用时需乘以用户输入的 boss系数 和 危局异常系数
 *
 * 累计系数计算方式：每管 floor(上一管 × 1.02)
 *   - 冰火电以太起始 3000
 *   - 物理起始 3600（3000 × 1.2）
 *   - 风第1管 1500（50%），第2管 2700（90%），第3管起同冰火电
 */
export const BUILDUP_CAP_TABLE: Record<string, number[]> = {
  // 冰/火/电/以太：正常积蓄
  ice:      [3000, 3060, 3121, 3183, 3246, 3310, 3376, 3443, 3511, 3581],
  fire:     [3000, 3060, 3121, 3183, 3246, 3310, 3376, 3443, 3511, 3581],
  electric: [3000, 3060, 3121, 3183, 3246, 3310, 3376, 3443, 3511, 3581],
  ether:    [3000, 3060, 3121, 3183, 3246, 3310, 3376, 3443, 3511, 3581],
  // 物理：始终多20%
  physical: [3600, 3672, 3745, 3819, 3895, 3972, 4051, 4132, 4214, 4298],
  // 风：第1管50%，第2管90%，第3管起同冰火电
  wind:     [1500, 2700, 3121, 3183, 3246, 3310, 3376, 3443, 3511, 3581],
}

/** 最大累计系数档位（第10管起不再增加，index 0-9） */
export const MAX_CAP_INDEX = 9

/**
 * 累积积蓄阈值表（前缀和）
 *
 * 预计算达到第 N+1 管所需的总积蓄值：
 *   threshold[0] = cap[0]               → 达到第1管需要这么多积蓄
 *   threshold[1] = cap[0] + cap[1]      → 达到第2管需要这么多
 *   threshold[N] = Σ cap[0..N]          → 达到第N+1管
 *
 * 计算时只需比较 totalBuildUp >= threshold[N] × boss系数 × 危局系数
 */
export const BUILDUP_THRESHOLD_TABLE: Record<string, number[]> = {}

for (const [element, caps] of Object.entries(BUILDUP_CAP_TABLE)) {
  const thresholds: number[] = []
  let sum = 0
  for (const cap of caps) {
    sum += cap
    thresholds.push(sum)
  }
  BUILDUP_THRESHOLD_TABLE[element] = thresholds
}

// ============ 异常默认持续时间表（新增） ============

/**
 * 异常默认持续时间表（秒）
 *
 * 数据来源：啵啵獭异常学 - 各属性异常的默认DoT持续时间
 * - 物理（畏缩）：10秒
 * - 火（灼烧）：10秒
 * - 冰（霜寒）：10秒
 * - 电（感电）：10秒
 * - 以太（侵蚀）：10秒
 * - 风（风化）：30秒（不被覆盖，T可吃满）
 * - 烈霜（frostfire）：冰属性特殊变体，20秒
 */
export const ANOMALY_DURATION: Record<string, number> = {
  physical:  10,  // 畏缩，10秒
  fire:      10,  // 灼烧，10秒
  ice:       10,  // 霜寒，10秒
  electric:  10,  // 感电，10秒
  ether:     10,  // 侵蚀，10秒
  wind:      30,  // 风化，30秒
  frostfire: 20,  // 烈霜，冰属性特殊变体，20秒
}

// ============ 紊乱倍率公式表（新增） ============

/**
 * 紊乱倍率公式表
 *
 * 紊乱倍率 = baseMultiplier + floor(T / tickInterval) × tickMultiplier
 * 其中 T = 被覆盖异常的剩余时间（秒）
 *
 * 数据来源：啵啵獭异常学 - 紊乱倍率公式
 * 注意：紊乱不继承异常增伤和异常暴击
 */
export const DISORDER_FORMULAS: Record<string, DisorderFormula> = {
  physical:  { baseMultiplier: 450, tickMultiplier: 7.5,  tickInterval: 1   },
  ice:       { baseMultiplier: 450, tickMultiplier: 7.5,  tickInterval: 1   },
  fire:      { baseMultiplier: 450, tickMultiplier: 50,   tickInterval: 0.5 },
  electric:  { baseMultiplier: 450, tickMultiplier: 125,  tickInterval: 1   },
  ether:     { baseMultiplier: 450, tickMultiplier: 62.5, tickInterval: 0.5 },
  frostfire: { baseMultiplier: 600, tickMultiplier: 75,   tickInterval: 1   },  // 烈霜
}

// ============ 乱流倍率公式表（新增） ============

/**
 * 乱流倍率公式表
 *
 * 乱流倍率 = baseMultiplier + floor(T / tickInterval) × tickMultiplier
 * 其中 T = 非风异常默认持续时间（风化不被覆盖，T可吃满）
 *
 * 数据来源：啵啵獭异常学 - 乱流倍率公式
 * 注意：乱流继承异常增伤和异常暴击
 */
export const TURBULENCE_FORMULAS: Record<string, TurbulenceFormula> = {
  physical:  { baseMultiplier: 800,  tickMultiplier: 7.5,  tickInterval: 1   },
  ice:       { baseMultiplier: 1300, tickMultiplier: 7.5,  tickInterval: 1   },
  fire:      { baseMultiplier: 900,  tickMultiplier: 50,   tickInterval: 0.5 },
  electric:  { baseMultiplier: 650,  tickMultiplier: 125,  tickInterval: 1   },
  ether:     { baseMultiplier: 650,  tickMultiplier: 62.5, tickInterval: 0.5 },
  frostfire: { baseMultiplier: 0,    tickMultiplier: 75,   tickInterval: 1   },
}

export function allocateBoostedEvents(globalTotalEvents: number, elementEvents: number, boostedEvents: number, processedBefore: number): number {
  if (globalTotalEvents <= 0 || elementEvents <= 0 || boostedEvents <= 0) return 0
  const before = Math.floor((processedBefore / globalTotalEvents) * boostedEvents)
  const after = Math.floor(((processedBefore + elementEvents) / globalTotalEvents) * boostedEvents)
  return Math.max(0, Math.min(elementEvents, after - before))
}

// ============ 类型定义 ============

/** 招式执行记录（扩展，含 anomaly_buildup 和 element） */
export interface AnomalySkillExecution {
  moveId: string
  moveName: string
  slot: number
  count: number
  /** 基础异常积蓄值 */
  baseBuildUp: number
  /** 招式元素 */
  element: string
  /** 行级异常积蓄效率加成（%）：进「异常积蓄效率区」与面板/元素效率**加算**（非独立乘区）。
   *  招式限定用（如格莉丝电能强化只加特殊技/强特两行）；由 transformSkillExecutions 或提取器写入 */
  buildUpEfficiencyBonusPct?: number
}

/**
 * 积蓄池计算输入（扩展）
 *
 * 在原有基础上新增覆盖率、紊乱伤害、乱流伤害所需参数
 */
export interface AnomalyPoolInput {
  /** 全队招式执行计划 */
  executions: AnomalySkillExecution[]
  /** 各角色的面板 */
  panels: PanelValues[]
  /** boss自身系数（影响积蓄上限，通常1-1.5） */
  bossCoeff?: number
  /** 危局异常系数（影响积蓄上限，通常1.1） */
  anomalyCoeff?: number
  /** 各元素异常积蓄抗性（百分比，如 { fire: 10, ice: 10 }） */
  enemyAnomalyResistances?: Record<string, number>
  // ---- 以下为新增字段 ----
  /** 总战斗时间（秒），默认180 */
  totalTime?: number
  /** boss无敌时间（秒），默认0，用于覆盖率计算 */
  invincibleTime?: number
  /** 怪物防御值，默认953 */
  enemyDefense?: number
  /** 减防（全局debuff，百分比），默认0 */
  enemyDefReduction?: number
  /** 各元素伤害抗性（百分比，如 { fire: 10, ice: -20 }，负值=弱点），用于紊乱/乱流结算区 */
  enemyResistances?: Record<string, number>
  /** 减抗（全局debuff，百分比），默认0 */
  enemyResReduction?: number
  /** 是否处于失衡状态，默认false */
  stunned?: boolean | number
  /** 失衡易伤基础倍率，默认1.5 */
  stunMultiplier?: number
  /** 队伍中是否有风属性角色，默认false */
  hasWindChar?: boolean
  /** 风属性角色slot（用于乱流结算区计算），默认0 */
  windCharSlot?: number
  /** 维琳娜2命：风化获得风蚀的期望利用率，默认2/3 */
  velinaCinema2CorrosionRate?: number
  /** 蕾米异化系数倍率，乘到紊乱/乱流/异常相关伤害；默认1 */
  globalAnomalyMultiplier?: number
  /** 爱丽丝畏缩 DOT 配置（启用时计算畏缩固定 DOT 伤害和紊乱倍率加成） */
  aliceCoweringConfig?: AliceCoweringConfig
  /** 赠送异常触发次数（不消耗异常条、不产生积蓄，但参与紊乱序列和伤害计算）。
   *  如 { 'physical_polar_assault': 5 } 表示赠送 5 次极性强击触发。 */
  giftedTriggerCounts?: Record<string, number>
  /** 赠送触发归属的槽位（用于 per-slot 统计和紊乱 applier 归属），默认 0 */
  giftedTriggerSlot?: number
  /** 角色机制模块列表（transformAnomalyPool 钩子调用，perElement 前注入积蓄） */
  agentMechanics?: import('@/mechanics/types').AgentMechanicModule[]
}

/** 爱丽丝畏缩机制配置 */
export interface AliceCoweringConfig {
  /** 畏缩 DOT：每 tick 造成强击伤害的比例（%），默认 2.5 */
  dotRatio: number
  /** 畏缩 DOT：tick 间隔（秒），默认 0.95 */
  dotInterval: number
  /** 紊乱倍率加成：每剩余 1 秒物理异常时长 +%（默认 18） */
  disorderBonusPerSec: number
  /** 紊乱倍率加成上限（%，默认 180） */
  disorderBonusMax: number
  /** 物理异常强击基础倍率（%，60级默认 853） */
  assaultBaseMultiplier: number
}

// ============ 异常喧响归属辅助 ============

export function distributeIntegerByWeight(total: number, weights: number[]): number[] {
  const safeTotal = Math.max(0, Math.floor(total))
  const sumWeight = weights.reduce((sum, v) => sum + Math.max(0, v), 0)
  const result = weights.map(() => 0)
  if (safeTotal <= 0 || sumWeight <= 0) return result

  const raw = weights.map(v => (Math.max(0, v) / sumWeight) * safeTotal)
  let used = 0
  const fractions = raw.map((v, i) => {
    const base = Math.floor(v)
    result[i] = base
    used += base
    return { i, fraction: v - base }
  })

  fractions.sort((a, b) => b.fraction - a.fraction)
  let remaining = safeTotal - used
  for (const item of fractions) {
    if (remaining <= 0) break
    result[item.i] += 1
    remaining--
  }

  return result
}

export function calcPerSlotAnomalyTriggers(perElement: AnomalyProgress[], slotCount: number): number[] {
  const perSlot = Array(slotCount).fill(0)
  for (const prog of perElement) {
    const weights = Array(slotCount).fill(0)
    for (const contrib of prog.contributions) {
      weights[contrib.slot] = (weights[contrib.slot] ?? 0) + contrib.totalBuildUp
    }
    // 赠送触发（空贡献）：使用预填的 perSlotTriggerCounts
    const totalWeight = weights.reduce((s, v) => s + Math.max(0, v), 0)
    if (totalWeight <= 0 && prog.perSlotTriggerCounts) {
      for (let i = 0; i < slotCount; i++) perSlot[i] += prog.perSlotTriggerCounts[i] ?? 0
    } else {
      const distributed = distributeIntegerByWeight(prog.triggerCount, weights)
      for (let i = 0; i < slotCount; i++) perSlot[i] += distributed[i] ?? 0
    }
  }
  return perSlot
}

export function calcPerSlotDisorderTriggers(
  elements: { element: string; triggerCount: number; applierSlot: number }[],
  disorderCount: number,
  slotCount: number,
): number[] {
  const perSlot = Array(slotCount).fill(0)
  if (disorderCount <= 0 || elements.length < 2) return perSlot

  const eventsPerElement = Math.floor(disorderCount / elements.length)
  let remainingEvents = disorderCount - eventsPerElement * elements.length

  for (let i = 0; i < elements.length; i++) {
    let triggerSlot = elements[i].applierSlot
    let bestTriggerCount = -1
    for (let j = 0; j < elements.length; j++) {
      if (j === i) continue
      if (elements[j].triggerCount > bestTriggerCount) {
        bestTriggerCount = elements[j].triggerCount
        triggerSlot = elements[j].applierSlot
      }
    }

    const events = eventsPerElement + (remainingEvents > 0 ? 1 : 0)
    if (remainingEvents > 0) remainingEvents--
    perSlot[triggerSlot] = (perSlot[triggerSlot] ?? 0) + events
  }

  return perSlot
}

export function calcPerSlotAnomalyDecibelBonus(
  perSlotAnomalyTriggers: number[],
  perSlotDisorderTriggers: number[],
  perSlotTurbulenceTriggers: number[] = [],
): number[] {
  const slotCount = Math.max(
    perSlotAnomalyTriggers.length,
    perSlotDisorderTriggers.length,
    perSlotTurbulenceTriggers.length,
  )
  const perSlotBonus: number[] = []

  for (let i = 0; i < slotCount; i++) {
    const ownAnomaly = (perSlotAnomalyTriggers[i] ?? 0) * ANOMALY_DECIBEL_BONUS
    const ownDisorder = (perSlotDisorderTriggers[i] ?? 0) * DISORDER_DECIBEL_BONUS
    const ownTurbulence = (perSlotTurbulenceTriggers[i] ?? 0) * TURBULENCE_DECIBEL_BONUS
    let companion = 0

    for (let j = 0; j < slotCount; j++) {
      if (j === i) continue
      companion += (perSlotAnomalyTriggers[j] ?? 0) * ANOMALY_DECIBEL_BONUS * 0.5
      companion += (perSlotDisorderTriggers[j] ?? 0) * DISORDER_DECIBEL_BONUS * 0.5
      companion += (perSlotTurbulenceTriggers[j] ?? 0) * TURBULENCE_DECIBEL_BONUS * 0.5
    }

    perSlotBonus.push(ownAnomaly + ownDisorder + ownTurbulence + companion)
  }

  return perSlotBonus
}

// ============ 积蓄计算函数（原有，保持不变） ============

/**
 * 获取指定元素在指定触发次数时的积蓄上限（不含boss系数和危局系数）
 * @param element 元素
 * @param triggerCount 已触发该元素异常的次数（0 = 第一管）
 * @returns 基础积蓄上限
 */
export function getBaseBuildUpCap(element: string, triggerCount: number): number {
  const baseElement = getBaseElement(element)
  const table = BUILDUP_CAP_TABLE[baseElement]
  if (!table) {
    // 未知元素（如辉光 lumiflux），默认用冰火电以太的表
    const defaultTable = BUILDUP_CAP_TABLE.ice
    return defaultTable[Math.min(triggerCount, MAX_CAP_INDEX)]
  }
  return table[Math.min(triggerCount, MAX_CAP_INDEX)]
}

/**
 * 获取指定元素在指定触发次数时的实际积蓄上限
 * @param element 元素
 * @param triggerCount 已触发次数
 * @param bossCoeff boss自身系数（用户输入，通常1-1.5）
 * @param anomalyCoeff 危局异常系数（用户输入，通常1.1）
 * @returns 实际积蓄上限
 */
export function getBuildUpCap(
  element: string,
  triggerCount: number,
  bossCoeff: number,
  anomalyCoeff: number,
): number {
  return getBaseBuildUpCap(element, triggerCount) * bossCoeff * anomalyCoeff
}

export function getElementAnomalyBuildUpEfficiency(panel: PanelValues, element: string): number {
  const baseElement = getBaseElement(element)
  if (baseElement === 'electric') return panel.electricAnomalyBuildUpEfficiency ?? 0
  if (baseElement === 'physical') return panel.physicalAnomalyBuildUpEfficiency ?? 0
  return 0
}

/**
 * 计算单次招式的实际异常积蓄值
 * 复用 damage.ts 的 calcAnomalyBuildUp 逻辑
 */
export function calcPerHitBuildUp(
  baseBuildUp: number,
  panel: PanelValues,
  enemyAnomalyResistance: number,
  element: string,
  rowEfficiencyBonusPct = 0,
): number {
  // 异常掌控区（anomalyMastery / 100，无上限）
  const mastery = Math.floor(panel.anomalyMastery ?? 0)
  const afterMastery = baseBuildUp * (mastery / 100)

  // 异常积蓄效率区（面板 + 元素 + 行级招式限定，全部**加算**）
  const buildUpEff = (panel.anomalyBuildUpEfficiency ?? 0)
    + getElementAnomalyBuildUpEfficiency(panel, element)
    + rowEfficiencyBonusPct
  const afterEff = afterMastery * (1 + buildUpEff / 100)

  // 异常积蓄抗性区
  const anomalyResRed = (panel.enemyAnomalyResReduction ?? 0) + getElementEnemyAnomalyResReduction(panel, element)
  const effectiveRes = enemyAnomalyResistance - anomalyResRed
  const afterRes = afterEff * (1 - effectiveRes / 100)

  return afterRes
}

/**
 * 通过累积阈值比较计算触发次数
 *
 * 预计算了各元素的累积阈值（前缀和），直接比较总积蓄值落在哪个区间：
 *   totalBuildUp >= threshold[0] → 至少1管
 *   totalBuildUp >= threshold[1] → 至少2管
 *   ...
 *
 * 超过表中最大管数后，第10管起上限不再增加，用固定上限继续计算
 *
 * @param totalBuildUp 该元素的总积蓄值
 * @param element 元素
 * @param bossCoeff boss系数
 * @param anomalyCoeff 危局异常系数
 * @returns { triggerCount, lastCap } 触发次数和下一管的上限（用于展示）
 */
export function simulateTriggerCount(
  totalBuildUp: number,
  element: string,
  bossCoeff: number,
  anomalyCoeff: number,
): { triggerCount: number; lastCap: number } {
  const baseElement = getBaseElement(element)
  const thresholds = BUILDUP_THRESHOLD_TABLE[baseElement] ?? BUILDUP_THRESHOLD_TABLE.ice
  const coeff = bossCoeff * anomalyCoeff

  let triggerCount = 0

  // 逐档比较：总积蓄值 >= 累积阈值 × 系数 → 达到该管
  for (let i = 0; i < thresholds.length; i++) {
    if (totalBuildUp >= thresholds[i] * coeff) {
      triggerCount = i + 1
    } else {
      break
    }
  }

  // 超过表中最大管数（10管）后，上限不再增加，用固定上限继续计算
  if (triggerCount >= thresholds.length) {
    const maxCap = getBaseBuildUpCap(element, MAX_CAP_INDEX) * coeff
    const excessThreshold = thresholds[thresholds.length - 1] * coeff
    triggerCount += Math.floor((totalBuildUp - excessThreshold) / maxCap)
  }

  const lastCap = getBuildUpCap(element, triggerCount, bossCoeff, anomalyCoeff)
  return { triggerCount, lastCap }
}

// ============ 伤害计算辅助函数（新增） ============

/** 圆整数值（通过 fmt 格式化后转回数字） */
export function round(value: number, decimals = 2): number {
  if (!Number.isFinite(value)) return 0
  // fmt 返回带千分位的字符串，去除逗号后转回数字
  return Number(fmt(value, decimals).replace(/,/g, ''))
}

/**
 * 获取元素伤害加成对应的 PanelValues 字段名
 * frostfire（烈霜）是冰属性变体，使用 iceDmg
 */
export function getElementDmgKey(element: string): string {
  const baseElement = getBaseElement(element)
  switch (baseElement) {
    case 'physical':  return 'physicalDmg'
    case 'fire':      return 'fireDmg'
    case 'ice':       return 'iceDmg'
    case 'electric':  return 'electricDmg'
    case 'ether':     return 'etherDmg'
    case 'wind':      return 'windDmg'
    case 'lumiflux':  return 'lumifluxDmg'
    case 'frostfire': return 'iceDmg'  // 烈霜是冰属性变体，使用冰属性增伤
    default:          return baseElement + 'Dmg'
  }
}

/** 获取面板中指定元素的伤害加成（百分比） */
export function getElementDmgBonus(panel: PanelValues, element: string): number {
  const key = getElementDmgKey(element)
  return panel[key] ?? 0
}

export function getElementEnemyResReduction(panel: PanelValues, element: string): number {
  const baseElement = getBaseElement(element)
  const stat = enemyDebuffElementStatId('res', baseElement)
  return stat ? panel[stat] ?? 0 : 0
}

export function getElementEnemyDefReduction(panel: PanelValues, element: string): number {
  const baseElement = getBaseElement(element)
  const stat = enemyDebuffElementStatId('def', baseElement)
  return stat ? panel[stat] ?? 0 : 0
}

export function getElementEnemyAnomalyResReduction(panel: PanelValues, element: string): number {
  const baseElement = getBaseElement(element)
  const stat = enemyDebuffElementStatId('anomalyRes', baseElement)
  return stat ? panel[stat] ?? 0 : 0
}

export function getAnomalyDuration(panel: PanelValues, element: string): number {
  const baseElement = getBaseElement(element)
  const elementBonus = baseElement === 'physical'
    ? (panel.physicalAnomalyDurationBonusSeconds ?? 0)
    : baseElement === 'fire'
      ? (panel.fireAnomalyDurationBonusSeconds ?? 0)
      : baseElement === 'electric'
        ? (panel.electricAnomalyDurationBonusSeconds ?? 0)
        : baseElement === 'ether'
          ? (panel.etherAnomalyDurationBonusSeconds ?? 0)
          : 0
  return (ANOMALY_DURATION[baseElement] ?? 10)
    + (panel.anomalyDurationBonusSeconds ?? 0)
    + elementBonus
}

/**
 * 防御乘区（内联实现，使用794常数）
 *
 * 公式（来源：啵啵獭第八期穿透防御学）：
 *   有效防御 = max(0, 怪物防御 × (1 - 穿透率/100) × (1 - 减防/100) - 穿透值)
 *   防御区 = 794 / (有效防御 + 794)
 *
 * 穿透值 = 角色穿透值 + 敌方固定防御降低（两者本质相同，加算）
 */
export function calcDefenseMultiplier(
  enemyDefense: number,
  enemyDefReduction: number,
  enemyDefFlatReduction: number,
  penRatio: number,
  penFlat: number,
): number {
  const totalPenFlat = penFlat + enemyDefFlatReduction
  const effectiveDef = Math.max(
    0,
    enemyDefense * (1 - penRatio / 100) * (1 - enemyDefReduction / 100) - totalPenFlat,
  )
  return LEVEL_COEFF_60 / (LEVEL_COEFF_60 + effectiveDef)
}

/**
 * 抗性乘区
 *
 * 异常伤害、紊乱、乱流使用伤害抗性表
 * multiplier = 1 - effectiveRes / 100，不设上限
 */
export function calcResistanceMultiplier(
  baseResistance: number,
  resReduction: number,
): number {
  const effectiveRes = baseResistance - resReduction
  return 1 - effectiveRes / 100
}

/**
 * 失衡易伤乘区
 *
 * 公式（来源：damage.ts calcStunMultiplier）：
 *   未失衡时返回1
 *   失衡时 = max(0, baseStunMultiplier + (stunBonus + stunBonusAlways) / 100)
 *   受 stunCapAlways 上限约束
 */
export function calcStunMultiplier(
  baseStunMultiplier: number,
  stunBonus: number,
  stunBonusAlways: number,
  stunCapAlways: number,
  stunned: boolean | number,
): number {
  // boolean: false → 1, true → 满乘区
  // number: 覆盖率 0-1 → 1 + (满乘区 − 1) × coverage
  if (typeof stunned === 'boolean') {
    if (!stunned) return 1
    let bonus = stunBonus + stunBonusAlways
    if (stunCapAlways > 0) bonus = Math.min(bonus, stunCapAlways)
    return Math.max(0, baseStunMultiplier + bonus / 100)
  }
  // number = coverage 0-1
  const cov = Math.max(0, Math.min(1, stunned))
  if (cov <= 0) return 1
  let bonus = stunBonus + stunBonusAlways
  if (stunCapAlways > 0) bonus = Math.min(bonus, stunCapAlways)
  const fullMult = Math.max(0, baseStunMultiplier + bonus / 100)
  return 1 + (fullMult - 1) * cov
}

/**
 * 计算异常暴击乘区（期望模式）
 *
 * 期望暴击乘区 = 1 + min(100, max(0, 暴击率)) / 100 × (暴击伤害 / 100)
 */
export function calcAnomalyCritExpect(
  panel: PanelValues,
  element?: string,
  sourcePanel?: PanelValues,
  options?: { includeSelfAssaultBonus?: boolean },
): number {
  const assaultSource = sourcePanel ?? panel
  const baseElement = element ? getBaseElement(element) : undefined
  const isAssault = baseElement === 'physical'
  const critRateRaw = (panel.anomalyCritRate ?? 0) + (isAssault ? assaultSource.assaultCritRate ?? 0 : 0)
  const selfAssaultBonus = options?.includeSelfAssaultBonus === false
    ? 0
    : (assaultSource.janeAssaultCritDmgBonus ?? 0)
  const critDmg = (panel.anomalyCritDmg ?? 0) + (isAssault ? (assaultSource.assaultCritDmg ?? 0) + selfAssaultBonus : 0)
  const critRate = Math.min(100, Math.max(0, critRateRaw))
  return 1 + (critRate / 100) * (critDmg / 100)
}

/**
 * 计算异常质量（基础部分，来自异常施加者）
 *
 * 公式：
 *   mass = atk × (multiplier/100) × (1 + 增伤/100) × (1 + 精通/100) × (1 + 异常增伤/100) × 防御区 × 等级区
 *
 * 各乘区来源：
 *   - atk, 增伤, 精通, 异常增伤, 穿透率, 穿透值：来自异常施加者面板
 *   - 防御区：使用施加者的穿透率/穿透值 + 全局减防
 *   - 等级区：60级固定 ×2
 *
 * @param panel 异常施加者面板
 * @param multiplier 紊乱/乱流倍率（百分比，如525表示525%）
 * @param element 被覆盖的异常元素
 * @param enemyDefense 怪物防御
 * @param enemyDefReduction 全局减防（百分比）
 * @param includeAnomalyDmg 是否包含异常增伤区（紊乱=否，因为紊乱使用独立的 disorderDamageBonus；其他异常伤害=是）
 */
export function calcAnomalyMass(
  panel: PanelValues,
  multiplier: number,
  element: string,
  enemyDefense: number,
  enemyDefReduction: number,
  includeAnomalyDmg = true,
): number {
  const p = panel

  // 1. 基础伤害 = 攻击 × 倍率（百分比转小数）
  const baseDmg = p.atk * (multiplier / 100)

  // 2. 增伤区（通用 + 元素伤害）
  const elementDmg = getElementDmgBonus(p, element)
  const dmgBonus = p.dmgBonus ?? 0
  const afterDmgBonus = baseDmg * (1 + (elementDmg + dmgBonus) / 100)

  // 3. 异常精通区（无上限）
  const anomalyProf = p.anomalyProficiency ?? 0
  const afterProf = afterDmgBonus * (anomalyProf / 100)

  // 4. 异常增伤区（来自施加者面板）
  //    紊乱结算时不继承此区（使用 disorderDamageBonus 替代），因此紊乱调用传 false
  //    乱流继承此区但已通过 calcTurbulenceSettlement 独立计算，因此乱流调用也传 false（避免重复）
  let afterAnomalyDmg = afterProf
  if (includeAnomalyDmg) {
    const anomalyDmgBonus = p.anomalyDmgBonus ?? 0
    afterAnomalyDmg = afterProf * (1 + anomalyDmgBonus / 100)
  }

  // 5. 防御乘区（使用施加者自己的通用/元素减防、穿透率/穿透值 + 兼容传入的全局减防）
  const totalDefReduction = enemyDefReduction + (p.enemyDefReduction ?? 0) + (p.enemyAnomalyDefReduction ?? 0) + getElementEnemyDefReduction(p, element)
  const defMult = calcDefenseMultiplier(
    enemyDefense,
    totalDefReduction,
    p.enemyDefFlatReduction ?? 0,
    p.penRatio ?? 0,
    p.penFlat ?? 0,
  )
  const afterDef = afterAnomalyDmg * defMult

  // 6. 等级系数（60级 = 2）
  const afterLevel = afterDef * LEVEL_MULT_60

  return afterLevel
}

/**
 * 计算紊乱结算区乘数（不继承异常增伤和异常暴击）
 *
 * 结算区 = 抗性区 × 易伤区 × 失衡易伤区
 *
 * 注意：紊乱不继承异常增伤(anomalyDmgBonus)和异常暴击(anomalyCritRate/anomalyCritDmg)
 * 结算区来自触发者面板 + 全局debuff
 *
 * @param triggerPanel 触发者面板（覆盖异常的角色）
 * @param element 被覆盖的异常元素（用于查找boss抗性）
 * @param enemyResistances 各元素伤害抗性（boss有偏好，如火抗冰弱）
 * @param enemyResReduction 全局减抗（百分比）
 * @param stunned 是否处于失衡状态
 * @param stunMultiplier 失衡易伤基础倍率
 */
export function calcDisorderSettlement(
  triggerPanel: PanelValues,
  element: string,
  enemyResistances: Record<string, number>,
  enemyResReduction: number,
  stunned: boolean | number,
  stunMultiplier: number,
): number {
  const p = triggerPanel

  // 1. 抗性乘区（使用按元素伤害抗性，boss有偏好如火抗冰弱）
  const baseRes = enemyResistances[getBaseElement(element)] ?? 0
  const totalResReduction = enemyResReduction + (p.enemyResReduction ?? 0) + getElementEnemyResReduction(p, element)
  const resMult = calcResistanceMultiplier(baseRes, totalResReduction)

  // 2. 易伤乘区
  const dmgTaken = p.enemyDamageTakenBonus ?? 0
  const dmgTakenMult = 1 + dmgTaken / 100

  // 3. 失衡易伤区
  const stunMult = calcStunMultiplier(
    stunMultiplier,
    p.stunDmgMultiplierBonus ?? 0,
    p.stunDmgMultiplierBonusAlways ?? 0,
    p.stunDmgMultiplierBonusCapAlways ?? 0,
    stunned,
  )

  // 紊乱只吃紊乱增伤区，不继承普通异常增伤和异常暴击
  const disorderDmgMult = 1 + (p.disorderDamageBonus ?? 0) / 100
  return resMult * dmgTakenMult * stunMult * disorderDmgMult
}

/**
 * 计算乱流结算区乘数（继承异常增伤和异常暴击）
 *
 * 结算区 = 抗性区 × 易伤区 × 失衡易伤区 × 异常增伤区 × 异常暴击区
 *
 * 注意：乱流继承异常增伤和异常暴击（与紊乱不同）
 * 乱流视为维琳娜触发，结算区使用风角色面板
 *
 * @param windPanel 风属性角色面板（乱流触发者）
 * @param element 非风异常元素（用于查找boss抗性）
 * @param enemyResistances 各元素伤害抗性（boss有偏好，如火抗冰弱）
 * @param enemyResReduction 全局减抗（百分比）
 * @param stunned 是否处于失衡状态
 * @param stunMultiplier 失衡易伤基础倍率
 */
export function calcTurbulenceSettlement(
  windPanel: PanelValues,
  sourcePanel: PanelValues,
  element: string,
  enemyResistances: Record<string, number>,
  enemyResReduction: number,
  stunned: boolean | number,
  stunMultiplier: number,
): number {
  const p = windPanel

  // 1. 抗性乘区（使用非风元素伤害抗性，boss有偏好如火抗冰弱）
  const baseRes = enemyResistances[element] ?? 0
  const velinaCinema1ResIgnore = (p.velinaCinema1 ?? 0) > 0 ? 20 : 0
  const totalResReduction = enemyResReduction + (p.enemyResReduction ?? 0) + getElementEnemyResReduction(p, element) + velinaCinema1ResIgnore
  const resMult = calcResistanceMultiplier(baseRes, totalResReduction)

  // 2. 易伤乘区
  const dmgTaken = p.enemyDamageTakenBonus ?? 0
  const dmgTakenMult = 1 + dmgTaken / 100

  // 3. 失衡易伤区
  const stunMult = calcStunMultiplier(
    stunMultiplier,
    p.stunDmgMultiplierBonus ?? 0,
    p.stunDmgMultiplierBonusAlways ?? 0,
    p.stunDmgMultiplierBonusCapAlways ?? 0,
    stunned,
  )

  // 4. 异常增伤区（乱流继承异常增伤）
  const anomalyDmgBonus = (p.anomalyDmgBonus ?? 0) + (element === 'wind' ? p.windAnomalyDmgBonus ?? 0 : 0) + (p.turbulenceDamageBonus ?? 0)
  const anomalyDmgMult = 1 + anomalyDmgBonus / 100

  // 5. 异常暴击区：乱流继承触发者的通用异常暴击；物理强击乱流额外继承强击暴击
  // 乱流不吃简的潜能强击爆伤：简潜能只给简自身触发的强击。
  const critMult = calcAnomalyCritExpect(p, element, sourcePanel, { includeSelfAssaultBonus: false })

  return resMult * dmgTakenMult * stunMult * anomalyDmgMult * critMult
}

/**
 * 获取指定元素的主要施加者slot
 * （积蓄贡献最大的slot）
 */
export function getMainApplierSlot(contribs: AnomalyContribution[]): number {
  if (!contribs || contribs.length === 0) return 0
  const slotMap = new Map<number, number>()
  for (const c of contribs) {
    slotMap.set(c.slot, (slotMap.get(c.slot) ?? 0) + c.totalBuildUp)
  }
  let maxSlot = contribs[0].slot
  let maxBuildUp = 0
  for (const [slot, buildup] of slotMap) {
    if (buildup > maxBuildUp) {
      maxBuildUp = buildup
      maxSlot = slot
    }
  }
  return maxSlot
}

// ============ 异常覆盖率计算（新增） ============

/**
 * 计算异常状态覆盖率
 *
 * 公式：
 *   总DoT时间 = Σ(各元素触发次数 × 该元素默认持续时间)
 *   有效DoT时间 = 总DoT时间 - boss无敌时间
 *   覆盖率 = 有效DoT时间 / 总战斗时间
 *   各元素覆盖率 = 该元素DoT时间 / 总战斗时间
 *   物理覆盖率 = 物理元素DoT时间 / 总战斗时间（用于增幅失衡）
 *
 * @param elementTriggerCounts 各元素触发次数
 * @param totalTime 总战斗时间（秒）
 * @param invincibleTime boss无敌时间（秒）
 */
export function calcCoverage(
  elementTriggerCounts: Record<string, number>,
  totalTime: number,
  invincibleTime: number,
  elementDurations: Record<string, number> = {},
  hasWindChar = false,
): AnomalyCoverageResult {
  const effectiveTime = Math.max(0, totalTime - invincibleTime)
  // 风化实际覆盖率：风异常总时长 / 有效战斗时间，最高 1
  const windCount = elementTriggerCounts['wind'] ?? 0
  const windDuration = elementDurations['wind'] ?? ANOMALY_DURATION.wind ?? 30
  const windTotalTime = Math.min(windCount * windDuration, effectiveTime)
  const windCoverageRate = effectiveTime > 0 ? windTotalTime / effectiveTime : 0

  const perElementDoTTime: Record<string, number> = {}
  let totalDoTTime = 0

  for (const [element, count] of Object.entries(elementTriggerCounts)) {
    const duration = elementDurations[element] ?? ANOMALY_DURATION[getBaseElement(element)] ?? 10
    // 风化覆盖的时间窗内非风状态不生效；其余时间按正常异常处理。
    const dotTime = element === 'wind'
      ? count * duration
      : hasWindChar
        ? count * duration * (1 - windCoverageRate)
        : count * duration
    perElementDoTTime[element] = dotTime
    totalDoTTime += dotTime
  }

  const effectiveDoTTime = Math.max(0, totalDoTTime - invincibleTime)
  const coverageRate = totalTime > 0 ? effectiveDoTTime / totalTime : 0

  const perElementCoverageRate: Record<string, number> = {}
  for (const [element, dotTime] of Object.entries(perElementDoTTime)) {
    perElementCoverageRate[element] = totalTime > 0 ? dotTime / totalTime : 0
  }

  // 畏缩真实覆盖率（供失衡加成）= 畏缩覆盖率 × (1 − 其他异常覆盖率)，模拟异常状态互斥吞没
  // 畏缩总时间 = (正常强击次数 + 极性强击次数) × 单次畏缩时长（极强与普通畏缩不分开）
  const physicalStunCount = (elementTriggerCounts['physical'] ?? 0) + (elementTriggerCounts['physical_polar_assault'] ?? 0)
  const physicalDuration = elementDurations['physical'] ?? ANOMALY_DURATION[getBaseElement('physical')] ?? 10
  const physicalTotalTime = physicalStunCount * physicalDuration * (hasWindChar ? 1 - windCoverageRate : 1)
  const physCov = totalTime > 0 ? Math.min(1, Math.max(0, physicalTotalTime - invincibleTime) / totalTime) : 0
  // 其他异常覆盖率：非物理类（极强属于畏缩合并，不计数）
  let otherCoverage = 0
  for (const [elem, cov] of Object.entries(perElementCoverageRate)) {
    if (elem !== 'physical' && elem !== 'physical_polar_assault' && elem !== 'wind') otherCoverage += cov
  }
  otherCoverage = Math.min(1, otherCoverage)
  const physicalCoverageRate = physCov * (1 - otherCoverage)

  // 霜寒真实覆盖率（供敌人暴击伤害+10% buff）：冻结与烈霜合计
  // 霜寒总时间 = 冻结(ice)触发次数×持续时间 + 烈霜(frostfire)触发次数×持续时间
  const iceCount = elementTriggerCounts['ice'] ?? 0
  const frostfireCount = elementTriggerCounts['frostfire'] ?? 0
  const frostTotalTime = (
    iceCount * (elementDurations['ice'] ?? ANOMALY_DURATION.ice ?? 10) +
    frostfireCount * (elementDurations['frostfire'] ?? ANOMALY_DURATION.frostfire ?? 20)
  ) * (hasWindChar ? 1 - windCoverageRate : 1)
  const frostCov = totalTime > 0 ? Math.min(1, Math.max(0, frostTotalTime - invincibleTime) / totalTime) : 0
  let frostOtherCoverage = 0
  for (const [elem, cov] of Object.entries(perElementCoverageRate)) {
    if (elem !== 'physical' && elem !== 'physical_polar_assault' && elem !== 'wind' && elem !== 'ice' && elem !== 'frostfire') frostOtherCoverage += cov
  }
  frostOtherCoverage = Math.min(1, frostOtherCoverage)
  const frostCoverageRate = frostCov * (1 - frostOtherCoverage)

  return {
    perElementDoTTime,
    totalDoTTime,
    invincibleTime,
    effectiveDoTTime,
    totalTime,
    coverageRate,
    perElementCoverageRate,
    physicalCoverageRate,
    frostCoverageRate,
    windCoverageRate,
  }
}

// ============ 伤害计算全局配置 ============

/** 紊乱/乱流伤害计算所需的共用配置 */
export interface DamageCalcConfig {
  enemyDefense: number
  enemyDefReduction: number
  /** 各元素伤害抗性（百分比，负值=弱点） */
  enemyResistances: Record<string, number>
  enemyResReduction: number
  stunned: boolean | number
  stunMultiplier: number
  velinaCinema2CorrosionRate: number
  /** 蕾米异化系数倍率，乘到所有异常相关伤害；无蕾米时为1 */
  globalAnomalyMultiplier: number
  /** 爱丽丝畏缩配置（启用时计算 DOT 和紊乱倍率加成） */
  aliceCoweringConfig?: AliceCoweringConfig
}

// ============ 紊乱伤害计算（新增，无风属性时） ============

/**
 * 计算紊乱伤害详情（无风属性时）
 *
 * 实现简化：
 * - 每个元素的T使用该元素的默认持续时间（如烈霜20s，其余10s）
 *   角色专属延时（如雅20s烈霜）不会分给别人，只计入自己的紊乱T
 * - 每个元素的紊乱伤害用该元素的施加者面板计算异常质量
 * - 用触发者的面板计算结算区（含按元素抗性）
 * - 紊乱不继承异常增伤和异常暴击
 *
 * @param elements 参与紊乱的元素列表（element, triggerCount, applierSlot）
 * @param disorderCount 紊乱总次数
 * @param panels 各角色面板
 * @param config 伤害计算全局配置
 */
export function calcDisorderDamage(
  elements: { element: string; triggerCount: number; applierSlot: number }[],
  disorderCount: number,
  panels: PanelValues[],
  config: DamageCalcConfig,
): DisorderDamageResult | undefined {
  if (disorderCount <= 0 || elements.length < 2) return undefined

  const details: DisorderDamageDetail[] = []
  let totalDamage = 0

  // 每个元素被覆盖的次数（简化：均分）
  // 对于2种元素，每种各被覆盖 disorderCount/2 次
  const numElements = elements.length
  const eventsPerElement = Math.floor(disorderCount / numElements)
  let remainingEvents = disorderCount - eventsPerElement * numElements

  for (let i = 0; i < elements.length; i++) {
    const { element, applierSlot } = elements[i]
    const applierPanel = panels[applierSlot] ?? panels[0]

    // 触发者 = 另一个元素的施加者（覆盖当前元素的元素）
    // 对于2种元素，取另一个；对于3+种，取触发次数最多的其他元素
    let triggerSlot = applierSlot
    let bestTriggerCount = -1
    for (let j = 0; j < elements.length; j++) {
      if (j === i) continue
      if (elements[j].triggerCount > bestTriggerCount) {
        bestTriggerCount = elements[j].triggerCount
        triggerSlot = elements[j].applierSlot
      }
    }
    const triggerPanel = panels[triggerSlot] ?? panels[0]

    // T = 该元素异常在施加者身上的剩余时间；异常持续时间加成只影响这里，不影响积蓄
    const T = getAnomalyDuration(applierPanel, element)

    // 紊乱倍率 = (baseMultiplier + 基础倍率提升) + floor(T / tickInterval) × tickMultiplier
    const formula = DISORDER_FORMULAS[getBaseElement(element)] ?? DISORDER_FORMULAS.ice
    let disorderMultiplier =
      formula.baseMultiplier +
      (applierPanel.disorderBaseMultiplierBonus ?? 0) +
      Math.floor(T / formula.tickInterval) * formula.tickMultiplier

    // 爱丽丝畏缩机制：紊乱覆盖物理异常时，每剩余1秒物理异常时长 +bonusPerSec%，上限 bonusMax%
    if (getBaseElement(element) === 'physical' && config.aliceCoweringConfig) {
      const coweringBonus = Math.min(
        T * config.aliceCoweringConfig.disorderBonusPerSec,
        config.aliceCoweringConfig.disorderBonusMax,
      )
      disorderMultiplier += coweringBonus
    }

    // 异常质量（紊乱不继承异常增伤，使用 disorderDamageBonus 替代）
    const anomalyMass = calcAnomalyMass(
      applierPanel,
      disorderMultiplier,
      element,
      config.enemyDefense,
      config.enemyDefReduction,
      false, // 紊乱使用 disorderDamageBonus，不继承 anomalyDmgBonus
    )

    // 结算区（来自触发者 + 全局debuff + 按元素抗性，不继承异常增伤和异常暴击）
    const settlementMultiplier = calcDisorderSettlement(
      triggerPanel,
      element,
      config.enemyResistances,
      config.enemyResReduction,
      config.stunned,
      config.stunMultiplier,
    )

    // 单次紊乱伤害 = 异常质量 × 结算区
    const perEventDamage = anomalyMass * settlementMultiplier

    // 该元素被覆盖的次数（剩余次数分配给前几个元素）
    const events = eventsPerElement + (remainingEvents > 0 ? 1 : 0)
    if (remainingEvents > 0) remainingEvents--

    const damage = perEventDamage * events * config.globalAnomalyMultiplier

    details.push({
      element,
      applierSlot,
      triggerSlot,
      remainingTime: round(T),
      disorderMultiplier: round(disorderMultiplier),
      anomalyMass: round(anomalyMass),
      settlementMultiplier: round(settlementMultiplier, 4),
      events,
      perEventDamage: round(perEventDamage),
      damage: round(damage),
    })

    totalDamage += damage
  }

  return {
    details,
    totalDamage: round(totalDamage),
    count: disorderCount,
    avgDamage: round(disorderCount > 0 ? totalDamage / disorderCount : 0),
  }
}

// ============ 乱流伤害计算（新增，有风属性时） ============

/**
 * 计算乱流伤害详情（有风属性时）
 *
 * 实现逻辑：
 * - DoT伤害归零（火/电/以太的DoT被乱流吞了）
 * - 不触发紊乱，触发乱流
 * - 乱流视为维琳娜触发，结算区用风角色面板（继承异常增伤和异常暴击）
 * - 异常质量来自非风角色
 * - T = 非风异常默认持续时间（风化不被覆盖，T可吃满）
 * - 乱流次数 = 非风元素触发次数之和，按风化时长 / 3秒CD 的槽位封顶（多次风化窗口合并，不封顶）
 *
 * @param nonWindElements 非风元素列表（element, triggerCount, applierSlot）
 * @param windSlot 风属性角色slot（用于乱流结算区）
 * @param panels 各角色面板
 * @param config 伤害计算全局配置
 */
export function calcTurbulenceDamage(
  nonWindElements: { element: string; triggerCount: number; applierSlot: number }[],
  windSlot: number,
  panels: PanelValues[],
  config: DamageCalcConfig,
  windTriggerCount = 0,
  maxCount = Number.POSITIVE_INFINITY,
): TurbulenceDamageResult | undefined {
  if (nonWindElements.length === 0) return undefined

  // 乱流次数 = 非风元素触发次数之和
  const rawCount = nonWindElements.reduce((sum, e) => sum + e.triggerCount, 0)
  // 乱流3秒CD：按实际风化时长折算 maxCount
  const turbulenceCount = Math.min(rawCount, Math.max(0, maxCount))

  if (turbulenceCount <= 0) return undefined

  const windPanel = panels[windSlot] ?? panels[0]
  const corrosionState = simulateVelinaCorrosionState(
    turbulenceCount,
    windTriggerCount,
    (windPanel.velinaCinema2 ?? 0) > 0,
    (windPanel.velinaCinema6 ?? 0) > 0,
    config.velinaCinema2CorrosionRate,
  )

  // 如果总数超过上限，按比例缩减各元素的次数
  const scale = rawCount > turbulenceCount ? turbulenceCount / rawCount : 1

  const details: TurbulenceDamageDetail[] = []
  let totalDamage = 0
  let totalBoostedCount = 0

  let processedTurbulenceEvents = 0

  for (const { element, triggerCount, applierSlot } of nonWindElements) {
    const applierPanel = panels[applierSlot] ?? panels[0]

    // T = 非风异常剩余时间；异常持续时间加成只影响这里，不影响积蓄
    const T = getAnomalyDuration(applierPanel, element)

    // 乱流倍率 = baseMultiplier + floor(T / tickInterval) × tickMultiplier；维琳娜2风蚀强化在倍率区加算+150%。
    const formula = TURBULENCE_FORMULAS[getBaseElement(element)] ?? TURBULENCE_FORMULAS.ice
    const turbulenceMultiplier =
      formula.baseMultiplier +
      Math.floor(T / formula.tickInterval) * formula.tickMultiplier

    // 该元素的乱流次数（按CD上限缩放）
    const events = Math.floor(triggerCount * scale)
    const boostedEvents = allocateBoostedEvents(turbulenceCount, events, corrosionState.boostedTurbulenceCount, processedTurbulenceEvents)
    processedTurbulenceEvents += events
    totalBoostedCount += boostedEvents

    // 异常质量（乱流不继承 anomalyDmgBonus，结算区已通过 calcTurbulenceSettlement 独立应用）
    const anomalyMass = calcAnomalyMass(
      applierPanel,
      turbulenceMultiplier,
      element,
      config.enemyDefense,
      config.enemyDefReduction,
      false,
    )
    const boostedAnomalyMass = boostedEvents > 0 ? calcAnomalyMass(
      applierPanel,
      turbulenceMultiplier + 150,
      element,
      config.enemyDefense,
      config.enemyDefReduction,
      false,
    ) : anomalyMass

    // 结算区（乱流视为维琳娜触发，用风角色面板，继承异常增伤和异常暴击）
    const settlementMultiplier = calcTurbulenceSettlement(
      windPanel,
      applierPanel,
      element,
      config.enemyResistances,
      config.enemyResReduction,
      config.stunned,
      config.stunMultiplier,
    )

    // 单次乱流伤害 = 异常质量 × 结算区
    const perEventDamage = anomalyMass * settlementMultiplier

    const boostedPerEventDamage = boostedAnomalyMass * settlementMultiplier
    const normalEvents = Math.max(0, events - boostedEvents)
    const damage = (perEventDamage * normalEvents + boostedPerEventDamage * boostedEvents) * config.globalAnomalyMultiplier

    details.push({
      element,
      applierSlot,
      count: events,
      boostedCount: boostedEvents,
      remainingTime: round(T),
      turbulenceMultiplier: round(boostedEvents > 0 ? turbulenceMultiplier + 150 : turbulenceMultiplier),
      anomalyMass: round(anomalyMass),
      settlementMultiplier: round(settlementMultiplier, 4),
      damage: round(damage),
    })

    totalDamage += damage
  }

  return {
    details,
    totalDamage: round(totalDamage),
    count: turbulenceCount,
    boostedCount: totalBoostedCount,
    avgDamage: round(turbulenceCount > 0 ? totalDamage / turbulenceCount : 0),
  }
}

// ============ 爱丽丝畏缩 DOT 计算 ============

/**
 * 计算爱丽丝畏缩固定 DOT 伤害
 *
 * 机制：畏缩状态下，每 dotInterval 秒造成 assaultDamage × dotRatio% 的固定异常伤害。
 * DOT 持续整个物理异常覆盖时间（覆盖率 100% 等效于 180 秒）。
 *
 * @param physicalContribs 物理元素积蓄贡献明细（用于找到施加者面板）
 * @param panels 各角色面板
 * @param physicalCoverageTime 物理异常覆盖时间（秒）
 * @param config 伤害计算全局配置
 */
// ============ 标准元素 DOT 配置（灼烧/感电/侵蚀） ============

/**
 * 各元素 DOT 参数
 *
 * 数据来源：啵啵獭异常学 + NGA 公式帖
 * 注意：物理（畏缩）、冰（霜寒）、风（风化）没有 DOT 伤害，只有特殊效果
 *   - 畏缩：敌人受到失衡值+7.5%，持续10秒
 *   - 霜寒：敌人受到暴击伤害+10%，持续10秒（冰）/ 20秒（烈霜）
 *   - 风化：提升风属性直伤，持续30秒
 */
export const STANDARD_DOT_CONFIG: Record<string, { tickMultiplier: number; tickInterval: number; totalTicks: number }> = {
  fire:     { tickMultiplier: 50,   tickInterval: 0.5, totalTicks: 20 },  // 灼烧 50%/0.5s，10秒共20tick
  electric: { tickMultiplier: 125,  tickInterval: 1,   totalTicks: 10 },  // 感电 125%/tick，10秒共10tick
  ether:    { tickMultiplier: 62.5, tickInterval: 0.5, totalTicks: 20 },  // 侵蚀 62.5%/0.5s，10秒共20tick
}

/**
 * 异常「单次/单跳」倍率（%）：异放/单次结算类事件的基底倍率。
 * DoT 类取单跳倍率，单次类（强击/碎冰/风化）取单次倍率。
 * 与「原属性异常伤害 × 初始比例」口径对齐：例如风 1250%×1.4%=17.5%、火 50%×35.7%=17.85%，
 * 各元素 × 初始比例 ≈ 17.5%，再乘掌控/10 转模（用户确认口径）。
 */
export const ANOMALY_SINGLE_HIT_MULTIPLIER: Record<string, number> = {
  fire: STANDARD_DOT_CONFIG.fire.tickMultiplier,        // 50
  electric: STANDARD_DOT_CONFIG.electric.tickMultiplier, // 125
  ether: STANDARD_DOT_CONFIG.ether.tickMultiplier,      // 62.5
  physical: 713,                                        // 强击 713% 单次
  ice: 500,                                             // 碎冰 500% 单次
  wind: 1250,                                           // 风化 1250% 单次
}

/**
 * 计算标准元素 DOT 伤害（灼烧/感电/侵蚀）
 *
 * 每 tick 伤害 = 异常质量 × 结算区
 * 异常质量 = calcAnomalyMass(ATK × tickMultiplier, 精通区, 增伤区, 防御区, 等级区)
 * 结算区 = 抗性区 × 易伤区 × 失衡区 × 异常增伤区 × 异常暴击区
 * 总 tick 数 = 有效 DOT 覆盖时间 / tickInterval（上限 = 触发次数 × 每次总tick数）
 *
 * @param dotElements 有 DOT 的元素列表（fire/electric/ether）
 * @param panels 各角色面板
 * @param dotCoverageTime 有效 DOT 覆盖时间（秒）
 * @param config 伤害计算全局配置
 */
export function calcStandardDotDamage(
  dotElements: { element: string; triggerCount: number; applierSlot: number }[],
  panels: PanelValues[],
  dotCoverageTime: number,
  config: DamageCalcConfig,
): StandardDotDamageResult | undefined {
  if (dotElements.length === 0 || dotCoverageTime <= 0) return undefined

  const details: StandardDotDamageDetail[] = []
  let totalDamage = 0

  for (const { element, triggerCount, applierSlot } of dotElements) {
    const dotConfig = STANDARD_DOT_CONFIG[element]
    if (!dotConfig) continue

    const applierPanel = panels[applierSlot] ?? panels[0]

    // 异常质量（每 tick 的基础伤害，含异常增伤）
    const anomalyMass = calcAnomalyMass(
      applierPanel,
      dotConfig.tickMultiplier,
      element,
      config.enemyDefense,
      config.enemyDefReduction,
      true, // 含异常增伤
    )

    // 结算区乘数（抗性 × 易伤 × 失衡 × 异常暴击）
    const baseRes = config.enemyResistances[getBaseElement(element)] ?? 0
    const totalResReduction = config.enemyResReduction
      + (applierPanel.enemyResReduction ?? 0)
      + getElementEnemyResReduction(applierPanel, element)
    const resMult = calcResistanceMultiplier(baseRes, totalResReduction)

    const dmgTakenMult = 1 + (applierPanel.enemyDamageTakenBonus ?? 0) / 100

    const stunMult = calcStunMultiplier(
      config.stunMultiplier,
      applierPanel.stunDmgMultiplierBonus ?? 0,
      applierPanel.stunDmgMultiplierBonusAlways ?? 0,
      applierPanel.stunDmgMultiplierBonusCapAlways ?? 0,
      config.stunned,
    )

    const anomalyDmgMult = 1 + (applierPanel.anomalyDmgBonus ?? 0) / 100
    const critMult = calcAnomalyCritExpect(applierPanel, element)

    const settlementMultiplier = resMult * dmgTakenMult * stunMult * anomalyDmgMult * critMult

    // 单 tick 伤害
    const perTickDamage = anomalyMass * settlementMultiplier

    // 总 tick 数 = DOT 覆盖时间 / tickInterval，上限 = 触发次数 × 每次总tick数
    const maxTicks = triggerCount * dotConfig.totalTicks
    const coverageTicks = dotCoverageTime / dotConfig.tickInterval
    const totalTicks = Math.min(maxTicks, coverageTicks)

    const damage = perTickDamage * totalTicks * config.globalAnomalyMultiplier

    details.push({
      element,
      applierSlot,
      tickMultiplier: dotConfig.tickMultiplier,
      tickInterval: dotConfig.tickInterval,
      totalTicks: round(totalTicks),
      perTickDamage: round(perTickDamage),
      damage: round(damage),
    })

    totalDamage += damage
  }

  if (details.length === 0) return undefined

  return { details, totalDamage: round(totalDamage) }
}

export function calcAliceCoweringDot(
  physicalContribs: AnomalyContribution[],
  panels: PanelValues[],
  dotCoverageTime: number,
  config: DamageCalcConfig,
): AliceCoweringDotResult | undefined {
  const cc = config.aliceCoweringConfig
  if (!cc) return undefined
  if (!physicalContribs || physicalContribs.length === 0) return undefined
  if (dotCoverageTime <= 0) return undefined

  // 找到主要物理施加者
  const applierSlot = getMainApplierSlot(physicalContribs)
  const applierPanel = panels[applierSlot] ?? panels[0]

  // 计算单次强击（物理异常）伤害
  const assaultDamage = calcAnomalyMass(
    applierPanel,
    cc.assaultBaseMultiplier,
    'physical',
    config.enemyDefense,
    config.enemyDefReduction,
  )

  // 结算区乘数（来自施加者 + 全局debuff）
  const settlementMultiplier = calcDisorderSettlement(
    applierPanel,
    'physical',
    config.enemyResistances,
    config.enemyResReduction,
    config.stunned,
    config.stunMultiplier,
  )

  // 单次强击伤害 = 异常质量 × 结算区（异常伤害吃异常增伤和暴击，这里简化不继承紊乱增伤）
  const assaultDamagePerTrigger = assaultDamage * settlementMultiplier * config.globalAnomalyMultiplier

  // DOT 每 tick 伤害 = assaultDamage × dotRatio%
  const dotDamagePerTick = assaultDamagePerTrigger * (cc.dotRatio / 100)

  // 总 tick 数 = DOT 覆盖时间 / dotInterval
  const totalTicks = dotCoverageTime / cc.dotInterval

  // 总 DOT 伤害
  const totalDotDamage = dotDamagePerTick * totalTicks

  return {
    dotInterval: cc.dotInterval,
    dotRatio: cc.dotRatio,
    assaultDamagePerTrigger: round(assaultDamagePerTrigger),
    dotDamagePerTick: round(dotDamagePerTick),
    totalTicks: round(totalTicks),
    totalDotDamage: round(totalDotDamage),
  }
}

// ============ 积蓄池主计算（修改） ============

/**
 * 积蓄池主计算
 *
 * 计算流程：
 * 1. 按元素分组累积积蓄值
 * 2. 通过累积阈值比较计算各元素触发次数
 * 3. 计算紊乱次数（无风属性时）
 * 4. 计算异常覆盖率
 * 5. 计算紊乱伤害（无风属性时）或乱流伤害（有风属性时）
 * 6. 计算喧响奖励
 */
