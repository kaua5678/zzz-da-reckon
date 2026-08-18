// @ts-nocheck
/**
 * 驱动盘组合评分内核
 *
 * 评分 = 该驱动盘组合下的伤害期望。
 *
 * 支持两种模式：
 * - fast:  基于 inCombat 面板的简化伤害估算（ATK × 暴击期望 × 增伤 × 防御 × 抗性），
 *          用于优化器内部的大规模枚举，保证与真实伤害成正比即可正确排序。
 * - full:  调用完整伤害计算 calcDamage，用于最终结果展示。
 */
import { enemyDebuffElementStatId } from '@/utils/enemyDebuffStats'
import type {
  Agent,
  WEngine,
  DriveDisc,
  DriveDiscSet,
  PanelValues,
  SkillEvent,
  DamageElement,
  AgentSkills,
  CalculatorConfig,
  BuffEffect,
} from '@/types/catalog'
import {
  calcBasePanel,
  applyDriveDiscs,
} from '@/core/panel'
import {
  collectAllBuffs,
  applyBuffs,
  applyStat,
  type CollectedBuffs,
} from '@/core/buff'
import { calcDamage } from '@/core/damage'

// ============ 类型定义 ============

/** 评分所需的完整配置（对应 OptimizerInput.scoringConfig） */
export interface ScoringConfig {
  cinemaLevel: number
  wEngineModificationLevel: number
  coreSkillLevel: string
  agentLevel: number
  enemyDefense: number
  enemyLevel: number
  enemyResistance: Record<string, number>
  stunMultiplier: number
  selectedEvents: SkillEvent[]
  skillLevels: Record<string, number>
}

export type ScoreMode = 'fast' | 'full'

/**
 * 预计算的评分上下文。
 *
 * 将不随驱动盘组合变化的部分（基础面板、常量 buff）预先计算好，
 * 优化器内部复用此上下文进行快速评分，避免重复收集 agent / wEngine / coreSkill buff。
 */
export interface ScoringContext {
  agent: Agent
  wEngine: WEngine
  setsMap: Map<string, DriveDiscSet>
  config: ScoringConfig

  /** 基础面板（角色 + 音擎，不含驱动盘） */
  basePanel: PanelValues

  /** 常量 buff（用空盘收集，即不含驱动盘套装 buff） */
  constantBuffs: CollectedBuffs

  /** 角色伤害元素 */
  damageElement: DamageElement | undefined

  /** 完整评分所需的技能数据 */
  agentSkills?: AgentSkills
}

// ============ 常量 ============

/** 百分比类属性（乘算），其余均为加算 */
const PCT_STATS = new Set<string>(['hpPct', 'atkPct', 'defPct'])

// ============ 辅助函数 ============

/** 获取元素伤害加成 */
function getElementDmgBonus(
  panel: PanelValues,
  element: DamageElement | undefined,
): number {
  if (!element) return 0
  const map: Record<string, number> = {
    physical: panel.physicalDmg,
    fire: panel.fireDmg,
    ice: panel.iceDmg,
    electric: panel.electricDmg,
    ether: panel.etherDmg,
    wind: panel.windDmg,
    lumiflux: panel.lumifluxDmg,
  }
  return map[element] ?? 0
}

function getElementEnemyResReduction(panel: PanelValues, element: DamageElement | undefined): number {
  const stat = enemyDebuffElementStatId('res', element)
  return stat ? panel[stat] ?? 0 : 0
}

function getElementEnemyDefReduction(panel: PanelValues, element: DamageElement | undefined): number {
  const stat = enemyDebuffElementStatId('def', element)
  return stat ? panel[stat] ?? 0 : 0
}

/**
 * 从面板值计算快速评分。
 *
 * score = basisValue × critMult × dmgBonusMult × defMult × resMult
 *
 * 其中 skillMultiplier / stunMult / count 为常量（不随驱动盘变化），
 * 省略后仍保持与真实伤害的正比关系，足以用于排序。
 *
 * @param panel       面板值（通常为 inCombat 面板）
 * @param damageElement 伤害元素
 * @param agentLevel  攻击者等级（用于防御乘区）
 * @param enemyDefense 敌人防御力
 * @param enemyResistance 敌人抗性表
 */
export function scorePanel(
  panel: PanelValues,
  damageElement: DamageElement | undefined,
  agentLevel: number,
  enemyDefense: number,
  enemyResistance: Record<string, number>,
): number {
  const p = panel

  // 1. 伤害基数（默认 ATK）
  const basis = p.atk

  // 2. 暴击期望乘数
  const critRate = Math.min(100, Math.max(0, p.critRate)) / 100
  const critMult = 1 + critRate * (p.critDmg / 100)

  // 3. 增伤乘数
  const elementDmg = getElementDmgBonus(p, damageElement)
  const dmgBonus = p.dmgBonus ?? 0
  const dmgBonusMult = 1 + (elementDmg + dmgBonus) / 100

  // 4. 防御乘区
  const levelCoeff = agentLevel * 10 + 690
  const effectiveDef = Math.max(
    0,
    enemyDefense * (1 - p.penRatio / 100) * (1 - ((p.enemyDefReduction ?? 0) + getElementEnemyDefReduction(p, damageElement)) / 100) - p.penFlat,
  )
  const defMult = Math.min(1, levelCoeff / (levelCoeff + effectiveDef))

  // 5. 抗性乘区
  const baseRes =
    enemyResistance[damageElement ?? 'physical'] ?? 0
  const resReduction = (p.enemyResReduction ?? 0) + getElementEnemyResReduction(p, damageElement)
  const resMult = 1 - (baseRes - resReduction) / 100

  return basis * critMult * dmgBonusMult * defMult * resMult
}

/**
 * 收集驱动盘套装 buff（独立于 collectAllBuffs，用于快速评分路径）。
 *
 * 逻辑与 buff.ts 中的 collectDriveDiscBuffs 一致，
 * 但可接收预计算的防御力，避免重复计算。
 */

/** 解析 outOfCombatStat 条件（兼容字符串 "stat=def; min=1000" 和对象 {stat, min} 两种格式） */
function parseOutOfCombatStat(
  raw: unknown,
): { stat: string; min: number } | null {
  if (raw == null) return null
  if (typeof raw === 'string') {
    const match = raw.match(/stat=(\w+).*min=(\d+)/)
    if (match) return { stat: match[1], min: Number(match[2]) }
    return null
  }
  if (typeof raw === 'object' && raw !== null) {
    const obj = raw as Record<string, unknown>
    if (typeof obj.stat === 'string' && typeof obj.min === 'number') {
      return { stat: obj.stat, min: obj.min }
    }
  }
  return null
}

function collectDiscSetBuffs(
  discs: DriveDisc[],
  setsMap: Map<string, DriveDiscSet>,
  panelDef: number,
): CollectedBuffs {
  const out: BuffEffect[] = []
  const inCombat: BuffEffect[] = []

  // 统计每套数量
  const setCounts = new Map<string, DriveDisc[]>()
  for (const disc of discs) {
    const arr = setCounts.get(disc.setId) ?? []
    arr.push(disc)
    setCounts.set(disc.setId, arr)
  }

  for (const [setId, discArr] of setCounts) {
    const set = setsMap.get(setId)
    if (!set) continue

    // 2 件套
    if (discArr.length >= 2 && set.twoPiece?.effects) {
      for (const e of set.twoPiece.effects) {
        out.push(e)
      }
    }

    // 4 件套
    if (discArr.length >= 4 && set.fourPiece?.selfBuff) {
      const effects = set.fourPiece.selfBuff.effects ?? []
      for (let e of effects) {
        if (!e || !e.stat) continue
        // 检查防御力条件（兼容字符串和对象两种格式）
        if (e.requirement?.outOfCombatStat) {
          const req = parseOutOfCombatStat(
            e.requirement.outOfCombatStat as unknown,
          )
          if (req && req.stat === 'def' && panelDef < req.min) continue
        }
        if (set.fourPiece.selfBuff.scope === 'outOfCombat') {
          out.push(e)
        } else {
          inCombat.push(e)
        }
      }
    }
  }

  return { outOfCombat: out, inCombat }
}

// ============ 上下文创建 ============

/**
 * 创建评分上下文。
 *
 * 预计算基础面板和常量 buff，后续 fastScoreWithContext 复用。
 */
export function createScoringContext(
  agent: Agent,
  wEngine: WEngine,
  setsMap: Map<string, DriveDiscSet>,
  config: ScoringConfig,
  agentSkills?: AgentSkills,
): ScoringContext {
  const basePanel = calcBasePanel(agent, wEngine)

  // 用空盘收集常量 buff（agent + wEngine + coreSkill，无套装 buff）
  const constantBuffs = collectAllBuffs(agent, wEngine, [], setsMap, {
    cinemaLevel: config.cinemaLevel,
    wEngineModificationLevel: config.wEngineModificationLevel,
  })

  return {
    agent,
    wEngine,
    setsMap,
    config,
    basePanel,
    constantBuffs,
    damageElement: agent.damageElement,
    agentSkills,
  }
}

// ============ 快速评分（上下文路径，优化器内部使用） ============

/**
 * 使用预计算上下文进行快速评分。
 *
 * 流程：
 * 1. basePanel + 驱动盘词条 → withDiscs
 * 2. 收集套装 buff（仅盘相关部分）
 * 3. withDiscs + (常量 buff + 套装 buff) → outOfCombat → inCombat
 * 4. 从 inCombat 面板计算快速评分
 */
export function fastScoreWithContext(
  ctx: ScoringContext,
  discs: DriveDisc[],
): number {
  // 1. 应用驱动盘主/副词条
  const withDiscs = applyDriveDiscs(ctx.basePanel, discs)

  // 2. 收集套装 buff
  const discBuffs = collectDiscSetBuffs(
    discs,
    ctx.setsMap,
    withDiscs.def,
  )

  // 3. 合并 buff 并应用
  const allOutOfCombat = [
    ...ctx.constantBuffs.outOfCombat,
    ...discBuffs.outOfCombat,
  ]
  const allInCombat = [
    ...ctx.constantBuffs.inCombat,
    ...discBuffs.inCombat,
  ]
  const outOfCombat = applyBuffs(withDiscs, allOutOfCombat)
  const inCombat = applyBuffs(outOfCombat, allInCombat)

  // 4. 计算快速评分
  return scorePanel(
    inCombat,
    ctx.damageElement,
    ctx.config.agentLevel,
    ctx.config.enemyDefense,
    ctx.config.enemyResistance,
  )
}

// ============ 完整评分（calcDamage 路径） ============

/** 评估结果：包含评分和面板数据 */
export interface EvaluationResult {
  score: number
  outOfCombat: PanelValues
  inCombat: PanelValues
}

/**
 * 使用预计算上下文进行完整评估，返回评分和面板数据。
 *
 * 与 fastScoreWithContext 逻辑一致，但额外返回局外/局内面板，
 * 供优化器进行最小值约束检查和结果展示。
 */
export function evaluateWithContext(
  ctx: ScoringContext,
  discs: DriveDisc[],
): EvaluationResult {
  // 1. 应用驱动盘主/副词条
  const withDiscs = applyDriveDiscs(ctx.basePanel, discs)

  // 2. 收集套装 buff
  const discBuffs = collectDiscSetBuffs(discs, ctx.setsMap, withDiscs.def)

  // 3. 合并 buff 并应用
  const allOutOfCombat = [
    ...ctx.constantBuffs.outOfCombat,
    ...discBuffs.outOfCombat,
  ]
  const allInCombat = [
    ...ctx.constantBuffs.inCombat,
    ...discBuffs.inCombat,
  ]
  const outOfCombat = applyBuffs(withDiscs, allOutOfCombat)
  const inCombat = applyBuffs(outOfCombat, allInCombat)

  // 4. 计算快速评分
  const score = scorePanel(
    inCombat,
    ctx.damageElement,
    ctx.config.agentLevel,
    ctx.config.enemyDefense,
    ctx.config.enemyResistance,
  )

  return { score, outOfCombat, inCombat }
}

/**
 * 使用完整伤害计算进行评分。
 * 需要 agentSkills 才能查表技能倍率，否则回退到 fast 模式。
 */
export function fullScoreWithContext(
  ctx: ScoringContext,
  discs: DriveDisc[],
): number {
  if (!ctx.agentSkills || !ctx.config.selectedEvents?.length) {
    return fastScoreWithContext(ctx, discs)
  }

  const calcConfig: CalculatorConfig = {
    agentId: ctx.agent.id,
    agentLevel: ctx.config.agentLevel,
    coreSkillLevel: ctx.config.coreSkillLevel,
    cinemaLevel: ctx.config.cinemaLevel,
    wEngineId: ctx.wEngine.id,
    wEngineLevel: 60,
    wEngineModificationLevel: ctx.config.wEngineModificationLevel,
    driveDiscs: discs,
    combatBuffs: [],
    bossId: '',
    enemyLevel: ctx.config.enemyLevel,
    enemyDefense: ctx.config.enemyDefense,
    enemyResistance: ctx.config.enemyResistance,
    stunMultiplier: ctx.config.stunMultiplier,
    selectedEvents: ctx.config.selectedEvents,
    skillLevels: ctx.config.skillLevels,
  }

  const result = calcDamage(
    ctx.agent,
    ctx.wEngine,
    discs,
    ctx.setsMap,
    calcConfig,
    ctx.agentSkills,
  )
  return result.finalDamage
}

// ============ 主评分接口 ============

/**
 * 评分函数：计算给定驱动盘组合的伤害期望。
 *
 * @param agent      角色
 * @param wEngine    音擎
 * @param discs      驱动盘数组（6 个）
 * @param setsMap    套装映射
 * @param config     评分配置
 * @param mode       评分模式（默认 'fast'）
 * @param agentSkills 技能数据（full 模式必需）
 * @returns 伤害期望评分
 */
export function scoreDiscs(
  agent: Agent,
  wEngine: WEngine,
  discs: DriveDisc[],
  setsMap: Map<string, DriveDiscSet>,
  config: ScoringConfig,
  mode: ScoreMode = 'fast',
  agentSkills?: AgentSkills,
): number {
  if (mode === 'full' && agentSkills) {
    const ctx = createScoringContext(agent, wEngine, setsMap, config, agentSkills)
    return fullScoreWithContext(ctx, discs)
  }

  // fast 模式
  const ctx = createScoringContext(agent, wEngine, setsMap, config)
  return fastScoreWithContext(ctx, discs)
}

// ============ 上界面板计算（用于 Super-Bound 剪枝） ============

/** 超级向量：每个槽位对每个属性的最大贡献 */
export interface SuperVector {
  /** 加算属性：stat → 各槽位最大值之和 */
  flat: Map<string, number>
  /** 乘算属性（atkPct/hpPct/defPct）：stat → 各槽位复合因子之积 */
  pct: Map<string, number>
}

/**
 * 计算单个候选盘对某个属性的总贡献。
 * = (主词条值 if 主词条是该属性) + (副词条该属性值之和)
 */
function discContribution(disc: DriveDisc, stat: string): number {
  let total = 0
  if (disc.mainStat.stat === stat) {
    total += disc.mainStat.value
  }
  for (const sub of disc.subStats ?? []) {
    if (sub.stat === stat) {
      total += sub.value
    }
  }
  return total
}

/**
 * 为指定槽位列表预计算超级向量。
 *
 * 对于每个剩余槽位，取所有候选盘中对每个属性的最大贡献；
 * 加算属性取各槽位最大值之和，乘算属性取各槽位复合因子之积。
 * 这是剩余槽位可贡献的理论上界（同一槽位不同属性的最大值可能来自不同盘，因此是过估）。
 *
 * @param candidateDiscs  所有槽位的候选盘
 * @param slotIndices     需要计算超级向量的槽位下标列表
 */
export function computeSuperVector(
  candidateDiscs: DriveDisc[][],
  slotIndices: number[],
): SuperVector {
  const flat = new Map<string, number>()
  const pct = new Map<string, number>()

  for (const slotIdx of slotIndices) {
    const candidates = candidateDiscs[slotIdx]
    if (!candidates || candidates.length === 0) continue

    // 收集该槽位所有候选盘涉及的所有属性
    const allStats = new Set<string>()
    for (const disc of candidates) {
      allStats.add(disc.mainStat.stat)
      for (const sub of disc.subStats ?? []) {
        allStats.add(sub.stat)
      }
    }

    // 对每个属性，取该槽位所有候选盘中的最大贡献
    for (const stat of allStats) {
      let maxContrib = 0
      for (const disc of candidates) {
        const contrib = discContribution(disc, stat)
        if (contrib > maxContrib) maxContrib = contrib
      }

      if (PCT_STATS.has(stat)) {
        // 乘算：复合因子 (1 + maxContrib / 100)
        const factor = 1 + maxContrib / 100
        pct.set(stat, (pct.get(stat) ?? 1) * factor)
      } else {
        // 加算：直接累加
        flat.set(stat, (flat.get(stat) ?? 0) + maxContrib)
      }
    }
  }

  // 初始化乘算属性的默认值（未出现的为 1，即无加成）
  return { flat, pct }
}

/**
 * 将超级向量应用到一个面板上，得到上界面板。
 *
 * 先应用加算属性（使基数最大化），再应用乘算属性（使增幅最大化），
 * 这种顺序保证结果 ≥ 任何实际组合。
 */
export function applySuperVector(
  panel: PanelValues,
  sv: SuperVector,
): PanelValues {
  const result = { ...panel }

  // 先加算
  for (const [stat, value] of sv.flat) {
    applyStat(result, stat, value, 'flat')
  }

  // 再乘算（将复合因子转换为等效 pct 值）
  for (const [stat, factor] of sv.pct) {
    const pctValue = (factor - 1) * 100
    applyStat(result, stat, pctValue, 'pct')
  }

  return result
}

/**
 * 计算上界评分：当前已选盘 + 剩余槽位超级向量 + 最优套装 buff。
 *
 * 用于 Super-Bound 剪枝。保证 ≥ 任何实际完成组合的真实评分。
 *
 * @param ctx              评分上下文
 * @param selectedDiscs    已选驱动盘
 * @param superVector      剩余槽位的超级向量
 * @param maxSetBuffs      最优可能的套装 buff（预计算，含所有候选套装的最佳效果）
 */
export function computeUpperBoundScore(
  ctx: ScoringContext,
  selectedDiscs: DriveDisc[],
  superVector: SuperVector,
  maxSetBuffs: CollectedBuffs,
): number {
  // 1. basePanel + 已选盘词条
  const withSelected = applyDriveDiscs(ctx.basePanel, selectedDiscs)

  // 2. + 超级向量（剩余槽位的理论最大属性）
  const withSuper = applySuperVector(withSelected, superVector)

  // 3. + 常量 buff + 最优套装 buff
  const allOutOfCombat = [
    ...ctx.constantBuffs.outOfCombat,
    ...maxSetBuffs.outOfCombat,
  ]
  const allInCombat = [
    ...ctx.constantBuffs.inCombat,
    ...maxSetBuffs.inCombat,
  ]
  const outOfCombat = applyBuffs(withSuper, allOutOfCombat)
  const inCombat = applyBuffs(outOfCombat, allInCombat)

  // 4. 快速评分
  return scorePanel(
    inCombat,
    ctx.damageElement,
    ctx.config.agentLevel,
    ctx.config.enemyDefense,
    ctx.config.enemyResistance,
  )
}

/**
 * 预计算最优套装 buff（用于上界估计）。
 *
 * 遍历所有可能的 4+2 / 2+2+2 组合，取评分最高的套装 buff 集合。
 * 在实际优化中，候选套装通常只有 2-3 套，组合数很少。
 */
export function computeMaxSetBuffs(
  fourPieceSetIds: string[],
  twoPieceSetIds: string[],
  setsMap: Map<string, DriveDiscSet>,
  ctx: ScoringContext,
): CollectedBuffs {
  const allSetIds = [...new Set([...fourPieceSetIds, ...twoPieceSetIds])]
  if (allSetIds.length === 0) {
    return { outOfCombat: [], inCombat: [] }
  }

  let bestBuffs: CollectedBuffs = { outOfCombat: [], inCombat: [] }
  let bestScore = -Infinity

  // 枚举 4+2 组合
  for (const fourId of fourPieceSetIds) {
    for (const twoId of allSetIds) {
      if (twoId === fourId) continue
      const buffs = buildSetBuffs(fourId, 4, twoId, 2, setsMap, ctx)
      const score = estimateSetBuffScore(buffs, ctx)
      if (score > bestScore) {
        bestScore = score
        bestBuffs = buffs
      }
    }
  }

  // 枚举 2+2+2 组合（如果 fourPieceSetIds 为空）
  if (fourPieceSetIds.length === 0 && twoPieceSetIds.length >= 3) {
    for (let i = 0; i < twoPieceSetIds.length; i++) {
      for (let j = i + 1; j < twoPieceSetIds.length; j++) {
        for (let k = j + 1; k < twoPieceSetIds.length; k++) {
          const buffs = buildSetBuffs(
            twoPieceSetIds[i], 2,
            twoPieceSetIds[j], 2,
            setsMap, ctx,
          )
          // 叠加第三套 2 件套
          const third = collectDiscSetBuffs(
            [makeFakeDisc(twoPieceSetIds[k]), makeFakeDisc(twoPieceSetIds[k])],
            setsMap,
            ctx.basePanel.def,
          )
          const combined: CollectedBuffs = {
            outOfCombat: [...buffs.outOfCombat, ...third.outOfCombat],
            inCombat: [...buffs.inCombat, ...third.inCombat],
          }
          const score = estimateSetBuffScore(combined, ctx)
          if (score > bestScore) {
            bestScore = score
            bestBuffs = combined
          }
        }
      }
    }
  }

  // 如果没有任何组合（例如只有一套），取该套的 2+4
  if (bestScore === -Infinity && allSetIds.length === 1) {
    bestBuffs = buildSetBuffs(allSetIds[0], 4, allSetIds[0], 2, setsMap, ctx)
  }

  return bestBuffs
}

/** 创建一个仅含 setId 的虚拟盘（用于套装 buff 收集） */
function makeFakeDisc(setId: string): DriveDisc {
  return {
    id: `fake_${setId}`,
    setId,
    setName: '',
    partition: 1,
    rarity: 'S',
    level: 15,
    maxLevel: 15,
    mainStat: { stat: 'hpFlat', value: 0, mode: 'flat' },
    subStats: [],
  }
}

/** 构建 4 件套 + 2 件套的 buff 集合 */
function buildSetBuffs(
  fourId: string,
  fourCount: number,
  twoId: string,
  twoCount: number,
  setsMap: Map<string, DriveDiscSet>,
  ctx: ScoringContext,
): CollectedBuffs {
  const discs: DriveDisc[] = []
  for (let i = 0; i < fourCount; i++) discs.push(makeFakeDisc(fourId))
  for (let i = 0; i < twoCount; i++) discs.push(makeFakeDisc(twoId))

  return collectDiscSetBuffs(discs, setsMap, ctx.basePanel.def)
}

/** 粗略评估套装 buff 的评分贡献（用于选择最优套装组合） */
function estimateSetBuffScore(
  buffs: CollectedBuffs,
  ctx: ScoringContext,
): number {
  // 用基础面板 + 套装 buff 估算评分差
  const base = ctx.basePanel
  const withBuffs = applyBuffs(
    applyBuffs(base, buffs.outOfCombat),
    buffs.inCombat,
  )
  return scorePanel(
    withBuffs,
    ctx.damageElement,
    ctx.config.agentLevel,
    ctx.config.enemyDefense,
    ctx.config.enemyResistance,
  )
}
