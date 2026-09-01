/**
 * 抽取价值 × 真引擎：把 planner 的 TeamOracle 接成 core/acquisitionValue 的 scoreOf。
 *
 * 分工（贵的那层不参与随机性）：
 *   core/acquisitionValue.ts  抽卡随机过程（便宜，跑几千条路径）
 *   本文件                     持有集 → 该期最优不重叠三队总分（贵，真引擎，必须缓存）
 * 蒙特卡洛的路径数**不影响引擎成本**：不同世界线只会落到同一批「持有集 × 期」上，
 * 记忆化后引擎求值次数 = 不同持有集数 × 期数（3 张卡 × 3 期 ≤ 24 次），与路径数无关。
 *
 * 卡 id 约定：'1561' = 角色本体（tier 1）；'1561#w' = 该角色的专武（tier 2）。
 * 专武不单独生效——没有本体的专武按未持有处理（与 planner 的阶梯 tier 语义一致，
 * nextPurchase 强制不跳档）。
 */
import type { ScoreOf } from '@/core/acquisitionValue'
import { pickPeriodAssignment, type PlannerPeriod, type TeamOracle } from '@/composables/pullPlanner'

/** 卡 id → (agentId, 该卡带来的档位) */
export function parseCardId(cardId: string): { agentId: string; tier: 1 | 2 } {
  const [agentId, suffix] = cardId.split('#')
  return { agentId, tier: suffix === 'w' ? 2 : 1 }
}

/** 拥有的卡集合 → planner 的持有集（同角色取最高档；专武需本体在手才算数） */
export function holdingsFrom(ownedIds: string[]): Record<string, number> {
  const out: Record<string, number> = {}
  const hasBody = new Set(ownedIds.filter(id => !id.includes('#')).map(id => parseCardId(id).agentId))
  for (const id of ownedIds) {
    const { agentId, tier } = parseCardId(id)
    if (tier === 2 && !hasBody.has(agentId)) continue // 专武不能独立生效
    out[agentId] = Math.max(out[agentId] ?? 0, tier)
  }
  return out
}

export interface EngineScoreOptions {
  oracle: TeamOracle
  periods: PlannerPeriod[]
  /** 期入口钩子（切 Boss 期相位；createEngineOracle 返回的同名函数） */
  applyPeriodContext?: (period: PlannerPeriod) => void
  /** 内层不重叠 DFS 的候选截断（与 planner 默认同口径） */
  topM?: number
  /**
   * 单调化（默认开）：真值函数必然单调——多一张卡只是多一个选项，最优解不可能变差，
   * 即 v(S) ≥ max_{T⊆S} v(T)。但 planner 内层是**截断搜索**（topM 分桶多样化 + 不重叠
   * DFS + 无解时逐房贪心兜底），多一个候选会挤掉原本被选中的队，实测出现过
   * 「拥有更多卡反而掉分」的负价值。那是搜索工件不是真实结构，直接按已求值的子集取上界
   * 修正；修正次数由 monotoneFixes() 暴露出来 —— 它本身就是现行截断口径失真程度的度量。
   */
  enforceMonotone?: boolean
}

/** 造一个记忆化的 scoreOf：键 = 期 + 持有集签名 */
export function makeEngineScoreOf(opts: EngineScoreOptions): {
  scoreOf: ScoreOf
  engineCalls: () => number
  cacheSize: () => number
  /** 单调化生效次数（= 截断搜索给出「多张卡反而更差」的次数） */
  monotoneFixes: () => number
} {
  const cache = new Map<string, number>()
  const byPeriod = new Map<number, Array<{ owned: string[]; score: number }>>()
  let calls = 0
  let fixes = 0
  const monotone = opts.enforceMonotone !== false
  const scoreOf: ScoreOf = (ownedIds, periodIndex) => {
    const period = opts.periods[periodIndex]
    if (!period) return 0
    const holdings = holdingsFrom(ownedIds)
    const key = period.id + '|' + Object.entries(holdings).sort().map(([k, v]) => k + ':' + v).join(',')
    const hit = cache.get(key)
    if (hit != null) return hit
    calls++
    opts.applyPeriodContext?.(period)
    const assignment = pickPeriodAssignment(opts.oracle, period, holdings, opts.topM ?? 6)
    let score = Math.max(0, assignment.totalScore)
    if (monotone) {
      const owned = new Set(ownedIds)
      const seen = byPeriod.get(periodIndex) ?? []
      for (const prev of seen) {
        if (prev.score > score && prev.owned.every(id => owned.has(id))) { score = prev.score; fixes++ }
      }
      seen.push({ owned: [...ownedIds], score })
      byPeriod.set(periodIndex, seen)
    }
    cache.set(key, score)
    return score
  }
  return { scoreOf, engineCalls: () => calls, cacheSize: () => cache.size, monotoneFixes: () => fixes }
}
