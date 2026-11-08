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
import { continuousStunClip, continuousStunCount } from '@/core/stunPool'
import { netFrontlineOccupation } from '@/core/resource/timeOccupation'
import { nextTick } from 'vue'

/**
 * `floor(连续失衡)` 前的浮点容差。与 `solveTeam#feasibleAt` 的 `Math.floor(continuousStunCount(...)) ≥ kIn`
 * 同口径（那边不留容差是因为它比的是**环成员实测值**；这里比的是扫描读数，来源不同，容差只防末位抖动）。
 */
const CONTINUOUS_FLOOR_EPS = 1e-9

/**
 * 连续失衡的**采纳容差**（单位：窗）。截短 δ 之后要求「这一轮真的攒得出 K 窗」，但实测
 * `auto-1371-1481-1451` C4 的 K=3 会落在 **2.9999**（缺口 0.004 窗 → δ 只有 0.156s，
 * 重读一帧后缺口只剩 1e-4 量级）——用机器 ε 判会把这种「就差一个舍入」的格子挡在门外。
 * 0.001 窗 = 15 点失衡值，与「少了整整一窗」差三个数量级，不是放松判据。
 */
const CONTINUOUS_ACCEPT_EPS = 1e-3

/** 前沿上的一个点 = **一个被钉住的 K**（不是难度网格）。 */
export interface KFrontierPoint {
  /** 钉住的失衡次数（`enemy.stunCountLock`） */
  k: number
  /** 该 K 下这一整轮重解出来的全队总伤害 */
  dmg: number
  /** 输出池的失衡次数（钉 K 后应等于 K；小于 = 引擎按 K 排窗、池却撑不住） */
  pool: number
  /** 连续失衡次数（自洽判据的左边；= 该帧净失衡值 / 一窗成本） */
  contiguous: number
  /**
   * 这个点**实际锁的计划窗数**（一般 = `k`；连续失衡生效时是**小数** `k − δ/W`）。
   *
   * 用户 2026-11-01 裁明机制：满条开出 K 窗后，若「攒条时间 + K×W」超过 180s，
   * 溢出 δ 从**最后一窗的时间**里丢掉 ⇒ 第 K 窗不是「没开」，而是「开了但被时钟截短」。
   * 兑现侧本来就吃小数（`stunWindowFraction(plan, W, eff) = plan·W/eff`，实测逐位成立），
   * 所以这里直接用小数计划重算这一帧，而不是把整窗判死。
   */
  plan: number
  /** 末窗被时钟截短的秒数（0 = 没截；> 0 时 `plan = k − clip/W`，末窗长 `W − clip`） */
  clip: number
  /** 这个点是否走了连续失衡（= `clip > 0`） */
  continuous: boolean
  /**
   * **该帧按槽位拆开的伤害**（下标 = 槽位号，与 `damagePoolRows[].slot` 同源；长度 = 队伍槽数）。
   * 用途：主读数要能说「这一级是主 C 涨、队友跌」，而不是只给一个全队合计。
   * 恒等式：`Σ slots === dmg`（`teamTotalDamage` 的定义就是 Σ `damagePoolRows.totalDamage`，
   * 判据 `teamTotalDamageSource.test.ts` / `cinemaUpliftSlots.test.ts`）。未求值的点为空数组。
   */
  slots: number[]
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
  /**
   * **交付帧按槽位拆开的伤害**（下标 = 槽位号）。来源与 `dmg` **同一帧**：
   * `pinned` 取那个钉 K 点、`converged` 取收敛帧 ⇒ `Σ slots === dmg` 恒成立（判据见 `KFrontierPoint#slots`）。
   * 页面「逐槽 Δ%」只用它，不另做一次求值（规则 11）。
   */
  slots: number[]
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
  /**
   * **交付帧的末窗被时钟截短的秒数**（0 = 末窗完整）。
   *
   * 两个来源、同一口径：
   * - `converged` ⇒ 收敛帧的 `convergence.stunContinuityClip`；
   * - `pinned` ⇒ 那个钉 K 点的 `KFrontierPoint#clip`。
   *
   * 为什么交付点要带它：`k` 相同不等于「失衡状况」相同——同一 K 下末窗可能完整、也可能只剩 88%。
   * 用户 2026-11-08 口径：「如果不写就是同 K，如果有连续变化要注明残疾程度」。
   */
  clip: number
  /** 交付帧的**计划窗数** `K − clip/W`（= 末窗按比例折下来的等效窗数；`clip=0` 时恒等于 `k`） */
  plan: number
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
    const rows = calc.damagePoolRows.value
    /**
     * 逐槽求和（`teamTotalDamage` 就是这份 rows 的 totalDamage 之和，见 `useResourceCalc`），
     * 所以 `Σ slots === teamTotalDamage` 是**定义上的恒等**，不是另算一遍。
     * 行数很少（~百行），且这里本来就要读 rows ⇒ 零额外求值。
     */
    const slots = new Array<number>(config.team.length).fill(0)
    for (const row of rows) {
      if (row.slot >= 0 && row.slot < slots.length) slots[row.slot]! += row.totalDamage
    }
    return {
      dmg: calc.teamTotalDamage.value,
      slots,
      pool: (pool as unknown as { stunCount?: number } | null)?.stunCount ?? 0,
      contiguous: pool ? continuousStunCount(pool) : 0,
      net: rr ? netFrontlineOccupation(rr) : Number.NaN,
      // 待装补齐按 **0** 计：钉 K 重算是「按 K 排窗重跑一整轮」，它自己就是稳定停点
      // （与 `evalLocked` 的重跑同口径；传上一轮会把它自己声明的补齐再扣一遍，方向反了）。
      fits: rr ? netFitsBudget(netFrontlineOccupation(rr), 0, calc.stunEffectiveTime.value) : false,
      windowDuration: calc.windowDuration.value,
      effectiveTime: calc.stunEffectiveTime.value,
      /**
       * **本帧末窗被时钟截短的秒数**（引擎读数 `convergence.stunContinuityClip` + 装配溢出取大，
       * 与页面时间轴 / `solveTeam#deliveredStunWindowClip` 同一算式）。
       * 收敛帧一律读它；钉 K 帧另由 `scanKFrontier` 自己的 `clip` 决定（那是计划口径）。
       */
      clip: (rr as unknown as { convergence?: { stunContinuityClip?: number } } | null)?.convergence?.stunContinuityClip ?? 0,
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
      let f = await readFrame(k)
      /** 整数 K 下的读数（判据左边 + 分布条「差多少窗」都用它，**不**随截短改写） */
      const contAtK = f.contiguous
      const selfConsistent = Math.floor(contAtK + CONTINUOUS_FLOOR_EPS) >= k
      /**
       * **连续失衡：末窗时钟截短**（用户 2026-11-01 裁明机制）。
       *
       * 攒满 K 窗要 `K·b/ρ` 秒（ρ = 净攒条速率 = `cont·b/(eff − K·W)`），加上 `K·W` 窗时若超 eff，
       * 溢出 **δ = (K/cont − 1)·(eff − K·W)** 从最后一窗的时间里丢 ⇒ 末窗只有 `W − δ` 秒。
       * δ ∈ [0, W) 时这一窗**是开了的**（攒条够了，只是没打满），兑现按 `plan = K − δ/W` 重算。
       *
       * ⚠ 只在「差距不到一窗」时试：δ ≥ W ⇒ 第 K 窗一秒都分不到 ⇒ 等价 K−1 窗，不采纳。
       * ⚠ 必须**重读一帧**（改计划窗数会改整轮排法）：这不是另算一遍伤害，与其它点同一条求值通道。
       */
      let plan = k
      let clip = 0
      if (!selfConsistent && f.fits && contAtK > 0) {
        const W = f.windowDuration
        /**
         * 第一步：解析式给一个**初始截短**——`δ = (k/cont − 1)·T`，来自「省下的窗秒全变成攒条」。
         * **算式单源 = `core/stunPool#continuousStunClip`**（结算侧 `solveTeam` 的 kStar 判据与之同源；
         * 两处各写一份算式的话，「分析层说可行 / 结算侧判不可行」会静默出现）。返回 `null` = 不适用
         * （T ≤ 0 或 δ ≥ W）。
         *
         * ⚠ 它只是初值：实测「省下 1 秒窗时能多攒多少」远小于这个假设（`auto-1371-1481-1451` C4
         * 的 cont 对 plan 的实测斜率 0.286 窗/窗，解析式等价斜率 ~0.4），所以下面要用实测斜率再解一次。
         */
        const d1 = continuousStunClip({ cont: contAtK, k, windowDuration: W, effectiveTime: f.effectiveTime })
        if (d1 !== null && d1 > 0) {
          const plan1 = k - d1 / W
          const f1 = await readFrame(plan1)
          const cont1 = f1.contiguous
          /**
           * **自洽校验**（判据，不是装饰）：截短之后这一轮必须真的攒得出 K 窗（`cont' ≥ k`）——
           * 那才叫「第 K 窗开了、只是被时钟截短」。攒不出 ⇒ 截短不够或模型不适用 ⇒ 不采纳。
           */
          if (f1.fits && cont1 + CONTINUOUS_ACCEPT_EPS >= plan1) {
            plan = plan1
            clip = d1
            f = f1
          } else if (f1.fits) {
            /** 第二步：**实测斜率**切一刀（secant）。斜率 ≤ 0 说明改计划窗数救不回攒条 ⇒ 放弃 */
            // cont 随 plan **增加而下降** ⇒ 斜率取正号，要涨攒条必须**减**计划窗数
            const slope = (cont1 - contAtK) / (plan1 - k)
            if (slope > 1e-6) {
              const plan2 = plan1 - (k - cont1) / slope
              if (plan2 > k - 1 && plan2 < k) {
                const f2 = await readFrame(plan2)
                if (f2.fits && f2.contiguous + CONTINUOUS_ACCEPT_EPS >= plan2) {
                  plan = plan2
                  clip = (k - plan2) * W
                  f = f2
                }
              }
            }
          }
        }
      }
      const continuous = clip > 0
      const rejectReason = !f.fits && !selfConsistent && !continuous ? 'both' as const
        : !f.fits ? 'budget' as const
          : !selfConsistent && !continuous ? 'contiguous' as const
            : null
      points.push({
        k,
        dmg: f.dmg,
        slots: f.slots,
        pool: f.pool,
        contiguous: contAtK,
        plan,
        clip,
        continuous,
        net: f.net,
        fits: f.fits,
        selfConsistent,
        feasible: rejectReason === null,
        rejectReason,
        clamped: f.pool < plan,
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
      if (!selfConsistent && !continuous && opts.earlyClose !== false) {
        for (let rest = k + 1; rest <= maxK; rest++) {
          points.push({
            k: rest,
            dmg: Number.NaN,
            slots: [],
            pool: Number.NaN,
            contiguous: Number.NaN,
            plan: rest,
            clip: 0,
            continuous: false,
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
      delivery: pickDelivery(points, free.dmg, free.pool, opts.rule, free.slots, free.clip, free.windowDuration),
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
  /** 收敛帧的逐槽伤害（缺省空 = 调用方不要逐槽读数；判据复用旧签名时不用改） */
  convergedSlots: readonly number[] = [],
  /**
   * 收敛帧的**末窗时钟截短秒数**（缺省 0 = 末窗完整）。只有「交付点 = 收敛帧」时才用它；
   * 钉 K 分支自己带 KFrontierPoint#clip。缺省 0 是为让判据复用旧签名。
   */
  convergedClip = 0,
  /** 该次扫描的窗长（秒）；缺省 0 ⇒ plan 退化成 k（判据复用旧签名时不用改） */
  windowDuration = 0,
): KFrontierDelivery {
  const feasible = points.filter(p => p.feasible)
  /** 交付帧的「残疾程度」：末窗截短秒 + 等效计划窗数（k − clip/W） */
  const stunOf = (k: number, clip: number) => ({
    clip: Math.max(0, clip),
    plan: windowDuration > 0 ? k - Math.max(0, clip) / windowDuration : k,
  })
  const base = {
    convergedK,
    convergedDmg,
    // 缺省 = 交付收敛帧 ⇒ 逐槽读数也取收敛帧；钉 K 分支会覆盖成那个点的
    slots: [...convergedSlots],
    feasibleCount: feasible.length,
    // 「扫描了多少个」= **真的求值过**的点数（提前封闭的那些没求值，不能算进成本也不该算进覆盖率）
    scannedCount: points.filter(p => p.scanned).length,
    maxK: Math.max(0, points.length - 1),
  }
  if (rule === 'maxK') {
    // 旧口径：可行点里的最大 K（**没有**可行点 ⇒ 0 ⇒ 回落收敛停点，与旧引擎 min-K 回落同形）
    const kmax = feasible.length ? feasible.reduce((a, b) => (b.k > a.k ? b : a)) : null
    if (!kmax) {
      return { ...base, k: convergedK, dmg: convergedDmg, source: 'converged', driftPct: 0, ...stunOf(convergedK, convergedClip) }
    }
    const usePinned = kmax.dmg > convergedDmg + 1e-9
    return {
      ...base,
      k: kmax.k,
      dmg: kmax.dmg,
      slots: [...kmax.slots],
      source: usePinned ? 'pinned' : 'converged',
      driftPct: convergedDmg > 0 ? ((kmax.dmg - convergedDmg) / convergedDmg) * 100 : 0,
      ...(usePinned ? stunOf(kmax.k, kmax.clip) : stunOf(convergedK, convergedClip)),
    }
  }
  const best = feasible.length
    ? feasible.reduce((a, b) => (b.dmg > a.dmg + 1e-9 ? b : b.dmg < a.dmg - 1e-9 ? a : (b.k < a.k ? b : a)))
    : null
  // 收敛停点领先或打平 ⇒ 引擎已经就位，不拿钉 K 去改读数（这一帧是「真的到达过」的点）
  if (!best || convergedDmg >= best.dmg - 1e-9) {
    return { ...base, k: convergedK, dmg: convergedDmg, source: 'converged', driftPct: 0, ...stunOf(convergedK, convergedClip) }
  }
  return {
    ...base,
    k: best.k,
    dmg: best.dmg,
    slots: [...best.slots],
    source: 'pinned',
    driftPct: convergedDmg > 0 ? ((best.dmg - convergedDmg) / convergedDmg) * 100 : 0,
    ...stunOf(best.k, best.clip),
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
  /**
   * 后一级在该 K 上**攒出的连续窗数**（`continuousStunCount`）——「差多少才算够」的原始读数。
   * 只在「攒不出」是原因之一时给（否则 null）。
   *
   * 为什么必须带出来：自洽判据是 `floor(连续窗) ≥ K` 的**整数门槛**，差 0.002 窗与差 2 窗
   * 在读数上是同一个「✕」，但对读者完全是两件事（前者是门槛抖动、后者是真墙）。
   */
  afterContiguous: number | null
  /** 攒出缺口 = `afterContiguous − k`（负数 = 还差这么多窗；仅 `contiguous`/`both` 时有值） */
  afterGap: number | null
  /**
   * 后一级在这个 K 上**末窗被时钟截短的秒数**（0 = 没截；> 0 = 走连续失衡兑现）。
   * 页面悬浮据此说明「这个 K 是开了窗、只是没打满」，而不是「攒不出」。
   */
  afterClip: number
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
      points.push({ k: b.k, pct: null, bothFeasible: false, afterReject: 'out-of-range', afterContiguous: null, afterGap: null, afterClip: 0 })
      continue
    }
    const bothFeasible = b.feasible && a.feasible
    const pct = b.dmg > 0 && a.scanned && b.scanned ? ((a.dmg - b.dmg) / b.dmg) * 100 : null
    const afterReject: SameKBandPoint['afterReject'] = a.feasible ? null : (a.scanned ? a.rejectReason : 'unscanned')
    // 缺口只在「攒不出」是原因之一时才有意义（纯超预算的 K 与连续窗数无关）
    const shortByContiguous = afterReject === 'contiguous' || afterReject === 'both'
    points.push({
      k: b.k,
      pct,
      bothFeasible,
      afterReject,
      afterContiguous: shortByContiguous && Number.isFinite(a.contiguous) ? a.contiguous : null,
      afterGap: shortByContiguous && Number.isFinite(a.contiguous) ? a.contiguous - b.k : null,
      afterClip: a.feasible ? a.clip : 0,
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

