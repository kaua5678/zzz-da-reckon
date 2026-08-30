/**
 * 队伍时间线：版本节点 × 最强队伍 + 最优限定金分配（时间图表页 Chart 1 的数据服务）
 *
 * 模型（用户口径）：
 * - 选定主C + Boss（期数） + 限定金预算；主C实装那期起，每个「版本节点」（上半/下半卡池期）
 *   记录当时的最强队伍（主C + 2 个当时已实装的 S 级队友）与队伍强度（伤害/Boss血量）。
 * - **队伤只与（队伍 × Boss × 金数）有关、与版本节点无关** → 每个队友组合只需计算一次，
 *   某节点的最强队伍 = 所有「双队友均已实装 ≤ 该节点」的组合里伤害最高者。
 *   因此本算法是精确的（非贪心/波束近似）：全部 C(n,2) 个组合各算一次，按节点前缀取最大值。
 * - 金数口径 = 总限定金（同队伍对比页）：限定 S 角色本体 1 金 + 限定音擎本体 1 金 +
 *   影画/精炼每级 1 金；常驻/A 级角色与常驻音擎不计。基础档 = 0命1精 + 各槽位推荐音擎。
 * - **最优加金分配**：在所选金数预算内，逐金贪婪挑「伤害提升最大」的下一步
 *   （影画 1~6 / 音擎本体获取（非限定槽位也可花 1 金佩戴限定音擎）/ 精炼 2~5），
 *   而不是按固定顺序（用户指出固定顺序不是当前金数的最优伤害）。
 * - 每个节点展示的「最强队伍」= 该节点参考（基础金）下 Top-3 队伍里、按所选金数
 *   做最优加金后伤害最高者（缓解「高金数下队伍偏好可能不同」的偏差）。
 *
 * - **换人判定**：换人节点的最优队伤害对比上一节点旧队伤害（同预算下各自最优加金），
 *   提升 ≥ SWAP_UPGRADE_UPLIFT_PCT%（默认 10）→ 上位，否则平替（classifySwapUplift 单一事实源）。
 *   新角色实装当期未进最优队时，用阶段①参考伤害标注「平替·可不抽 / 未上位」（零额外求值）。
 *
 * 搜索口径：
 * - 队友候选 = AGENT_RELEASE_NODE 收录的角色（S 级 + 用户口径特例潘引壶：唯一收录的
 *   A 级贯穿拐，0 金不占限定金）中，实装 ≤ 当前节点的。
 * - 配装 = 每队跑一遍 store.applyTeamPreset（邦布精灵推荐驱动盘 + 词条优化器），
 *   再显式覆盖音擎/命座/精炼/交互（交互基准：弹刀6 闪反10 快支3 连携1，般岳/星徽·比利按角色默认）。
 * - Boss 一次应用（applyBossPreset）；当期可选 buff 牌不参与（与「队伍对比」的「不使用」一致）。
 * - 计算现场快照/恢复，跑完不留痕（同 computeTeamComparePoints）。
 */
import { getInteractionDefaults, roleInteractionBaseline, useConfigStore } from '@/stores/config'
import { equalizeTimeWeights } from '@/composables/timeWeightBalancer'
import { useCatalogStore } from '@/stores/catalog'
import { AGENT_RELEASE_NODE, VERSION_NODES, nodeIndexOf, releaseNodeOf } from '@/data/versionTimeline'
import { indexForDate } from '@/composables/bossSchedule'
import { isLimitedAgent, isLimitedWEngine, applyGoldSteps, STANDARD_S_AGENT_IDS } from '@/composables/teamCompare'
import { teamPresets } from '@/data/teamPresets'
import { STRONG_TEAM_PRESETS } from '@/data/strongTeamPresets'
import type { Agent } from '@/types/catalog'
import type { BossPreset, BossPresetPhase } from '@/types/bossPreset'
import type { useResourceCalc } from '@/composables/useResourceCalc'

type Calc = ReturnType<typeof useResourceCalc>

/** 一个队伍的最终配装态（命座/精炼/音擎） */
export interface TeamGoldState {
  cinemas: [number, number, number]
  wengineMods: [number, number, number]
  wEngines: [string, string, string]
}

/** 换人判定：upgrade = 上位（提升 ≥ SWAP_UPGRADE_UPLIFT_PCT%），lateral = 平替 */
export type SwapKind = 'upgrade' | 'lateral'

/** 实装未进队判定：lateral = 平替（差距 < 阈值，可不抽），worse = 未上位（差距 ≥ 阈值） */
export interface NewAgentBench {
  /** 当期实装但未进最优队的角色 */
  agents: string[]
  kind: 'lateral' | 'worse'
  /** 含新角色的最强组合相对现役（不含新角色）最强组合的差距，负数 % */
  gapPct: number
}

/** 单节点结果（折线图一个点 + 泳道图一格） */
export interface TimelineNodeResult {
  nodeId: string
  nodeLabel: string
  /** 节点特殊说明（如 3.2 测试服） */
  nodeNote?: string
  team: [string, string, string]
  state: TeamGoldState
  /** 实际总限定金（低于目标预算时按基础金钳制） */
  totalGold: number
  /** 金数明细（如 "8金：仪玄 2命 + 卢西娅 专武（本体）"） */
  goldLabel: string
  damage: number
  /** 伤害/Boss血量 × 100（100 = 击杀线） */
  hpRatio: number
  /** 相对上一节点的换人（仅换入者/被换出者 id，无变化为空；双槽位同节点变化只记最后一个） */
  swappedIn?: string
  swappedOut?: string
  /** 换人判定：本节点最优队 vs 上一节点旧队伤害（同预算各自最优加金） */
  swapKind?: SwapKind
  swapUpliftPct?: number
  /** 当期新实装角色全部未进最优队时的判定（指导跳卡池） */
  newAgentBench?: NewAgentBench
}

export interface TeamTimelineSwapEvent {
  nodeId: string
  nodeLabel: string
  swappedIn: string
  swappedOut: string
  swapKind?: SwapKind
  swapUpliftPct?: number
}

export interface TeamTimelineStats {
  /** 队伍组合求值次数（≈ C(候选,2)，不含结构约束排除） */
  teamsEvaluated: number
  /** 因外层不动点未收敛（maxIter）被排除出排名的队伍数 */
  nonConverged: number
  /** 加金贪婪的试算次数 */
  goldEvaluations: number
  durationMs: number
}

/**
 * 多队并存强度种子（用户口径「队伍×版本强度矩阵」）：池内每个收敛组合一条，
 * damage 跨节点恒定（同 Boss 数值不变、当期 Buff 不参与）；startIndex = 双队友均实装的
 * 首个节点（nodes 数组下标）。淘汰点（首次跌出 Top-K 即永久出局——可达集合只增 ⇒ 排名单调不升）
 * 由展示层按 K 计算，不在数据层固化。
 */
export interface TeamStrengthSeed {
  key: string
  team: [string, string, string]
  /** 队伍简称：主C与队友名首字拼接（如 仪青潘） */
  shortLabel: string
  damage: number
  hpRatio: number
  startIndex: number
}

export interface TeamTimelineResult {
  mainAgentId: string
  mainName: string
  budget: number
  bossName: string
  phaseLabel: string
  nodes: TimelineNodeResult[]
  swapEvents: TeamTimelineSwapEvent[]
  /** 多队并存强度种子（池内全部收敛组合；展示层按 Top-K 裁剪存活区间） */
  strengthSeeds: TeamStrengthSeed[]
  stats: TeamTimelineStats
}

/** 演变轴节点：带日期即可。缺省由 VERSION_NODES 合成（版本卡池节点）；页面传危局期数轴 */
export interface TimelineAxisNode {
  id: string
  label: string
  /** 节点起始日期 YYYY-MM-DD（窗口 [date, 下一节点 date)） */
  date: string
  /** 测试服占位节点：includeTestServer=false 时剔除 */
  testServer?: boolean
}

export interface TeamTimelineOptions {
  mainAgentId: string
  boss: BossPreset
  phase: BossPresetPhase
  /** 目标总限定金（低于队伍基础金自动钳制） */
  budget: number
  onProgress?: (p: { pct: number; text: string }) => void
  /**
   * 演变轴（危局期数轴由页面经 buildPeriodAxis 构造后传入）。缺省 = VERSION_NODES 合成。
   * 角色在期数中途实装也算该期可用：实装日落在某节点 [date, 下一节点 date) 窗口内即算该节点；
   * 早于轴起点的队友从轴起点可用。
   */
  axisNodes?: TimelineAxisNode[]
  /**
   * 限定队友候选池（用户策展，页面持久化在 localStorage；缺省 = 全部候选）。
   * 必须含主C以外的候选；轻量速算的关键：C(池,2) 对组合各算一次（同队跨期面对同一 Boss 数值不变，
   * 伤害直接复用），池 5 人 = 10 对 ≈ 10 次求值，而不是全候选 ~900 次。
   */
  candidatePool?: string[]
  /** 是否包含测试服角色（3.2 未实装；缺省 false，防止测试服数值污染「跟随版本」曲线） */
  includeTestServer?: boolean
  /**
   * 自动配装（推荐驱动盘 + 词条优化器）。缺省 **false = 轻量速算**：
   * 只用 setAgent 兜底配装（专属音擎/兜底套装/5号位主词条），并清掉上一队残留的 4/6 号主词条与副词条分配。
   */
  autoBuild?: boolean
  /**
   * 最优加金分配（逐金贪婪，每步多次求值）。缺省 **false**：
   * 用主C优先确定性分配（budgetAwareStateFor，零额外求值），展示态与排名同源。
   */
  optimalGold?: boolean
}

// ========== 现场快照 / 恢复 ==========

interface StoreSnapshot {
  team: unknown[]
  enemy: unknown
  appliedBoss: unknown
  stunAxes: unknown[]
  stunAxisPlans: unknown[]
  useStunAxis: boolean
  globalBuffs: unknown[]
}

function snapshotStore(configStore: ReturnType<typeof useConfigStore>): StoreSnapshot {
  return {
    team: JSON.parse(JSON.stringify(configStore.team)),
    enemy: JSON.parse(JSON.stringify(configStore.enemy)),
    appliedBoss: configStore.appliedBoss,
    stunAxes: JSON.parse(JSON.stringify(configStore.stunAxes)),
    stunAxisPlans: JSON.parse(JSON.stringify(configStore.stunAxisPlans)),
    useStunAxis: configStore.useStunAxis,
    globalBuffs: JSON.parse(JSON.stringify(configStore.globalBuffs)),
  }
}

function restoreStore(configStore: ReturnType<typeof useConfigStore>, snap: StoreSnapshot) {
  configStore.team.splice(0, configStore.team.length, ...(snap.team as never[]))
  configStore.setEnemy(snap.enemy as never)
  configStore.appliedBoss = snap.appliedBoss as never
  configStore.stunAxes.splice(0, configStore.stunAxes.length, ...(snap.stunAxes as never[]))
  configStore.stunAxisPlans.splice(0, configStore.stunAxisPlans.length, ...(snap.stunAxisPlans as never[]))
  configStore.useStunAxis = snap.useStunAxis
  configStore.globalBuffs.splice(0, configStore.globalBuffs.length, ...(snap.globalBuffs as never[]))
}

// ========== 配装工具 ==========

function teamKey(main: string, a: string, b: string): string {
  return `${main},${a},${b}`
}

// ========== 换人判定（上位 / 平替） ==========

/** 上位阈值：换入后全队伤害提升 ≥ 该百分比 → 上位，否则平替（用户口径，单一事实源） */
export const SWAP_UPGRADE_UPLIFT_PCT = 10

/**
 * 换人判定：pct = (cur − prev) / prev × 100（1 位小数）。
 * ≥ SWAP_UPGRADE_UPLIFT_PCT → 上位，否则平替；prev ≤ 0 防御性归平替（pct 0）。
 * 换人事件与「实装未进队」标注共用该阈值口径。
 */
export function classifySwapUplift(prevDamage: number, curDamage: number): { kind: SwapKind; pct: number } {
  const pct = prevDamage > 0 ? Math.round(((curDamage - prevDamage) / prevDamage) * 1000) / 10 : 0
  return { kind: pct >= SWAP_UPGRADE_UPLIFT_PCT ? 'upgrade' : 'lateral', pct }
}

/** 基础音擎（0 金档）：
 * - 限定 S 角色：基础档直接带专属音擎（限定 → 计 1 金，与「队伍对比」基础档 = 0命1精+专武 同口径）；
 * - 非限定槽位：只选不占金的音擎（专属优先，其次同职业常驻/A 级）。 */
function baseWEngineFor(agent: Agent | null | undefined, catalog: ReturnType<typeof useCatalogStore>): string {
  if (!agent) return ''
  const ws = catalog.displayWEngines
  const sig = ws.find(w => w.ownerAgentId === agent.id)
  if (isLimitedAgent(agent.id)) {
    if (sig) return sig.id
    return bestLimitedWEngineFor(agent, catalog) ?? ''
  }
  if (sig && !isLimitedWEngine(sig.id)) return sig.id
  const freeSpec = ws.find(w => w.specialty === agent.specialty && !isLimitedWEngine(w.id))
  if (freeSpec) return freeSpec.id
  if (sig) return sig.id
  const sameSpec = ws.find(w => w.specialty === agent.specialty)
  return sameSpec?.id ?? ws[0]?.id ?? ''
}

/** 槽位最佳限定音擎（花 1 金获取的候选；非限定槽位也可佩戴） */
function bestLimitedWEngineFor(agent: Agent | null | undefined, catalog: ReturnType<typeof useCatalogStore>): string | null {
  if (!agent) return null
  const ws = catalog.displayWEngines
  const sig = ws.find(w => w.ownerAgentId === agent.id)
  if (sig && isLimitedWEngine(sig.id)) return sig.id
  const sameSpec = ws.find(w => w.specialty === agent.specialty && isLimitedWEngine(w.id))
  return sameSpec?.id ?? null
}

function baseStateFor(team: [string, string, string], catalog: ReturnType<typeof useCatalogStore>): TeamGoldState {
  return {
    cinemas: [0, 0, 0],
    wengineMods: [1, 1, 1],
    wEngines: [
      baseWEngineFor(catalog.getAgent(team[0]), catalog),
      baseWEngineFor(catalog.getAgent(team[1]), catalog),
      baseWEngineFor(catalog.getAgent(team[2]), catalog),
    ],
  }
}

/** 队伍基础总限定金 = 限定 S 角色本体 + 基础档限定音擎（各 1 金） */
export function baseGoldOfTeam(team: [string, string, string], catalog: ReturnType<typeof useCatalogStore>): number {
  let gold = 0
  for (let s = 0; s < 3; s++) {
    if (isLimitedAgent(team[s])) gold += 1
    const w = baseWEngineFor(catalog.getAgent(team[s]), catalog)
    if (w && isLimitedWEngine(w)) gold += 1
  }
  return gold
}

/**
 * 预算感知的确定性加金步清单（主C优先：主C影画1..6 → 主C精炼2..5 → 队友1 → 队友2）。
 * 供「搜索排名」用：每队按目标金数做一次确定性分配（1 次伤害求值），
 * 排名即「所选金数下的大致强度」，比基础金排名更贴近最优加金结果（换人时机正确）。
 * 与 applyGoldSteps 同口径（总限定金、钳制到 [基础金, 基础金+步数]）。
 */
export function buildBudgetAwareGoldSteps(
  team: [string, string, string],
  catalog: ReturnType<typeof useCatalogStore>,
): { steps: Parameters<typeof applyGoldSteps>[0]; baseWEngines: [string, string, string] } {
  const steps: Parameters<typeof applyGoldSteps>[0] = []
  const baseWEngines = baseStateFor(team, catalog).wEngines
  for (let s = 0; s < 3; s++) {
    const agent = catalog.getAgent(team[s])
    if (!agent) continue
    const name = agent.name.zhCN ?? agent.name.en ?? `槽位${s + 1}`
    if (isLimitedAgent(team[s])) {
      for (let c = 1; c <= 6; c++) steps.push({ label: `${name} ${c}命`, slot: s, kind: 'cinema' as const, value: c })
    }
    const baseW = baseWEngines[s]
    if (baseW && isLimitedWEngine(baseW)) {
      for (let m = 2; m <= 5; m++) steps.push({ label: `${name} 精炼${m}`, slot: s, kind: 'wengine' as const, value: m })
    }
  }
  return { steps, baseWEngines }
}

/** 预算感知确定性分配（applyGoldSteps 封装）：返回可直接 applyTeamToStore 的配装态 */
export function budgetAwareStateFor(
  team: [string, string, string],
  budget: number,
  catalog: ReturnType<typeof useCatalogStore>,
): { state: TeamGoldState; totalGold: number; label: string } {
  const { steps, baseWEngines } = buildBudgetAwareGoldSteps(team, catalog)
  const base = baseGoldOfTeam(team, catalog)
  const applied = applyGoldSteps(steps, budget, base, [], baseWEngines)
  return {
    state: {
      cinemas: applied.cinemas,
      wengineMods: applied.wengineMods,
      wEngines: applied.wEngines,
    },
    totalGold: applied.totalGold,
    label: applied.label,
  }
}

/**
 * 装配队伍到 store：推荐配装 + 显式覆盖（音擎/命座/精炼/交互基准）。
 *
 * autoBuild=false（轻量速算，默认）：跳过推荐/优化器，只用 setAgent 兜底配装
 * （专属音擎、兜底套装、5号位主词条），并清掉上一队残留的 4/6 号主词条与副词条分配
 * （setAgent 不重置它们，不清会跨队泄漏）。
 */
function applyTeamToStore(
  configStore: ReturnType<typeof useConfigStore>,
  team: [string, string, string],
  state: TeamGoldState,
  autoBuild = false,
) {
  if (autoBuild) {
    configStore.applyTeamPreset(team)
  } else {
    for (let s = 0; s < 3; s++) configStore.setAgent(s, team[s], { defer: true })
    configStore.syncTeammateBuffsFromTeam()
    for (let s = 0; s < 3; s++) {
      const char = configStore.team[s]
      if (!char) continue
      const m5 = char.driveDisc.mainStats[5]
      char.driveDisc.mainStats = { 5: m5 } as typeof char.driveDisc.mainStats
      char.driveDisc.subStatAllocation = {}
    }
  }
  for (let s = 0; s < 3; s++) {
    configStore.setCinemaLevel(s, state.cinemas[s])
    configStore.setWEngineModLevel(s, state.wengineMods[s])
    if (state.wEngines[s]) configStore.setWEngine(s, state.wEngines[s])
    // 交互基准：角色专属默认（般岳/星徽·比利等）> 通用职业基准（支援/防护不交互，击破只弹刀，主C弹刀+闪反）
    const defs = getInteractionDefaults(team[s])
    const hasCustom = defs.parry > 0 || defs.dodge > 0 || defs.block > 0 || defs.dual > 0
    const base = hasCustom ? defs : roleInteractionBaseline(useCatalogStore().getAgent(team[s])?.specialty)
    configStore.setParryCount(s, base.parry)
    configStore.setDodgeCounterCount(s, base.dodge)
    configStore.setBlockCount(s, base.block)
    configStore.setDualCounterCount(s, base.dual)
    configStore.setQuickAssistCount(s, 3)
    configStore.setChainCountPerStun(s, 1)
  }
}

// ========== 平A时间权重·边际均衡（默认「均衡」而非 1:1） ==========

/**
 * 把 applyTeamToStore 设好的默认平A权重（0/1 等权）重均衡到「边际产出更高」的槽位。
 *
 * 用 set-read-restore（同 computeOptimalTeamAllocation 的「临时应用→读伤害→还原」模式）经
 * `calc.teamTotalDamage` 做有限差分坐标上升（纯算法见 timeWeightBalancer.equalizeTimeWeights）。
 * 支援/防护（weight=0）不参与转移；时间总权重守恒。
 *
 * 返回均衡后的权重向量（按槽位）与均衡后总伤。均衡后权重已写回 store，后续读 teamTotalDamage 同源。
 */
export function optimizeTeamTimeWeights(
  calc: Calc,
  configStore: ReturnType<typeof useConfigStore>,
  opts: { step?: number; shiftStep?: number; maxIter?: number } = {},
): { weights: number[]; damage: number; balanced: boolean } {
  const initial = [0, 1, 2].map(s => Math.max(0, Number(configStore.team[s]?.basicAttackTimeWeight ?? 0)))
  const adjustableCount = initial.filter(w => w > 0).length
  if (adjustableCount < 2) {
    return { weights: initial, damage: calc.teamTotalDamage.value, balanced: false }
  }
  const evaluate = (w: number[]) => {
    for (let s = 0; s < 3; s++) configStore.setBasicAttackTimeWeight(s, Math.max(0, w[s]))
    return calc.teamTotalDamage.value
  }
  const r = equalizeTimeWeights(evaluate, initial, {
    step: opts.step ?? 0.5,
    shiftStep: opts.shiftStep ?? 1,
    maxIter: opts.maxIter ?? 3,
  })
  for (let s = 0; s < 3; s++) configStore.setBasicAttackTimeWeight(s, r.weights[s])
  return { weights: r.weights, damage: r.damage, balanced: true }
}

// ========== 最优加金分配（逐金贪婪） ==========

interface GoldStepCandidate {
  slot: number
  kind: 'cinema' | 'wengine' | 'refine'
  value: number
  wEngineId?: string
  label: string
}

function wengineName(wId: string, catalog: ReturnType<typeof useCatalogStore>): string {
  const w = catalog.getWEngine(wId)
  return w?.name?.zhCN ?? w?.name?.en ?? wId
}

/** 下一批可用的加金候选（测试导出；每槽位最多一条：影画/音擎本体/精炼） */
export function nextGoldCandidates(
  team: [string, string, string],
  state: TeamGoldState,
  catalog: ReturnType<typeof useCatalogStore>,
): GoldStepCandidate[] {  const out: GoldStepCandidate[] = []
  for (let s = 0; s < 3; s++) {
    const agent = catalog.getAgent(team[s])
    if (!agent) continue
    const name = agent.name.zhCN ?? agent.name.en ?? `槽位${s + 1}`
    // 影画（限定 S 角色才占金）
    if (isLimitedAgent(team[s]) && state.cinemas[s] < 6) {
      out.push({ slot: s, kind: 'cinema', value: state.cinemas[s] + 1, label: `${name} ${state.cinemas[s] + 1}命` })
    }
    const curW = state.wEngines[s]
    if (curW && isLimitedWEngine(curW)) {
      // 已带限定音擎 → 精炼步
      if (state.wengineMods[s] < 5) {
        out.push({ slot: s, kind: 'refine', value: state.wengineMods[s] + 1, label: `${name} ${wengineName(curW, catalog)}精炼${state.wengineMods[s] + 1}` })
      }
    } else {
      // 未带限定音擎 → 可花 1 金换装最佳限定音擎（含非限定槽位，用户口径「非限定也允许修改佩戴」）
      const best = bestLimitedWEngineFor(agent, catalog)
      if (best && best !== curW) {
        out.push({ slot: s, kind: 'wengine', value: 1, wEngineId: best, label: `${name} 换${wengineName(best, catalog)}（本体）` })
      }
    }
  }
  return out
}

export interface GoldAllocationResult extends TeamGoldState {
  totalGold: number
  label: string
  damage: number
  /** 贪婪试算次数（进度用） */
  stepsEvaluated: number
}

/**
 * 最优加金分配：从基础档（0命1精+推荐音擎）出发，在目标总限定金内逐金贪婪——
 * 每金档试算所有「下一个可用级别」（每槽位影画/精炼/音擎本体各一），提交伤害提升最大的那个。
 * 预算低于基础金时钳制到基础金（0 步）。同 computeTeamComparePoints 的 computeOptimalGoldAllocations 口径，
 * 但候选从 catalog 生成（适用于任意生成队伍，而非 preset.goldSteps）。
 */
export function computeOptimalTeamAllocation(
  calc: Calc,
  configStore: ReturnType<typeof useConfigStore>,
  team: [string, string, string],
  budget: number,
  autoBuild = false,
): GoldAllocationResult {
  const catalog = useCatalogStore()
  const base = baseGoldOfTeam(team, catalog)
  const state = baseStateFor(team, catalog)
  applyTeamToStore(configStore, team, state, autoBuild)
  // 平A时间权重默认「均衡」：基础态先把等权重均衡到边际产出更高的槽位（后续贪婪在均衡权重上做）
  optimizeTeamTimeWeights(calc, configStore)
  // 防御：基础态外层未收敛 → 整队不可信（正常流程已由 refDamage 收敛过滤挡掉）
  if (calc.resourceResult.value?.convergence?.outerExit === 'maxIter') {
    return {
      ...state,
      totalGold: base,
      label: `${base}金（基础，未收敛）`,
      damage: Number.NEGATIVE_INFINITY,
      stepsEvaluated: 0,
    }
  }
  let damage = calc.teamTotalDamage.value
  let totalGold = base
  const taken: string[] = []
  let stepsEvaluated = 0
  while (totalGold < budget) {
    const cands = nextGoldCandidates(team, state, catalog)
    if (cands.length === 0) break
    let best: { cand: GoldStepCandidate; dmg: number } | null = null
    for (const c of cands) {
      // 试算（临时应用 → 读伤害 → 还原）
      const prevC = state.cinemas[c.slot]
      const prevW = state.wEngines[c.slot]
      const prevM = state.wengineMods[c.slot]
      if (c.kind === 'cinema') configStore.setCinemaLevel(c.slot, c.value)
      else if (c.kind === 'wengine') configStore.setWEngine(c.slot, c.wEngineId!)
      else configStore.setWEngineModLevel(c.slot, c.value)
      stepsEvaluated++
      // 注意：贪婪循环内不做 yield——试算是「临时改动→读伤害→还原」，中途让出会触发
      // store 的 team watch（syncTeammateBuffsFromTeam）在改动未还原时重入，扭曲后续试算。
      // 让出只发生在阶段边界（阶段1每2队、阶段3每2队）。
      // 收敛过滤：试算态外层未收敛（maxIter）→ 该步伤害虚高不可信，视作 -Inf 拒绝
      // （calcOutput 里 convergence 被重建过，TS 推断丢了 maxIter 字面量，运行时确实会出现，故显式断言）
      const conv = calc.resourceResult.value?.convergence?.outerExit as 'stable' | 'cycle' | 'maxIter' | undefined
      const d = conv === 'maxIter' ? Number.NEGATIVE_INFINITY : calc.teamTotalDamage.value
      configStore.setCinemaLevel(c.slot, prevC)
      configStore.setWEngine(c.slot, prevW)
      configStore.setWEngineModLevel(c.slot, prevM)
      if (best == null || d > best.dmg + 1e-9) best = { cand: c, dmg: d }
    }
    if (!best) break
    // 提交最佳步
    const c = best.cand
    if (c.kind === 'cinema') configStore.setCinemaLevel(c.slot, c.value)
    else if (c.kind === 'wengine') configStore.setWEngine(c.slot, c.wEngineId!)
    else configStore.setWEngineModLevel(c.slot, c.value)
    if (c.kind === 'cinema') state.cinemas[c.slot] = c.value
    else if (c.kind === 'wengine') state.wEngines[c.slot] = c.wEngineId!
    else state.wengineMods[c.slot] = c.value
    damage = best.dmg
    totalGold++
    taken.push(c.label)
  }
  const clamped = budget < base
  const label = taken.length === 0
    ? `${totalGold}金（基础${clamped ? '，目标已钳制' : ''}）`
    : `${totalGold}金${clamped ? '（钳制）' : ''}：${taken.join(' + ')}`
  return { ...state, totalGold, label, damage, stepsEvaluated }
}

// ========== 主流程：队伍演变时间线 ==========

function yieldNow(): Promise<void> {
  return new Promise(r => setTimeout(r, 0))
}

/**
 * 计算主C从实装节点到最新版本的队伍演变时间线。
 * 精确增量：全部 S 级队友对各算一次**预算感知**伤害（主C优先确定性分配，排名贴近所选金数），
 * 每节点最强 = 可达组合前缀的最大值；再对每节点参考 Top-3 队伍按所选金数做最优加金（逐金贪婪），
 * 取加金后伤害最高者为该节点展示队伍。未收敛（maxIter）队伍排除出排名。
 */
export async function computeTeamTimeline(calc: Calc, opts: TeamTimelineOptions): Promise<TeamTimelineResult> {
  const configStore = useConfigStore()
  const catalog = useCatalogStore()
  const snap = snapshotStore(configStore)
  const t0 = Date.now()
  let teamsEvaluated = 0
  let goldEvaluations = 0
  const report = (pct: number, text: string) => opts.onProgress?.({ pct, text })

  try {
    const mainRelease = releaseNodeOf(opts.mainAgentId)
    if (!mainRelease) throw new Error(`角色 ${opts.mainAgentId} 未收录实装版本（时间线只做 S 级）`)
    const mainDate = VERSION_NODES[nodeIndexOf(mainRelease)]?.date
    if (!mainDate) throw new Error(`版本节点 ${mainRelease} 缺日期，无法映射演变轴`)

    // 演变轴：页面传入的危局期数轴优先；缺省由 VERSION_NODES 合成（回归兼容）。
    // 角色可用性按日期窗口匹配：实装日落在某节点 [date, 下一节点 date) 内即从该节点起可用
    //（期数中途实装也算该期）；早于轴起点的队友从轴起点可用。
    const defaultAxis: TimelineAxisNode[] = VERSION_NODES.map(n => ({
      id: n.id,
      label: n.label,
      date: n.date,
      testServer: (n.note ?? '').includes('测试服'),
    }))
    const fullAxis = (opts.axisNodes?.length ? opts.axisNodes : defaultAxis)
      .filter(a => a.testServer !== true || opts.includeTestServer === true)
    if (fullAxis.length === 0) throw new Error('演变轴为空（无可用期数）')
    // 主C实装日期不在轴内（如所选 Boss 首登晚于主C实装）→ 从轴起点开始；主C作为存量队友从起点可用
    const mainAxisIdx = Math.max(0, indexForDate(fullAxis, mainDate))
    const nodes: TimelineAxisNode[] = fullAxis.slice(mainAxisIdx)

    const releaseDateOf = (id: string) => {
      const rel = AGENT_RELEASE_NODE[id]
      return rel ? VERSION_NODES[nodeIndexOf(rel)]?.date : undefined
    }
    /** 实装 → 轴下标（未裁剪；-1 = 早于轴起点） */
    const axisIndexRaw = (id: string) => {
      const d = releaseDateOf(id)
      return d ? indexForDate(nodes, d) : -1
    }
    /** 实装 → 可用轴下标（早于轴起点钳制为 0 = 从轴起点可用） */
    const axisIndexFor = (id: string) => {
      const idx = axisIndexRaw(id)
      return idx < 0 ? 0 : idx
    }

    // Boss 一次应用（与节点无关）
    configStore.applyBossPreset({ id: opts.boss.id }, opts.phase, opts.boss.monster, opts.boss.defaults)

    // S 级候选（AGENT_RELEASE_NODE 收录即 S 级），排除主C；缺省排除测试服（3.2 未实装）角色
    const testNodes = new Set(
      VERSION_NODES.filter(n => (n.note ?? '').includes('测试服')).map(n => n.id),
    )
    // 显式传候选池时池子说了算（测试服角色也可被用户选入）；仅缺省全量模式排除测试服
    const candidates = (opts.candidatePool ?? Object.keys(AGENT_RELEASE_NODE))
      .filter(id => id !== opts.mainAgentId)
      .filter(id => opts.candidatePool?.length || opts.includeTestServer || !testNodes.has(AGENT_RELEASE_NODE[id]))
    // 队伍结构约束：至多 1 名击破（stun）。真实 meta 无双击破阵容（失衡窗口重叠浪费），
    // 且引擎失衡循环对双击破组合严重高估（实测 仪玄+莱卡恩+青衣 8金 ≈ 437% 血量，远高于
    // 单击破 meta 队 105-127%）；用户确认的演变路径（橘福福/卢西娅/琉音/诺姆）均为 ≤1 击破。
    const isStun = (id: string) => (catalog.getAgent(id)?.specialty ?? '') === 'stun'
    const stunBudget = isStun(opts.mainAgentId) ? 0 : 1

    // ---- 阶段 1：全对参考伤害（精确增量，每对只算一次）----
    // 按「较晚实装成员」的轴位置排序求值，让早期节点先完成（进度单调）
    const pairs: { a: string; b: string; at: number }[] = []
    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        const a = candidates[i]
        const b = candidates[j]
        if ((isStun(a) ? 1 : 0) + (isStun(b) ? 1 : 0) > stunBudget) continue
        pairs.push({ a, b, at: Math.max(axisIndexFor(a), axisIndexFor(b)) })
      }
    }
    pairs.sort((x, y) => x.at - y.at)

    const refDamage = new Map<string, number>()
    let nonConverged = 0
    let evalCount = 0
    const totalEval = pairs.length
    for (const { a, b } of pairs) {
      const team: [string, string, string] = [opts.mainAgentId, a, b]
      // 搜索排名用「预算感知确定性分配」（主C优先）：排名贴近所选金数下的真实强度，
      // 换人时机 = 该金数下变强的时刻（比基础金排名准确；最优加金仍由阶段 3 逐金贪婪给出）
      const { state } = budgetAwareStateFor(team, opts.budget, catalog)
      applyTeamToStore(configStore, team, state, opts.autoBuild === true)
      // 收敛过滤：失衡外层不动点未收敛（outerExit='maxIter'）的队伍伤害虚高不可信
      // （实测 青衣 系阵容 8金 407% vs 收敛 meta 队 105-127%），排除出排名
      const conv = calc.resourceResult.value?.convergence?.outerExit as 'stable' | 'cycle' | 'maxIter' | undefined
      if (conv === 'maxIter') {
        nonConverged++
      } else {
        refDamage.set(teamKey(opts.mainAgentId, a, b), calc.teamTotalDamage.value)
      }
      teamsEvaluated++
      evalCount++
      if (evalCount % 2 === 0) {
        report((evalCount / totalEval) * 0.75, `队伍搜索 ${evalCount}/${totalEval}（${catalog.getAgent(a)?.name.zhCN ?? a}+${catalog.getAgent(b)?.name.zhCN ?? b}）…`)
        await yieldNow()
      }
    }
    report(0.75, '队伍搜索完成，节点归并…')
    await yieldNow()

    // ---- 多队并存强度种子（用户口径「队伍×版本强度矩阵」，演示.xlsx）----
    // 池内每个收敛组合一条：damage 跨期恒定，startIndex = 双队友均实装的首个节点。
    const shortName = (id: string) => catalog.getAgent(id)?.name.zhCN?.[0] ?? id
    const strengthSeeds: TeamStrengthSeed[] = [...refDamage.entries()]
      .map(([key, dmg]) => {
        const [m, a, b] = key.split(',') as [string, string, string]
        const startNodeIdx = Math.max(axisIndexFor(a), axisIndexFor(b))
        return {
          key,
          team: [m, a, b] as [string, string, string],
          shortLabel: `${shortName(m)}${shortName(a)}${shortName(b)}`,
          damage: dmg,
          hpRatio: opts.phase.hp > 0 ? Math.round((dmg / opts.phase.hp) * 10000) / 100 : 0,
          startIndex: Math.max(0, startNodeIdx),
        }
      })
      .sort((x, y) => y.damage - x.damage)

    // ---- 阶段 2：每节点参考 Top-3（可达前缀）----
    // 当期新实装角色（候选池内按实装日期映射轴下标；主C已排除）——「实装未进队」判定用。
    // 用未钳制下标：早于轴起点的是存量队友，不算「当期新实装」
    const releasedAtByAxis = new Map<number, string[]>()
    for (const id of candidates) {
      const idx = axisIndexRaw(id)
      if (idx < 0) continue
      const list = releasedAtByAxis.get(idx) ?? []
      list.push(id)
      releasedAtByAxis.set(idx, list)
    }
    const top3ByNode: { key: string; dmg: number }[][] = []
    // 每节点「含 / 不含当期新实装角色」的最强参考伤害（同一 refDamage 空间，零额外求值）
    const newAgentStatsByNode: { agents: string[]; withNew: number; withoutNew: number }[] = []
    let running: { key: string; dmg: number }[] = []
    let pairPtr = 0
    for (let n = 0; n < nodes.length; n++) {
      while (pairPtr < pairs.length && pairs[pairPtr].at <= n) {
        const { a, b } = pairs[pairPtr]
        const key = teamKey(opts.mainAgentId, a, b)
        const dmg = refDamage.get(key)
        if (dmg !== undefined) running.push({ key, dmg })
        pairPtr++
      }
      const ranked = [...running].sort((x, y) => y.dmg - x.dmg)
      top3ByNode.push(ranked.slice(0, 3))
      const newHere = releasedAtByAxis.get(n) ?? []
      let stats: { agents: string[]; withNew: number; withoutNew: number } | null = null
      if (newHere.length > 0 && running.length > 0) {
        const newSet = new Set(newHere)
        let withNew = Number.NEGATIVE_INFINITY
        let withoutNew = Number.NEGATIVE_INFINITY
        for (const r of running) {
          const [, x, y] = r.key.split(',')
          if (newSet.has(x) || newSet.has(y)) withNew = Math.max(withNew, r.dmg)
          else withoutNew = Math.max(withoutNew, r.dmg)
        }
        if (withNew > Number.NEGATIVE_INFINITY && withoutNew > Number.NEGATIVE_INFINITY) {
          stats = { agents: newHere, withNew, withoutNew }
        }
      }
      newAgentStatsByNode.push(stats ?? { agents: [], withNew: 0, withoutNew: 0 })
    }

    // ---- 阶段 3：对 Top-3 队伍按所选金数做最优加金（逐金贪婪；optimalGold=false 轻量档跳过，零额外求值）----
    const goldCache = new Map<string, GoldAllocationResult>()
    if (opts.optimalGold) {
      const distinctTeams = new Set<string>()
      for (const tops of top3ByNode) for (const t of tops) distinctTeams.add(t.key)
      const distinctList = [...distinctTeams]
      for (let i = 0; i < distinctList.length; i++) {
        const key = distinctList[i]
        const [m, a, b] = key.split(',') as [string, string, string]
        const alloc = computeOptimalTeamAllocation(calc, configStore, [m, a, b], opts.budget, opts.autoBuild === true)
        goldCache.set(key, alloc)
        goldEvaluations += alloc.stepsEvaluated
        report(0.75 + (i / distinctList.length) * 0.22, `加金优化 ${i + 1}/${distinctList.length}（${catalog.getAgent(a)?.name.zhCN ?? a}+${catalog.getAgent(b)?.name.zhCN ?? b}）…`)
        if (i % 2 === 0) await yieldNow()
      }
    }

    // ---- 阶段 4：节点结果装配 ----
    const mainAgent = catalog.getAgent(opts.mainAgentId)
    const nodesResult: TimelineNodeResult[] = []
    for (let n = 0; n < nodes.length; n++) {
      const tops = top3ByNode[n]
      if (tops.length === 0) {
        // 该节点无收敛队伍：沿用上一节点结果（首次节点无收敛时跳过该节点）
        if (nodesResult.length > 0) {
          const prev = nodesResult[nodesResult.length - 1]
          nodesResult.push({ ...prev, nodeId: nodes[n].id, nodeLabel: nodes[n].label })
          continue
        }
        continue
      }
      let best = tops[0]
      if (opts.optimalGold) {
        for (const t of tops) {
          const a1 = goldCache.get(t.key)!
          const a2 = goldCache.get(best.key)!
          if (a1.damage > a2.damage + 1e-9) best = t
        }
      }
      const team = best.key.split(',') as [string, string, string]
      // 轻量档：排名伤害（阶段1参考值）直接复用——同队跨期面对同一 Boss 数值不变，仅当期 buff 不同（不参与）
      const alloc = opts.optimalGold ? goldCache.get(best.key) : null
      const budgetAware = alloc ? null : budgetAwareStateFor(team, opts.budget, catalog)
      const damage = alloc ? alloc.damage : refDamage.get(best.key)!
      const totalGold = alloc ? alloc.totalGold : budgetAware!.totalGold
      const goldLabel = alloc ? alloc.label : budgetAware!.label
      const nodeState: TeamGoldState = alloc
        ? { cinemas: alloc.cinemas, wengineMods: alloc.wengineMods, wEngines: alloc.wEngines }
        : budgetAware!.state
      const hpRatio = opts.phase.hp > 0 ? Math.round((damage / opts.phase.hp) * 10000) / 100 : 0
      const prev = nodesResult[n - 1]
      let swappedIn: string | undefined
      let swappedOut: string | undefined
      if (prev && prev.team.join() !== team.join()) {
        for (let s = 1; s < 3; s++) {
          if (prev.team[s] !== team[s]) {
            swappedOut = prev.team[s]
            swappedIn = team[s]
          }
        }
      }
      // 换人判定：本节点最优队 vs 上一节点旧队伤害（同预算各自配装态）
      const swapCls = prev && swappedIn ? classifySwapUplift(prev.damage, damage) : null
      // 实装未进队：当期新角色全部不在展示队伍里 → 参考伤害差距定平替/未上位
      // （gapPct ≥ 0 说明参考最强含新角色但最优加金后被反超，排名分歧场景不标注）
      const stats = newAgentStatsByNode[n]
      let newAgentBench: NewAgentBench | undefined
      if (stats.agents.length > 0 && !stats.agents.some(a => team.includes(a))) {
        const gapPct = Math.round(((stats.withNew - stats.withoutNew) / stats.withoutNew) * 1000) / 10
        if (gapPct < 0) {
          newAgentBench = {
            agents: stats.agents,
            kind: gapPct > -SWAP_UPGRADE_UPLIFT_PCT ? 'lateral' : 'worse',
            gapPct,
          }
        }
      }
      nodesResult.push({
        nodeId: nodes[n].id,
        nodeLabel: nodes[n].label,
        ...(nodes[n].testServer ? { nodeNote: '测试服数据' } : {}),
        team,
        state: nodeState,
        totalGold,
        goldLabel,
        damage,
        hpRatio,
        ...(swappedIn ? { swappedIn, swappedOut } : {}),
        ...(swapCls ? { swapKind: swapCls.kind, swapUpliftPct: swapCls.pct } : {}),
        ...(newAgentBench ? { newAgentBench } : {}),
      })
    }

    const swapEvents: TeamTimelineSwapEvent[] = nodesResult
      .filter(r => r.swappedIn)
      .map(r => ({
        nodeId: r.nodeId,
        nodeLabel: r.nodeLabel,
        swappedIn: r.swappedIn!,
        swappedOut: r.swappedOut!,
        ...(r.swapKind ? { swapKind: r.swapKind, swapUpliftPct: r.swapUpliftPct } : {}),
      }))

    report(1, `完成：${nodesResult.length} 个节点，${swapEvents.length} 次换人`)
    return {
      mainAgentId: opts.mainAgentId,
      mainName: mainAgent?.name.zhCN ?? opts.mainAgentId,
      budget: opts.budget,
      bossName: opts.boss.name,
      phaseLabel: opts.phase.label,
      nodes: nodesResult,
      swapEvents,
      strengthSeeds,
      stats: { teamsEvaluated, nonConverged, goldEvaluations, durationMs: Date.now() - t0 },
    }
  } finally {
    restoreStore(configStore, snap)
  }
}

// ========== Chart 3：每期新角色 · 强队强度（横轴 = 版本，点 = 当期新角色强队） ==========
//
// 用户口径（2026-08-23）：横轴 = 版本（卡池期节点）；每个点 = 该期新 S 角色的「强队」，
// 强队完全由**用户手填**（页面可编辑，预填口述清单 STRONG_TEAM_PRESETS，不提供引擎建议——
// 引擎搜出来的组合偏差大，本图只是用户填什么就展示什么的展示层）；
// **同一时间点（同一角色）可配置多支队伍**，各出一独立点。
// 强度按**当前全部已实装**（队伍可含晚于主C实装的队友）+ 所选金数配装
// （optimalGold=false 轻量档 = 主C优先确定性分配）。
// 行清单排除 1.0 常驻 S（用户口径：常驻 S 不是「当期新角色」，不占行）。

/** 一行 = 一个版本节点的「当期新 S 角色」（强队由用户手填，可多支） */
export interface NewCharacterRow {
  nodeId: string
  nodeLabel: string
  nodeNote?: string
  charId: string
}

/** 全部版本节点 × 当期新 S 角色 → 行清单（含测试服节点行带 note；排除 1.0 常驻 S） */
export function buildNewCharacterRows(): NewCharacterRow[] {
  const rows: NewCharacterRow[] = []
  for (const node of VERSION_NODES) {
    for (const [id, nodeId] of Object.entries(AGENT_RELEASE_NODE)) {
      if (nodeId !== node.id) continue
      if (STANDARD_S_AGENT_IDS.has(id)) continue // 1.0 常驻 S 不是当期新角色（用户口径）
      rows.push({
        nodeId: node.id,
        nodeLabel: node.label,
        ...(node.note ? { nodeNote: node.note } : {}),
        charId: id,
      })
    }
  }
  return rows
}

/** 一个点 = 用户清单里某新角色的某支强队（按所选金数配装）的强度 */
export interface NewCharacterPoint {
  charId: string
  charName: string
  nodeId: string
  nodeLabel: string
  nodeNote?: string
  team: [string, string, string]
  /** 该角色第几支队伍（0 起；同角色多队伍展示用） */
  teamIndex: number
  state: TeamGoldState
  totalGold: number
  goldLabel: string
  damage: number
  hpRatio: number
}

export interface NewCharacterChartOptions {
  rows: NewCharacterRow[]
  /** charId → 用户手填的强队列表（每支含主C，3 名不同角色；空/缺省/重复成员 = 不出点） */
  teams: Record<string, [string, string, string][]>
  boss: BossPreset
  phase: BossPresetPhase
  budget: number
  /** 自动配装（推荐驱动盘 + 词条优化器）；缺省 false = 轻量速算 */
  autoBuild?: boolean
  /** 最优加金（逐金贪婪）；缺省 false = 主C优先确定性分配（与排名同源） */
  optimalGold?: boolean
  onProgress?: (p: { pct: number; text: string }) => void
}

/**
 * 计算 Chart 3 各点：对用户清单里每个已配置强队（同角色多队各出一点），按所选金数配装
 * （optimalGold=false 轻量档用 budgetAwareStateFor，零额外求值；true 用逐金贪婪），
 * 收敛过滤 + 现场快照/恢复。
 */
export async function computeNewCharacterPoints(calc: Calc, opts: NewCharacterChartOptions): Promise<NewCharacterPoint[]> {
  const configStore = useConfigStore()
  const catalog = useCatalogStore()
  const snap = snapshotStore(configStore)
  const report = (pct: number, text: string) => opts.onProgress?.({ pct, text })
  try {
    configStore.applyBossPreset({ id: opts.boss.id }, opts.phase, opts.boss.monster, opts.boss.defaults)
    // 展开成 (行, 队) 平铺：同角色多队各一任务
    const tasks: { row: NewCharacterRow; team: [string, string, string] }[] = []
    for (const row of opts.rows) {
      for (const team of opts.teams[row.charId] ?? []) {
        if (new Set(team).size === 3 && team.every(id => id && catalog.getAgent(id))) {
          tasks.push({ row, team })
        }
      }
    }
    const points: NewCharacterPoint[] = []
    for (let i = 0; i < tasks.length; i++) {
      const { row, team } = tasks[i]
      let damage: number
      let totalGold: number
      let goldLabel: string
      let nodeState: TeamGoldState
      if (opts.optimalGold) {
        const alloc = computeOptimalTeamAllocation(calc, configStore, team, opts.budget, opts.autoBuild === true)
        // 基础态未收敛 → 返回 -Inf，跳过该点
        if (!Number.isFinite(alloc.damage)) continue
        damage = alloc.damage
        totalGold = alloc.totalGold
        goldLabel = alloc.label
        nodeState = { cinemas: alloc.cinemas, wengineMods: alloc.wengineMods, wEngines: alloc.wEngines }
      } else {
        const budgetAware = budgetAwareStateFor(team, opts.budget, catalog)
        applyTeamToStore(configStore, team, budgetAware.state, opts.autoBuild === true)
        const conv = calc.resourceResult.value?.convergence?.outerExit as 'stable' | 'cycle' | 'maxIter' | undefined
        if (conv === 'maxIter') continue
        damage = calc.teamTotalDamage.value
        totalGold = budgetAware.totalGold
        goldLabel = budgetAware.label
        nodeState = budgetAware.state
      }
      const char = catalog.getAgent(row.charId)
      points.push({
        charId: row.charId,
        charName: char?.name.zhCN ?? row.charId,
        nodeId: row.nodeId,
        nodeLabel: row.nodeLabel,
        ...(row.nodeNote ? { nodeNote: row.nodeNote } : {}),
        team,
        teamIndex: (opts.teams[row.charId] ?? []).indexOf(team),
        state: nodeState,
        totalGold,
        goldLabel,
        damage,
        hpRatio: opts.phase.hp > 0 ? Math.round((damage / opts.phase.hp) * 10000) / 100 : 0,
      })
      report((i + 1) / tasks.length, `强队强度 ${i + 1}/${tasks.length}（${char?.name.zhCN ?? row.charId}）…`)
      if (i % 2 === 0) await yieldNow()
    }
    report(1, `完成：${points.length} 个点`)
    return points
  } finally {
    restoreStore(configStore, snap)
  }
}

/** 预填 Chart 3 强队清单：用户口述预设（STRONG_TEAM_PRESETS）优先，仓库 preset 队伍补剩余（同主C取 goldSteps 最多者——配置最完整；平手取后者） */
export function prefillStrongTeamsFromPresets(): Record<string, [string, string, string]> {
  const out: Record<string, [string, string, string]> = { ...STRONG_TEAM_PRESETS }
  const bestSteps: Record<string, number> = {}
  for (const p of teamPresets) {
    const main = p.team[0]
    if (!main || out[main]) continue
    const steps = p.goldSteps?.length ?? 0
    if (!(main in bestSteps) || steps >= bestSteps[main]) {
      bestSteps[main] = steps
      out[main] = [p.team[0], p.team[1], p.team[2]]
    }
  }
  return out
}

// ========== Chart 4：菲林经济模拟（选定 Boss + 主C，逐期菲林投放 → 加金 → 当期 Boss 强度） ==========
//
// 用户口径（2026-08-23 修订）：
// - 横轴 = 危局期数（含日期）；纵轴 = 队伍强度（伤害/该期 Boss 血量 %）。
// - **选的是主C不是队伍**：加金可让队友换人（如 琉音换青衣、卢西娅换潘引壶——主C 固定，
//   队友 = 候选池内「当前总限定金下伤害最高」的双人组，随金数增长自动换队）。
// - 每个版本有菲林投放（默认 ≈ 1 金 = 15000 菲林，可编辑）；按「消耗占比」决定每期花多少
//   抽卡、存多少（如给 1 金用半金 = 0.5）；「目标卡池」期把银行菲林全部投入抽卡加金。
// - 抽卡成本按期望（萌百·游戏内调频详情）：命座金 = 93.75 抽 = 15000 菲林；
//   音擎金 = 62.5 抽 = 10000 菲林（角色池 1.6% 综率 × 50/50 保底；音擎池 2% 综率 × 75/25 保底）。
// - **充值 = 用户只输入每版本预算（元），按性价比固定分配**（汇率不可改）：
//   月卡（30 元 → 3300 菲林）> 大月卡（68 元 → ≈2600 菲林）> 直充（10 菲林/元），
//   见 data/filmEconomy.ts allocateTopUpFilm。
// - 买金顺序 = 当前最优队的主C 优先步（buildBudgetAwareGoldSteps：主C 影画 1-6 → 主C 精炼
//   2-5 → 队友…）；初始金数可设定（低于基础金自动钳制到 0 命 1 精带专武）。
// - **起点 = 主C 首次 UP 之后的 Boss 初登场**（axisNodes 按主C 实装日期裁剪）。
// - 每期只算「当前期数」的 Boss 血量与关卡固有 buff（layer_buff，期视图有数据才应用）+ 队伍。

import { CINEMA_GOLD_FILM, WEAPON_GOLD_FILM, PERIODS_PER_VERSION, allocateTopUpFilm } from '@/data/filmEconomy'
import type { PhaseBossBrief, PhaseView } from '@/types/bossPreset'

/** 模拟一个点的结果（一个危局期数） */
export interface FilmSimPoint {
  periodId: string
  seq: number
  label: string
  date: string
  team: [string, string, string]
  /** 该期总限定金（初始金 + 已购金步） */
  totalGold: number
  /** 该期配装明细（budgetAware label） */
  goldLabel: string
  /** 期初累计剩余菲林 */
  filmBank: number
  /** 本期投入抽卡的菲林 */
  filmSpent: number
  /** 累计已投入抽卡的菲林 */
  filmInvestedTotal: number
  damage: number
  hpRatio: number
}

export interface FilmSimulationOptions {
  boss: BossPreset
  /** 危局期数轴（id = phaseId；label/date 由页面从 bossSchedule 构造） */
  axisNodes: TimelineAxisNode[]
  /** 期视图（当期关卡固有 buff 数据；缺省空 = 老期无 buff） */
  periodViews: PhaseView[]
  /** 主C（固定；队友从候选池搜最优） */
  mainAgentId: string
  /** 队友候选池（用户策展；主C 自动排除；每期按当前总限定金搜最优双人组） */
  candidatePool: string[]
  /** 初始总限定金（低于基础金自动钳制） */
  initialGold: number
  /** 每版本免费菲林（默认 15000 ≈ 1 金） */
  filmPerVersion: number
  /** 消耗占比 0-1：每期菲林花多少抽卡（其余存银行） */
  spendRatio: number
  /** 每版本充值预算（元，0 = 不充）——按性价比固定分配（月卡→大月卡→直充，汇率不可改） */
  budgetYuanPerVersion: number
  /** 目标卡池期（期 id）：该期把银行菲林全部投入抽卡 */
  targetPeriodId?: string
  /** 自动配装（推荐驱动盘 + 词条优化器）；缺省 false = 轻量速算 */
  autoBuild?: boolean
  onProgress?: (p: { pct: number; text: string }) => void
}

export interface FilmSimulationResult {
  points: FilmSimPoint[]
  stats: { nonConverged: number; durationMs: number }
}

/** 期视图里选定 Boss 的关卡固有 buff → 写入全局 Buff 表（先清旧 layer-buff:，同 BossSelectCard） */
function applyPeriodLayerBuffs(
  configStore: ReturnType<typeof useConfigStore>,
  periodViews: PhaseView[],
  periodId: string,
  boss: BossPreset,
) {
  for (let i = configStore.globalBuffs.length - 1; i >= 0; i--) {
    if (String(configStore.globalBuffs[i].id).startsWith('layer-buff:')) configStore.globalBuffs.splice(i, 1)
  }
  const view = periodViews.find(v => v.phaseId === periodId)
  if (!view) return
  const brief = ([view.criticalAssault, ...(view.defense ?? [])].filter(Boolean) as PhaseBossBrief[])
    .find(b => b.presetId === boss.id)
  if (!brief) return
  for (const card of brief.bossBuffs ?? []) {
    for (const e of card.effects) {
      configStore.globalBuffs.push({
        id: `layer-buff:${brief.monsterId}:${e.stat}:${e.value}`,
        name: `关卡·${brief.name}`,
        stat: e.stat,
        value: e.value,
        enabled: true,
        targetSkillType: e.targetSkillType ?? ('all' as any),
      })
    }
  }
}

/** 下一个待购金步的成本（主C 优先顺序）：影画 = 命座金，音擎（本体/精炼）= 音擎金 */
function nextGoldStepCost(
  team: [string, string, string],
  totalGold: number,
  catalog: ReturnType<typeof useCatalogStore>,
): number | null {
  const base = baseGoldOfTeam(team, catalog)
  const { steps } = buildBudgetAwareGoldSteps(team, catalog)
  const idx = totalGold - base
  if (idx < 0 || idx >= steps.length) return null
  return steps[idx].kind === 'cinema' ? CINEMA_GOLD_FILM : WEAPON_GOLD_FILM
}

/**
 * 菲林经济模拟：主C 固定，每期发菲林（+预算按性价比折算）→ 按占比花/存 →
 * 抽卡资金按当前最优队的主C 优先步买金 → 用「当前期数」Boss 数值 + 关卡固有 buff，
 * 在候选池内搜「当前总限定金下伤害最高」的双队友组合求队伍强度（队友随金数增长可换人）。
 */
export async function computeFilmSimulation(calc: Calc, opts: FilmSimulationOptions): Promise<FilmSimulationResult> {
  const configStore = useConfigStore()
  const catalog = useCatalogStore()
  const snap = snapshotStore(configStore)
  const t0 = Date.now()
  const report = (pct: number, text: string) => opts.onProgress?.({ pct, text })
  try {
    // 起点 = 主C 首次 UP 之后的 Boss 登场期（用户口径；主C 实装前的期不算）
    const mainRelease = releaseNodeOf(opts.mainAgentId)
    const mainDate = mainRelease ? VERSION_NODES[nodeIndexOf(mainRelease)]?.date : undefined
    const axis = opts.axisNodes.filter(n => !mainDate || (n.date ?? '') >= mainDate)
    if (axis.length === 0) {
      report(1, '主C 首次 UP 之后无该 Boss 登场期')
      return { points: [], stats: { nonConverged: 0, durationMs: Date.now() - t0 } }
    }

    // 候选双队友（主C 排除；至多 1 击破；预算感知配装）
    const isStun = (id: string) => (catalog.getAgent(id)?.specialty ?? '') === 'stun'
    const stunBudget = isStun(opts.mainAgentId) ? 0 : 1
    const candidates = opts.candidatePool.filter(id => id !== opts.mainAgentId && catalog.getAgent(id))
    const pairs: [string, string][] = []
    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        const a = candidates[i]
        const b = candidates[j]
        if ((isStun(a) ? 1 : 0) + (isStun(b) ? 1 : 0) > stunBudget) continue
        pairs.push([a, b])
      }
    }
    if (pairs.length === 0) {
      report(1, '候选池不足（至少 2 名非主C队友）')
      return { points: [], stats: { nonConverged: 0, durationMs: Date.now() - t0 } }
    }

    /** 在当期 Boss/buff（已应用）下搜「当前总限定金」的最优双队友组合（预算感知 + 收敛过滤） */
    const searchBest = (totalGold: number): { team: [string, string, string]; damage: number; budgetAware: ReturnType<typeof budgetAwareStateFor> } | null => {
      let best: { team: [string, string, string]; damage: number; budgetAware: ReturnType<typeof budgetAwareStateFor> } | null = null
      for (const [a, b] of pairs) {
        const team: [string, string, string] = [opts.mainAgentId, a, b]
        if (baseGoldOfTeam(team, catalog) > totalGold) continue // 买不起
        const budgetAware = budgetAwareStateFor(team, totalGold, catalog)
        applyTeamToStore(configStore, team, budgetAware.state, opts.autoBuild === true)
        const conv = calc.resourceResult.value?.convergence?.outerExit as 'stable' | 'cycle' | 'maxIter' | undefined
        if (conv === 'maxIter') continue
        const dmg = calc.teamTotalDamage.value
        if (!best || dmg > best.damage + 1e-9) best = { team, damage: dmg, budgetAware }
      }
      return best
    }

    const minPairBase = Math.min(...pairs.map(([a, b]) => baseGoldOfTeam([opts.mainAgentId, a, b], catalog)))
    let totalGold = Math.max(opts.initialGold, minPairBase) // 初始金低于最便宜队基础金 → 钳到最便宜队
    let bank = 0
    let filmWallet = 0 // 抽卡资金（累计投入，买金步前先攒）
    let filmInvestedTotal = 0
    const topUpFilm = allocateTopUpFilm(opts.budgetYuanPerVersion)
    const filmPerPeriod = (opts.filmPerVersion + topUpFilm) / PERIODS_PER_VERSION
    const points: FilmSimPoint[] = []
    let nonConverged = 0
    const total = axis.length
    for (let i = 0; i < total; i++) {
      const node = axis[i]
      // 当前期数 Boss + 关卡固有 buff 一次应用（本期所有候选队共用）
      const phase = opts.boss.phases.find(p => p.phaseId === node.id)
        ?? opts.boss.phases.find(p => p.begin.slice(0, 10) === (node.date ?? '').slice(0, 10))
      if (!phase) continue
      configStore.applyBossPreset({ id: opts.boss.id }, phase, opts.boss.monster, opts.boss.defaults)
      applyPeriodLayerBuffs(configStore, opts.periodViews, node.id, opts.boss)
      // ---- 经济：收入 → 存/花 ----
      const ratio = Math.max(0, Math.min(1, opts.spendRatio))
      bank += filmPerPeriod * (1 - ratio)
      let spend = filmPerPeriod * ratio
      if (node.id === opts.targetPeriodId && bank > 0) {
        spend += bank
        bank = 0
      }
      filmWallet += spend
      filmInvestedTotal += spend
      // ---- 买金：按当前最优队的下一步成本；换队时累计金数按新队主C 优先重新解释 ----
      let guard = 0
      while (guard++ < 40) {
        const best = searchBest(totalGold)
        if (!best) break
        const cost = nextGoldStepCost(best.team, totalGold, catalog)
        if (cost == null || filmWallet < cost) break
        filmWallet -= cost
        totalGold++
      }
      // ---- 最终最优队 + 本期强度 ----
      const best = searchBest(totalGold)
      if (!best) {
        nonConverged++
        continue
      }
      points.push({
        periodId: node.id,
        seq: i + 1,
        label: node.label,
        date: node.date,
        team: best.team,
        totalGold,
        goldLabel: best.budgetAware.label,
        filmBank: Math.round(bank),
        filmSpent: Math.round(spend),
        filmInvestedTotal: Math.round(filmInvestedTotal),
        damage: best.damage,
        hpRatio: phase.hp > 0 ? Math.round((best.damage / phase.hp) * 10000) / 100 : 0,
      })
      report((i + 1) / total, `期 ${node.label}：${totalGold} 金（${filmInvestedTotal.toFixed(0)} 菲林投入）…`)
      if (i % 2 === 0) await yieldNow()
    }
    report(1, `完成：${points.length} 期`)
    return { points, stats: { nonConverged, durationMs: Date.now() - t0 } }
  } finally {
    restoreStore(configStore, snap)
  }
}

