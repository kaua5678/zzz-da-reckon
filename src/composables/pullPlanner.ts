/**
 * 抽卡规划器（时间图表页 Chart 6 数据服务）——纯逻辑核心，引擎经 oracle 注入。
 *
 * 问题（用户口径 2026-08-28）：从起点节点、每版本 25000 菲林免费收入出发，规划限定卡
 * 抽取策略，最大化危局总分。形式化 = 带可用性窗口的多期资本预算（Weingartner 1963 谱系；
 * 窗口内「可购买」而非 TKP 的窗口内「占用」，引用时区分）：
 * - 卡 = 限定 S（首 UP 窗口唯一可购；复刻不建模——最优规划下复刻补抽要求资源受限且
 *   复刻期无更强新卡，两者都罕见，用户认同直接砍掉）。
 * - 购买阶梯（每卡三档，音擎金更便宜是用户口径）：本体 15000 菲林（1 命座金）→
 *   专武 10000 菲林（1 音擎金）→ 满配 = 本体+专武+6 影画+4 精炼（11 金，v1 单步）。
 * - 每期结算 = 3 个危局 Boss × 不重叠 3 人队（角色跨房间不可复用，共 9 人约束）；
 *   分数 = 60000 × min(1, 伤害/HP)（只算伤害分；操作分是附加分、已剔除）。
 * - 贬值内生：不设折现参数——老卡分数下降由每期 Boss 血量/抗性与 layer buff 数据自然涌现。
 *
 * 算法：beam search（无一般近似保证，Ow & Morton 1988；niche 协同破坏次模性，贪心的
 * 常数因子保证不适用——NWF 1978 / Sviridenko 2004 / Krause & Guestrin 2005 均需次模，
 * 卢西娅式「单拿弱配命破 C 强」的边际不减结构恰是 beam 的保留多样性所要对抗的）。
 * 状态 = (持有集, 银行菲林)；每版本节点展开「买 X（窗口内可购的下一档）/ 攒着」分支；
 * 节点价值 = 该期 3-Boss 不重叠组队的 oracle 最优解（内层，见 engineOracles 的
 * pickPeriodAssignment——每 Boss Top-M 队伍的三维不重叠匹配）。
 *
 * 价值归因：VCG 反事实差分（Vickrey 1961 / Clarke 1971 / Groves 1973 的边际外部性口径）——
 * 卡 c 的价值 = V(规划器 | c 可购) − V(规划器 | c 永不可购)，重规划非禁用。
 * 命座/专武档同理：禁用该卡的所有后续档。同一引擎同一算法，成型号与新号起点
 * 会给同一张卡不同估值（持有集条件化，即用户「比利 vs 维琳娜」例子的形式化）。
 */
import { CINEMA_GOLD_FILM, WEAPON_GOLD_FILM, PLANNER_FILM_PER_VERSION } from '@/data/filmEconomy'

// ========== 类型 ==========

/** 危局一期（横轴节点）：日期 + 各 Boss 的预设定位 + 分数函数参数 */
export interface PlannerPeriod {
  /** 期 id（phaseId，如 '690431'） */
  id: string
  label: string
  /** 期开始日 YYYY-MM-DD */
  date: string
  /** 该期的 Boss 房间（只含有预设的；早期数据不全按实际算） */
  bosses: PlannerBossRoom[]
}

export interface PlannerBossRoom {
  /** BossPreset.id */
  bossId: string
  /** 该期相位 id（boss.phases 里定位数值用） */
  phaseId: string
  bossName: string
  hp: number
}

/**
 * 组队 oracle：给定持有集，返回某 Boss 房间候选队伍（按理论分数降序）。
 * 引擎实现见 engineOracles.ts（teamTimeline 底座 + 伤害→分数映射 + maxIter 过滤 + 缓存）。
 */
export interface TeamOracle {
  /**
   * @param bossRoom 房间（Boss × 期相位）
   * @param holdings 持有集：agentId → 已购档位（0 = 未持有，见 PurchaseTier）
   * @returns 候选队伍列表（理论分数降序；内层匹配只取前 M 条做分支定界）
   */
  candidates(bossRoom: PlannerBossRoom, holdings: Record<string, number>): Array<{
    team: [string, string, string]
    /** 理论分数（60000×伤害比，只算伤害分） */
    score: number
  }>
}

/** 购买档位（阶梯：0 < 1 < 2 < 3） */
export type PurchaseTier = 0 | 1 | 2 | 3
/** tier 语义：0 = 未持有；1 = 本体（15000）；2 = 本体+专武（+10000）；3 = 满配（+剩余全部） */
export const TIER_COSTS: Record<Exclude<PurchaseTier, 0>, number> = {
  1: CINEMA_GOLD_FILM,
  2: WEAPON_GOLD_FILM,
  3: CINEMA_GOLD_FILM * 6 + WEAPON_GOLD_FILM * 4,
}
export const TIER_LABELS: Record<PurchaseTier, string> = {
  0: '未持有',
  1: '本体',
  2: '本体+专武',
  3: '满配（本体+专武+6影画+4精炼）',
}

/** 可购卡（限定 S；首 UP 窗口唯一） */
export interface PlannerCard {
  agentId: string
  /** 首发 UP 窗口：起始日（版本节点日期） */
  windowStart: string
  /** 起点即持有的初始档位（自选持有预设用；缺省 0） */
  initialTier?: PurchaseTier
}

export interface PlannerOptions {
  /** 可购卡全集（含窗口日期；复刻不建模） */
  cards: PlannerCard[]
  /** 危局期数轴（时间升序；只含有 Boss 预设的期） */
  periods: PlannerPeriod[]
  /** 起点日期（含）：早于起点的期不计分 */
  startDate: string
  /** 起点银行菲林 */
  initialBank: number
  /** 每版本免费菲林（用户口径默认 25000）；按版本边界发放 */
  filmPerVersion: number
  /** beam 宽度 */
  beamWidth: number
  /** 内层每 Boss 取前 M 候选做不重叠匹配 */
  assignmentTopM: number
  /** 组队 oracle（引擎注入；测试可注入假 oracle） */
  oracle: TeamOracle
  onProgress?: (p: { pct: number; text: string }) => void
  /** 每期结算前回调（引擎 oracle 在此切换 Boss/期相位上下文；纯逻辑测试无需传） */
  onPeriod?: (period: PlannerPeriod) => void
}

// ========== 版本边界（菲林发放粒度） ==========

/**
 * 每版本发一次菲林：同一日历天内可能有多个期（如同日开赛的 3.2 两期），
 * 按「日期变化」判定版本边界；首期不发（起点预算 = initialBank）。
 */
function filmGrants(periods: PlannerPeriod[], filmPerVersion: number): number[] {
  const out: number[] = []
  let prevDate = ''
  for (const p of periods) {
    const isNewVersion = p.date !== prevDate && prevDate !== ''
    out.push(isNewVersion ? filmPerVersion : 0)
    prevDate = p.date
  }
  return out
}

// ========== 每期结算：3-Boss 不重叠组队（内层） ==========

export interface PeriodAssignment {
  periodId: string
  /** 每房间选中的队伍（与 bosses 同序） */
  picks: Array<{ bossRoom: PlannerBossRoom; team: [string, string, string]; score: number }>
  /** 该期总分（房间分求和；房间数不足 3 的期按实际） */
  totalScore: number
}

/**
 * 单期不重叠组队：每 Boss 取 oracle 候选，DFS 选「每房间一队、9 人不重叠」的分数最大
 * 组合（早期数据不全的期房间数 < 3 也成立）。
 *
 * topM 截断用「分桶多样化」：纯分数序截断会让前 M 名全含同一个最强角色（真实引擎下
 * 即「每个 Boss 的最优队都想要主C」），第 2 房起全部重叠 → DFS 无解。分桶 = 按队伍
 * 首成员（最强位）分桶、每桶取桶内前 ceil(M/桶数)——保证不同「主C」的队都有代表，
 * 不重叠匹配才有可行解空间。桶内仍按分数降序。
 */
export function pickPeriodAssignment(
  oracle: TeamOracle,
  period: PlannerPeriod,
  holdings: Record<string, number>,
  topM: number,
): PeriodAssignment {
  // 候选池：首试用「分桶多样化截断」；DFS 无解（桶代表队高度重叠，3 房选不出 9 个
  // 不重叠的人——实测同组三人互相是各桶 top1）则扩大到 topM×4 重试（仍远小于全量）。
  const rawCands = period.bosses.map(b => oracle.candidates(b, holdings))
  const diverse = (raw: Array<{ team: [string, string, string]; score: number }>, limit: number) => {
    if (raw.length <= limit) return raw
    const byLead = new Map<string, Array<{ team: [string, string, string]; score: number }>>()
    for (const c of raw) {
      const lead = c.team[0]
      const arr = byLead.get(lead) ?? []
      arr.push(c)
      byLead.set(lead, arr)
    }
    const perBucket = Math.max(1, Math.ceil(limit / Math.max(1, byLead.size)))
    const out: Array<{ team: [string, string, string]; score: number }> = []
    for (const arr of byLead.values()) out.push(...arr.slice(0, perBucket))
    return out.sort((a, b) => b.score - a.score).slice(0, limit)
  }
  /** 一次 DFS 尝试；返回最优（无解 = null） */
  interface AttemptResult { bestTeams: Array<[string, string, string]>; bestScore: number }
  const attempt = (cands: Array<Array<{ team: [string, string, string]; score: number }>>): AttemptResult | null => {
    let best: AttemptResult | null = null
    const used = new Set<string>()
    const chosen: Array<[string, string, string] | null> = period.bosses.map(() => null)
    const dfs = (room: number, score: number) => {
      if (room === period.bosses.length) {
        if (best == null || score > best.bestScore) {
          // 闭包内赋值闭包外变量：TS 控制流分析会把直接 let 视为 never，用整对象赋值绕开
          best = { bestScore: score, bestTeams: chosen.map(c => (c ?? ['', '', '']) as [string, string, string]) }
        }
        return
      }
      for (const c of cands[room]) {
        if (c.team.some(m => used.has(m))) continue
        c.team.forEach(m => used.add(m))
        chosen[room] = c.team
        dfs(room + 1, score + c.score)
        chosen[room] = null
        c.team.forEach(m => used.delete(m))
      }
    }
    dfs(0, 0)
    return best
  }
  let result: AttemptResult | null = attempt(rawCands.map(raw => diverse(raw, topM)))
  if (!result) result = attempt(rawCands.map(raw => diverse(raw, topM * 4)))
  if (!result) {
    // 兜底贪心：桶截断候选无解（小池完美划分稀疏）时，逐房取「与已用人不重叠的最高分队」
    // ——保证有解（DFS 最优性让位于可行性；beam 下一期仍会重新搜索）。
    const used = new Set<string>()
    const teams: Array<[string, string, string]> = []
    for (const raw of rawCands) {
      const c = raw.find(c => !c.team.some(m => used.has(m)))
      if (c) {
        c.team.forEach(m => used.add(m))
        teams.push([...c.team] as [string, string, string])
      } else {
        teams.push(['', '', ''])
      }
    }
    result = { bestTeams: teams, bestScore: -1 }
  }
  const picks = (result?.bestTeams ?? period.bosses.map(() => ['', '', ''] as [string, string, string])).map((team, i) => ({
    bossRoom: period.bosses[i],
    team,
    score: result ? (rawCands[i].find(c => c.team.join() === team.join())?.score ?? 0) : 0,
  }))
  return {
    periodId: period.id,
    picks,
    totalScore: picks.reduce((s, p) => s + p.score, 0),
  }
}

// ========== 购买阶梯 ==========

/** 卡的下一档与成本；窗口外 / 已满配 / 档位跳跃（initialTier>1 且未按序）返回 null */
export function nextPurchase(card: PlannerCard, tier: number, date: string): { tier: Exclude<PurchaseTier, 0>; cost: number } | null {
  if (date < card.windowStart) return null // 首UP窗口未开
  // 窗口无上界（首 UP 窗口唯一 + 复刻不建模：窗口开后任意后续节点都可买——
  // 实务上最优规划几乎总在首发当期或紧邻期购买，攒着跨多期买 = 实物期权，规划器自动权衡）
  const next = (tier + 1) as Exclude<PurchaseTier, 0>
  if (next > 3) return null
  if (next === 3 && tier < 2) return null // 满配必须先有本体+专武（阶梯不跳档）
  return { tier: next, cost: TIER_COSTS[next] }
}

// ========== Beam Search 主流程 ==========

export interface PlannerStep {
  periodId: string
  periodLabel: string
  date: string
  /** 本期入手的购买（agentId → 新档位） */
  purchases: Array<{ agentId: string; tier: Exclude<PurchaseTier, 0>; cost: number }>
  /** 期初银行（发薪后、购买前） */
  bankBefore: number
  bankAfter: number
  assignment: PeriodAssignment
}

export interface PlannerResult {
  /** 规划期数（结算过的） */
  steps: PlannerStep[]
  /** 总分 */
  totalScore: number
  /** 终态持有集 */
  holdings: Record<string, number>
  /** 终态银行 */
  finalBank: number
  /** 累计花费菲林 */
  totalSpent: number
  stats: { beamStates: number; oracleCalls: number }
}

interface BeamState {
  holdings: Record<string, number>
  bank: number
  score: number
  spent: number
  /** 购买轨迹（浅拷贝追加） */
  history: PlannerStep[]
}

function holdingsKey(h: Record<string, number>): string {
  return Object.keys(h).filter(k => h[k] > 0).sort().map(k => `${k}:${h[k]}`).join('|')
}

/**
 * 规划主入口。beam 状态去重（持有集+银行量化到 1000 菲林）；节点价值 = oracle 每期结算。
 * 购买分支 = 窗口内可购卡的下一档（含「攒着」隐式分支 = 不买）。
 */
export function planPullStrategy(opts: PlannerOptions): PlannerResult {
  const { cards, periods, oracle } = opts
  const startDate = opts.startDate
  const activePeriods = periods.filter(p => p.date >= startDate)
  const grants = filmGrants(activePeriods, opts.filmPerVersion)

  // 初始持有（起点预设）
  const initHoldings: Record<string, number> = {}
  for (const c of cards) if ((c.initialTier ?? 0) > 0) initHoldings[c.agentId] = c.initialTier!

  let oracleCalls = 0
  const wrapOracle: TeamOracle = {
    candidates: (b, h) => {
      oracleCalls++
      return oracle.candidates(b, h)
    },
  }

  let beam: BeamState[] = [{
    holdings: { ...initHoldings },
    bank: opts.initialBank,
    score: 0,
    spent: 0,
    history: [],
  }]
  let beamStates = 0

  for (let i = 0; i < activePeriods.length; i++) {
    const period = activePeriods[i]
    opts.onPeriod?.(period)
    const grant = grants[i]
    const next: BeamState[] = []
    for (const st of beam) {
      // 发薪 → 购买分支（含不买）→ 期结算。
      // 购买分支用受控展开：单张购买 + 同节点连买（递归受限：每张卡至多一档/节点）
      const purchasesRoot: Array<{ agentId: string; tier: Exclude<PurchaseTier, 0>; cost: number }> = []
      type Branch = { holdings: Record<string, number>; bank: number; spent: number; purchases: typeof purchasesRoot }
      const branches: Branch[] = []
      const expand = (state: Branch, depth: number) => {
        branches.push(state)
        if (depth >= 3) return // 同节点连买上限（防组合爆炸；3 张/节点已覆盖现实预算）
        for (const card of cards) {
          const tier = state.holdings[card.agentId] ?? 0
          const np = nextPurchase(card, tier, period.date)
          if (!np) continue
          if (state.bank < np.cost) continue
          const purch: Branch = {
            holdings: { ...state.holdings, [card.agentId]: np.tier },
            bank: state.bank - np.cost,
            spent: state.spent + np.cost,
            purchases: [...state.purchases, { agentId: card.agentId, tier: np.tier, cost: np.cost }],
          }
          expand(purch, depth + 1)
        }
      }
      expand({ holdings: st.holdings, bank: st.bank + grant, spent: st.spent, purchases: purchasesRoot }, 0)

      // 每个分支做期结算并构造 PlannerStep
      for (const br of branches) {
        const assignment = pickPeriodAssignment(wrapOracle, period, br.holdings, opts.assignmentTopM)
        const step: PlannerStep = {
          periodId: period.id,
          periodLabel: period.label,
          date: period.date,
          purchases: br.purchases,
          bankBefore: st.bank + grant,
          bankAfter: br.bank,
          assignment,
        }
        next.push({
          holdings: br.holdings,
          bank: br.bank,
          score: st.score + assignment.totalScore,
          spent: br.spent,
          history: [...st.history, step],
        })
      }
    }
    // 去重 + 截断 beam
    const dedup = new Map<string, BeamState>()
    for (const st of next) {
      // 键 = 持有集 + 银行量化（1000 菲林）+ 累计分：同状态只留最高分轨迹
      //（score 必须进键——历史期分数不同代表不同质量的前缀决策，只按持有集合并会丢信息）
      const key = `${holdingsKey(st.holdings)}#${Math.round(st.bank / 1000)}#${Math.round(st.score)}`
      const prev = dedup.get(key)
      if (!prev || st.score > prev.score) dedup.set(key, st)
    }
    beam = [...dedup.values()].sort((a, b) => b.score - a.score).slice(0, opts.beamWidth)
    beamStates += beam.length
    opts.onProgress?.({ pct: (i + 1) / activePeriods.length, text: `规划 ${period.label}：${Math.round(beam[0]?.score ?? 0)} 分` })
  }

  const best = beam[0] ?? { holdings: initHoldings, bank: opts.initialBank, score: 0, spent: 0, history: [] as PlannerStep[] }
  return {
    steps: best.history,
    totalScore: best.score,
    holdings: best.holdings,
    finalBank: best.bank,
    totalSpent: best.spent,
    stats: { beamStates, oracleCalls },
  }
}

// ========== VCG 反事实价值归因 ==========

export interface CardValueVcg {
  agentId: string
  /** 禁用重规划的总分差（= 卡在最优策略里的抽取价值；≥0） */
  value: number
  /** 禁用重规划后该卡槽位的实际替代差（诊断用） */
  baselineTotal: number
  /** 最优策略里该卡的最终档位（0 = 最优策略本来就没抽它 → 价值 0） */
  tierInPlan: PurchaseTier
}

/**
 * 卡片 VCG 价值：V(全卡可购) − V(禁用该卡重规划)。
 * 禁用 = 该卡 initialTier 保留（已持有的不没收，公平比较「起点后的抽取决策」）、
 * 但窗口内不可购（对成型号起点= 持有集排除该卡初始档）。
 */
export function computeCardValuesVcg(
  opts: PlannerOptions,
  base: PlannerResult,
): CardValueVcg[] {
  const out: CardValueVcg[] = []
  for (const card of opts.cards) {
    const wasHeld = (card.initialTier ?? 0) > 0
    // 最优策略没抽它且起点也没持有 → 价值 0（禁用不改变任何决策）
    const tierInPlan: PurchaseTier = (base.holdings[card.agentId] ?? 0) as PurchaseTier
    if (!wasHeld && tierInPlan === 0) {
      out.push({ agentId: card.agentId, value: 0, baselineTotal: base.totalScore, tierInPlan: 0 as PurchaseTier })
      continue
    }
    const restricted: PlannerOptions = {
      ...opts,
      cards: opts.cards.map(c =>
        c.agentId === card.agentId
          ? { ...c, windowStart: '9999-12-31' } // 永不开窗 = 禁购
          : c,
      ),
    }
    const counter = planPullStrategy(restricted)
    out.push({
      agentId: card.agentId,
      value: Math.max(0, base.totalScore - counter.totalScore),
      baselineTotal: counter.totalScore,
      tierInPlan,
    })
    opts.onProgress?.({ pct: 0, text: `VCG 归因 ${card.agentId}：−${Math.round(base.totalScore - counter.totalScore)}` })
  }
  return out.sort((a, b) => b.value - a.value)
}

// ========== 起点预设 ==========

/** 起点预设（用户口径 1：全做） */
export type StartPresetKind = 'fresh' | 'established' | 'custom'
export const START_PRESET_LABELS: Record<StartPresetKind, string> = {
  fresh: '新号（无任何限定）',
  established: '成型号（常驻 S + A 可用，0 限定）',
  custom: '自选持有',
}

/** 默认每版本免费菲林（用户口径 5：25000） */
export const PLANNER_DEFAULT_FILM = PLANNER_FILM_PER_VERSION
