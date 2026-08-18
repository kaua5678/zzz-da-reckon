/**
 * 套装等效词条 + 副词条融合贪心优化器
 *
 * 替代 substatAlloc.ts 的固定步数启发式（computeRecommendedSubStats）。
 * 将套装效果拆分为等效词条和独立乘区，然后用融合贪心在 39 步词条预算下
 * 最大化伤害期望。
 *
 * 核心流程：
 * 1. 角色词条模板 → 确定优化哪些副词条
 * 2. 套装效果分解 → 等效词条（可折算为副词条步长的属性）+ 独立乘区（增伤类）
 * 3. 套装剪枝 → 排除与模板无关的套装，Top-K 进贪心
 * 4. 融合贪心 → 39 步，每步选 ∂E/∂stat 最大者
 */

import type {
  Agent, WEngine, DriveDiscSet, PanelValues,
  DriveDiscConfig, TeammateBuff, BuffEffect,
  StatId, StatRules,
} from '@/types/catalog'
import { calcPanel } from './panel'
import type { SourcePanelsByOwner } from './buff'

// ============ 副词条步长表 ============

/** 副词条池：可出现在驱动盘副词条中的属性 */
const SUBSTAT_POOL: Record<string, number> = {
  hpFlat: 112,
  atkFlat: 19,
  defFlat: 15,
  hpPct: 3,
  atkPct: 3,
  defPct: 4.8,
  critRate: 2.4,
  critDmg: 4.8,
  anomalyProficiency: 9,
  penFlat: 9,
}

/** 副词条属性 Set（快速查找） */
const SUBSTAT_SET = new Set(Object.keys(SUBSTAT_POOL))

/**
 * 按有效词条数自动计算总步数。
 * 2 词条→32、3 词条→39、4 词条→43，其他→39。
 */
function getDefaultTotalSteps(statsCount: number): number {
  if (statsCount === 2) return 32
  if (statsCount === 3) return 39
  if (statsCount === 4) return 43
  return 39
}

// ============ 非副词条增伤乘区属性 ============

/**
 * 这些属性不在副词条池中，但直接进入伤害公式乘区，
 * 不能折算为等效词条，需归入「独立乘区」。
 */
const MULTIPLIER_STATS = new Set<string>([
  'dmgBonus',
  'anomalyDmgBonus',
  'disorderDamageBonus',
  'penRatio',
  'physicalDmg', 'fireDmg', 'iceDmg', 'electricDmg', 'etherDmg', 'windDmg', 'lumifluxDmg',
  'anomalyMastery',
  'anomalyBuildUpEfficiency',
  'physicalAnomalyBuildUpEfficiency',
  'electricAnomalyBuildUpEfficiency',
  'windAnomalyDmgBonus',
  'turbulenceDamageBonus',
  'anomalyCritRate',
  'anomalyCritDmg',
  'assaultCritRate',
  'assaultCritDmg',
  'anomalyReleaseDmgBonus',
])

// ============ 角色词条模板 ============

/** 词条模板：定义优化范围和伤害组成 */
export interface SubstatTemplate {
  /** 优先优化的副词条列表（有序） */
  stats: string[]
  /** 普通增伤乘区是否计入目标函数 */
  dmgBonusRelevant: boolean
  /** 异常伤害是否计入目标函数 */
  anomalyRelevant: boolean
  /** 异常伤害占比（0-1），用于混合伤害期望的加权 */
  anomalyRatio: number
  /** 全队攻击转模配置（可选）。设置后，atkPct 词条的边际收益会包含队友伤害增量。
   *  ratios = [1名异常, 2名异常, 3名异常] 时的转模比例。cap = 转模上限。 */
  teamAtkTransfer?: { ratios: [number, number, number]; cap: number }
  /** 攻击在异常伤害项中的权重（默认 1）。<1 时副词条攻击增量对异常伤害的贡献按比例衰减。
   *  蕾米=0.1（耀变/虚耀用队友面板，不吃自己攻击）。主C异常角色保持默认 1。 */
  atkWeightInAnomaly?: number
  /** 角色级贪心提前终止阈值。undefined=用全局默认 0.01。
   *  蕾米=0.15：攻击残余边际 < 初始最大×15% 时停止，只堆拐力收益期几步。 */
  minGainRatio?: number
}

/**
 * 队友信息（用于计算拐力收益）。
 * 调用方传入队友的当前面板伤害估算，贪心优化时攻击词条的边际收益
 * 会包含「自身攻击提升 → 全队拐力增加」的部分。
 */
export interface TeammateInfo {
  /** 队友的角色 ID（用于匹配特定机制） */
  agentId: string
  /** 队友当前面板攻击力 */
  atk: number
  /** 队友当前伤害期望（与目标函数同量纲） */
  expectedDamage: number
  /** 队友是否以异常伤害为主（影响异常增伤拐力计算） */
  anomalyRelevant: boolean
}

/**
 * 角色特定词条模板。
 * 按 agent.id（catalog 中的 nanoka_id，如 "1401"）索引。
 * 未配置的角色按 specialty 落入默认模板。
 */
const AGENT_TEMPLATES: Record<string, SubstatTemplate> = {
  // ===== 默认模板（按 specialty 兜底） =====
  _default_dps: {
    stats: ['critRate', 'critDmg', 'atkPct', 'penFlat'],
    dmgBonusRelevant: true,
    anomalyRelevant: false,
    anomalyRatio: 0,
  },
  _default_anomaly: {
    stats: ['anomalyProficiency', 'atkPct'],
    dmgBonusRelevant: true,
    anomalyRelevant: true,
    anomalyRatio: 0.85,
  },
  _default_support: {
    stats: ['atkPct', 'hpPct', 'defPct'],  // 辅助不优化伤害，保生存/面板
    dmgBonusRelevant: false,
    anomalyRelevant: false,
    anomalyRatio: 0,
  },
  _default_stun: {
    stats: ['critRate', 'critDmg', 'atkPct', 'penFlat'],
    dmgBonusRelevant: true,
    anomalyRelevant: false,
    anomalyRatio: 0,
  },
  _default_defense: {
    stats: ['hpPct', 'defPct', 'atkPct'],
    dmgBonusRelevant: true,
    anomalyRelevant: false,
    anomalyRatio: 0,
  },

  // ===== 角色特例 =====

  // 爱丽丝（1401）：物理异常 → 精通+攻击（异常角色暴击不如精通，6命附伤占比不足以让双爆上位）
  '1401': {
    stats: ['anomalyProficiency', 'atkPct'],
    dmgBonusRelevant: true,
    anomalyRelevant: true,
    anomalyRatio: 0.7,
  },

  // 蕾米埃尔（1581）：辉光异常/辅助定位，精通转模核心 → 精通+攻击，不堆掌控
  // 额外能力：队伍 1/2/3 名异常角色时，全队攻击 +6%/12%/40%×蕾米攻击，上限 1600
  // 耀变/虚耀/异化用队友面板结算 → 副词条攻击对异常伤害权重 0.1
  '1581': {
    stats: ['anomalyProficiency', 'atkPct'],
    dmgBonusRelevant: true,
    anomalyRelevant: true,
    anomalyRatio: 0.95,
    teamAtkTransfer: { ratios: [0.06, 0.12, 0.40], cap: 1600 },
    atkWeightInAnomaly: 0.1,
    minGainRatio: 0.15,
  },

  // 简（1261）：物理异常 → 精通+攻击
  '1261': {
    stats: ['anomalyProficiency', 'atkPct'],
    dmgBonusRelevant: true,
    anomalyRelevant: true,
    anomalyRatio: 0.9,
  },

  // 维琳娜（1561）：风异常/乱流 → 精通+攻击
  '1561': {
    stats: ['anomalyProficiency', 'atkPct'],
    dmgBonusRelevant: true,
    anomalyRelevant: true,
    anomalyRatio: 0.75,
  },

  // 柏妮思（1171）：火异常/灼烧 → 精通+攻击
  '1171': {
    stats: ['anomalyProficiency', 'atkPct'],
    dmgBonusRelevant: true,
    anomalyRelevant: true,
    anomalyRatio: 0.9,
  },

  // 月城柳（1221）：电异常/极性紊乱 → 精通+攻击
  '1221': {
    stats: ['anomalyProficiency', 'atkPct'],
    dmgBonusRelevant: true,
    anomalyRelevant: true,
    anomalyRatio: 0.9,
  },

  // 星见雅（Miyabi，待入 catalog）：直伤+异常混合型（烈霜/冰），霜寒+烈霜伤害混合
  // 将来入 catalog 时配置：
  //   stats: ['anomalyProficiency', 'atkPct', 'critRate', 'critDmg'],
  //   anomalyRatio: ~0.5,
  // 直伤占比高所以双爆收益大，异常占比低但仍需精通保证紊乱伤害。
}

/** 获取角色的词条模板 */
export function getTemplate(agent: Agent): SubstatTemplate {
  const direct = AGENT_TEMPLATES[agent.id]
  if (direct) return direct
  const spec = agent.specialty
  if (spec === 'anomaly') return AGENT_TEMPLATES._default_anomaly
  if (spec === 'support') return AGENT_TEMPLATES._default_support
  if (spec === 'stun') return AGENT_TEMPLATES._default_stun
  if (spec === 'defense') return AGENT_TEMPLATES._default_defense
  return AGENT_TEMPLATES._default_dps
}

// ============ 套装效果分解 ============

/** 套装效果分解结果 */
export interface SetBonusDecomposition {
  /** 等效副词条：statId → 等效步数（如 atkPct: 3.33 表示 10%/3% = 3.33 步） */
  equivalentSteps: Record<string, number>
  /** 独立乘区：statId → 值（百分比模式，如 dmgBonus: 15 表示 +15%） */
  multipliers: Record<string, number>
}

/**
 * 将单个 BuffEffect 拆分为等效词条或独立乘区。
 * 条件效果按覆盖率折算。
 */
function decomposeEffect(effect: BuffEffect): SetBonusDecomposition {
  const result: SetBonusDecomposition = { equivalentSteps: {}, multipliers: {} }
  if (!effect?.stat) return result

  const stat = effect.stat
  let value = effect.value ?? 0

  // 覆盖率折算（条件效果）
  const coverage = effect.coverage?.default ?? 1
  if (coverage < 1 && effect.type !== 'fixed') {
    value *= coverage
  }

  // Stacked 效果：取满层值
  if (effect.type === 'stacked' && effect.valuePerStack && effect.maxStacks) {
    value = effect.valuePerStack * (effect.defaultStacks ?? effect.maxStacks)
    if (coverage < 1) value *= coverage
  }

  if (value === 0) return result

  // 副词条池属性 → 等效词条
  if (SUBSTAT_SET.has(stat)) {
    const step = SUBSTAT_POOL[stat] ?? 1
    result.equivalentSteps[stat] = (result.equivalentSteps[stat] ?? 0) + value / step
    return result
  }

  // 增伤/乘区属性 → 独立乘区
  if (MULTIPLIER_STATS.has(stat)) {
    result.multipliers[stat] = (result.multipliers[stat] ?? 0) + value
    return result
  }

  // 其他属性（影响防御/抗性减益等）→ 暂不折算，记录为乘区
  // 如 enemyDefReduction、enemyResReduction 等间接影响伤害的属性
  const indirectStats = new Set([
    'enemyDefReduction', 'enemyDefFlatReduction',
    'enemyResReduction', 'enemyAnomalyResReduction',
    ...Array.from(MULTIPLIER_STATS),
  ])

  return result
}

/**
 * 分解套装效果为等效词条和独立乘区。
 */
function decomposeSet(
  setId: string,
  setsMap: Map<string, DriveDiscSet>,
  coverage?: number,
): SetBonusDecomposition {
  const result: SetBonusDecomposition = { equivalentSteps: {}, multipliers: {} }
  const set = setsMap.get(setId)
  if (!set) return result

  const cov = coverage ?? 1

  // 2 件套效果
  for (const e of set.twoPiece?.effects ?? []) {
    const d = decomposeEffect(e)
    for (const [k, v] of Object.entries(d.equivalentSteps)) {
      result.equivalentSteps[k] = (result.equivalentSteps[k] ?? 0) + v * cov
    }
    for (const [k, v] of Object.entries(d.multipliers)) {
      result.multipliers[k] = (result.multipliers[k] ?? 0) + v * cov
    }
  }

  // 4 件套效果
  for (const e of set.fourPiece?.selfBuff?.effects ?? []) {
    const d = decomposeEffect(e)
    for (const [k, v] of Object.entries(d.equivalentSteps)) {
      result.equivalentSteps[k] = (result.equivalentSteps[k] ?? 0) + v * cov
    }
    for (const [k, v] of Object.entries(d.multipliers)) {
      result.multipliers[k] = (result.multipliers[k] ?? 0) + v * cov
    }
  }

  return result
}

/**
 * 分解 4+2 套装组合。
 */
export function decomposeFourPlusTwo(
  fourPieceId: string,
  twoPieceId: string,
  setsMap: Map<string, DriveDiscSet>,
): SetBonusDecomposition {
  const four = decomposeSet(fourPieceId, setsMap)
  const two = decomposeSet(twoPieceId, setsMap)

  const equiv: Record<string, number> = { ...four.equivalentSteps }
  for (const [k, v] of Object.entries(two.equivalentSteps)) {
    equiv[k] = (equiv[k] ?? 0) + v
  }
  const mult: Record<string, number> = { ...four.multipliers }
  for (const [k, v] of Object.entries(two.multipliers)) {
    mult[k] = (mult[k] ?? 0) + v
  }

  return { equivalentSteps: equiv, multipliers: mult }
}

// ============ 伤害期望目标函数 ============

/**
 * 从基础面板 + 副词条分配 + 套装等效/乘区 计算伤害期望。
 *
 * 期望 E = (1-anomalyRatio) × E_direct + anomalyRatio × E_anomaly
 *
 * E_direct ∝ ATK × (1 + CR×CD/10000) × (1 + Σdmg/100)
 * E_anomaly ∝ ATK × (anomalyProficiency/100) × (1 + Σdmg/100) × (1 + anomalyDmg/100)
 *
 * 防御/抗性因子为常数（不随副词条变化），省略。
 *
 * @param basePanel   基础面板（不含副词条、不含套装效果）
 * @param allocation  副词条分配 { statId: stepCount }
 * @param setBonus    套装等效词条和独立乘区
 * @param template    角色词条模板
 * @param subStep     副词条步长表
 */
function computeExpectedScore(
  basePanel: PanelValues,
  allocation: Record<string, number>,
  setBonus: SetBonusDecomposition,
  template: SubstatTemplate,
  subStep: Record<string, number>,
): number {
  const stepTable = subStep || SUBSTAT_POOL

  // --- 合并副词条 + 套装等效词条 → 实际属性值 ---
  const mergedAlloc: Record<string, number> = {}
  for (const stat of template.stats) {
    const stepVal = stepTable[stat] ?? 0
    const allocSteps = allocation[stat] ?? 0
    const bonusSteps = setBonus.equivalentSteps[stat] ?? 0
    mergedAlloc[stat] = (allocSteps + bonusSteps) * stepVal
  }
  // 非模板词条的等效词条（套装可能给不优化的词条）也算入面板
  for (const [stat, steps] of Object.entries(setBonus.equivalentSteps)) {
    if (mergedAlloc[stat] != null) continue  // 已在上面处理
    const stepVal = stepTable[stat] ?? 0
    mergedAlloc[stat] = (mergedAlloc[stat] ?? 0) + steps * stepVal
  }

  // --- 构建实际面板 ---
  const p = { ...basePanel }

  // ATK：baseATK × (1 + atkPct/100) + atkFlat
  const baseAtk = basePanel.atk
  const atkPctVal = (mergedAlloc['atkPct'] ?? 0)
  const atkFlatVal = (mergedAlloc['atkFlat'] ?? 0)
  p.atk = baseAtk * (1 + atkPctVal / 100) + atkFlatVal

  // HP / DEF（penFlat 与防御相关但这里不优化，只承载）
  const hpPctVal = (mergedAlloc['hpPct'] ?? 0)
  const hpFlatVal = (mergedAlloc['hpFlat'] ?? 0)
  p.hp = basePanel.hp * (1 + hpPctVal / 100) + hpFlatVal

  const defPctVal = (mergedAlloc['defPct'] ?? 0)
  const defFlatVal = (mergedAlloc['defFlat'] ?? 0)
  p.def = basePanel.def * (1 + defPctVal / 100) + defFlatVal

  // 暴击
  p.critRate = basePanel.critRate + (mergedAlloc['critRate'] ?? 0)
  p.critDmg = basePanel.critDmg + (mergedAlloc['critDmg'] ?? 0)

  // 精通 + 套装独立乘区
  p.anomalyProficiency = basePanel.anomalyProficiency + (mergedAlloc['anomalyProficiency'] ?? 0) + (setBonus.multipliers['anomalyProficiency'] ?? 0)
  p.penFlat = basePanel.penFlat + (mergedAlloc['penFlat'] ?? 0)

  // 增伤乘区：来自面板本身 + 副词条（副词条没有增伤）+ 套装独立乘区
  const totalDmgBonus = (basePanel.dmgBonus ?? 0) + (setBonus.multipliers['dmgBonus'] ?? 0)
  const totalAnomalyDmg = (basePanel.anomalyDmgBonus ?? 0) + (setBonus.multipliers['anomalyDmgBonus'] ?? 0)

  // 副词条攻击增量（与基础攻击分开，用于异常项衰减）
  const substatAtkIncrement = baseAtk * (atkPctVal / 100) + atkFlatVal

  // --- 直伤期望（攻击全权重） ---
  let scoreDirect = 0
  if (template.anomalyRatio < 1) {
    const crCap = Math.min(100, Math.max(0, p.critRate)) / 100
    const cd = p.critDmg
    const critMult = 1 + crCap * (cd / 100)
    const dmgMult = 1 + totalDmgBonus / 100
    scoreDirect = p.atk * critMult * dmgMult
  }

  // --- 异常伤害期望（攻击权重 = atkWeightInAnomaly，默认1） ---
  let scoreAnomaly = 0
  if (template.anomalyRelevant && template.anomalyRatio > 0) {
    const atkWeight = template.atkWeightInAnomaly ?? 1
    const effectiveAnomalyATK = baseAtk + substatAtkIncrement * atkWeight
    const profMult = (p.anomalyProficiency ?? 0) / 100
    const dmgMult = 1 + totalDmgBonus / 100
    const anomalyDmgMult = 1 + totalAnomalyDmg / 100
    scoreAnomaly = effectiveAnomalyATK * profMult * dmgMult * anomalyDmgMult
  }

  return (1 - template.anomalyRatio) * scoreDirect + template.anomalyRatio * scoreAnomaly
}

// ============ 融合贪心 ============

/** 贪心优化结果 */
export interface GreedyResult {
  /** 最终副词条分配 { statId: stepCount } */
  allocation: Record<string, number>
  /** 最终伤害期望评分 */
  expectedScore: number
  /** 各词条再加 1 步的边际伤害增量（贪心最后一步时各候选词条的 ΔE） */
  marginalGains: Record<string, number>
}

/** 攻击拐力配置（从蕾米额外能力等全队攻击 buff 计算） */
interface AtkTransferConfig {
  /** 转模比例（如 0.06 / 0.12 / 0.40） */
  ratio: number
  /** 转模上限（默认 1600） */
  cap: number
}

/**
 * 计算蕾米攻击拐力给全队的伤害增量。
 * 只有 atkPct 词条增加攻击时，全队攻击 buff 才会变大（其他词条不影响）。
 *
 * @param remielleATK      蕾米当前攻击力
 * @param baseATK          蕾米基础攻击力（不含 atkPct 副词条）
 * @param atkPctVal        当前 atkPct 副词条总百分比值
 * @param stepTable        副词条步长表
 * @param teammates        队友信息列表
 * @param transfer         攻击转模配置
 * @returns 加一步 atkPct 的拐力增量（伤害期望量纲）
 */
function computeAtkTeamBenefit(
  remielleATK: number,
  baseATK: number,
  atkPctVal: number,
  stepTable: Record<string, number>,
  teammates: TeammateInfo[],
  transfer: AtkTransferConfig,
): number {
  if (!teammates || teammates.length === 0) return 0
  if (transfer.ratio <= 0) return 0

  // 检查是否已达转模上限（边际为 0）
  if (remielleATK * transfer.ratio >= transfer.cap) return 0

  // 加一步 atkPct 后的新攻击力：增量 = 基础攻击 × 步长%，叠加到当前面板攻击上
  // （面板其他攻击来源——音擎/主词条/套装——不随副词条变化，保持一致基数）
  const atkPctStep = stepTable['atkPct'] ?? 3
  const atkDelta = baseATK * (atkPctStep / 100)
  const newATK = remielleATK + atkDelta

  // 拐力增量 = 新转模量 - 旧转模量（同一口径：当前面板攻击 × 比例）
  const oldTransfer = Math.min(remielleATK * transfer.ratio, transfer.cap)
  const newTransfer = Math.min(newATK * transfer.ratio, transfer.cap)
  const deltaTransfer = Math.max(0, newTransfer - oldTransfer)

  if (deltaTransfer <= 0) return 0

  // 队友伤害弹性 = expectedDamage / ATK（线性近似）
  let teamBenefit = 0
  for (const tm of teammates) {
    if (tm.atk <= 0) continue
    const elasticity = tm.expectedDamage / tm.atk
    teamBenefit += elasticity * deltaTransfer
  }
  return teamBenefit
}

/**
 * 融合贪心：在 39 步预算内，每步贪心选择边际收益最大的词条。
 *
 * @param basePanel   基础面板（面板计算结果的 inCombat 面板，subStatAllocation 置空）
 * @param setBonus    套装等效词条 + 独立乘区
 * @param template    角色词条模板
 * @param subStep     副词条步长表
 * @param totalSteps  总步数
 * @param teammates   队友信息（可选，用于攻击拐力计算）
 * @param atkTransfer 攻击拐力配置（可选，非蕾米角色不传）
 */
function greedyAllocate(
  basePanel: PanelValues,
  setBonus: SetBonusDecomposition,
  template: SubstatTemplate,
  subStep: Record<string, number>,
  totalSteps: number,
  teammates: TeammateInfo[] | undefined,
  atkTransfer: AtkTransferConfig | undefined,
  statCap: number = 20,
  minGainRatio: number = 0.05,
): GreedyResult {
  const allocation: Record<string, number> = {}
  for (const stat of template.stats) allocation[stat] = 0

  // 追踪当前 atkPct 总量（用于拐力计算）
  const stepTable = subStep || SUBSTAT_POOL
  let currentAtkPctVal = (setBonus.equivalentSteps['atkPct'] ?? 0) * (stepTable['atkPct'] ?? 3)

  // 初始最大边际（第一步时记录，用于提前终止阈值判断）
  let maxGain0 = 0
  let stepCount = 0

  for (let step = 0; step < totalSteps; step++) {
    let bestStat = ''
    let bestScore = -Infinity
    let bestGain = 0

    const baseScore = computeExpectedScore(basePanel, allocation, setBonus, template, subStep)

    for (const stat of template.stats) {
      // 单词条步数已达上限，跳过
      if (allocation[stat] >= statCap) continue

      // 尝试加一步
      allocation[stat]++
      let score = computeExpectedScore(basePanel, allocation, setBonus, template, subStep)

      // 攻击词条的拐力收益
      if (stat === 'atkPct' && teammates && atkTransfer) {
        const panelATK = computePanelAtk(basePanel, allocation, setBonus, stepTable)
        score += computeAtkTeamBenefit(panelATK, basePanel.atk, currentAtkPctVal, stepTable, teammates, atkTransfer)
      }

      allocation[stat]--

      const gain = score - baseScore
      if (gain > bestGain) {
        bestScore = score
        bestGain = gain
        bestStat = stat
      }
    }

    // 第一步记录初始最大边际
    if (step === 0 && bestGain > 0) {
      maxGain0 = bestGain
    }

    // 提前终止：最佳边际已衰减到初始值的 minGainRatio 以下
    if (stepCount > 0 && maxGain0 > 0 && bestGain < maxGain0 * minGainRatio) {
      break
    }

    if (bestStat) {
      allocation[bestStat]++
      if (bestStat === 'atkPct') {
        currentAtkPctVal += (stepTable['atkPct'] ?? 3)
      }
      stepCount++
    }
  }

  // 最后一步时各词条的边际增量（即使已到 cap 也显示真实边际，供用户对比各词条收益）
  const marginalGains: Record<string, number> = {}
  const finalAlloc = { ...allocation }
  const baseFinalScore = computeExpectedScore(basePanel, finalAlloc, setBonus, template, subStep)
  for (const stat of template.stats) {
    finalAlloc[stat]++
    let marginalScore = computeExpectedScore(basePanel, finalAlloc, setBonus, template, subStep)
    if (stat === 'atkPct' && teammates && atkTransfer) {
      const panelATK = computePanelAtk(basePanel, finalAlloc, setBonus, stepTable)
      marginalScore += computeAtkTeamBenefit(panelATK, basePanel.atk, currentAtkPctVal, stepTable, teammates, atkTransfer)
    }
    finalAlloc[stat]--
    marginalGains[stat] = Math.max(0, marginalScore - baseFinalScore)
  }

  return { allocation, expectedScore: baseFinalScore, marginalGains }
}

/** 从分配计算面板攻击力（用于拐力计算，避免重复计算整个面板） */
function computePanelAtk(
  basePanel: PanelValues,
  allocation: Record<string, number>,
  setBonus: SetBonusDecomposition,
  stepTable: Record<string, number>,
): number {
  const atkPctSteps = (allocation['atkPct'] ?? 0) + (setBonus.equivalentSteps['atkPct'] ?? 0)
  const atkPctVal = atkPctSteps * (stepTable['atkPct'] ?? 3)
  const atkFlatVal = ((allocation['atkFlat'] ?? 0) + (setBonus.equivalentSteps['atkFlat'] ?? 0)) * (stepTable['atkFlat'] ?? 19)
  return basePanel.atk * (1 + atkPctVal / 100) + atkFlatVal
}

// ============ 套装剪枝 ============

/**
 * 检查套装是否与角色模板相关。
 *
 * 剪枝条件（满足任一即保留）：
 * 1. 套装等效词条中有模板 stats 中的属性
 * 2. 套装独立乘区中有 dmgBonus / anomalyDmgBonus 且模板标记了 dmgBonusRelevant
 * 3. 套装独立乘区中有 anomaly 相关乘区且模板标记了 anomalyRelevant
 */
function isSetRelevant(
  decomposition: SetBonusDecomposition,
  template: SubstatTemplate,
): boolean {
  // 等效词条与模板 stats 交集
  for (const stat of template.stats) {
    if ((decomposition.equivalentSteps[stat] ?? 0) > 0) return true
  }
  // 独立乘区中如果有增伤类且模板需要
  if (template.dmgBonusRelevant) {
    const dmgStats = ['dmgBonus', 'physicalDmg', 'fireDmg', 'iceDmg', 'electricDmg', 'etherDmg', 'windDmg', 'lumifluxDmg']
    for (const s of dmgStats) {
      if ((decomposition.multipliers[s] ?? 0) > 0) return true
    }
  }
  // 异常相关乘区
  if (template.anomalyRelevant) {
    const anomalyStats = ['anomalyDmgBonus', 'anomalyProficiency', 'anomalyMastery', 'anomalyCritRate', 'anomalyCritDmg', 'assaultCritRate', 'assaultCritDmg']
    for (const s of anomalyStats) {
      if ((decomposition.multipliers[s] ?? 0) > 0) return true
    }
  }
  return false
}

/**
 * 对所有候选套装组合做剪枝，返回 Top-K 组合。
 */
function pruneAndRankSets(
  allSetIds: string[],
  setsMap: Map<string, DriveDiscSet>,
  basePanel: PanelValues,
  template: SubstatTemplate,
  subStep: Record<string, number>,
  topK: number = 5,
  teammates?: TeammateInfo[],
  atkTransfer?: AtkTransferConfig,
  statCap?: number,
  totalSteps?: number,
): { fourPieceId: string; twoPieceId: string; decomposition: SetBonusDecomposition; baseScore: number }[] {
  // 生成 4+2 组合
  const combinations: { fourPieceId: string; twoPieceId: string; decomposition: SetBonusDecomposition }[] = []

  for (const fourId of allSetIds) {
    for (const twoId of allSetIds) {
      if (twoId === fourId) continue
      const decomp = decomposeFourPlusTwo(fourId, twoId, setsMap)
      if (!isSetRelevant(decomp, template)) continue
      combinations.push({ fourPieceId: fourId, twoPieceId: twoId, decomposition: decomp })
    }
  }

  // 对每个组合跑一次贪心（快速），取分数排序
  const scored = combinations.map(c => {
    const result = greedyAllocate(basePanel, c.decomposition, template, subStep, totalSteps!, teammates, atkTransfer, statCap)
    return { ...c, baseScore: result.expectedScore }
  })

  scored.sort((a, b) => b.baseScore - a.baseScore)
  return scored.slice(0, topK)
}

// ============ 主入口 ============

/** 优化器输入 */
export interface OptimizeSubstatsInput {
  agent: Agent
  wEngine: WEngine | undefined
  driveDiscConfig: DriveDiscConfig
  setsMap: Map<string, DriveDiscSet>
  teammateBuffs: TeammateBuff[]
  statRules: StatRules | null
  config: {
    cinemaLevel: number
    wEngineModLevel: number
    sourcePanelsByOwner?: SourcePanelsByOwner
  }
  /** 队友信息（可选）。提供后攻击词条的拐力收益会计入目标函数。 */
  teammates?: TeammateInfo[]
  /** 单词条分配上限（步数），防止所有步数堆一个属性。默认 20。 */
  statCap?: number
  /** 总步数覆盖。0（默认）= 自动按有效词条数（2→32/3→39/4→43）。>0 时强制使用。 */
  totalSteps?: number
  /** 贪心提前终止阈值。当最佳边际 < 初始最大边际 × minGainRatio 时停止。默认 0.05（5%）。 */
  minGainRatio?: number
}

/** 优化器输出 */
export interface OptimizeSubstatsOutput {
  /** 副词条分配 { statId: stepCount } */
  subStatAllocation: Record<string, number>
  /** 最终伤害期望评分 */
  expectedDamage: number
  /** 选中的套装信息 */
  chosenSet: {
    fourPieceId: string
    twoPieceId: string
    decomposition: SetBonusDecomposition
  }
  /** 各词条再加 1 步的边际伤害增量（贪心最后一步数据留底） */
  marginalGains: Record<string, number>
}

/**
 * 计算不含副词条的基础面板。
 * 用于贪心优化的起点（面板中副词条相关属性为初始值）。
 */
function computeNoSubstatPanel(input: OptimizeSubstatsInput): PanelValues {
  const emptySubConfig: DriveDiscConfig = {
    ...input.driveDiscConfig,
    subStatAllocation: {},
  }

  const result = calcPanel(
    input.agent,
    input.wEngine,
    emptySubConfig,
    input.setsMap,
    input.teammateBuffs,
    input.statRules,
    {
      cinemaLevel: input.config.cinemaLevel,
      wEngineModLevel: input.config.wEngineModLevel,
      sourcePanelsByOwner: input.config.sourcePanelsByOwner,
    },
  )
  return { ...result.inCombat }
}

/**
 * 套装等效词条 + 副词条融合贪心优化主入口。
 *
 * 替代 computeRecommendedSubStats。
 *
 * 流程：
 * 1. 获取角色词条模板
 * 2. 构建基础面板（subStatAllocation 置空）
 * 3. 读取当前驱动盘套装 ID（4件套 + 2件套）
 * 4. 读取所有候选套装（catalog 中的 driveDiscSets）
 * 5. 套装剪枝 → Top-5 跑贪心
 * 6. 返回最优分配 + 评分
 */
export function computeOptimalSubStats(input: OptimizeSubstatsInput): OptimizeSubstatsOutput {
  // 1. 角色模板
  const template = getTemplate(input.agent)

  // 2. 基础面板（无副词条）
  const basePanel = computeNoSubstatPanel(input)

  // 3. 副词条步长表
  const subStep = (input.statRules?.driveDisc?.sRankSubStatBaseStep ?? {}) as Record<string, number>

  // 4. 总步数：用户覆盖 > 自动（按有效词条数）
  const totalSteps = input.totalSteps && input.totalSteps > 0
    ? input.totalSteps
    : getDefaultTotalSteps(template.stats.length)

  // 5. 攻击拐力配置：从模板 teamAtkTransfer 读取（通用化，不再特判 agent.id）
  let atkTransfer: AtkTransferConfig | undefined
  const teammates = input.teammates
  if (teammates && teammates.length > 0 && template.teamAtkTransfer) {
    const anomalyCount = 1 + teammates.filter(t => t.anomalyRelevant).length
    // 取 ratios[0/1/2] 对应 1/2/3 名异常角色
    const idx = Math.min(anomalyCount, template.teamAtkTransfer.ratios.length) - 1
    const ratio = template.teamAtkTransfer.ratios[Math.max(0, idx)]
    atkTransfer = { ratio, cap: template.teamAtkTransfer.cap }
  }

  // 6. 收集所有候选套装
  const allSetIds = Array.from(input.setsMap.keys())

  const statCap = input.statCap ?? 20
  // 阈值优先级：模板 > 用户覆盖 > 全局默认 0.05
  const minGainRatio = template.minGainRatio ?? input.minGainRatio ?? 0.05

  // 7. 剪枝 + 贪心 → 最优组合
  const topCombos = pruneAndRankSets(allSetIds, input.setsMap, basePanel, template, subStep, 5, teammates, atkTransfer, statCap, totalSteps)

  // 回退函数：对指定套装跑贪心
  const runGreedy = (fourId: string, twoId: string): GreedyResult => {
    const decomp = decomposeFourPlusTwo(fourId, twoId, input.setsMap)
    return greedyAllocate(basePanel, decomp, template, subStep, totalSteps, teammates, atkTransfer, statCap, minGainRatio)
  }

  if (topCombos.length === 0) {
    // 无候选套装匹配模板，回退到当前套装贪心
    const currentFour = input.driveDiscConfig.fourPieceSetId
    const currentTwo = input.driveDiscConfig.twoPieceSetId
    const fourId = currentFour || allSetIds[0] || ''
    const twoId = currentTwo || allSetIds.find(id => id !== fourId) || allSetIds[0] || ''
    const greedy = runGreedy(fourId, twoId)
    return {
      subStatAllocation: greedy.allocation,
      expectedDamage: greedy.expectedScore,
      marginalGains: greedy.marginalGains,
      chosenSet: { fourPieceId: fourId, twoPieceId: twoId, decomposition: decomposeFourPlusTwo(fourId, twoId, input.setsMap) },
    }
  }

  const best = topCombos[0]
  const greedy = runGreedy(best.fourPieceId, best.twoPieceId)

  return {
    subStatAllocation: greedy.allocation,
    expectedDamage: greedy.expectedScore,
    marginalGains: greedy.marginalGains,
    chosenSet: {
      fourPieceId: best.fourPieceId,
      twoPieceId: best.twoPieceId,
      decomposition: best.decomposition,
    },
  }
}
