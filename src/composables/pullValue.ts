/**
 * 抽卡价值 · 危局兑现（时间图表页 Chart 5 数据服务）——纯函数，零引擎求值、零 store 依赖。
 *
 * 问题：给定实战归档（zzz-run-archive，每条 = 某玩家某期某关卡的 队伍×分数×击杀×用时），
 * 估计「一张卡自抽取（实装）以来在危局能兑现的分数总和」，并沿抽卡时间轴分级排序。
 *
 * 模型（学术口径，详见 docs/FEATURES_GUIDE.md §4.4）：
 * - **生产函数 + 边际产量**（微观经济学）：危局房间 r 里玩家 i 用 3 张卡产出分数 Y；
 *   卡 c 的价值 = 边际产量 MP_c,r，沿时间轴累计 = 「抽取以来兑现的分数总和」。
 * - **配对差分**（劳动经济学匹配面板 / AKM 双向固定效应的稳健子型）：
 *   同一玩家、同一房间内比较「带卡 c 的最佳分数 − 不带卡 c 的最佳分数」——
 *   玩家技术（作者固定效应）与当期环境（房间固定效应：Boss/buff/期数难度）全部被差分吸收；
 *   跨作者取中位数（robust statistics，抗整队替换的异常放大）。
 *   估计的是 treatment-on-the-treated：玩家**选它上场**时的效果（选择偏正向——玩家倾向在
 *   卡适合的房间用它；对「抽了能兑现多少」的决策口径反而合适）。
 * - **分数删失**（Tobit 口径）：单房间分数上限 65000；带/不带都打满 → 边际如实计 0
 *   （顶部饱和 = 该房间人人可兑现，边际报酬趋零本身即经济学结论）。
 * - **资本积累**（资本理论）：卡在实装日被抽取 = 投资，此后每期产出边际分；
 *   累计兑现 = Σ MP（无折现，「总和」字面口径）；过时/衰减由「近 3 期场均」呈现。
 * - **ROI**（投资学）：每万菲林兑现 = 累计 / (CINEMA_GOLD_FILM / 10000)；
 *   抽卡成本单一事实源 = data/filmEconomy.ts（限定角色本体 1 金 = 15000 菲林期望）。
 * - **分级**（非参数统计）：限定池内（含赠送 S）按累计兑现四分位 → T0/T1/T2/T3；
 *   配对数 < 阈值 → 样本不足（null）；常驻 S / A 级不参与分级（见分层）。
 *
 * 口径：
 * - 房间 = (seasonId, targetId)（一期 3 个普通房 + 0/1 个困难房），按赛季开始日排序；
 *   普通 / 困难（Adversity）都算危局兑现，mode 标注。
 * - 卡在某房间可用 ⇔ 实装日 ≤ 该期结束日（期中实装算该期可用，对齐 teamTimeline 窗口惯例）。
 * - 观测窗口 = 归档覆盖的赛季；更早实装的卡只累计窗口内兑现（页面图上位于观测带左侧）。
 * - 卡未出场 / 无配对样本的房间计 0（「兑现」= 实际上场产生的边际）。
 * - 分层（tier）：限定 S（AGENT_RELEASE_NODE 收录且非常驻）/ 赠送 S（佩洛伊斯 3.0）/
 *   常驻 S（STANDARD_S_AGENT_IDS）/ A 级基线（占位选项，边际常为负 = 与更好卡的机会差，
 *   不参与分级——它们定义的是保留效用/机会成本，不是抽卡投资标的）。
 */
import { AGENT_RELEASE_NODE, VERSION_NODES, nodeIndexOf } from '@/data/versionTimeline'
import { STANDARD_S_AGENT_IDS } from '@/composables/teamCompare'
import { runLimitedGold } from '@/composables/limitedGold'
import { CINEMA_GOLD_FILM } from '@/data/filmEconomy'

/** 危局单房间分数上限（删失点；归档实测 max = 65000） */
export const SCORE_CAP = 65000
/** 参与分级所需最小配对数（作者对数；低于此 = 估计噪声过大） */
export const MIN_PAIRS_FOR_GRADE = 10
/** 「近 3 期」窗口长度 */
export const RECENT_ROOMS = 3
/** 赠送 S（无抽卡成本，ROI 记 null）——佩洛伊斯 3.0 上半赠送（用户口径） */
const FREE_GIFT_AGENT_IDS = new Set(['1551'])
/** AGENT_RELEASE_NODE 唯一 A 级特例（潘引壶，贯穿拐演变路径收录）——归入 A 级基线层 */
const A_RANK_SPECIAL_IDS = new Set(['1421'])

// ========== 输入（run-archive.json 的结构子集；宽接口兼容真实 ArchiveRun） ==========

export interface PvRun {
  id?: string
  seasonId: string
  targetId: string
  mode: string
  score: number
  authorName?: string
  team: ReadonlyArray<{ agentId: string; mindscape?: number; phase?: number }>
}

export interface PvSeasonMeta {
  start: string
  end: string
}

export interface PvRoomMeta {
  bossNameZh?: string
  bossName?: string
}

export interface PullValueInput {
  runs: PvRun[]
  seasons: Record<string, PvSeasonMeta>
  rooms: Record<string, PvRoomMeta>
}

// ========== 输出 ==========

/** 一个危局房间（赛季 × 关卡）的统计快照 */
export interface PvRoom {
  key: string
  seasonId: string
  targetId: string
  /** 赛季开始日 YYYY-MM-DD */
  date: string
  /** 赛季结束日 YYYY-MM-DD（期中实装判定用） */
  endDate: string
  /** 展示标签：MM-DD·Boss名（·困） */
  label: string
  mode: 'normal' | 'adversity'
  bossName: string
  runCount: number
  authorCount: number
  maxScore: number
  medianScore: number
  capCount: number
  /** 效率前沿（用户口径 4）：该期限定金数最低的顶分 run（前 N 名按金数升序取首个满档；
   *  null = 无队伍数据。「低金顶分」= 该期被 65000 打满的投稿里限定金最少的那次——
   *  它代表「理论理想配装 + 玩家上限」在该期的可达边界，用于校准规划器的现实折扣 λ） */
  frontierLowestGold: PvRoomFrontier | null
}

/** 效率前沿条目：低金顶分 run 的队伍与金数 */
export interface PvRoomFrontier {
  /** 顶分（= cap 才入前沿） */
  score: number
  /** 队伍限定金数（本体 1/金 + 影画/精炼各 1/金；非限定成员 0） */
  gold: number
  /** 队伍 agentId */
  team: string[]
}

/** 一张卡在一个房间的兑现明细 */
export interface PvCardRoomEffect {
  roomKey: string
  /** 配对差分中位数（未出场 / 无配对 / 实装前 = 0） */
  effect: number
  /** 有效配对数（同房间 带卡&不带卡 都有投稿的作者数） */
  pairs: number
  /** 该房间是否上场（实装后） */
  appeared: boolean
  /** 是否在该房间顶分队伍里（含并列顶分；Shapley 式「不可替代性」的在场口径） */
  frontier: boolean
}

export type PvCardTier = 'limited' | 'freeGift' | 'standard' | 'aRank'
export type PvGrade = 'T0' | 'T1' | 'T2' | 'T3'

export interface PvCardValue {
  agentId: string
  tier: PvCardTier
  releaseDate: string | null
  /** 实装后首个房间下标（-1 = 观测窗口内无可用期，如晚于归档末期的卡） */
  firstRoomIndex: number
  /** 实装以来可观测房间数（含未出场计 0 的） */
  observableRooms: number
  /** 上场房间数（实装后） */
  roomsAppeared: number
  /** 顶分在场房间数（实装后） */
  frontierRooms: number
  totalPairs: number
  /** 累计兑现分 = Σ 实装以来各房配对差分（未出场计 0） */
  cumulative: number
  /** 场均兑现（按可观测房间数摊平，跨不同实装时点的卡可比） */
  avgPerRoom: number
  /** 近 3 期场均（含未出场计 0；不足 3 期按实际期数） */
  recentAvg: number
  /** 每万菲林兑现（赠送卡 = null） */
  roiPer10kFilm: number | null
  /** 价值分级（限定池四分位；非限定 / 样本不足 = null） */
  grade: PvGrade | null
  /** 逐房间兑现明细（与 result.rooms 全轴对齐，实装前为 0） */
  roomEffects: PvCardRoomEffect[]
}

export interface PullValueResult {
  /** 房间时间轴（按日期升序，只含有投稿的房间） */
  rooms: PvRoom[]
  /** 全部卡（含从未出场的限定 S；按累计兑现降序） */
  cards: PvCardValue[]
  window: { firstDate: string; lastDate: string; seasonCount: number; runCount: number }
}

// ========== 工具 ==========

function median(sortedAsc: number[]): number {
  const n = sortedAsc.length
  if (n === 0) return 0
  const mid = n >> 1
  return n % 2 === 1 ? sortedAsc[mid] : (sortedAsc[mid - 1] + sortedAsc[mid]) / 2
}

/** 最近邻位分位数（升序数组；小样本分级用，避免插值产生无观测的阈值） */
function quantileAsc(sortedAsc: number[], q: number): number {
  if (sortedAsc.length === 0) return 0
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.round(q * (sortedAsc.length - 1))))
  return sortedAsc[idx]
}

/** 卡的抽卡分层（单一事实源：versionTimeline 收录表 + 标准常驻 S 名单 + 两个特例集合） */
export function pvTierOf(agentId: string): PvCardTier {
  if (FREE_GIFT_AGENT_IDS.has(agentId)) return 'freeGift'
  if (!AGENT_RELEASE_NODE[agentId] || A_RANK_SPECIAL_IDS.has(agentId)) return 'aRank'
  if (STANDARD_S_AGENT_IDS.has(agentId)) return 'standard'
  return 'limited'
}

/** 卡的实装日期（AGENT_RELEASE_NODE → 版本节点日期；未收录 = null） */
export function pvReleaseDateOf(agentId: string): string | null {
  const node = AGENT_RELEASE_NODE[agentId]
  if (!node) return null
  return VERSION_NODES[nodeIndexOf(node)]?.date ?? null
}

// ========== 主流程 ==========

export function computePullValue(input: PullValueInput): PullValueResult {
  const { runs, seasons, rooms } = input

  // ---- 1. 房间聚合与排序 ----
  const seasonDate = (sid: string) => (seasons[sid]?.start ?? '').slice(0, 10)
  const seasonEnd = (sid: string) => (seasons[sid]?.end ?? '').slice(0, 10)

  const roomRuns = new Map<string, { seasonId: string; targetId: string; runs: PvRun[] }>()
  for (const r of runs) {
    const key = `${r.seasonId}|${r.targetId}`
    let e = roomRuns.get(key)
    if (!e) {
      e = { seasonId: r.seasonId, targetId: r.targetId, runs: [] }
      roomRuns.set(key, e)
    }
    e.runs.push(r)
  }
  const roomList = [...roomRuns.values()].sort(
    (a, b) => seasonDate(a.seasonId).localeCompare(seasonDate(b.seasonId)) || a.targetId.localeCompare(b.targetId),
  )

  // ---- 2. 逐房间：配对差分 + 顶分在场 ----
  interface RoomComputed extends PvRoom {
    effectByCard: Map<string, { effect: number; pairs: number }>
    appearedCards: Set<string>
    frontierCards: Set<string>
  }
  const computedRooms: RoomComputed[] = roomList.map(({ seasonId, targetId, runs: rs }) => {
    const date = seasonDate(seasonId)
    const endDate = seasonEnd(seasonId)
    const mode: PvRoom['mode'] = rs.some(r => r.mode.includes('Adversity')) ? 'adversity' : 'normal'
    const bossName = rooms[targetId]?.bossNameZh ?? rooms[targetId]?.bossName ?? targetId
    const scores = rs.map(r => r.score).sort((a, b) => a - b)
    const maxScore = scores.length ? scores[scores.length - 1] : 0

    // 作者分组（无名投稿各自成组 = 无配对可能）
    const byAuthor = new Map<string, PvRun[]>()
    rs.forEach((r, i) => {
      const a = r.authorName?.trim() || `#anon-${r.id ?? i}`
      const list = byAuthor.get(a) ?? []
      list.push(r)
      byAuthor.set(a, list)
    })

    // 配对差分：同作者 带卡最佳分 − 不带卡最佳分；跨作者取中位数
    const deltasByCard = new Map<string, number[]>()
    for (const ars of byAuthor.values()) {
      const teamSets = ars.map(r => new Set(r.team.map(m => m.agentId).filter(Boolean)))
      const cards = new Set<string>()
      for (const t of teamSets) for (const c of t) cards.add(c)
      for (const c of cards) {
        const withS: number[] = []
        const withoutS: number[] = []
        ars.forEach((r, i) => (teamSets[i].has(c) ? withS : withoutS).push(r.score))
        if (withS.length > 0 && withoutS.length > 0) {
          const arr = deltasByCard.get(c) ?? []
          arr.push(Math.max(...withS) - Math.max(...withoutS))
          deltasByCard.set(c, arr)
        }
      }
    }
    const effectByCard = new Map<string, { effect: number; pairs: number }>()
    for (const [c, deltas] of deltasByCard) {
      effectByCard.set(c, { effect: median(deltas.slice().sort((a, b) => a - b)), pairs: deltas.length })
    }

    // 效率前沿（用户口径 4）：满档（= cap）投稿里限定金数最低的 run。
    // 金数口径单一事实源 = limitedGold.runLimitedGold（限定 S 本体 1 + 影画 + 专武精炼−1；常驻/A 不计）。
    let frontierLowestGold: PvRoomFrontier | null = null
    for (const r of rs) {
      if (r.score < SCORE_CAP) continue
      const gold = runLimitedGold(r.team)
      if (!frontierLowestGold || gold < frontierLowestGold.gold) {
        frontierLowestGold = {
          score: r.score,
          gold,
          team: r.team.map(m => m.agentId).filter(Boolean),
        }
      }
    }

    // 顶分在场：房间最高分队伍的成员（含并列）
    const appearedCards = new Set<string>()
    const frontierCards = new Set<string>()
    for (const r of rs) {
      for (const m of r.team) {
        if (!m.agentId) continue
        appearedCards.add(m.agentId)
        if (r.score === maxScore) frontierCards.add(m.agentId)
      }
    }

    return {
      key: `${seasonId}|${targetId}`,
      seasonId,
      targetId,
      date,
      endDate,
      label: `${date.slice(5)}·${bossName}${mode === 'adversity' ? '·困' : ''}`,
      mode,
      bossName,
      runCount: rs.length,
      authorCount: byAuthor.size,
      maxScore,
      medianScore: median(scores),
      capCount: scores.filter(s => s >= SCORE_CAP).length,
      frontierLowestGold,
      effectByCard,
      appearedCards,
      frontierCards,
    }
  })

  // ---- 3. 卡清单（归档出场 ∪ 全部可抽 S；从未出场的限定 S 也列出 = 兑现 0） ----
  const cardIds = new Set<string>(Object.keys(AGENT_RELEASE_NODE))
  for (const room of computedRooms) for (const c of room.appearedCards) cardIds.add(c)

  // ---- 4. 逐卡累计（实装门槛 = 该期结束日 ≥ 实装日；期中实装算该期可用） ----
  const cards: PvCardValue[] = []
  for (const agentId of cardIds) {
    const tier = pvTierOf(agentId)
    const releaseDate = pvReleaseDateOf(agentId)
    let firstRoomIndex = -1
    let firstAppearance = -1
    computedRooms.forEach((room, i) => {
      const usable = releaseDate ? room.endDate >= releaseDate : true
      if (usable && firstRoomIndex < 0) firstRoomIndex = i
      if (room.appearedCards.has(agentId) && firstAppearance < 0) firstAppearance = i
    })
    // 无实装日期（A 级）从首次出场起算；观测窗口内从未可用（晚于归档末期）则全 0
    if (!releaseDate && firstAppearance >= 0) firstRoomIndex = firstAppearance
    if (releaseDate && firstRoomIndex < 0) firstRoomIndex = computedRooms.length // 全程不可用 → 空观测

    const roomEffects: PvCardRoomEffect[] = computedRooms.map((room, i) => {
      const usable = i >= firstRoomIndex && firstRoomIndex < computedRooms.length
      const eff = usable ? room.effectByCard.get(agentId) : undefined
      return {
        roomKey: room.key,
        effect: eff?.effect ?? 0,
        pairs: eff?.pairs ?? 0,
        appeared: usable && room.appearedCards.has(agentId),
        frontier: usable && room.frontierCards.has(agentId),
      }
    })
    const observableRooms = Math.max(0, computedRooms.length - firstRoomIndex)
    const cumulative = roomEffects.reduce((s, e) => s + e.effect, 0)
    // 近 3 期 = 实装后区间的末尾若干房间（避免混入实装前的非观测期）
    const observableEffects = firstRoomIndex < computedRooms.length ? roomEffects.slice(firstRoomIndex) : []
    const recentSlice = observableEffects.slice(-Math.min(RECENT_ROOMS, observableRooms))
    cards.push({
      agentId,
      tier,
      releaseDate,
      firstRoomIndex,
      observableRooms,
      roomsAppeared: roomEffects.filter(e => e.appeared).length,
      frontierRooms: roomEffects.filter(e => e.frontier).length,
      totalPairs: roomEffects.reduce((s, e) => s + e.pairs, 0),
      cumulative,
      avgPerRoom: observableRooms > 0 ? cumulative / observableRooms : 0,
      recentAvg: recentSlice.length > 0 ? recentSlice.reduce((s, e) => s + e.effect, 0) / recentSlice.length : 0,      roiPer10kFilm: tier === 'freeGift' ? null : cumulative / (CINEMA_GOLD_FILM / 10000),
      grade: null,
      roomEffects,
    })
  }

  // ---- 5. 分级：限定池（含赠送）内按累计四分位 ----
  const qualified = cards.filter(c => (c.tier === 'limited' || c.tier === 'freeGift') && c.totalPairs >= MIN_PAIRS_FOR_GRADE)
  const cumAsc = qualified.map(c => c.cumulative).sort((a, b) => a - b)
  if (cumAsc.length > 0) {
    const q75 = quantileAsc(cumAsc, 0.75)
    const q50 = quantileAsc(cumAsc, 0.5)
    const q25 = quantileAsc(cumAsc, 0.25)
    for (const c of qualified) {
      c.grade = c.cumulative >= q75 ? 'T0' : c.cumulative >= q50 ? 'T1' : c.cumulative >= q25 ? 'T2' : 'T3'
    }
  }

  cards.sort((a, b) => b.cumulative - a.cumulative)

  const seasonIds = new Set(computedRooms.map(r => r.seasonId))
  return {
    // 剥离内部计算字段（effectByCard/appearedCards/frontierCards），只暴露 PvRoom 展示面
    rooms: computedRooms.map(({ effectByCard: _ebc, appearedCards: _ac, frontierCards: _fc, ...rest }) => rest),
    cards,
    window: {
      firstDate: computedRooms[0]?.date ?? '',
      lastDate: computedRooms[computedRooms.length - 1]?.date ?? '',
      seasonCount: seasonIds.size,
      runCount: runs.length,
    },
  }
}
