/**
 * 抽卡规划器的引擎 oracle 桥：把 pullPlanner 的 TeamOracle 接到真实伤害引擎
 * （teamTimeline 底座：applyTeamToStore / 预算感知配装 / maxIter 收敛过滤 / 现场快照恢复）。
 *
 * 伤害 → 分数映射（调研口径，FEATURES_GUIDE §4.5）：
 *   score = 60000 × min(1, teamDamage / bossHp) + 5000（操作分全满）
 * 单房上限 65000；一期 3 房（每期实际 Boss 数由期轴数据决定）。
 *
 * 性能口径（对齐 Chart 1/4 实测）：每次伤害求值 ~30ms 是唯一大头。缓存 key =
 * (team × phaseId × 金数档 × buff 签名)——同队同 Boss 同期同档只算一次，
 * beam 的 VCG 重规划大量命中缓存。规划期内 Boss/buff 逐期应用（同 Chart 4）。
 */
import { useConfigStore } from '@/stores/config'
import { useCatalogStore } from '@/stores/catalog'
import { budgetAwareStateFor } from '@/composables/teamTimeline'
import type { BossPreset, PhaseView } from '@/types/bossPreset'
import type { useResourceCalc } from '@/composables/useResourceCalc'
import type { PlannerBossRoom, PlannerPeriod, TeamOracle } from '@/composables/pullPlanner'

type Calc = ReturnType<typeof useResourceCalc>

/** 危局计分常量（调研口径：伤害分 ≤60000 + 操作分 5000 = 单房 65000） */
export const DAMAGE_SCORE_CAP = 60000
export const OPERATION_SCORE = 5000

export interface EngineOracleOptions {
  calc: Calc
  /** 全部 Boss 预设（按 bossRoom.bossId 定位该期相位——一期 3 房是 3 个不同 Boss，
   *  单预设只覆盖自己的出场期） */
  bosses: BossPreset[]
  periodViews: PhaseView[]
  /** 候选池（agentId 列表；含常驻 S 与 A 级——成型号起点的免费人；限定 S 的持有态由 holdings 决定） */
  candidatePool: string[]
  onProgress?: (p: { pct: number; text: string }) => void
}

interface OracleState {
  opts: EngineOracleOptions
  bossById: Map<string, BossPreset>
  configStore: ReturnType<typeof useConfigStore>
  cache: Map<string, Array<{ team: [string, string, string]; score: number }>>
  evaluations: number
  cacheHits: number
}

/** 持有集 → 金数预算（队伍内限定成员按各自 tier 折算：本体 1 / +专武 2 / 满配 11 金） */
function teamBudgetFor(team: [string, string, string], holdings: Record<string, number>): number {
  let budget = 4 // 常驻/A 队友底
  for (const id of team) {
    const tier = holdings[id] ?? 0
    budget += tier === 3 ? 11 : tier === 2 ? 2 : tier === 1 ? 1 : 0
  }
  return budget
}

import { STANDARD_S_AGENT_IDS } from '@/composables/teamCompare'

/** 持有成员过滤：限定 S 未持有（tier 0）不可入队；常驻 S / A 级永远可用（成型号口径） */
function usableMembers(pool: string[], holdings: Record<string, number>, catalog: ReturnType<typeof useCatalogStore>): string[] {
  const out: string[] = []
  for (const id of pool) {
    if (!catalog.getAgent(id)) continue
    const tier = holdings[id] ?? 0
    if (tier > 0) {
      out.push(id)
      continue
    }
    // 限定 S（非常驻名单）未持有不可用；常驻 S 与 A 级免费可用
    const isLimitedS = catalog.getAgent(id)?.rarity === 'S' && !STANDARD_S_AGENT_IDS.has(id)
    if (!isLimitedS) out.push(id)
  }
  return out
}

/**
 * 构造引擎 oracle。**异步预热**：boss/期相位应用属 store 副作用，由调用方在每期结算前
 * 经 applyPeriodContext 切换（beam 每期只切一次）；oracle 本身纯读缓存。
 *
 * 用法（见 pullPlannerEngine 集成）：
 *   const oracle = createEngineOracle(opts)
 *   for 每期: oracle.applyPeriodContext(period) → planPullStrategy 内 oracle.candidates(...)
 */
export function createEngineOracle(opts: EngineOracleOptions): {
  oracle: TeamOracle
  applyPeriodContext: (period: PlannerPeriod) => void
  stats: () => { evaluations: number; cacheHits: number; cacheSize: number }
} {
  const configStore = useConfigStore()
  const catalog = useCatalogStore()
  const state: OracleState = {
    opts,
    bossById: new Map(opts.bosses.map(b => [b.id, b])),
    configStore,
    cache: new Map(),
    evaluations: 0,
    cacheHits: 0,
  }
  /** 逐房间应用 Boss 期相位（一期 3 房 = 3 个不同 Boss；求值前调用） */
  const applyRoomContext = (bossRoom: PlannerBossRoom): boolean => {
    const boss = state.bossById.get(bossRoom.bossId)
    if (!boss) return false
    const phase = boss.phases.find(p => p.phaseId === bossRoom.phaseId)
    if (!phase) return false
    configStore.applyBossPreset({ id: boss.id }, phase, boss.monster, boss.defaults)
    return true
  }
  const applyPeriodContext = (period: PlannerPeriod) => {
    // 期入口预应用首房间（保持 onPeriod 钩子语义；后续房间在 candidates 内按需应用）
    if (period.bosses.length > 0) applyRoomContext(period.bosses[0])
  }

  /** 队级分数缓存：键 = (bossId|phaseId|队伍成员 tier 签名)。同一支队在「成员 tier
   *  不变」的任何持有集下分数相同——beam 大量持有集只改了池外卡的 tier，队级键不变
   *  → 命中率远高于整持有集键（实测整持有集键 30 hits / 1800 evals，队级键把
   *  「同队跨持有集」全部吸收）。 */
  const teamScoreCache = new Map<string, number>()
  const evalTeamOnce = (
    bossRoom: PlannerBossRoom,
    team: [string, string, string],
    holdings: Record<string, number>,
    configStore: ReturnType<typeof useConfigStore>,
    isStun: (id: string) => boolean,
  ): number | null => {
    void isStun
    const key = `${bossRoom.bossId}|${bossRoom.phaseId}|${team.map(id => `${id}:${holdings[id] ?? 0}`).sort().join(',')}`
    const hit = teamScoreCache.get(key)
    if (hit !== undefined) return hit
    const hp = bossRoom.hp > 0 ? bossRoom.hp : 1
    const budget = teamBudgetFor(team, holdings)
    const { state: goldState } = budgetAwareStateFor(team, budget, catalog)
    applyTeamLite(configStore, team, goldState)
    state.evaluations++
    const conv = opts.calc.resourceResult.value?.convergence?.outerExit as 'stable' | 'cycle' | 'maxIter' | undefined
    if (conv === 'maxIter') {
      teamScoreCache.set(key, -1) // 未收敛哨兵：同键不再求值
      return null
    }
    const damage = opts.calc.teamTotalDamage.value
    const score = DAMAGE_SCORE_CAP * Math.min(1, damage / hp) + OPERATION_SCORE
    teamScoreCache.set(key, score)
    return score
  }

  const oracle: TeamOracle = {
    candidates(bossRoom: PlannerBossRoom, holdings: Record<string, number>) {
      const cacheKey = `${bossRoom.bossId}|${bossRoom.phaseId}|${Object.keys(holdings).filter(k => holdings[k] > 0).sort().map(k => `${k}:${holdings[k]}`).join(',')}`
      const cached = state.cache.get(cacheKey)
      if (cached) {
        state.cacheHits++
        return cached
      }
      // 该房间的 Boss 期相位（一期 3 房 = 3 个不同 Boss，逐房应用）
      if (!applyRoomContext(bossRoom)) {
        state.cache.set(cacheKey, [])
        return [] // Boss 无该期数据（早期数据不全）：房间不可结算
      }
      // 候选队伍 = usableMembers 中任取 3 人（含持有限定 + 免费常驻/A）
      const members = usableMembers(opts.candidatePool, holdings, catalog)
      if (members.length < 3) {
        state.cache.set(cacheKey, [])
        return []
      }
      // 候选限流（性能主控项）：不跑全量 C(n,3)（池 12 人 = 220 队 × ~70ms = 慢机分钟级，
      // 这是规划器卡顿的根因）。改为「每个 slot0 主C候选 × 前 4 强双队友」：队数 ≈ n×C(4,2)=6n
      // （池 12 → ~72 队，-67%），且 slot0 互异的队天然成员错开——3 房不重叠匹配的多样性
      // 反而比全量分数序截断更好。队友序 = 免费池代表序（每职业最强代表在前），
      // 最强双队友近似最优配对（精确配对的损失由 beam 多状态与 3 房匹配吸收）。
      const isStun = (id: string) => (catalog.getAgent(id)?.specialty ?? '') === 'stun'
      const MATE_TOP = 4
      const results: Array<{ team: [string, string, string]; score: number }> = []
      for (let i = 0; i < members.length; i++) {
        const lead = members[i]
        // 队友候选 = 非本人、且与主C合计 ≤1 击破
        const mates = members
          .filter(m => m !== lead && ((isStun(lead) ? 1 : 0) + (isStun(m) ? 1 : 0)) <= 1)
          .slice(0, MATE_TOP)
        for (let a = 0; a < mates.length; a++) {
          for (let b = a + 1; b < mates.length; b++) {
            const team = [lead, mates[a], mates[b]] as [string, string, string]
            if ((isStun(team[1]) ? 1 : 0) + (isStun(team[2]) ? 1 : 0) > 1) continue // 双队友击破互斥
            const score = evalTeamOnce(bossRoom, team, holdings, configStore, isStun)
            if (score == null) continue // 收敛过滤：未收敛伤害虚高，排除
            results.push({ team, score })
          }
        }
      }
      results.sort((a, b) => b.score - a.score)
      state.cache.set(cacheKey, results)
      return results
    },
  }

  return {
    oracle,
    applyPeriodContext,
    stats: () => ({ evaluations: state.evaluations, cacheHits: state.cacheHits, cacheSize: state.cache.size + teamScoreCache.size }),
  }
}

/** 轻量装配（同 Chart 1 轻量档：setAgent 兜底 + 清残留主/副词条） */
function applyTeamLite(
  configStore: ReturnType<typeof useConfigStore>,
  team: [string, string, string],
  state: { cinemas: [number, number, number]; wengineMods: [number, number, number]; wEngines: [string, string, string] },
) {
  for (let s = 0; s < 3; s++) configStore.setAgent(s, team[s], { defer: true })
  configStore.syncTeammateBuffsFromTeam()
  for (let s = 0; s < 3; s++) {
    const char = configStore.team[s]
    if (!char) continue
    const m5 = char.driveDisc.mainStats[5]
    char.driveDisc.mainStats = { 5: m5 } as typeof char.driveDisc.mainStats
    char.driveDisc.subStatAllocation = {}
    configStore.setCinemaLevel(s, state.cinemas[s])
    configStore.setWEngineModLevel(s, state.wengineMods[s])
    if (state.wEngines[s]) configStore.setWEngine(s, state.wEngines[s])
    configStore.setParryCount(s, 6)
    configStore.setDodgeCounterCount(s, 10)
    configStore.setBlockCount(s, 0)
    configStore.setDualCounterCount(s, 0)
    configStore.setQuickAssistCount(s, 3)
    configStore.setChainCountPerStun(s, 1)
  }
}

// ========== 期轴构造（boss-presets → PlannerPeriod；只取有预设的房间） ==========

import { AGENT_RELEASE_NODE, VERSION_NODES, nodeIndexOf } from '@/data/versionTimeline'

/**
 * 危局期数轴 → 规划器期轴：每期 = defense 模式的 phases 按 phaseId 聚合（同 buildPeriodAxis
 * 的归期口径，但保留 hp 供分数函数）。排除测试服版本；只收 Boss 有预设的房间。
 */
export function buildPlannerPeriods(
  bosses: BossPreset[],
  opts: { testServerVersions?: Set<string> } = {},
): PlannerPeriod[] {
  interface Draft {
    id: string
    label: string
    date: string
    rooms: Map<string, { bossId: string; bossName: string; hp: number }>
  }
  const map = new Map<string, Draft>()
  for (const b of bosses) {
    for (const ph of b.phases) {
      if (ph.modeType !== 'defense' || !ph.begin) continue
      if (opts.testServerVersions?.has(ph.version)) continue
      let d = map.get(ph.phaseId)
      if (!d) {
        d = { id: ph.phaseId, label: ph.label, date: ph.begin.slice(0, 10), rooms: new Map() }
        map.set(ph.phaseId, d)
      }
      if (!d.rooms.has(b.id)) d.rooms.set(b.id, { bossId: b.id, bossName: b.name, hp: ph.hp })
    }
  }
  return [...map.values()]
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
    .map(d => ({
      id: d.id,
      label: d.label,
      date: d.date,
      bosses: [...d.rooms.values()].map(r => ({
        bossId: r.bossId,
        phaseId: d.id,
        bossName: r.bossName,
        hp: r.hp,
      })),
    }))
}

/** 测试服版本集合（同 Chart 1 口径：note 含「测试服」的 VERSION_NODES） */
export function plannerTestServerVersions(): Set<string> {
  return new Set(VERSION_NODES.filter(n => (n.note ?? '').includes('测试服')).map(n => n.version))
}

// ========== 集成编排：快照/恢复 + 起点预设 + VCG（异步版，带进度与让出） ==========

import { computeCardValuesVcg, planPullStrategy, type CardValueVcg, type PlannerCard, type PlannerOptions, type PlannerResult, type StartPresetKind } from '@/composables/pullPlanner'
import { PLANNER_FILM_PER_VERSION } from '@/data/filmEconomy'

/** 起点预设 → 卡清单（窗口 = 首 UP 日期，复刻不建模）：
 * - fresh：无任何限定（起点前实装的卡也 0 持有，全部待抽）
 * - established：常驻 S + A 免费可用（freeMemberPool），0 限定
 * - custom：用户传入 holdings 映射（起点即持有的档位）。 */
export function buildPlannerCards(
  preset: StartPresetKind,
  startDate: string,
  customHoldings: Record<string, number> = {},
): PlannerCard[] {
  void startDate // 窗口日期来自版本节点；起点只影响规划期过滤（runPullPlanner 内做）
  const out: PlannerCard[] = []
  for (const [agentId, nodeId] of Object.entries(AGENT_RELEASE_NODE)) {
    const date = VERSION_NODES[nodeIndexOf(nodeId)]?.date
    if (!date) continue
    if (STANDARD_S_AGENT_IDS.has(agentId)) continue // 常驻 S 非抽卡对象（免费）
    if (agentId === '1421') continue // 潘引壶 A 级特例（免费）
    if (agentId === '1551') continue // 佩洛伊斯赠送（免费）——debt: 赠送卡窗口期自动获得，v1 不入购买清单
    let initialTier = 0
    if (preset === 'custom') initialTier = customHoldings[agentId] ?? 0
    out.push({ agentId, windowStart: date, ...(initialTier ? { initialTier: initialTier as never } : {}) })
  }
  return out
}

/** 免费人池（常驻 S + A 级 + 赠送）：成型号起点永远可用的组队成员 */
export function freeMemberPool(allAgentIds: string[], catalog: ReturnType<typeof useCatalogStore>): string[] {
  return allAgentIds.filter(id => {
    const a = catalog.getAgent(id)
    if (!a) return false
    if (id === '1551' || id === '1421') return true // 赠送 S / A 级特例
    return a.rarity !== 'S' || STANDARD_S_AGENT_IDS.has(id)
  })
}

/**
 * 免费池精筛（性能剪枝）：每职业保留至多 N 名代表（限定 S 与特例不裁）。
 * 免费人是「凑 9 人」的底座而非强度来源——C(池,3) 是引擎求值量的主控项：
 * 20 免费全量 = C(20+窗口卡,3) ≈ 1330+ 队 × ~70ms ≈ 92s/持有集（实测）；
 * 每职业留 2 = ~10 人 + 窗口卡 ≈ C(14,3) = 364 队 ≈ 25s/持有集。
 * 职业代表选择 = 稀有度高者优先（S 常驻 > A），同稀有度按 id 稳定。
 */
export function freePoolRepresentatives(
  allAgentIds: string[],
  catalog: ReturnType<typeof useCatalogStore>,
  perSpecialty: number,
): string[] {
  const free = freeMemberPool(allAgentIds, catalog)
  if (perSpecialty <= 0) return free
  const bySpec = new Map<string, string[]>()
  for (const id of free) {
    const spec = catalog.getAgent(id)?.specialty ?? 'unknown'
    const arr = bySpec.get(spec) ?? []
    arr.push(id)
    bySpec.set(spec, arr)
  }
  const out: string[] = []
  for (const arr of bySpec.values()) {
    arr.sort((a, b) => {
      const ra = catalog.getAgent(a)?.rarity ?? 'A'
      const rb = catalog.getAgent(b)?.rarity ?? 'A'
      if (ra !== rb) return rb.localeCompare(ra) // S 在前
      return a.localeCompare(b)
    })
    out.push(...arr.slice(0, perSpecialty))
  }
  return out
}

export interface PlannerRunOptions {
  calc: Calc
  /** 期轴数据源：全部 Boss 预设（期轴聚合需要；oracle 求值用 boss 单预设） */
  allBosses: BossPreset[]
  boss: BossPreset
  periodViews: PhaseView[]
  /** 全部可选角色 id（catalog displayAgents；免费池从中过滤） */
  allAgentIds: string[]
  preset: StartPresetKind
  customHoldings?: Record<string, number>
  startDate: string
  /** 规划期数上限（默认全部；截短用于快速预览/测试） */
  maxPeriods?: number
  initialBank?: number
  filmPerVersion?: number
  beamWidth?: number
  assignmentTopM?: number
  /** 是否跑 VCG 归因（贵：每卡一次重规划；默认 false） */
  withVcg?: boolean
  /** 免费池每职业代表数（性能剪枝；0 = 全量免费池。默认 1——池越大 beam 每个持有集的 C(池,3) 求值越贵，实测 2 已分钟级） */
  freePoolPerSpecialty?: number
  onProgress?: (p: { pct: number; text: string }) => void
}

export interface PlannerRunResult {
  plan: PlannerResult
  /** VCG 价值（withVcg 时） */
  values: CardValueVcg[]
  stats: { evaluations: number; cacheHits: number; cacheSize: number; durationMs: number }
}

/**
 * 引擎版规划主入口（异步）：快照/恢复 store、构造卡清单与免费池、beam 规划、
 * 可选 VCG 归因。VCG 每卡重规划复用同一 oracle 缓存（禁卡只影响持有集键，
 * 大部分 (phaseId × holdings) 键命中缓存，实测增量远小于首次规划）。
 */
export async function runPullPlanner(opts: PlannerRunOptions): Promise<PlannerRunResult> {
  const configStore = useConfigStore()
  const catalog = useCatalogStore()
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
    const allCards = buildPlannerCards(opts.preset, opts.startDate, opts.customHoldings ?? {})
    const periods = buildPlannerPeriods(opts.allBosses, { testServerVersions: plannerTestServerVersions() })
      .filter(p => p.date >= opts.startDate)
    const trimmed = opts.maxPeriods ? periods.slice(0, opts.maxPeriods) : periods
    // 候选池 = 免费人 + **窗口与规划期相交**的限定 S（窗口早于起点的卡要么起点已持有
    // （custom initialTier）、要么窗口已过永远买不到——不进池可把 C(池,3) 从数千砍到
    // 数百，这是引擎求值量的决定性剪枝；VCG 归因同池（窗口外卡价值恒 0））
    const lastDate = trimmed.length > 0 ? trimmed[trimmed.length - 1].date : opts.startDate
    const inWindow = (c: { windowStart: string; initialTier?: number }) =>
      (c.initialTier ?? 0) > 0 || (c.windowStart >= opts.startDate && c.windowStart <= lastDate)
    const cards = allCards.filter(inWindow)
    const free = freePoolRepresentatives(opts.allAgentIds, catalog, opts.freePoolPerSpecialty ?? 1)
    const pool = [...new Set([...free, ...cards.map(c => c.agentId)])]
    const engine = createEngineOracle({
      calc: opts.calc,
      bosses: opts.allBosses,
      periodViews: opts.periodViews,
      candidatePool: pool,
    })
    const plannerOpts: PlannerOptions = {
      cards,
      periods: trimmed,
      startDate: opts.startDate,
      initialBank: opts.initialBank ?? 0,
      filmPerVersion: opts.filmPerVersion ?? PLANNER_FILM_PER_VERSION,
      beamWidth: opts.beamWidth ?? 6,
      assignmentTopM: opts.assignmentTopM ?? 12,
      oracle: engine.oracle,
      onPeriod: engine.applyPeriodContext,
      onProgress: p => report(p.pct * (opts.withVcg ? 0.7 : 1), p.text),
    }
    const plan = planPullStrategy(plannerOpts)
    let values: CardValueVcg[] = []
    if (opts.withVcg) {
      report(0.7, 'VCG 反事实归因…')
      await new Promise(r => setTimeout(r, 0))
      values = computeCardValuesVcg(plannerOpts, plan)
      report(1, '完成')
    }
    const stats = engine.stats()
    return { plan, values, stats: { ...stats, durationMs: Date.now() - t0 } }
  } finally {
    // 现场恢复（同 computeTeamTimeline）
    configStore.team.splice(0, configStore.team.length, ...(snap as { team: unknown[] }).team as never[])
    configStore.setEnemy((snap as { enemy: unknown }).enemy as never)
    configStore.appliedBoss = (snap as { appliedBoss: unknown }).appliedBoss as never
    configStore.stunAxes.splice(0, configStore.stunAxes.length, ...((snap as { stunAxes: unknown[] }).stunAxes as never[]))
    configStore.stunAxisPlans.splice(0, configStore.stunAxisPlans.length, ...((snap as { stunAxisPlans: unknown[] }).stunAxisPlans as never[]))
    configStore.useStunAxis = (snap as { useStunAxis: boolean }).useStunAxis
    configStore.globalBuffs.splice(0, configStore.globalBuffs.length, ...((snap as { globalBuffs: unknown[] }).globalBuffs as never[]))
  }
}
