/**
 * 角色分数增量（「角色兑现曲线」页数据服务）——队伍基底提取 + 增量定义（纯函数部分）。
 *
 * 用户口径（2026-08-28）：
 * - **队伍基底 = 归档每期危局「最低限金到（最低限金+4）的强队，其他全部无视**：
 *   按 Boss 聚合归档 run → 强队 = 分数 ≥ 该 Boss 顶分 ×0.9 → 金数窗 = [minGold, minGold+4]
 *   → 按队伍构成去重取顶分 run（金数 = 限定S本体1+影画+专武精炼−1，同 pullValue 效率前沿口径）。
 *   基底是「meta 效率前沿」的队伍清单——规划/增量的求值域只有这些队，求值量从
 *   C(池,3)≈数千 砍到每 Boss 封顶 N 队。
 * - **每期为账号带来的分数增量**（展示主体）：
 *   期增量(c) = 账号分(全基底可组队) − 账号分(禁用含 c 的队) ≥ 0。
 *   全基底 = 满配 meta 账号口径：禁卡只改变「哪些队可组」，队伍伤害本身与持有集无关
 *   → **一次求值全卡出**（每队每期只算一次引擎伤害；增量是缓存分数上的纯集合运算）。
 *   卢西娅式故事由此精确呈现：禁她 → 命破房被迫退回潘引壶队，分差 = 她的抽取价值；
 *   比利式饱和同样：账号已有命破体系时，禁他不痛不痒。
 * - 账号分 = 一期 3 房（每期实际 Boss 数由期轴定）× 不重叠 3 人队（9 人约束）的最优 DFS。
 * - 分数 = scoreForDamageRatio(引擎伤害/当期Boss血量)（伤害分 0~60000 分段线性；操作分是附加分、与强度无关，已剔除）。
 *
 * 引擎部分（快照/求值/赋值）在 computeIncrementPass（同文件尾部，vitest 里假 oracle 验证）。
 */
import { runLimitedGold } from '@/composables/limitedGold'

// ========== 队伍基底提取 ==========

/** 归档 run 的最小结构（与 run-archive.json 对齐） */
export interface IncRun {
  seasonId: string
  targetId: string
  mode: string
  score: number
  team: ReadonlyArray<{ agentId: string; mindscape?: number; phase?: number; weaponId?: string }>
}

/** 房间 →（Boss 预设 id, 期 id）的映射（调用方用 runArchiveImport.matchBossPreset + 日期窗构造） */
export type RoomMeta = Record<string, { bossId: string; periodId: string }>

/** 基底里的一支队：成员快照（含命座/音擎/精炼——按投稿原样求值，= 该队的典型前沿投入） */
export interface BaseTeamMember {
  agentId: string
  mindscape: number
  weaponId: string | null
  phase: number
}

export interface BaseTeam {
  /** Boss 预设 id（该队只在打这个 Boss 的房间里作候选） */
  bossId: string
  /** 成员（按归档槽位序） */
  members: [BaseTeamMember, BaseTeamMember, BaseTeamMember]
  /** 限定金数（本体 1 + 影画 + 专武精炼−1；常驻/A 计 0） */
  gold: number
  /** 该构成在归档里的最高分（溯源展示用） */
  bestScore: number
}

/** 队伍构成键（去重用：成员 id 集合 + 各成员档位的签名） */
function teamKey(r: IncRun): string {
  return r.team
    .map(m => `${m.agentId}:${m.mindscape ?? 0}:${m.phase ?? 1}`)
    .sort()
    .join('|')
}

/**
 * 提取队伍基底：按（期 × Boss）分桶（期 = 归档房间所属期；跨期不共用——7 月的 meta 队
 * 不该出现在 5 月的期里，时代错置会虚增早期账号分）→ 强队（≥ 该桶顶分 90%）→
 * 金数窗 [min, min+4] → 按构成去重保留顶分 run → 每桶封顶 maxPerBoss 队。
 * @param runs 归档全部 run（默认只普通模式；Adversity 由 includeAdversity 控制）
 * @param roomMeta 房间 →（bossId, periodId）；无映射的房间跳过
 * @returns Map<`${periodId}|${bossId}`, BaseTeam[]>
 * 默认每桶封顶 3 队（实测 30 桶 × 6 = 140 队 → 引擎求值 40-80s（慢机）；
 * 封 3 = 84 队且顶分梯队前 3 已覆盖「最强队 + 下位替代队」的增量对比需要）
 */
export function extractBaseTeams(
  runs: IncRun[],
  roomMeta: RoomMeta,
  opts: { maxPerBoss?: number; goldWindow?: number; includeAdversity?: boolean } = {},
): Map<string, BaseTeam[]> {
  const maxPerBoss = opts.maxPerBoss ?? 3
  const goldWindow = opts.goldWindow ?? 4
  const byBucket = new Map<string, IncRun[]>()
  for (const r of runs) {
    if (!opts.includeAdversity && r.mode.includes('Adversity')) continue
    const meta = roomMeta[r.targetId]
    if (!meta) continue
    const key = `${meta.periodId}|${meta.bossId}`
    const arr = byBucket.get(key) ?? []
    arr.push(r)
    byBucket.set(key, arr)
  }
  const out = new Map<string, BaseTeam[]>()
  for (const [key, bucketRuns] of byBucket) {
    const maxScore = Math.max(...bucketRuns.map(r => r.score))
    const strong = bucketRuns.filter(r => r.score >= maxScore * 0.9)
    if (strong.length === 0) continue
    const minGold = Math.min(...strong.map((r) => runLimitedGold(r.team)))
    const inWindow = strong.filter((r) => runLimitedGold(r.team) <= minGold + goldWindow)
    // 按构成去重，保留顶分 run
    const bestByTeam = new Map<string, IncRun>()
    for (const r of inWindow) {
      const key2 = teamKey(r)
      const prev = bestByTeam.get(key2)
      if (!prev || r.score > prev.score) bestByTeam.set(key2, r)
    }
    const teams = [...bestByTeam.values()]
      .map((r): BaseTeam => ({
        bossId: key.split('|')[1],
        members: r.team.slice(0, 3).map(m => ({
          agentId: m.agentId,
          mindscape: m.mindscape ?? 0,
          weaponId: m.weaponId ?? null,
          phase: m.phase ?? 1,
        })) as [BaseTeamMember, BaseTeamMember, BaseTeamMember],
        gold: runLimitedGold(r.team),
        bestScore: r.score,
      }))
      .filter(t => t.members.length === 3 && t.members.every(m => m.agentId))
      .sort((a, b) => b.bestScore - a.bestScore)
      .slice(0, maxPerBoss)
    if (teams.length > 0) out.set(key, teams)
  }
  return out
}

// ========== 期轴与增量定义（纯逻辑，可注入假分数） ==========

/** 期轴房间（引擎装配需要的完整 Boss 引用由调用方侧携带；这里只留结算必需字段） */
export interface IncPeriodRoom {
  bossId: string
  bossName: string
  hp: number
  /** 该房间基底队求出的分数（注入或引擎填充） */
  scores: Array<{ team: BaseTeam; score: number }>
}

export interface IncPeriod {
  id: string
  label: string
  date: string
  rooms: IncPeriodRoom[]
}

/** 3 房不重叠 DFS（与 pullPlanner 同思路；基底候选少，直接全量分支） */
export function assignRooms(rooms: IncPeriodRoom[]): { total: number; picks: Array<{ team: BaseTeam | null; score: number }> } {
  let bestTotal = -1
  let bestPicks: Array<{ team: BaseTeam | null; score: number }> | null = null
  const used = new Set<string>()
  const chosen: Array<{ team: BaseTeam; score: number } | null> = rooms.map(() => null)
  const dfs = (i: number, score: number) => {
    if (i === rooms.length) {
      if (score > bestTotal) {
        bestTotal = score
        bestPicks = chosen.map(c => c ? { team: c.team, score: c.score } : { team: null, score: 0 })
      }
      return
    }
    for (const c of rooms[i].scores) {
      const members = c.team.members.map(m => m.agentId)
      if (members.some(m => used.has(m))) continue
      members.forEach(m => used.add(m))
      chosen[i] = { team: c.team, score: c.score }
      dfs(i + 1, score + c.score)
      chosen[i] = null
      members.forEach(m => used.delete(m))
    }
    // 允许该房间不组队（早期数据不全 / 全被禁用时）——分数 0
    chosen[i] = null
    dfs(i + 1, score)
  }
  dfs(0, 0)
  return {
    total: Math.max(0, bestTotal),
    picks: bestPicks ?? rooms.map(() => ({ team: null, score: 0 })),
  }
}

export interface CardPeriodIncrement {
  periodId: string
  date: string
  label: string
  /** 期增量 = 账号分(全基底) − 账号分(禁含该卡的队) ≥ 0 */
  increment: number
  accountScore: number
  bannedScore: number
  /** 全基底最优 3 队（展示） */
  picks: Array<{ bossName: string; team: BaseTeam | null; score: number }>
  /** 禁卡后最优 3 队（展示替代差——卢西娅→潘引壶 一眼可见） */
  bannedPicks: Array<{ bossName: string; team: BaseTeam | null; score: number }>
}

/**
 * 单期、单卡的增量（纯集合运算）：scores 已就绪时调用。
 * @param agentId 目标卡
 */
export function incrementForCard(period: IncPeriod, agentId: string): CardPeriodIncrement {
  const full = assignRooms(period.rooms)
  const bannedRooms = period.rooms.map(r => ({
    ...r,
    scores: r.scores.filter(c => !c.team.members.some(m => m.agentId === agentId)),
  }))
  const banned = assignRooms(bannedRooms)
  return {
    periodId: period.id,
    date: period.date,
    label: period.label,
    increment: Math.max(0, full.total - banned.total),
    accountScore: full.total,
    bannedScore: banned.total,
    picks: full.picks.map((p, i) => ({ bossName: period.rooms[i].bossName, team: p.team, score: p.score })),
    bannedPicks: banned.picks.map((p, i) => ({ bossName: period.rooms[i].bossName, team: p.team, score: p.score })),
  }
}

// ========== 引擎求值层（快照/部署/伤害→分数；基底队少 = 全量也秒级） ==========

import { useConfigStore, getInteractionDefaults, roleInteractionBaseline } from '@/stores/config'
import { useCatalogStore } from '@/stores/catalog'
import { buildPlannerPeriods, plannerTestServerVersions } from '@/composables/pullPlannerEngine'
import { scoreForDamageRatio } from '@/core/deadlyAssaultScore'
import type { BossPreset, PhaseView } from '@/types/bossPreset'
import type { useResourceCalc } from '@/composables/useResourceCalc'
import type { ArchiveRoom } from '@/composables/runArchiveImport'

type Calc = ReturnType<typeof useResourceCalc>

/** 归档房间表（run-archive.json rooms：ArchiveRoom + seasonStart） */
export type ArchiveRoomMap = Record<string, ArchiveRoom & { seasonStart?: string }>

export interface IncrementPassOptions {
  calc: Calc
  /** 全部 Boss 预设（期轴 + 部署求值） */
  bosses: BossPreset[]
  /** 期视图（关卡固有 buff；有数据才应用） */
  periodViews: PhaseView[]
  /** 归档（runs + rooms） */
  runs: IncRun[]
  rooms: ArchiveRoomMap
  onProgress?: (p: { pct: number; text: string }) => void
}

export interface IncrementPassResult {
  /** 有基底队的期（时间升序；分数已由引擎填充） */
  periods: IncPeriod[]
  /** 各期各房间的基底队（UI 溯源展示） */
  stats: { baseTeams: number; evaluations: number; durationMs: number }
}

/** 赛季开始（UTC）→ 期轴下标：取 begin（京时 04:00）≤ 赛季开始 的最晚一期（时区对齐） */
function periodIndexOfSeason(periods: Array<{ date: string }>, seasonStartUtc: string): number {
  const startMs = Date.parse(seasonStartUtc)
  if (Number.isNaN(startMs)) return -1
  let best = -1
  for (let i = 0; i < periods.length; i++) {
    const beginMs = Date.parse(`${periods[i].date}T04:00:00+08:00`)
    if (!Number.isNaN(beginMs) && beginMs <= startMs) best = i
  }
  return best
}

/**
 * 增量数据总装配：基底提取 → 引擎逐（期 × 房 × 队）求值 → IncPeriod[]。
 * 求值量 = Σ 每桶 ≤6 队（≈ 全归档 100~150 次引擎求值，一次 <20s，页面缓存复用）；
 * 卡片增量 = 缓存分数上的纯集合运算（零引擎），切卡即算。
 */
export async function computeIncrementPass(opts: IncrementPassOptions): Promise<IncrementPassResult> {
  const configStore = useConfigStore()
  const snap = JSON.parse(JSON.stringify({
    team: configStore.team,
    enemy: configStore.enemy,
    appliedBoss: configStore.appliedBoss,
    stunAxes: configStore.stunAxes,
    stunAxisPlans: configStore.stunAxisPlans,
    useStunAxis: configStore.useStunAxis,
    globalBuffs: configStore.globalBuffs,
  })) as never
  const t0 = Date.now()
  const report = (pct: number, text: string) => opts.onProgress?.({ pct, text })
  try {
    // 1. 期轴（boss-presets defense 聚合；测试服剔除）
    const periods = buildPlannerPeriods(opts.bosses, { testServerVersions: plannerTestServerVersions() })
    // 2. 房间 →（bossId, periodId）
    const { matchBossPreset } = await import('@/composables/runArchiveImport')
    const roomMeta: RoomMeta = {}
    for (const [targetId, room] of Object.entries(opts.rooms)) {
      const match = matchBossPreset(room, opts.bosses, room.seasonStart)
      if (!match) continue
      const pIdx = room.seasonStart ? periodIndexOfSeason(periods, room.seasonStart) : -1
      if (pIdx < 0) continue
      roomMeta[targetId] = { bossId: match.presetId, periodId: periods[pIdx].id }
    }
    // 3. 基底提取（强队 90% + 金数窗 [min, min+4] + 每桶 ≤6 队去重）
    const base = extractBaseTeams(opts.runs, roomMeta)
    // 4. 引擎求值：只对有基底队的（期 × 房）算
    const tasks: Array<{ period: (typeof periods)[number]; room: (typeof periods)[number]['bosses'][number]; teams: BaseTeam[] }> = []
    for (const period of periods) {
      for (const room of period.bosses) {
        const teams = base.get(`${period.id}|${room.bossId}`) ?? []
        if (teams.length > 0) tasks.push({ period, room, teams })
      }
    }
    const scoreByKey = new Map<string, number>()
    const yieldNow = () => new Promise(r => setTimeout(r, 0))
    const totalTasks = tasks.reduce((s, t) => s + t.teams.length, 0)
    let done = 0
    for (const task of tasks) {
      // Boss 无该期相位 → 房间不可结算（防御：resolveBossApply 静默跳过会用上一个
      // 房间的敌人数据求值出垃圾分；此处显式跳过，房间计 0 分 = 无数据）
      const preset = opts.bosses.find(b => b.id === task.room.bossId)
      const phase = preset?.phases.find(p => p.phaseId === task.period.id)
      if (!preset || !phase) continue
      // Boss 期相位一次应用（同桶所有队共用敌人数据）
      configStore.applyBossPreset({ id: preset.id }, phase, preset.monster, preset.defaults)
      for (const team of task.teams) {
        applyBaseTeamLite(configStore, team)
        const damage = opts.calc.teamTotalDamage.value
        const hp = task.room.hp > 0 ? task.room.hp : 1
        scoreByKey.set(`${task.period.id}|${task.room.bossId}|${teamKeyOf(team)}`, scoreForDamageRatio(damage / hp))
        done++
        if (done % 4 === 0) {
          report(done / (totalTasks || 1), `基底求值 ${done}/${totalTasks} 队…`)
          await yieldNow()
        }
      }
    }
    // 5. 装配 IncPeriod[]（只留求值成功的队 → 非空房间 → 非空期）
    const incPeriods: IncPeriod[] = periods
      .map(p => ({
        id: p.id,
        label: p.label,
        date: p.date,
        rooms: p.bosses
          .map(r => ({
            bossId: r.bossId,
            bossName: r.bossName,
            hp: r.hp,
            scores: (base.get(`${p.id}|${r.bossId}`) ?? [])
              .map(team => ({ team, score: scoreByKey.get(`${p.id}|${r.bossId}|${teamKeyOf(team)}`) }))
              .filter(x => x.score != null) as Array<{ team: BaseTeam; score: number }>,
          }))
          .filter(r => r.scores.length > 0),
      }))
      .filter(p => p.rooms.length > 0)
    const baseTeamCount = tasks.reduce((s, t) => s + t.teams.length, 0)
    report(1, `完成：${incPeriods.length} 期 · ${baseTeamCount} 支基底队`)
    return { periods: incPeriods, stats: { baseTeams: baseTeamCount, evaluations: baseTeamCount, durationMs: Date.now() - t0 } }
  } finally {
    // 现场恢复（同 teamTimeline / pullPlannerEngine）
    const s = snap as { team: unknown[]; enemy: unknown; appliedBoss: unknown; stunAxes: unknown[]; stunAxisPlans: unknown[]; useStunAxis: boolean; globalBuffs: unknown[] }
    configStore.team.splice(0, configStore.team.length, ...(s.team as never[]))
    configStore.setEnemy(s.enemy as never)
    configStore.appliedBoss = s.appliedBoss as never
    configStore.stunAxes.splice(0, configStore.stunAxes.length, ...(s.stunAxes as never[]))
    configStore.stunAxisPlans.splice(0, configStore.stunAxisPlans.length, ...(s.stunAxisPlans as never[]))
    configStore.useStunAxis = s.useStunAxis
    configStore.globalBuffs.splice(0, configStore.globalBuffs.length, ...(s.globalBuffs as never[]))
  }
}

function teamKeyOf(team: BaseTeam): string {
  return team.members.map(m => `${m.agentId}:${m.mindscape}:${m.phase}`).sort().join('|')
}

/**
 * 基底队轻量装配：setAgent 兜底（专属音擎优先/兜底套装/5号位主词条）+ 命座/精炼 +
 * 投稿音擎（有则用）+ 交互基准（角色专属默认 > 职业基准 roleInteractionBaseline：支援/防护 0 交互，
 * 其余弹刀6/闪反10；快支3/连携1）。
 * 与 applyDeployConfig 的差别 = 跳过 applyTeamPreset 的推荐配装与融合贪心副词条
 * 优化器（逐队 3 槽 × 优化器迭代是慢机 40-80s 的主因；同 Chart 1 轻量档口径——
 * 所有候选队同向偏低，增量对比的相对结论不受影响）。并清掉上一队残留的 4/6 号主词条
 * 与副词条分配（setAgent 不重置它们）。
 */
function applyBaseTeamLite(
  configStore: ReturnType<typeof useConfigStore>,
  team: BaseTeam,
): void {
  for (let s = 0; s < 3; s++) configStore.setAgent(s, team.members[s].agentId, { defer: true })
  configStore.syncTeammateBuffsFromTeam()
  for (let s = 0; s < 3; s++) {
    const m = team.members[s]
    const char = configStore.team[s]
    if (!char) continue
    // 清残留（跨队泄漏防护，同 teamTimeline.applyTeamToStore）
    const m5 = char.driveDisc.mainStats[5]
    char.driveDisc.mainStats = { 5: m5 } as typeof char.driveDisc.mainStats
    char.driveDisc.subStatAllocation = {}
    configStore.setCinemaLevel(s, m.mindscape)
    configStore.setWEngineModLevel(s, m.phase)
    if (m.weaponId) configStore.setWEngine(s, m.weaponId)
    const defs = getInteractionDefaults(m.agentId)
    const hasCustom = defs.parry > 0 || defs.dodge > 0 || defs.block > 0 || defs.dual > 0
    // 职业基准单一事实源（roleInteractionBaseline）：支援/防护 0 交互（辅助不上场打弹刀/闪反），其余弹刀6+闪反10
    const base = roleInteractionBaseline(useCatalogStore().getAgent(m.agentId)?.specialty)
    configStore.setParryCount(s, hasCustom ? defs.parry : base.parry)
    configStore.setDodgeCounterCount(s, hasCustom ? defs.dodge : base.dodge)
    configStore.setBlockCount(s, hasCustom ? defs.block : base.block)
    configStore.setDualCounterCount(s, hasCustom ? defs.dual : base.dual)
    configStore.setQuickAssistCount(s, 3)
    configStore.setChainCountPerStun(s, 1)
  }
}

// ========== 卡片增量汇总（纯集合运算，零引擎） ==========

export interface CardIncrementSummary {
  agentId: string
  /** 实装日（AGENT_RELEASE_NODE；null = 未收录卡） */
  releaseDate: string | null
  /** 与 periods 同序；实装前 = null（展示「—」，不进累计） */
  perPeriod: Array<CardPeriodIncrement | null>
  /** 累计增量 = Σ 实装后期增量 */
  total: number
}

/** 单卡增量曲线：periods 为 computeIncrementPass 产物（时间升序） */
export function computeCardIncrements(
  periods: IncPeriod[],
  agentId: string,
  releaseDate: string | null,
): CardIncrementSummary {
  const perPeriod = periods.map(p => {
    if (releaseDate && p.date < releaseDate) return null
    return incrementForCard(p, agentId)
  })
  return {
    agentId,
    releaseDate,
    perPeriod,
    total: perPeriod.reduce((s, x) => s + (x?.increment ?? 0), 0),
  }
}

/** 全卡累计增量排名（一次算全卡；卡片增量 = 缓存分数上的集合运算，毫秒级） */
export function computeAllCardTotals(
  periods: IncPeriod[],
  cards: Array<{ agentId: string; releaseDate: string | null }>,
): Array<{ agentId: string; total: number; periodsActive: number }> {
  return cards
    .map(({ agentId, releaseDate }) => {
      const inc = computeCardIncrements(periods, agentId, releaseDate)
      const active = inc.perPeriod.filter(x => x != null && x.increment > 0).length
      return { agentId, total: inc.total, periodsActive: active }
    })
    .sort((a, b) => b.total - a.total)
}
