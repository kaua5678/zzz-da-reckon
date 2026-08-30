/**
 * 限定金数（单一事实源，2026-08 口径）：限定 S 本体 1 + 影画 mindscape + 专武精炼 (phase−1)。
 * 常驻 S（STANDARD_S_AGENT_IDS）与未收录角色（AGENT_RELEASE_NODE 无条目，含四星）不计金。
 *
 * 三处共用同一口径，改口径只改这里：
 * - pullValue（效率前沿 frontierLowestGold）
 * - charIncrement（队伍基底 extractBaseTeams 的金数窗）
 * - 实战对比页 RunArchivePage（「仅看低金顶分」筛选）
 */
import { AGENT_RELEASE_NODE } from '@/data/versionTimeline'
import { STANDARD_S_AGENT_IDS } from '@/composables/teamCompare'

export interface LimitedGoldMember {
  agentId: string
  mindscape?: number
  phase?: number
}

/** 单个成员的限定金数（常驻 S / 未收录 = 0） */
export function memberLimitedGold(m: LimitedGoldMember): number {
  if (!AGENT_RELEASE_NODE[m.agentId]) return 0
  if (STANDARD_S_AGENT_IDS.has(m.agentId)) return 0
  return 1 + (m.mindscape ?? 0) + Math.max(0, (m.phase ?? 1) - 1)
}

/** 一支队伍的限定金数 = Σ 成员 */
export function runLimitedGold(team: ReadonlyArray<LimitedGoldMember>): number {
  return team.reduce((s, m) => s + memberLimitedGold(m), 0)
}

/** 低金顶分筛选所需的 run 最小结构（ArchiveRun 结构上兼容） */
export interface FrontierRunLike {
  seasonId: string
  targetId: string
  score: number
  /** 是否击杀（角色上限只认击杀 run；缺省 = 未提供，killedOnly 时会被跳过） */
  bossKilled?: boolean
  team: ReadonlyArray<LimitedGoldMember>
}

export interface LowGoldFrontierOptions {
  /** 只考虑击杀 run（角色上限 = 实际击杀该 Boss 的队）；缺省 false */
  killedOnly?: boolean
  /** 金数窗口：保留 [最低金, 最低金 + goldWindow]；缺省 0 = 只取最低金 */
  goldWindow?: number
}

/**
 * 低金顶分前沿（「实战对比」·「仅看低金顶分」）：
 * 按房间（seasonId × targetId）分桶 → 顶分 = 该房最高分 → 只在顶分 run 里保留限定金数最低的一批
 * （可开 killedOnly 只认击杀、goldWindow 放宽到最低金 +N）。它们 = 用最少限定金打到该房顶分的队
 * = **角色上限**（理论理想配装是「配装上界」，这些低金顶分队是「该角色/队伍实际能打到的上界」），
 * 供计算器理论理想值对照。返回稳定子集（保持输入序）；调用方自行排序。
 */
export function lowGoldFrontier<T extends FrontierRunLike>(
  runs: T[],
  opts: LowGoldFrontierOptions = {},
): T[] {
  const { killedOnly = false, goldWindow = 0 } = opts
  const window = Math.max(0, goldWindow)
  const byRoom = new Map<string, { maxScore: number; runs: T[] }>()
  for (const r of runs) {
    if (killedOnly && r.bossKilled !== true) continue
    const key = `${r.seasonId}|${r.targetId}`
    let e = byRoom.get(key)
    if (!e) {
      e = { maxScore: r.score, runs: [] }
      byRoom.set(key, e)
    }
    e.runs.push(r)
    if (r.score > e.maxScore) e.maxScore = r.score
  }
  const out: T[] = []
  for (const { maxScore, runs: rs } of byRoom.values()) {
    const top = rs.filter((r) => r.score === maxScore)
    if (!top.length) continue
    const minGold = Math.min(...top.map((r) => runLimitedGold(r.team)))
    const maxGold = minGold + window
    for (const r of top) {
      if (runLimitedGold(r.team) <= maxGold) out.push(r)
    }
  }
  return out
}
