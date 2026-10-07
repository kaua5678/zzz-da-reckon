/**
 * 抽卡规划器的引擎 oracle 桥：把 pullPlanner 的 TeamOracle 接到真实伤害引擎
 * （teamTimeline 底座：轻量装配 teamTimelineStore#applyTeamToStore / 逐人持有档配装 / maxIter 收敛过滤 / 独立场景求值）。
 *
 * 伤害 → 分数映射（分段线性，FEATURES_GUIDE §4.5）：
 *   score = scoreForDamageRatio(teamDamage / bossHp)（伤害分 0~60000，非线性——前段血值分多）
 * 单房上限 60000；一期 3 房（每期实际 Boss 数由期轴数据决定）。
 *
 * 性能口径（对齐 Chart 1/4 实测）：每次伤害求值 ~30ms 是唯一大头。缓存 key =
 * (有序 team × bossId/phaseId/HP × 逐人持有档)——同槽序同房同档只算一次，
 * beam 的 VCG 重规划大量命中缓存。规划期内 Boss/buff 逐期应用（同 Chart 4）。
 */
import type { ConfigModel } from '@/stores/config'
import { applyTeamToStore } from '@/composables/teamTimelineStore'
import { applyBossRoom } from '@/composables/bossRoom'
import { useCatalogStore } from '@/stores/catalog'
import { teamStunOk } from '@/composables/teamStructure'
import { isLimitedSWengineId } from '@/composables/limitedGold'
import { signatureWEngineOf } from '@/composables/signatureWEngine'
import { STANDARD_S_AGENT_IDS } from '@/data/standardMultiplierTable'
import type { BossPreset } from '@/types/bossPreset'
import type { AnalysisContext } from '@/composables/analysisScenario'
import { batchReporter, type BatchProgress, type BatchTaskOptions } from '@/composables/batchTask'
import { ladderRung, type PlannerBossRoom, type PlannerPeriod, type TeamOracle } from '@/composables/pullPlanner'

import { scoreForDamageRatio } from '@/data/deadlyAssaultScore'

export interface EngineOracleOptions {
  /**
   * 求值场景（r372 独立场景）：oracle 在 `scenario.config` 上装配队伍 / Boss 房间，读 `scenario.calc`
   * 的伤害。调用方（页面 / 运行器 / 测试）经 `withAnalysisScenario` 建场景并负责销毁。
   */
  scenario: AnalysisContext
  /** 全部 Boss 预设（按 bossRoom.bossId 定位该期相位——一期 3 房是 3 个不同 Boss，
   *  单预设只覆盖自己的出场期） */
  bosses: BossPreset[]
  /** 候选池（agentId 列表；含常驻 S 与 A 级——成型号起点的免费人；限定 S 的持有态由 holdings 决定） */
  candidatePool: string[]
  onProgress?: (p: BatchProgress) => void
}

interface OracleState {
  opts: EngineOracleOptions
  bossById: Map<string, BossPreset>
  configStore: ConfigModel
  cache: Map<string, Array<{ team: [string, string, string]; score: number }>>
  evaluations: number
  cacheHits: number
}

/** 每期危局房间数上限（一期 3 房；早期数据不全的期可能更少）。候选队友数按它定。 */
const PLANNER_ROOMS_PER_PERIOD = 3
/** 免费人下限 = 一期满编 3 房不重叠所需人数（freePoolRepresentatives 不足时补代表，第 365 轮）。 */
export const PLANNER_MIN_FREE_MEMBERS = 3 * PLANNER_ROOMS_PER_PERIOD

/** 免费特例 = 赠送 S ∪ A 级特例（CC-272 由 versionTimeline 两个集合派生）；购买清单、入队及代表剪枝共享。 */
const FREE_SPECIAL_AGENT_IDS: ReadonlySet<string> = new Set([...FREE_GIFT_S_AGENT_IDS, ...A_RANK_RELEASE_SPECIAL_IDS])

function isFreePlannerMember(id: string, catalog: ReturnType<typeof useCatalogStore>): boolean {
  const agent = catalog.getAgent(id)
  return !!agent && (FREE_SPECIAL_AGENT_IDS.has(id) || agent.rarity !== 'S' || STANDARD_S_AGENT_IDS.has(id))
}

/**
 * 没抽到限定专武时的固定下位：每职业一件，不逐队搜索。
 * 辅助/击破选自默认下位池里通常最好的一把（2026-09-24 同队丽娜/雅/莱卡恩、无弱点各试几件：
 * 摇篮 R5 615万 > R3 600万 > 阿炮 434万 > 游球 420万；齿轮 687万 > 刀俎 681万）。
 * 游球的暴击要属性克制才触发（引擎按 attributeCounter 闸门；上面无弱点试算仍计入），不作为默认。池外左轮转子单次略高，不据此扩大搜索。
 * 其余职业 = 该职业常驻 S 专武（攻击用硫磺石，不用物理锁定的钢铁肉垫）；没有则一把 A 级。
 * 精炼 5 是非限定音擎，不占限定金。起点就有的专武用 initialTier ≥ 2 表达，不在这里特判。
 */
export const PLANNER_FIXED_LOWER: Record<string, { id: string; mod: number }> = {
  support: { id: '14121', mod: 5 },
  stun: { id: '14110', mod: 5 },
  attack: { id: '14104', mod: 5 },
  anomaly: { id: '14118', mod: 5 },
  rupture: { id: '13019', mod: 5 },
  defense: { id: '13010', mod: 5 },
  sharpen: { id: '13017', mod: 5 },
}
const FALLBACK_LOWER = { id: '13004', mod: 5 }

/**
 * 持有档 → 该人自己的配装。不把队伍金数并成一个池再按主C优先分配
 * （那会让 {雅1,柳3} 和 {雅3,柳1} 装成同一套）。
 * 档位 → 影画 / 精炼查 `PURCHASE_LADDER`（pullPlanner.ts，唯一定义处）；免费成员不走阶梯（0 影画 + 固定下位）。
 * 没买专武（refine 0）或专武不是限定 S 音擎就穿固定下位。
 */
export function holdingStateFor(
  team: [string, string, string],
  holdings: Record<string, number>,
  catalog: ReturnType<typeof useCatalogStore>,
): { cinemas: [number, number, number]; wengineMods: [number, number, number]; wEngines: [string, string, string] } {
  const cinemas: [number, number, number] = [0, 0, 0]
  const wengineMods: [number, number, number] = [1, 1, 1]
  const wEngines: [string, string, string] = ['', '', '']
  for (let s = 0; s < 3; s++) {
    const id = team[s]
    const agent = catalog.getAgent(id)
    const limited = !!agent && !isFreePlannerMember(id, catalog)
    const rung = limited ? ladderRung(holdings[id] ?? 0) : null
    const sig = signatureWEngineOf(catalog, id)?.id ?? ''
    cinemas[s] = rung?.cinema ?? 0
    if (rung && rung.refine > 0 && isLimitedSWengineId(sig)) {
      wEngines[s] = sig
      wengineMods[s] = rung.refine
    } else {
      const lower = PLANNER_FIXED_LOWER[agent?.specialty ?? ''] ?? FALLBACK_LOWER
      wEngines[s] = lower.id
      wengineMods[s] = lower.mod
    }
  }
  return { cinemas, wengineMods, wEngines }
}

/** 持有成员过滤：限定 S 未持有不可入队；免费成员资格与免费池同源。 */
function usableMembers(pool: string[], holdings: Record<string, number>, catalog: ReturnType<typeof useCatalogStore>): string[] {
  return pool.filter(id => !!catalog.getAgent(id) && ((holdings[id] ?? 0) > 0 || isFreePlannerMember(id, catalog)))
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
  const { config: configStore, calc } = opts.scenario
  // catalog 是全局只读数据、场景不持有独立副本 ⇒ 分析器内部直接取（见 docs §8 的决定）
  const catalog = useCatalogStore()
  const candidatePool = [...new Set(opts.candidatePool)]
  const roomKey = (room: PlannerBossRoom) => `${room.bossId}|${room.phaseId}|${room.hp > 0 ? room.hp : 1}`
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
    // CC-342：敌人参数 + 该期关卡固有 buff（第 363 轮前只切敌人，用户现场的 layer-buff: 行泄漏到每一房）
    applyBossRoom(configStore, boss, phase)
    return true
  }
  const applyPeriodContext = (period: PlannerPeriod) => {
    // 期入口预应用首房间（保持 onPeriod 钩子语义；后续房间在 candidates 内按需应用）
    if (period.bosses.length > 0) applyRoomContext(period.bosses[0])
  }

  /** 队级分数缓存：键 = (bossId|phaseId|HP|有序队伍成员 tier 签名)。同一支队在「槽序与成员 tier
   *  不变」的任何持有集下分数相同——beam 大量持有集只改了池外卡的 tier，队级键不变
   *  → 命中率远高于整持有集键（实测整持有集键 30 hits / 1800 evals，队级键把
   *  「同队跨持有集」全部吸收）。 */
  const teamScoreCache = new Map<string, number | null>()
  const evalTeamOnce = (
    bossRoom: PlannerBossRoom,
    team: [string, string, string],
    holdings: Record<string, number>,
    configStore: ConfigModel,
  ): number | null => {
    const key = `${roomKey(bossRoom)}|${team.map(id => `${id}:${holdings[id] ?? 0}`).join(',')}`
    const hit = teamScoreCache.get(key)
    if (hit !== undefined) return hit
    const hp = bossRoom.hp > 0 ? bossRoom.hp : 1
    const goldState = holdingStateFor(team, holdings, catalog)
    applyTeamToStore(configStore, team, goldState) // CC-256：轻量装配唯一实现（原私有 applyTeamLite 逐行同义）
    state.evaluations++
    const conv = calc.resourceResult.value?.convergence?.outerExit as 'stable' | 'cycle' | 'maxIter' | undefined
    if (conv === 'maxIter') {
      teamScoreCache.set(key, null) // 未收敛也缓存；命中时仍返回 null，不能泄漏为负分候选
      return null
    }
    const damage = calc.teamTotalDamage.value
    const score = scoreForDamageRatio(damage / hp)
    teamScoreCache.set(key, score)
    return score
  }

  const oracle: TeamOracle = {
    candidates(bossRoom: PlannerBossRoom, holdings: Record<string, number>) {
      const cacheKey = `${roomKey(bossRoom)}|${candidatePool.filter(k => holdings[k] > 0).map(k => `${k}:${holdings[k]}`).join(',')}`
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
      const members = usableMembers(candidatePool, holdings, catalog)
      if (members.length < 3) {
        state.cache.set(cacheKey, [])
        return []
      }
      // 候选限流（性能主控项）：不跑全量 C(n,3)（池 12 人 = 220 队 × ~70ms = 慢机分钟级，
      // 这是规划器卡顿的根因）。改为「每个 slot0 主C候选 × 前 MATE_TOP 名双队友」：队数 ≈ n×C(MATE_TOP,2)。
      // 精确配对的损失由 beam 多状态与 3 房匹配吸收。
      //
      // arena-D 第 362 轮修正两处结构缺陷（探针见 docs/mcp-r6-refactor-list.md §8 第 362 行）：
      // ① MATE_TOP 原为 4：每队占 2 名队友，只有 4 名队友时最多凑出 2 支不重叠的队 ⇒ **第 3 房恒为 0 分**
      //    （探针 12 期 × 3 房，第 3 房全部空）。3 房不重叠至少要 2 × 3 = 6 名不同队友。
      // ② 队友序原为候选池序（免费代表在前、限定卡在末尾）⇒ 买到的限定 S **只能当 slot0、永远进不了队友位**
      //    （探针里买到的卡 100% 在 s0）。改为持有档高者在前（稳定排序，免费成员档位 0 保持原序）。
      const MATE_TOP = 2 * PLANNER_ROOMS_PER_PERIOD
      const mateOrder = [...members].sort((a, b) => (holdings[b] ?? 0) - (holdings[a] ?? 0))
      const results: Array<{ team: [string, string, string]; score: number }> = []
      for (let i = 0; i < members.length; i++) {
        const lead = members[i]
        // 队友候选 = 非本人、且与主C合计不超击破上限（teamStructure.ts，CC-483）
        const mates = mateOrder
          .filter(m => m !== lead && teamStunOk([lead, m], catalog))
          .slice(0, MATE_TOP)
        for (let a = 0; a < mates.length; a++) {
          for (let b = a + 1; b < mates.length; b++) {
            const team = [lead, mates[a], mates[b]] as [string, string, string]
            if (!teamStunOk(team, catalog)) continue // 双队友击破互斥（主C 已与各队友单独过滤，这里兜整队）
            const score = evalTeamOnce(bossRoom, team, holdings, configStore)
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

// ========== 期轴构造（boss-presets → PlannerPeriod；只取有预设的房间） ==========

import { AGENT_RELEASE_NODE, A_RANK_RELEASE_SPECIAL_IDS, FREE_GIFT_S_AGENT_IDS, VERSION_NODES, nodeIndexOf } from '@/data/versionTimeline'

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

/**
 * 规划器收入日历：每个版本的开始日（VERSION_NODES 里该版本的第一个节点，升序）。
 * 不排除测试服版本——收入按日历发，期轴已排除测试服期，测试服版本开始日之后没有期，不影响发放。
 */
export function plannerVersionStartDates(): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const n of VERSION_NODES) {
    if (seen.has(n.version)) continue
    seen.add(n.version)
    out.push(n.date)
  }
  return out.sort()
}

/** 测试服版本集合（同 Chart 1 口径：note 含「测试服」的 VERSION_NODES） */
export function plannerTestServerVersions(): Set<string> {
  return new Set(VERSION_NODES.filter(n => (n.note ?? '').includes('测试服')).map(n => n.version))
}

// ========== 集成编排：快照/恢复 + 起点预设 + VCG（异步版，带进度与让出） ==========

import { computeCardValuesVcg, planPullStrategy, type CardValueVcg, type PlannerCard, type PlannerOptions, type PlannerResult, type StartPresetKind } from '@/composables/pullPlanner'
import { PLANNER_FILM_PER_VERSION } from '@/data/filmEconomy'

/** 起点预设 → 卡清单（窗口 = [首 UP 节点日期, 下一个卡池节点日期)，复刻不建模）：
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
    const idx = nodeIndexOf(nodeId)
    const date = VERSION_NODES[idx]?.date
    if (!date) continue
    // 窗口终止 = 下一个卡池节点（上半 → 下半 → 下个版本上半，约 21 天；下半日期是近似值，见 versionTimeline 头注释）
    const windowEnd = VERSION_NODES[idx + 1]?.date ?? null
    if (STANDARD_S_AGENT_IDS.has(agentId)) continue // 常驻 S 非抽卡对象（免费）
    if (FREE_SPECIAL_AGENT_IDS.has(agentId)) continue // 潘引壶/佩洛伊斯永久免费，不受购买窗口限制
    let initialTier = 0
    if (preset === 'custom') initialTier = customHoldings[agentId] ?? 0
    out.push({ agentId, windowStart: date, windowEnd, ...(initialTier ? { initialTier } : {}) })
  }
  return out
}

/** 免费人池（常驻 S + A 级 + 赠送）：成型号起点永远可用的组队成员 */
export function freeMemberPool(allAgentIds: string[], catalog: ReturnType<typeof useCatalogStore>): string[] {
  return allAgentIds.filter(id => isFreePlannerMember(id, catalog))
}

/**
 * 免费池精筛（性能剪枝）：每职业保留 N 名代表（限定 S 与特例不裁）；总数不足 `PLANNER_MIN_FREE_MEMBERS` 时按职业轮转补足。
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
    if (FREE_SPECIAL_AGENT_IDS.has(id)) continue // 免费特例不参与职业配额竞争
    const spec = catalog.getAgent(id)?.specialty ?? 'unknown'
    const arr = bySpec.get(spec) ?? []
    arr.push(id)
    bySpec.set(spec, arr)
  }
  const specials = free.filter(id => FREE_SPECIAL_AGENT_IDS.has(id))
  const lists = [...bySpec.values()]
  const out: string[] = []
  for (const arr of lists) {
    arr.sort((a, b) => {
      const ra = catalog.getAgent(a)?.rarity ?? 'A'
      const rb = catalog.getAgent(b)?.rarity ?? 'A'
      if (ra !== rb) return rb.localeCompare(ra) // S 在前
      return a.localeCompare(b)
    })
    out.push(...arr.slice(0, perSpecialty))
  }
  // 下限：免费人（起点不持有任何限定也能上场的人）至少要凑满一期 3 房 × 3 人。arena-D 第 365 轮：每职业 1 名
  // 时只有 8 人（5 职业代表 + 3 特例）⇒ 0 持有的持有集**第 3 房恒为 0 分**，第一张买到的卡不论强弱都白得一整房分
  // （规划与 VCG 归因都被这个假边际值带偏）。不够时按职业轮转补下一名代表，直到够数或免费池用尽。
  for (let k = perSpecialty; out.length + specials.length < PLANNER_MIN_FREE_MEMBERS; k++) {
    let added = false
    for (const arr of lists) {
      if (out.length + specials.length >= PLANNER_MIN_FREE_MEMBERS) break
      if (k < arr.length) { out.push(arr[k]); added = true }
    }
    if (!added) break
  }
  return [...out, ...specials]
}

export interface PlannerRunOptions extends BatchTaskOptions {
  /** 求值场景（r372 独立场景）：整次规划（beam 逐期 + VCG 重规划）只在 `scenario.config` 上改写 */
  scenario: AnalysisContext
  /** 期轴数据源：全部 Boss 预设（期轴聚合需要；oracle 求值用 boss 单预设） */
  allBosses: BossPreset[]
  boss: BossPreset
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
  /** 是否跑 VCG 归因（贵：每卡一次重规划；默认 false） */
  withVcg?: boolean
  /** 免费池每职业代表数（性能剪枝；0 = 全量免费池。默认 1——池越大 beam 每个持有集的 C(池,3) 求值越贵，实测 2 已分钟级） */
  freePoolPerSpecialty?: number
}

export interface PlannerRunResult {
  plan: PlannerResult
  /** VCG 价值（withVcg 时） */
  values: CardValueVcg[]
  stats: { evaluations: number; cacheHits: number; cacheSize: number; durationMs: number }
}

/**
 * 引擎版规划主入口（异步）：在调用方给的独立场景上构造卡清单与免费池、beam 规划、
 * 可选 VCG 归因。VCG 每卡重规划复用同一 oracle 缓存（禁卡只影响持有集键，
 * 大部分 (phaseId × holdings) 键命中缓存，实测增量远小于首次规划）。
 */
export async function runPullPlanner(opts: PlannerRunOptions): Promise<PlannerRunResult> {
  // r372：在调用方给的独立场景（opts.scenario）上求值——改写只落在场景里，跑完无需恢复
  // （原 CC-278 的 snapshotStore / restoreStore 已删）；beam 逐期 yield 期间 UI 也看不到中间态
  // （旧路径下页面会为每个中间态重算）。
  const catalog = useCatalogStore()
  const t0 = Date.now()
  const report = batchReporter(opts)
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
    scenario: opts.scenario,
    bosses: opts.allBosses,
    candidatePool: pool,
  })
  const plannerOpts: PlannerOptions = {
    cards,
    periods: trimmed,
    startDate: opts.startDate,
    initialBank: opts.initialBank ?? 0,
    filmPerVersion: opts.filmPerVersion ?? PLANNER_FILM_PER_VERSION,
    versionStartDates: plannerVersionStartDates(),
    beamWidth: opts.beamWidth ?? 6,
    oracle: engine.oracle,
    onPeriod: engine.applyPeriodContext,
    onProgress: p => report(p.pct * (opts.withVcg ? 0.7 : 1), p.text),
    control: opts.control,
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
}
