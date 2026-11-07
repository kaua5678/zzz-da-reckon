/**
 * **钉 K 前沿扫描**：一个命座水平在「失衡次数 K」这根轴上的伤害曲线，以及**交付点**的选法。
 *
 * ## 为什么需要（口径全文见 `docs/mcp-cinema-interval-uplift.md` §4 / §5.6 / §5.7）
 *
 * 用户 2026-11-04 原话：「一个命座水平在难度曲线上覆盖一段 y，加命座会把 y 区间上移，但是区间有重合，
 * 特定的某个 y1 可以找到更低的 y2。这就是副作用的由来。」
 *
 * 一条命座水平**不是单点**：它是一条 (难度 x, 伤害 y) 前沿。而「取两点」之所以能造出假负值，
 * 除了难度不同（§2.1），还有**同一难度下落在不同操作点**——本模块量的就是后者的直接载体：
 * **同一个配置、同一个难度，把失衡次数 K 钉住重算一整轮，伤害随 K 变**。
 * 于是「C0 交付在 K3 / C1 交付在 K1」这种错位可以被逐 K 表直接看见，而不是变成一个凭空出现的负号。
 *
 * ## 交付点 = 前沿点（用户 2026-11-06 口径）
 *
 * > 「用户可能想要的是当前情况的一个确切值」。
 *
 * 候选集 = **自由收敛的停点**（引擎自己落到的那个 K，`outerExit='stable'` 或环退出 ⇒ kStar 结算）
 * **∪** 全部**可行**的钉 K 点。可行 = **自洽**（`floor(连续失衡) ≥ K`）**且** **装得下**
 * （`candidateFitsBudget`，与 kStar 结算 / 轴退化 / 非轴降配**同一把尺**）。
 * 交付 = 候选集里**伤害最大**的那个点；同伤害取**较小** K（打平不多占一个窗）。
 *
 * 为什么「收敛停点」必须留在候选集里：它是**引擎自己真的到达过**的点，是「玩家不点本卡时看到的那一帧」。
 * 把它排除会让前沿扩展变成「不许比原来好、只许比原来差」——实测反例见 §5.7：
 * `auto-1591-1481-1211` p16 C1 的收敛停点 37.01M（K3，plan≠pin）高于任何钉 K 点（K1 = 26.66M）。
 *
 * ## 与「区间提升」（`cinemaIntervalUplift`）的分工
 *
 * - 本模块 = **同难度、不同 K**（把交付点漂移变成可见的逐 K 表）；
 * - `cinemaIntervalUplift` = **同 K、不同难度**（前沿对前沿）。
 * 两者是同一张网的两条轴，都遵守 §4.2 的三条判据（不比端点、披露域、负值可下钻）。
 *
 * ## ⚠ 为什么不在引擎里做（两次实测否决，别再走）
 *
 * 在 `computeCalcOutput` 内注入伤害求值器会让**主路径伤害本身**变（`yixuan-jufufu` p0 C0
 * 20.47 → 15.85；叶瞬光 C1 → 0.000）：伤害池的入参链
 * `axisAllocation → stackTraversalResult → calcOutput.value`，求值器正运行在 `calcOutput` 自己的计算过程里
 * ⇒ **重入拿到半成品**。所以扫描只能在**外层循环**做：对每个 K 设 `enemy.stunCountLock = K` →
 * 让整条管线完整重解一轮 → 读伤害。这也是本模块住在 `composables/`（可以读 store/面板/伤害池）而
 * `solveTeam` 必须保持零 Vue/store 依赖的原因。
 */
import type { AnalysisContext } from '@/composables/analysisScenario'
import { isBatchAborted, type BatchControl } from '@/composables/batchTask'
import { netFitsBudget } from '@/composables/resourceCalc/solveTeam'
import { continuousStunCount } from '@/core/stunPool'
import { netFrontlineOccupation } from '@/core/resource/timeOccupation'
import { nextTick } from 'vue'

/**
 * `floor(连续失衡)` 前的浮点容差。与 `solveTeam#feasibleAt` 的 `Math.floor(continuousStunCount(...)) ≥ kIn`
 * 同口径（那边不留容差是因为它比的是**环成员实测值**；这里比的是扫描读数，来源不同，容差只防末位抖动）。
 */
const CONTINUOUS_FLOOR_EPS = 1e-9

/** 前沿上的一个点 = **一个被钉住的 K**（不是难度网格）。 */
export interface KFrontierPoint {
  /** 钉住的失衡次数（`enemy.stunCountLock`） */
  k: number
  /** 该 K 下这一整轮重解出来的全队总伤害 */
  dmg: number
  /** 输出池的失衡次数（钉 K 后应等于 K；小于 = 引擎按 K 排窗、池却撑不住） */
  pool: number
  /** 连续失衡次数（自洽判据的左边） */
  contiguous: number
  /** Σ前台净占用（秒，含待装补齐后的口径与 kStar 结算同源） */
  net: number
  /** 装得下（`candidateFitsBudget`）：净占用 ≤ 有效战斗时间 + 2s 容差 */
  fits: boolean
  /** 自洽：`floor(连续失衡) ≥ K`（按 K 排了窗，池也真攒得出 K 次） */
  selfConsistent: boolean
  /** `fits && selfConsistent` —— 只有可行点才参与交付点竞选 */
  feasible: boolean
  /** **不可行的原因**（可行时为 null）：负值/缺口必须能被追问到原因，不是只说「不可行」 */
  rejectReason: 'budget' | 'contiguous' | 'both' | null
  /** 池被钳：`pool < K` */
  clamped: boolean
  /**
   * 这个点**真的求值过**。false = 被「自洽判据单调」提前封闭（见 `scanKFrontier` 的同名段），
   * `dmg`/`contiguous`/`net` 都是 NaN —— 「域内没有这个操作点」与「没去看」必须能分开。
   */
  scanned: boolean
}

/** 交付点的两种来源：自由收敛的停点 / 钉 K 扫描里更值钱的可行点。 */
export type DeliverySource = 'converged' | 'pinned'

/**
 * 交付点的**选法**（可注入 ⇒ 让「改回旧口径必须变红」这条负控能在同一批扫描数据上重放）。
 *
 * - `'argmax'`（缺省，用户 2026-11-06 口径）= 候选集里伤害最大者；
 * - `'maxK'`（**旧口径，已被否决**）= 可行点里**最大 K**，隐含「窗越多伤害越高」。
 *   该假设为假（§5.6 实测三队无单调性），且它会**跨级错位**：
 *   `auto-1591-1481-1211` p16 钉 K 表里 C0 的可行最大 K 是 K3（32.94M）、C1 是 K1（26.66M）
 *   ⇒ max-K 交付造出 **−19.08%** 的假负值；argmax 交付是 +12.34%。
 *   保留它**只为**做负控（`cinemaUpliftFrontier.test.ts` 的 ③），生产路径不得使用。
 */
export type DeliveryRule = 'argmax' | 'maxK'

export interface KFrontierDelivery {
  /** 交付的 K */
  k: number
  /** 交付的伤害 */
  dmg: number
  /** `converged` = 收敛停点已经就是最优；`pinned` = 某个钉住的 K 更值钱 */
  source: DeliverySource
  /** 自由收敛自己交付的 K 与其伤害（= 用户不点本卡时看到的那一帧） */
  convergedK: number
  convergedDmg: number
  /** 交付点相对收敛停点的差（%；0 = 无漂移） */
  driftPct: number
  /** 参与竞选的可行点数（0 ⇒ 没有任何可行点，交付回落收敛停点并如实标注） */
  feasibleCount: number
  /** 扫描了多少个候选 K（行数 = `maxK + 1`） */
  scannedCount: number
  /** 物理上限 `floor(effTime / windowDuration)` —— 扫描域上界 */
  maxK: number
}

export interface KFrontier {
  /** 该次扫描的窗长（秒）与有效战斗时间（秒）——交付点的两个物理输入，页面归因行要印 */
  windowDuration: number
  effectiveTime: number
  /** 逐 K 点，按 K 升序，行数 = `maxK + 1` */
  points: KFrontierPoint[]
  /** 交付点（= 该配置在当前难度下的**确切值**） */
  delivery: KFrontierDelivery
}

/**
 * 「同一难度下钉 K 重算」——**唯一的求值入口**（页面/测试共用，规则 11）。
 *
 * 每个 K 都是一次**完整外层求值**（含外层不动点 + 可行化决策），故 `maxK + 1` 次
 * （K=0 也扫：零窗是合法对比点，且 C0 基线的收敛停点常在 K=0~1）。
 *
 * ⚠ **必须 `await nextTick()`**：`config` 是响应式 model，`calc` 的 computed 链在微任务里刷新；
 * 不 yield 就读 `teamTotalDamage` 会读到**上一个 K 的**结果（历史上「两条臂逐位相同」就是这个坑）。
 * ⚠ 退出时**复位 `stunCountLock` 与命座等级**：否则场景带着锁跑下一次 C 级，整段口径走错。
 */
export async function scanKFrontier(
  scenario: AnalysisContext,
  opts: {
    cinemaLevel: number
    control?: BatchControl
    maxK?: number
    rule?: DeliveryRule
    /**
     * 自洽判据单调时**提前封闭**剩余 K（缺省 true：省掉必然不可行的求值，是页面 12s vs 22s 的来源）。
     *
     * 判据要「K=0..N 全部实测」时传 **false**：封闭后的点 `scanned=false`、读数 NaN，
     * 只能表达「不可能」不能表达「实测也是正的」。`cinemaUpliftFrontier.test.ts` 的判据③
     * （固定 K 非负，K=0..5 全测）就靠这个开关。
     */
    earlyClose?: boolean
  },
): Promise<KFrontier | null> {
  const { config, calc } = scenario
  const slot = 0
  const savedLock = config.enemy.stunCountLock
  const savedCinema = config.team[slot]?.cinemaLevel ?? 0

  /**
   * 读一帧：`lock < 0` = 自由收敛（用户不点时看到的那一帧）。
   *
   * ⚠ **`lock >= 0` 的那一帧不在同一个投影口径下**（2026-11-07 实测，写在这里因为它是读数差异的主要来源）：
   * 用户锁失衡次数时，`useResourceCalc` 会把 `stunPlanProjection` 从 `physical` 回落 **`off`**
   * （CC-151：physical 读的是**上一轮池**的物理次数，会把锁定值旁路掉；`solveTeam#evalLocked` 走 override
   * 通道时也自己回落 off）。所以**收敛帧用配置口径、钉 K 帧恒 off**。
   * ⇒ 「同 K 两个计划」的差 = 计划分支差 ⊗ 投影口径差，两者在本扫描里分不开；
   * 报告这种差时必须写明这一条，别把它当成「分支问题」或「物理投影治好了分支问题」。
   */
  const readFrame = async (lock: number) => {
    config.enemy.stunCountLock = lock
    await nextTick()
    const rr = calc.resourceResult.value
    const pool = calc.stunPoolResult.value
    return {
      dmg: calc.teamTotalDamage.value,
      pool: (pool as unknown as { stunCount?: number } | null)?.stunCount ?? 0,
      contiguous: pool ? continuousStunCount(pool) : 0,
      net: rr ? netFrontlineOccupation(rr) : Number.NaN,
      // 待装补齐按 **0** 计：钉 K 重算是「按 K 排窗重跑一整轮」，它自己就是稳定停点
      // （与 `evalLocked` 的重跑同口径；传上一轮会把它自己声明的补齐再扣一遍，方向反了）。
      fits: rr ? netFitsBudget(netFrontlineOccupation(rr), 0, calc.stunEffectiveTime.value) : false,
      windowDuration: calc.windowDuration.value,
      effectiveTime: calc.stunEffectiveTime.value,
    }
  }

  try {
    config.setCinemaLevel(slot, opts.cinemaLevel)
    config.syncTeammateBuffsFromTeam()

    const free = await readFrame(-1)
    if (!(free.windowDuration > 0) || !(free.effectiveTime > 0)) return null
    const maxK = Math.min(
      opts.maxK ?? Number.POSITIVE_INFINITY,
      Math.max(1, Math.floor(free.effectiveTime / free.windowDuration)),
    )

    const points: KFrontierPoint[] = []
    for (let k = 0; k <= maxK; k++) {
      if (isBatchAborted(opts.control)) return null
      const f = await readFrame(k)
      const selfConsistent = Math.floor(f.contiguous + CONTINUOUS_FLOOR_EPS) >= k
      const rejectReason = !f.fits && !selfConsistent ? 'both' as const
        : !f.fits ? 'budget' as const
          : !selfConsistent ? 'contiguous' as const
            : null
      points.push({
        k,
        dmg: f.dmg,
        pool: f.pool,
        contiguous: f.contiguous,
        net: f.net,
        fits: f.fits,
        selfConsistent,
        feasible: rejectReason === null,
        rejectReason,
        clamped: f.pool < k,
        scanned: true,
      })
      /**
       * **自洽判据单调 ⇒ 提前封闭剩余 K**（纯性能，不改任何读数）。
       *
       * `floor(continuousStunCount(pool(K)))` 随 K **单调不增**（`solveTeam` 的二分回落
       * 已经建立在同一条性质上，见那里的「单调性依据」注释）。而判据右边 `≥ K` 随 K 严格增
       * ⇒ 谓词单调递减：`K` 一旦不自洽，比它大的 K **必然**也不自洽 ⇒ 余下点不必求值。
       *
       * 逐点求值是本卡最贵的部分（每个 K 一次完整外层求值，实测 11 点 ≈ 1.1s/条前沿）；
       * 实测 `auto-1591-1481-1211` p16 在 K4 就封闭（11 → 5 次），页面 3 槽 6 级 22.3s → **12.1s**。
       *
       * ⚠ 只封闭`contiguous`那一侧：`fits`（净占用）**非单调**（实测同一条前沿的 K9/K10 净占用
       * 179.5/179.1 都低于 K3 的 181.2）⇒ 绝不拿它做提前终止。
       * 未扫的点**照样出现在 `points` 里**（`scanned=false`，原因注明 `contiguous`），
       * 因为「域内没有这个操作点」与「我们没去看」是两件事，读数必须能分开。
       */
      if (!selfConsistent && opts.earlyClose !== false) {
        for (let rest = k + 1; rest <= maxK; rest++) {
          points.push({
            k: rest,
            dmg: Number.NaN,
            pool: Number.NaN,
            contiguous: Number.NaN,
            net: Number.NaN,
            fits: false,
            selfConsistent: false,
            feasible: false,
            rejectReason: 'contiguous',
            clamped: false,
            scanned: false,
          })
        }
        break
      }
    }
    return {
      windowDuration: free.windowDuration,
      effectiveTime: free.effectiveTime,
      points,
      delivery: pickDelivery(points, free.dmg, free.pool, opts.rule),
    }
  } finally {
    config.enemy.stunCountLock = savedLock
    config.setCinemaLevel(slot, savedCinema)
    config.syncTeammateBuffsFromTeam()
    await nextTick()
  }
}

/**
 * **交付点 = 前沿点**：候选集 = 收敛停点 ∪ 全部可行点，取伤害 argmax；同伤害取**较小** K。
 *
 * 收敛停点只以「它的伤害」参与竞选（它的 K 未必在扫描域里：实测 `auto-1581-1511-1411` C4 的
 * 收敛停点池窗 2 但钉 K2 的 net 与它不同源 ⇒ 同 K 不同 plan，K 相等不代表点相等）。
 *
 * ⚠ 别把 `rule` 的缺省改掉，也别在生产路径传 `'maxK'`：它是**负控入口**（见 `DeliveryRule`）。
 */
export function pickDelivery(
  points: readonly KFrontierPoint[],
  convergedDmg: number,
  convergedK: number,
  rule: DeliveryRule = 'argmax',
): KFrontierDelivery {
  const feasible = points.filter(p => p.feasible)
  const base = {
    convergedK,
    convergedDmg,
    feasibleCount: feasible.length,
    // 「扫描了多少个」= **真的求值过**的点数（提前封闭的那些没求值，不能算进成本也不该算进覆盖率）
    scannedCount: points.filter(p => p.scanned).length,
    maxK: Math.max(0, points.length - 1),
  }
  if (rule === 'maxK') {
    // 旧口径：可行点里的最大 K（**没有**可行点 ⇒ 0 ⇒ 回落收敛停点，与旧引擎 min-K 回落同形）
    const kmax = feasible.length ? feasible.reduce((a, b) => (b.k > a.k ? b : a)) : null
    if (!kmax) return { ...base, k: convergedK, dmg: convergedDmg, source: 'converged', driftPct: 0 }
    return {
      ...base,
      k: kmax.k,
      dmg: kmax.dmg,
      source: kmax.dmg > convergedDmg + 1e-9 ? 'pinned' : 'converged',
      driftPct: convergedDmg > 0 ? ((kmax.dmg - convergedDmg) / convergedDmg) * 100 : 0,
    }
  }
  const best = feasible.length
    ? feasible.reduce((a, b) => (b.dmg > a.dmg + 1e-9 ? b : b.dmg < a.dmg - 1e-9 ? a : (b.k < a.k ? b : a)))
    : null
  // 收敛停点领先或打平 ⇒ 引擎已经就位，不拿钉 K 去改读数（这一帧是「真的到达过」的点）
  if (!best || convergedDmg >= best.dmg - 1e-9) {
    return { ...base, k: convergedK, dmg: convergedDmg, source: 'converged', driftPct: 0 }
  }
  return {
    ...base,
    k: best.k,
    dmg: best.dmg,
    source: 'pinned',
    driftPct: convergedDmg > 0 ? ((best.dmg - convergedDmg) / convergedDmg) * 100 : 0,
  }
}

/**
 * **同窗数对照**：把两级钉在**同一个 K** 上比（用户 2026-11-06 要的「同条件对照」）。
 *
 * 回答的问题 = **不改变操作强度**（同样的失衡窗数），加这一级命座能多打多少。
 * 与上面「交付点之间的比」互补：那个比的是「两级各自的最优」，这个比的是「同一个操作点」。
 * 两者一起才能区分「命座真变强」与「引擎把这一级交付到了更值钱的 K」。
 *
 * ## K 的取法（为什么不是死用前一级的交付 K）
 *
 * 首选 = **前一级的交付 K**（「玩家现在就在这个操作点上」）。但高一级在同一个 K 上常常**装不下**
 * ——实测 `auto-1591-1481-1211` p16：C0 交付 K3（net 181.20 ≤ 182 容差内），C1 钉 K3 时
 * **net = 201.87s**（超出 20s）⇒ 那个操作点对 C1 物理不存在。
 * 此时**下探**到「两级都可行的最大 K」，并用 `atPreferred` 如实标出「用的不是首选的 K」。
 * ⇒ 只要能找到一个两级都可行的 K（K=0 几乎恒可行），本栏就有一个确切的数；一个都没有才报 null。
 *
 * ⚠ 不许拿「前一级的 K 不可行就返回 null」了事：那会让主读数在实测最常见的形态（高命座更吃预算）下
 * 恒为「不可比」，读者拿不到任何信息——与用户「我要一个确切值」的口径相反。
 * ⚠ 也不许拿两级的**各自交付 K** 分别装桶再比（那是上面的 `pct`，不是本栏）。
 */
export interface SameKComparison {
  /** 实际使用的对照 K（两级都可行的最大 K，且不超过 `preferredK`；null = 两级没有公共可行 K） */
  k: number | null
  /** 首选的对照 K = 前一级的交付 K */
  preferredK: number
  /** 实际用的 K 是否就是首选 K（false ⇒ 首选 K 上后一级装不下，已下探） */
  atPreferred: boolean
  /** 前一级在 `k` 的伤害（`k` 为 null 时 = NaN） */
  beforeDmg: number
  /** 后一级在同一 `k` 的伤害 */
  afterDmg: number | null
  /** Δ%；null = 没有公共可行 K（**不是 0**，§4.2 判据②：域外只能单向报） */
  pct: number | null
  /** 后一级在**首选 K** 上不可行的原因（`atPreferred` 为 true 时无意义） */
  preferredReason: 'budget' | 'contiguous' | 'both' | 'out-of-range' | null
}

export function compareAtSameK(before: KFrontier, after: KFrontier, k: number): SameKComparison {
  const atPreferredPoint = after.points.find(p => p.k === k)
  const preferredReason = !atPreferredPoint
    ? 'out-of-range' as const
    : atPreferredPoint.feasible ? null : atPreferredPoint.rejectReason

  /** 两级都可行的 K（降序）——首选 K 在其中就取它，否则取 ≤ 首选 K 的最大者 */
  const bothFeasible = before.points
    .filter(b => b.feasible && after.points.some(a => a.k === b.k && a.feasible))
    .map(b => b.k)
    .sort((x, y) => y - x)
  const chosen = bothFeasible.includes(k) ? k : (bothFeasible.find(c => c <= k) ?? null)
  if (chosen === null) {
    return {
      k: null,
      preferredK: k,
      atPreferred: false,
      beforeDmg: Number.NaN,
      afterDmg: null,
      pct: null,
      preferredReason: preferredReason ?? 'budget',
    }
  }
  const b = before.points.find(p => p.k === chosen)!
  const a = after.points.find(p => p.k === chosen)!
  return {
    k: chosen,
    preferredK: k,
    atPreferred: chosen === k,
    beforeDmg: b.dmg,
    afterDmg: a.dmg,
    pct: b.dmg > 0 ? ((a.dmg - b.dmg) / b.dmg) * 100 : null,
    preferredReason,
  }
}

/**
 * **同 K 提升的整条分布**（用户 2026-11-07 口径）：「正确的显示不是挑选好看或者不好看的交付点数字展示，
 * 而是在整个面板显示完整的提升分布」。
 *
 * 为什么需要它：`compareAtSameK` 只给**一个** K（前一级的交付 K），而用户真正要看的是
 * 「这一级命座在**每个**操作强度上各值多少，以及从哪个 K 开始装不下」。实测全库
 * （`.zc/perf/keptLost.probe.perf.ts`，105 预设 C1→C2）：
 *
 * | 类别 | 队数 | 同 K 提升（中位均值） | 交付口径 |
 * |---|---|---|---|
 * | 保住失衡（C2 可达 K 上界 ≥ C1） | **100 / 105** | **+11.4%** | +11.2% |
 * | 丢了窗（C2 上界更低） | **5 / 105** | +13.8% | +6.5%（其中 2 条为负） |
 *
 * ⇒ 只印交付点会把 100 队的 +11% 压成一个数、把 5 队的两面性藏成「一个负号」。
 * 本函数按 K 逐点给出提升率与**可行性三态**，页面把它画成分布条。
 *
 * ⚠ 纯读数：不参与交付、不改变任何选择（`pickDelivery` 不看它）。
 */
export interface SameKBandPoint {
  k: number
  /** 同 K 提升率（%）；null = 该 K 上有一级没扫/不可行（**不是 0**） */
  pct: number | null
  /** 两级都可行 ⇒ 这个 K 是「真能打的操作点」 */
  bothFeasible: boolean
  /** 后一级（高命）在该 K 不可行的原因；可行时为 null */
  afterReject: 'budget' | 'contiguous' | 'both' | 'unscanned' | 'out-of-range' | null
}

export interface SameKBand {
  points: SameKBandPoint[]
  /** 两级都可行那些 K 的提升率中位数（null = 一个都没有） */
  medianPct: number | null
  /** 两级都可行的 K（升序）——「这一级在哪些操作强度上站得住」 */
  feasibleKs: number[]
  /** 高命从哪个 K 起开始不可行（null = 全程可行） */
  breaksAt: number | null
  /** 窗长是否变了（仪玄 C2 的「失衡持续 +3s」就是这一类：窗变长 ⇒ 少而长的窗） */
  windowChanged: boolean
  beforeWindow: number
  afterWindow: number
}

/** 按 K 逐点算「同 K 提升」，并把可行性三态如实带出（页面据此画分布）。 */
export function sameKBand(before: KFrontier, after: KFrontier): SameKBand {
  const points: SameKBandPoint[] = []
  for (const b of before.points) {
    const a = after.points.find(p => p.k === b.k)
    if (!a) {
      points.push({ k: b.k, pct: null, bothFeasible: false, afterReject: 'out-of-range' })
      continue
    }
    const bothFeasible = b.feasible && a.feasible
    const pct = b.dmg > 0 && a.scanned && b.scanned ? ((a.dmg - b.dmg) / b.dmg) * 100 : null
    points.push({
      k: b.k,
      pct,
      bothFeasible,
      afterReject: a.feasible ? null : (a.scanned ? a.rejectReason : 'unscanned'),
    })
  }
  const usable = points.filter(p => p.bothFeasible && p.pct !== null).map(p => p.pct!)
  const sorted = [...usable].sort((x, y) => x - y)
  const medianPct = sorted.length ? sorted[Math.floor(sorted.length / 2)]! : null
  const feasibleKs = points.filter(p => p.bothFeasible).map(p => p.k)
  const firstBreak = points.find(p => !p.bothFeasible && p.k > (feasibleKs[0] ?? -1))
  return {
    points,
    medianPct,
    feasibleKs,
    breaksAt: firstBreak ? firstBreak.k : null,
    windowChanged: Math.abs(before.windowDuration - after.windowDuration) > 1e-9,
    beforeWindow: before.windowDuration,
    afterWindow: after.windowDuration,
  }
}

