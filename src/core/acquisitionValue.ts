/**
 * 抽取价值（acquisition value）：一张卡「该不该抽」的决策论答案。
 *
 * ── 为什么重做（2026-08-31）────────────────────────────────────────────────
 * 现有 planner 的 VCG 反事实（composables/pullPlanner.ts#computeCardValuesVcg）结构是对的
 * ——价值 = 有它 vs 没它的整体策略差——但三样配料是错的：
 *   ① 价格是常量：每金固定 15000 菲林。真实边际价随保底状态在 15000↔160 之间浮动 90 倍
 *      （core/gachaCost.ts 已量化），于是「先垫刀再上车」「把大保底留给下期强卡」这类
 *      真实策略在模型里根本不存在；
 *   ② 输出是点估计：一个期望分。但玩家的效用是**阈值型**的（打穿/没打穿），
 *      同均值、不同方差的两张卡决策完全不同；
 *   ③ 期望价求解 ≠ 期望的最优解：预算约束 + 整数购买让收益对成本非线性，
 *      拿期望价规划会**系统性高估**（账本里 λ=1「现实折扣未回测」就是这个洞）。
 *
 * 本模块的立场：**λ 不是一个待标定的常数，它是分布模型的输出**。把随机过程如实模拟一遍，
 * 打穿概率自己就出来了，不需要再乘一个拍脑袋的折扣。
 *
 * ── 模型 ────────────────────────────────────────────────────────────────
 * 分两层，贵的那层不参与随机性：
 *   层 1（贵，外部注入 + 调用方缓存）：scoreOf(拥有集合, 期) → 分数（真引擎队伍求值）
 *   层 2（便宜，本模块）：抽卡随机过程 —— 确定性菲林收入 → 抽数预算；随机的是「每张卡要多少抽」。
 * 于是价值 = 同一预算、同一随机数（CRN 对偶）下，两条世界线的效用差：
 *   value(card) = E[U(有它)] − E[U(没它)]
 * 效用同时给三种读数：期望分（可比现状）、打穿概率（最可操作）、CVaR（下尾体验）。
 *
 * 为什么用蒙特卡洛而不是解析 DP：窗口过期、歪保底跨卡传递、组合价值（拥有 A 才让 B 更值）
 * 三者一起让状态空间带上「已拥有集合」这一维（2^n）。MC + 固定种子既保留全部相关性，
 * 又保持可复现（种子稳定性有测试锁死）；N=20000 条路径的统计误差远小于建模误差。
 *
 * debt: 复刻池/常驻池/音擎与角色共享预算的分配策略未建模（当前一条 order 只走一个池的
 * 优先级序列）；升级路径 = order 的元素带 pool 标签后按池各维护一套 (pity, guar)。
 */
import { CHAR_POOL, type PoolSpec, baseRateOf } from './gachaCost'

/** 确定性伪随机（mulberry32）：同种子同结果，CRN 对偶靠它 */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 一张可抽的卡：期索引窗口 [open, close]（闭区间），close 之后再也拿不到（复刻未建模） */
export interface CardWindow {
  id: string
  open: number
  close: number
  /** 缺省用角色池；音擎池传 WENGINE_POOL */
  pool?: PoolSpec
}

/** 世界设定：确定性的收入与窗口 + 玩家起始状态 */
export interface PullWorld {
  /** 期数（危局期为单位） */
  periods: number
  /** 每期到账抽数（菲林收入 / 单抽价，确定性） */
  pullsPerPeriod: number[]
  /** 开局已有抽数 */
  initialPulls: number
  /** 开局已垫抽数 */
  initialPity: number
  /** 开局是否大保底 */
  initialGuaranteed: boolean
  cards: CardWindow[]
}

/** 策略 = 优先级序列（想要的卡按顺序抽；不在序列里 = 不抽） */
export interface PullPolicy { order: string[] }

export interface PathOutcome {
  /** 每期结束时已拥有的卡 id（升序） */
  ownedByPeriod: string[][]
  /** 卡 id → 拿到它的期；没拿到则缺席 */
  acquiredAt: Record<string, number>
  /** 卡 id → 为它实际花掉的抽数（含歪掉的那些） */
  pullsSpent: Record<string, number>
  /** 剩余未花的抽数 */
  leftover: number
}

/**
 * 单条世界线。抽卡循环即游戏规则本身：
 * 每抽 pity+1；命中 S（基础出率或硬保底）后 pity 归零；非大保底时按 upRate 判 UP，
 * 歪了则置大保底继续抽同一张卡。窗口关闭仍未到手 = 永久错过（pity/大保底照常留给下一张）。
 */
export function simulateOne(world: PullWorld, policy: PullPolicy, rng: () => number): PathOutcome {
  const byId = new Map(world.cards.map(c => [c.id, c]))
  const acquiredAt: Record<string, number> = {}
  const pullsSpent: Record<string, number> = {}
  const expired = new Set<string>()
  const ownedByPeriod: string[][] = []
  let pity = Math.max(0, world.initialPity)
  let guaranteed = world.initialGuaranteed
  let budget = Math.max(0, world.initialPulls)

  for (let t = 0; t < world.periods; t++) {
    budget += world.pullsPerPeriod[t] ?? 0
    // 本期可推进的目标：优先级序列里第一张「未到手、未过期、窗口已开」的卡
    for (;;) {
      const targetId = policy.order.find(id => {
        const c = byId.get(id)
        return c && acquiredAt[id] == null && !expired.has(id) && c.open <= t
      })
      if (!targetId) break
      const card = byId.get(targetId)!
      const pool = card.pool ?? CHAR_POOL
      const p = baseRateOf(pool)
      let got = false
      while (budget > 0) {
        budget--
        pullsSpent[targetId] = (pullsSpent[targetId] ?? 0) + 1
        pity++
        const hitS = pity >= pool.hardPity || rng() < p
        if (!hitS) continue
        pity = 0
        if (guaranteed || rng() < pool.upRate) {
          guaranteed = false
          acquiredAt[targetId] = t
          got = true
          break
        }
        guaranteed = true // 歪了：下次必 UP，继续抽同一张
      }
      if (!got) break // 预算耗尽，本期到此为止
    }
    // 期末结算窗口
    for (const c of world.cards) {
      if (acquiredAt[c.id] == null && c.close <= t) expired.add(c.id)
    }
    ownedByPeriod.push(Object.keys(acquiredAt).sort())
  }
  return { ownedByPeriod, acquiredAt, pullsSpent, leftover: budget }
}

/** 分数函数：拥有集合 + 期 → 分（真引擎在外面，调用方负责缓存） */
export type ScoreOf = (ownedIds: string[], period: number) => number

export interface PathScores {
  /** 每条路径的总分（各期求和） */
  totals: number[]
  /** 每条路径「达标期数 / 总期数」 */
  hitRates: number[]
  /** 每条路径为某卡花掉的抽数（仅在算单卡价值时用） */
  pullsFor: number[]
}

/** 跑 N 条路径并打分（种子固定 → 可复现；CRN 对偶靠同一 seed 起点） */
export function runPaths(
  world: PullWorld, policy: PullPolicy, scoreOf: ScoreOf,
  opts: { paths?: number; seed?: number; threshold?: number; pullsForCard?: string } = {},
): PathScores {
  const n = opts.paths ?? 4000
  const seed = opts.seed ?? 20260831
  const threshold = opts.threshold ?? Infinity
  const totals: number[] = []
  const hitRates: number[] = []
  const pullsFor: number[] = []
  for (let i = 0; i < n; i++) {
    const path = simulateOne(world, policy, makeRng(seed + i))
    let total = 0
    let hits = 0
    for (let t = 0; t < path.ownedByPeriod.length; t++) {
      const s = scoreOf(path.ownedByPeriod[t], t)
      total += s
      if (s >= threshold) hits++
    }
    totals.push(total)
    hitRates.push(path.ownedByPeriod.length > 0 ? hits / path.ownedByPeriod.length : 0)
    pullsFor.push(opts.pullsForCard ? (path.pullsSpent[opts.pullsForCard] ?? 0) : 0)
  }
  return { totals, hitRates, pullsFor }
}

export interface Summary {
  mean: number
  /** 打穿概率（期望达标期数占比）——最可操作的读数 */
  hitRate: number
  /** 下尾 5% 的平均总分（CVaR）：非酋体验，风险厌恶玩家真正在意的量 */
  cvar05: number
  p10: number
  p90: number
}

export function summarize(scores: PathScores): Summary {
  const sorted = [...scores.totals].sort((a, b) => a - b)
  const n = sorted.length || 1
  const mean = sorted.reduce((s, v) => s + v, 0) / n
  const tail = Math.max(1, Math.floor(n * 0.05))
  const cvar05 = sorted.slice(0, tail).reduce((s, v) => s + v, 0) / tail
  const quant = (q: number) => sorted[Math.min(n - 1, Math.max(0, Math.floor(q * n)))]
  return {
    mean,
    hitRate: scores.hitRates.reduce((s, v) => s + v, 0) / n,
    cvar05,
    p10: quant(0.1),
    p90: quant(0.9),
  }
}

export interface AcquisitionValue {
  cardId: string
  withCard: Summary
  withoutCard: Summary
  /** 期望总分的增量（可与现有 VCG 数字对齐比较） */
  deltaMean: number
  /** 打穿概率增量（百分点 ×100 前的小数） */
  deltaHitRate: number
  /** 下尾增量：这张卡救不救得了非酋 */
  deltaCvar: number
  /** 期望为它花掉的抽数（含歪掉的），未到手的路径按实际花费计入 */
  expectedPulls: number
  /** 到手概率：窗口内真拿到的路径占比 */
  acquireProb: number
  /** 每 100 抽的期望分增量（价格已内生：垫刀/大保底都算在 expectedPulls 里） */
  meanPer100Pulls: number
  /**
   * 在这份预算下它是否真的会被抽到并带来收益（到手率 > 5% 且 Δ期望分 > 0）。
   * 注意：自由排序下「把它排在最后」永远免费，所以「加进愿望单」几乎不可能有害——
   * 真正的问题从来不是「要不要加」，而是**预算够不够排到它**。这个标志答的是后者。
   */
  worthPulling: boolean
  /** 最优决策链（含它时的最优顺序） */
  bestOrder: string[]
}

/**
 * 全部「有序子集」（排列 + 可跳过），n 小才用；n 大走贪心插入。
 *
 * 为什么必须含**跳过**而不只是排列（2026-08-31 实测踩出来的）：卡有窗口，
 * 窗口靠前的弱卡会在强卡开窗前把预算吃掉。只枚举全排列时，「把它排末位」并不等于
 * 「不抽它」——强卡窗口还没开时它就是唯一可推进的目标，钱照样花出去。于是
 * V*(有它) 可能真的小于 V*(没它)，价值算出负数。**这不是工件，是真实的机会成本**；
 * 正确的修法是把「不抽」放进策略空间（玩家现实中就是这么做的），而不是给结果取绝对值。
 */
function arrangements<T>(items: T[]): T[][] {
  const out: T[][] = [[]]
  const rec = (prefix: T[], rest: T[]) => {
    for (let i = 0; i < rest.length; i++) {
      const next = [...prefix, rest[i]]
      out.push(next)
      rec(next, [...rest.slice(0, i), ...rest.slice(i + 1)])
    }
  }
  rec([], items)
  return out
}

/**
 * 最优决策链：给定卡集合，找期望总分最高的优先级顺序。
 *
 * 为什么必须有它：价值的定义是 V*(有它) − V*(没它)——**两边都要按最优打法评价**。
 * 若两边都固定用同一条顺序，删掉一张卡会顺带改变别的卡的抽取时机，算出来的「价值」
 * 里混进了排序惩罚，甚至出现负价值（首版探针实测 −414：把维琳娜放序列首位强行先抽，
 * 而不抽她时预算自然流向更划算的卡）。这也正是「全局规划」该有的语义。
 * n ≤ 6 走全排列（≤720 条，MC 本身不碰引擎、只跑纯算术），更大走贪心插入。
 */
// @fact engine:gacha/策略空间 口径: 抽卡策略空间必须含「跳过」动作——窗口靠前的弱卡会吃掉后面强卡的预算，只枚举排列会算出真实存在的负价值 | 据 实测@2026-08-31 | 验 src/core/__tests__/acquisitionValue.test.ts | 锚 src/core/acquisitionValue.ts#arrangements | 信 确认
// @fact engine:gacha/目标依赖 口径: 「哪条决策链更好」依赖目标（期望分/打穿率/CVaR），同一份卡在不同目标下最优链不同，报价值必须同时报目标 | 据 实测@2026-08-31 | 验 src/core/__tests__/acquisitionValue.test.ts | 锚 src/core/acquisitionValue.ts#objectiveValue | 信 确认

/** 优化目标：刷分 / 打穿 / 保下限。三者的最优链**可以不同**——目标不说清就无所谓「更好」 */
export type Objective = 'mean' | 'hitRate' | 'cvar'

export function objectiveValue(s: Summary, objective: Objective = 'mean'): number {
  return objective === 'hitRate' ? s.hitRate : objective === 'cvar' ? s.cvar05 : s.mean
}

export function bestPolicy(
  world: PullWorld, cardIds: string[], scoreOf: ScoreOf,
  opts: { paths?: number; seed?: number; threshold?: number; searchPaths?: number; objective?: Objective } = {},
): { order: string[]; mean: number; objectiveScore: number } {
  // 搜索阶段用少路径（排序只需分出高下），定稿再用全路径量数值——
  // 全排列 × 全路径是本模块唯一会失控的成本项（6 张卡 = 720 × 3000 条）。
  const searchOpts = { ...opts, paths: Math.min(opts.paths ?? 4000, opts.searchPaths ?? 800) }
  const objective = opts.objective ?? 'mean'
  const evaluate = (order: string[]) => objectiveValue(summarize(runPaths(world, { order }, scoreOf, searchOpts)), objective)
  const finalize = (order: string[]) => {
    const s = summarize(runPaths(world, { order }, scoreOf, opts))
    return { order, mean: s.mean, objectiveScore: objectiveValue(s, objective) }
  }
  if (cardIds.length <= 5) {
    let best = { order: [] as string[], mean: -Infinity as number }
    for (const order of arrangements(cardIds)) {
      const mean = evaluate(order)
      if (mean > best.mean) best = { order, mean }
    }
    return finalize(best.order)
  }
  // 贪心插入：逐张卡试遍所有位置，**不如不加就不加**（跳过也是合法动作）
  let order: string[] = []
  let cur = evaluate(order)
  for (const id of cardIds) {
    let best = { order, mean: cur }
    for (let i = 0; i <= order.length; i++) {
      const cand = [...order.slice(0, i), id, ...order.slice(i)]
      const mean = evaluate(cand)
      if (mean > best.mean) best = { order: cand, mean }
    }
    order = best.order
    cur = best.mean
  }
  return finalize(order)
}

/**
 * 单卡抽取价值 = 同预算、同随机数（CRN）下「序列里有它」vs「序列里没它」的差。
 * CRN 是关键：两条世界线用同一批种子，差值的方差远小于各自的方差，
 * 于是几千条路径就能把 delta 估准（否则要几十万条）。
 */
export function acquisitionValue(
  world: PullWorld, policy: PullPolicy, scoreOf: ScoreOf, cardId: string,
  opts: { paths?: number; seed?: number; threshold?: number; optimizePolicy?: boolean; searchPaths?: number; objective?: Objective } = {},
): AcquisitionValue {
  const all = policy.order.includes(cardId) ? policy.order : [...policy.order, cardId]
  const rest = all.filter(id => id !== cardId)
  // 默认两边都按最优顺序打（V* vs V*）：否则算的是「按这个顺序抽它」的价值，
  // 混入排序惩罚会出负数。关掉它 = 评价「在既定计划里加/减这张卡」的局部价值。
  const optimize = opts.optimizePolicy !== false
  const bestRest = optimize ? bestPolicy(world, rest, scoreOf, opts) : { order: rest, mean: 0, objectiveScore: 0 }
  const bestAll = optimize ? bestPolicy(world, all, scoreOf, opts) : { order: all, mean: 0, objectiveScore: 0 }
  // 两边都取最优策略（含「跳过」动作）：价值 = V*(有它可选) − V*(没它)。
  // 策略空间含跳过 ⇒ 多一张卡不可能变差（大不了不抽），价值天然 ≥ 0；
  // 残余负值只可能来自 MC 噪声或外部 scoreOf 的搜索工件，不会来自定义本身。
  const withPolicy: PullPolicy = optimize ? { order: bestAll.order } : { order: all }
  const withoutPolicy: PullPolicy = optimize ? { order: bestRest.order } : { order: rest }
  const a = runPaths(world, withPolicy, scoreOf, { ...opts, pullsForCard: cardId })
  const b = runPaths(world, withoutPolicy, scoreOf, opts)
  const withCard = summarize(a)
  const withoutCard = summarize(b)
  const expectedPulls = a.pullsFor.reduce((s, v) => s + v, 0) / (a.pullsFor.length || 1)
  const acquired = runPathsAcquireProb(world, withPolicy, cardId, opts)
  const deltaMean = withCard.mean - withoutCard.mean
  return {
    cardId,
    withCard,
    withoutCard,
    deltaMean,
    deltaHitRate: withCard.hitRate - withoutCard.hitRate,
    deltaCvar: withCard.cvar05 - withoutCard.cvar05,
    expectedPulls,
    acquireProb: acquired,
    meanPer100Pulls: expectedPulls > 0 ? (deltaMean / expectedPulls) * 100 : 0,
    worthPulling: acquired > 0.05 && deltaMean > 0,
    bestOrder: withPolicy.order,
  }
}

/** 到手概率（与 acquisitionValue 同种子，复用同一批世界线） */
export function runPathsAcquireProb(
  world: PullWorld, policy: PullPolicy, cardId: string,
  opts: { paths?: number; seed?: number } = {},
): number {
  const n = opts.paths ?? 4000
  const seed = opts.seed ?? 20260831
  let got = 0
  for (let i = 0; i < n; i++) {
    if (simulateOne(world, policy, makeRng(seed + i)).acquiredAt[cardId] != null) got++
  }
  return got / n
}

// @fact engine:gacha/价值口径 口径: 抽取价值=同预算同随机数(CRN)下「序列含该卡 vs 不含」的期望效用差，效用三读数=期望分/打穿概率/CVaR；现实折扣 λ 由分布模型输出，不再当常数标定 | 据 用户@2026-08-31 | 验 src/core/__tests__/acquisitionValue.test.ts | 锚 src/core/acquisitionValue.ts#acquisitionValue | 信 确认

export interface PolicyComparison {
  /** A 相对 B 的期望总分差（配对差的均值） */
  deltaMean: number
  /** 配对差的标准误：判「这个差是真的还是噪声」用它，而不是看两边各自的方差 */
  stderr: number
  /** A 严格优于 B 的世界线占比（同一批随机数下逐条比） */
  winRate: number
  /** 两条链完全同结果的占比（多数分歧只发生在预算边界上） */
  tieRate: number
  aMean: number
  bMean: number
}

/**
 * 两条决策链谁更好——**这就是「引入随机性后还能不能评价决策链」的答案**。
 * 用同一批随机数（CRN）逐条世界线配对比较：同样的运气下只有决策不同，
 * 于是差值里没有运气成分。配对差的标准误通常比单边方差小一到两个数量级，
 * 几千条路径就能把「A 比 B 好多少」说到小数点后。
 */
export function comparePolicies(
  world: PullWorld, a: PullPolicy, b: PullPolicy, scoreOf: ScoreOf,
  opts: { paths?: number; seed?: number; threshold?: number } = {},
): PolicyComparison {
  const ra = runPaths(world, a, scoreOf, opts)
  const rb = runPaths(world, b, scoreOf, opts)
  const n = Math.min(ra.totals.length, rb.totals.length) || 1
  const diffs = Array.from({ length: n }, (_, i) => ra.totals[i] - rb.totals[i])
  const mean = diffs.reduce((s, v) => s + v, 0) / n
  const variance = diffs.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, n - 1)
  return {
    deltaMean: mean,
    stderr: Math.sqrt(variance / n),
    winRate: diffs.filter(d => d > 0).length / n,
    tieRate: diffs.filter(d => d === 0).length / n,
    aMean: ra.totals.reduce((s, v) => s + v, 0) / n,
    bMean: rb.totals.reduce((s, v) => s + v, 0) / n,
  }
}

export interface CardRanking {
  /** 按 Δ期望分降序 */
  rows: AcquisitionValue[]
  /** 全部卡都在时的最优决策链 */
  bestOrder: string[]
  /** 该链的期望总分 */
  bestMean: number
  /** 边际之和 / 联合价值：远离 1 = 榜单不能直接当预算分配 */
  additivityRatio: number
}

/**
 * 价值榜：对每张卡跑一次 V* vs V*，按 Δ期望分排序，并附上「这份榜单能不能直接用」的判据。
 * 成本 = 每张卡两次策略搜索；scoreOf 记忆化后引擎只被问「不同持有集 × 期」那么多次。
 */
export function rankCards(
  world: PullWorld, cardIds: string[], scoreOf: ScoreOf,
  opts: { paths?: number; seed?: number; threshold?: number; searchPaths?: number; objective?: Objective } = {},
): CardRanking {
  const rows = cardIds
    .map(id => acquisitionValue(world, { order: cardIds }, scoreOf, id, opts))
    .sort((a, b) => b.deltaMean - a.deltaMean)
  const best = bestPolicy(world, cardIds, scoreOf, opts)
  const none = summarize(runPaths(world, { order: [] }, scoreOf, opts)).mean
  const joint = best.mean - none
  const sum = rows.reduce((s, r) => s + r.deltaMean, 0)
  return { rows, bestOrder: best.order, bestMean: best.mean, additivityRatio: joint !== 0 ? sum / joint : 0 }
}

/**
 * 边际价值之和 ≠ 总价值：互补品双计、替代品双杀（VCG 边际贡献在组合场景下的已知失真）。
 * 本函数把失真量算出来——比值远离 1 就说明「按边际价值排序」这份榜单不能直接当预算分配用。
 */
export function additivityGap(
  world: PullWorld, policy: PullPolicy, scoreOf: ScoreOf,
  opts: { paths?: number; seed?: number; threshold?: number } = {},
): { sumOfMarginals: number; jointValue: number; ratio: number } {
  const sumOfMarginals = policy.order
    .map(id => acquisitionValue(world, policy, scoreOf, id, opts).deltaMean)
    .reduce((s, v) => s + v, 0)
  const all = summarize(runPaths(world, policy, scoreOf, opts))
  const none = summarize(runPaths(world, { order: [] }, scoreOf, opts))
  const jointValue = all.mean - none.mean
  return { sumOfMarginals, jointValue, ratio: jointValue !== 0 ? sumOfMarginals / jointValue : 0 }
}
