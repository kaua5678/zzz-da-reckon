/**
 * 限定金数（单一事实源）。金数与菲林是两套单位，不要互相折算：
 * - 金数：限定 S 角色本体 1 + 影画；限定专武本体也是 1，再加精炼 (phase−1)。满配 = 12。
 * - 菲林：角色金 15000、音擎金 10000（`data/filmEconomy.ts`）。专武金数同为 1，期望抽数更低。
 * 音擎金只在 `weaponId` 能认出是限定 S 音擎时计入。没有音擎身份 = 没抽专武，不计音擎金
 * （常驻/A 级音擎的精炼以前被 phase 误计，已去掉）。
 * 常驻 S 角色与未收录角色（AGENT_RELEASE_NODE 无条目，含四星）的角色本体不计金；
 * 他们若穿着限定专武，音擎金仍计（有金就是金）。
 *
 * 归档与计算器共用这一份公式（memberLimitedGold），改口径只改这里：
 * - 归档侧经 runLimitedGold：pullValue（效率前沿 frontierLowestGold）、charIncrement（队伍基底 extractBaseTeams 的金数窗）、
 *   实战对比页 RunArchivePage（「仅看低金顶分」筛选）
 * - 计算器侧经 teamCompare.teamGoldOf：配置页「预设金数」、基础金 baseGoldOf（队伍对比）/ baseGoldOfTeam（时间线）
 *   （r734 前这三处各写一份同一公式）
 */
import { AGENT_RELEASE_NODE, A_RANK_RELEASE_SPECIAL_IDS } from '@/data/versionTimeline'
import { STANDARD_S_AGENT_IDS, STANDARD_S_WENGINE_IDS } from '@/data/standardMultiplierTable'

export interface LimitedGoldMember {
  agentId: string
  mindscape?: number
  /** 音擎精炼 1–5。只在 weaponId 为限定 S 音擎时计入。 */
  phase?: number
  /** 归档音擎 id。缺省 = 没有可识别的限定专武，不计音擎金。 */
  weaponId?: string
}

/**
 * 限定 S 音擎（占 1 金本体）。S 音擎 id 均为 141xx（catalog 2026-09：49 把 S 全是 141，
 * 没有任何非 S 以 141 开头）；常驻 6 把除外。不依赖 catalog store，归档统计可直接用。
 */
export function isLimitedSWengineId(id: string | undefined | null): boolean {
  if (!id) return false
  return id.startsWith('141') && !STANDARD_S_WENGINE_IDS.has(id)
}

/**
 * 限定 S 角色（占 1 金本体 + 影画）= 时间线收录 ∧ 非常驻 S ∧ 非 A 级特例。不依赖 catalog store。
 * CC-270：修前只看「收录 ∧ 非常驻」，把收录表里的 A 级特例潘引壶算成限定金（归档 31 条潘引壶 M6 run 各多记 7 金）；
 * teamCompare.isLimitedAgent 另按 catalog 稀有度判定、恰好排除了她——两套定义分叉，现统一到本函数。
 */
export function isLimitedSAgentId(id: string | undefined | null): boolean {
  if (!id) return false
  return !!AGENT_RELEASE_NODE[id] && !STANDARD_S_AGENT_IDS.has(id) && !A_RANK_RELEASE_SPECIAL_IDS.has(id)
}

/** 单个成员的限定金数（常驻 S / A 级特例 / 未收录 = 0） */
export function memberLimitedGold(m: LimitedGoldMember): number {
  let gold = 0
  if (isLimitedSAgentId(m.agentId)) {
    gold += 1 + (m.mindscape ?? 0)
  }
  if (isLimitedSWengineId(m.weaponId)) {
    const phase = Number.isFinite(m.phase) ? Math.max(1, Math.floor(m.phase as number)) : 1
    gold += phase
  }
  return gold
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
