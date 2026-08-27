/**
 * 副词条分配算法
 *
 * 规则：
 * - 推荐含双爆（critRate + critDmg）时，优先双爆配平至局内暴击率100%
 *   配平规则：局内暴击率 × 2 = 暴击伤害（暴击伤害步长4.8 = 暴击率步长2.4 × 2，所以等步数即配平）
 * - 3个推荐词条：总39步，先双爆配平至100%暴击率，剩余全给第3词条
 * - 2个推荐词条：总31步，第1优先18步、第2优先13步
 * - 1个推荐词条：总18步，全给该词条
 */

import type { CharacterBuildRecommendation } from '@/types/catalog'
import type { DriveDiscConfig, StatRules, Agent, WEngine, TeammateBuff } from '@/types/catalog'
import { calcPanel } from './panel'
import type { SourcePanelsByOwner } from './buff'

/** 推荐副词条 prop name → catalog statId 映射 */
const REC_SUBSTAT_MAP: Record<string, string> = {
  'CRIT Rate': 'critRate',
  'CRIT DMG': 'critDmg',
  'ATK': 'atkPct',
  'HP': 'hpPct',
  'DEF': 'defPct',
  'PEN Ratio': 'penRatio',
  'Impact': 'impact',
  'Anomaly Proficiency': 'anomalyProficiency',
  'Anomaly Mastery': 'anomalyMastery',
  'Energy Regen': 'energyRegen',
}

/** 将推荐副词条列表转换为 statId 数组（按优先级排序） */
function parseRecSubstats(rec: CharacterBuildRecommendation): string[] {
  return rec.substats
    .slice()
    .sort((a, b) => a.priority - b.priority)
    .map(s => REC_SUBSTAT_MAP[s.name])
    .filter((s): s is string => !!s)
}

/**
 * 计算推荐副词条分配方案
 *
 * @param rec 配装推荐
 * @param baseCritRate 不含副词条时的局内暴击率（百分比，如19.4表示19.4%）
 * @param subStep 副词条步长表
 * @returns Record<statId, count> 副词条分配
 */
export function computeRecommendedSubStats(
  rec: CharacterBuildRecommendation,
  baseCritRate: number,
  subStep: Record<string, number>,
): Record<string, number> {
  const recStats = parseRecSubstats(rec).filter(stat => subStep[stat] != null)
  const hasDualCrit = recStats.includes('critRate') && recStats.includes('critDmg')
  const result: Record<string, number> = {}
  if (recStats.length === 0) return result

  // --- 1个推荐词条：18步全给 ---
  if (recStats.length === 1) {
    result[recStats[0]] = 18
    return result
  }

  // --- 2个推荐词条：31步，18+13 ---
  if (recStats.length === 2) {
    result[recStats[0]] = 18
    result[recStats[1]] = 13
    return result
  }

  // --- 3个推荐词条（或更多，取前3）：39步 ---
  const total = 39
  const top3 = recStats.slice(0, 3)
  const thirdStat = top3[2] // 第3优先级词条

  if (hasDualCrit) {
    const critRateStep = subStep.critRate ?? 2.4
    const critDmgStep = subStep.critDmg ?? 4.8

    // 需要多少步暴击率才能达到100%
    const critGap = Math.max(0, 100 - baseCritRate)
    const critRateStepsNeeded = critGap > 0
      ? Math.ceil(critGap / critRateStep)
      : 0

    // 双爆配平：暴击率步数 = 暴击伤害步数（因为步长比1:2 = 配平比1:2）
    // 如果双爆需要的总步数 > 39，则各分一半
    const dualCritTotal = critRateStepsNeeded * 2
    if (dualCritTotal >= total) {
      // 全给双爆，尽量配平
      const half = Math.floor(total / 2)
      result['critRate'] = half
      result['critDmg'] = total - half
    } else {
      // 双爆配平后剩余给第3词条
      result['critRate'] = critRateStepsNeeded
      result['critDmg'] = critRateStepsNeeded
      result[thirdStat] = total - dualCritTotal
    }
  } else {
    // 不含双爆：均分39步，前两个各13，第三个13
    const perStat = Math.floor(total / 3)
    result[top3[0]] = perStat
    result[top3[1]] = perStat
    result[top3[2]] = total - perStat * 2
  }

  return result
}

/**
 * 计算不含副词条时的局内暴击率
 * 通过将 subStatAllocation 置空来计算基础面板
 */
export function computeBaseCritRate(
  agent: Agent,
  wEngine: WEngine | undefined,
  driveDiscConfig: DriveDiscConfig,
  setsMap: Map<string, any>,
  teammateBuffs: TeammateBuff[],
  statRules: StatRules | null,
  config: { cinemaLevel: number; wEngineModLevel: number; sourcePanelsByOwner?: SourcePanelsByOwner },
  globalBuffs: Array<{ stat: string; value: number; enabled: boolean; targetSkillType?: string }>,
): number {
  // 创建一个副词条为空的驱动盘配置
  const emptySubConfig: DriveDiscConfig = {
    ...driveDiscConfig,
    subStatAllocation: {},
  }

  const result = calcPanel(agent, wEngine, emptySubConfig, setsMap, teammateBuffs, statRules, config)
  let panel = { ...result.inCombat }

  // 应用全局buff
  for (const buff of globalBuffs) {
    if (!buff.enabled) continue
    const mode = buff.stat.endsWith('Pct') || buff.stat.endsWith('Rate') || buff.stat.endsWith('Dmg') ||
      buff.stat.endsWith('Ratio') || buff.stat.endsWith('Mastery') || buff.stat.endsWith('Regen') ||
      buff.stat.endsWith('Impact') || buff.stat.endsWith('Efficiency') || buff.stat.endsWith('Bonus')
      ? 'pct' : 'flat'
    // 这里不完整applyStat，仅做估算
    if (buff.stat === 'critRate') {
      panel.critRate += buff.value
    }
  }

  return panel.critRate
}
