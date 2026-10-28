/**
 * **连续失衡：缺口标注**（用户口径 2026-10-23「再加点配置或交互就能达到完整失衡，进入下一阶段」）。
 *
 * ⚠ 2026-10-25：本模块原有的「末窗兑现物理推演」（realizeStunWindows）与连续覆盖率
 * （continuousStunCoverage）从未接进任何生产通道（deadChannelLs 判死导出；现行覆盖率仍是
 * 二值 stunWindowFraction），且与「没攒满 = 没开启 = 没有易伤」的裁决（2026-10-21 §33）不一致，
 * 已删除。完整推导、否决过程与实测表保留在 docs/STUN_CONTINUOUS_LASTWINDOW.md 与 git 历史。
 */
import { finiteOr0 } from '@/utils/finiteClamp'
import { continuousStunCount } from '@/core/stunPool'

/**
 * **「离下一次完整失衡还差多少」进度**（展示标注用；**不改任何数值**）。
 *
 * ## 为什么需要它
 * 引擎的 `kStar` 是「最大自洽可行整数」：它只会答「攒满了几次」。于是在难度曲线上，
 * 「完整 n」到「完整 n+1」之间是**一格跳变**（实测 `auto-1611-1141-1211` 闪反 18→19
 * 一格 +9.268M、占全程 70.9%）。用户口径要的是「到临界后快速增加」的那一段——
 * 而在**当前物理模型下那一段的伤害贡献恒为 0**（第 n+1 窗没攒满 = 没开启 = 没有易伤，
 * 用户 2026-10-21 §33 裁决），所以它不该被算成伤害，**只该被标注出来**：
 *
 * > 「再加点配置或交互就能达到完整失衡，进入下一阶段」（用户 2026-10-23）
 *
 * ## 口径
 * - `nextWindowProgress` ∈ [0,1)：距离第 ⌈cont⌉ 窗攒满的比例（0 = 刚好攒满上一窗，0.99 = 就差一点）；
 * - `missingBars`：还差几条失衡值（= ⌈cont⌉ − cont）；
 * - `missingBuildUp`：还差多少失衡值（按池的计数律 `b + (n−1)·b·(1−refund)` 折算，与
 *   `stunBuildUpForCount` 同源）；
 * - `atStep`：是否正好踩在整数上（= 已完整达成，无「再加点」可言）。
 */
export interface ContinuousStunProgress {
  /** 已完整兑现的失衡次数（整数） */
  completeWindows: number
  /** 距下一次完整失衡的进度（0..1）；`atStep` 时恒 0 */
  nextWindowProgress: number
  /** 还差几条失衡值（0..1） */
  missingBars: number
  /** 还差多少失衡值（绝对值；池的 boss 失衡值量纲） */
  missingBuildUp: number
  /** 是否正好踩在整数上（没有「再加点」可言） */
  atStep: boolean
  /**
   * **缺口折成「几个失衡窗被吃掉的量」**（用户 2026-10-23 的计量单位）。
   *
   * 用户口径：「打完 n 次失衡时，中间 n−1 个失衡窗里被吃掉的那些失衡值，就是这一轮周期的
   * 自然单位；从『刚进入第 n 次』到『完整 n+1 次』大约只要再补**一个被吃掉量**」。
   * ⇒ 展示层用这个数说话（「还差 ≈0.4 个失衡窗的量」），比裸失衡值点更好读。
   *
   * `null` = 该队没有可用的「被吃掉量」读数（`eatenPerWindow` 未给或 ≤ 0）。
   */
  missingInEatenWindows: number | null
}

export function continuousStunProgress(input: {
  /** 池报的**连续**失衡次数（`core/stunPool.ts#continuousStunCount`） */
  builtWindows: number
  bossStunValue: number
  /** 雨果决算口径的失衡值返还比例（0~0.25；与池同源） */
  stunRefundRatio?: number
  /**
   * **每个失衡窗里被吃掉的失衡值**（= `StunPoolResult.inAxisStunTotal / stunCount`；
   * 「失衡窗口内招式吃易伤但不攒条」⇒ 那段时间本该攒出来的条被吃掉）。
   * 给了才能把缺口折成用户口径的「几个失衡窗的量」；缺省 ⇒ `missingInEatenWindows = null`。
   */
  eatenPerWindow?: number
}): ContinuousStunProgress {
  const built = Math.max(0, finiteOr0(input.builtWindows))
  const b = Math.max(0, finiteOr0(input.bossStunValue))
  const refund = Math.max(0, Math.min(0.99, finiteOr0(input.stunRefundRatio)))
  const complete = Math.floor(built + 1e-9)
  const EPS = 1e-6
  const frac = built - complete
  const atStep = frac < EPS
  if (atStep) {
    return { completeWindows: complete, nextWindowProgress: 0, missingBars: 0, missingBuildUp: 0, atStep: true, missingInEatenWindows: 0 }
  }
  /** 第 ⌈built⌉ 窗还差的比例（1 − frac） */
  const missingBars = Math.min(1, Math.max(0, 1 - frac))
  /** 下一次失衡的边际成本：首次 b、之后 b(1−refund)（与 `stunBuildUpForCount` 同一条计数律） */
  const marginal = complete < 1 ? b : b * (1 - refund)
  const missingBuildUp = missingBars * marginal
  const eaten = Math.max(0, finiteOr0(input.eatenPerWindow))
  return {
    completeWindows: complete,
    nextWindowProgress: Math.min(1, Math.max(0, frac)),
    missingBars,
    missingBuildUp,
    atStep: false,
    missingInEatenWindows: eaten > 0 ? missingBuildUp / eaten : null,
  }
}
/** 连续失衡：末窗兑现比例（用户口径 2026-10-25；施工图 `.claude/TASK-continuous-stun.md`）。 */
export interface ContinuousWindowSplit {
  /** **开窗数** N（含末窗）：`1 + floor((Σ − b) / unit)`；Σ < b ⇒ 0（一窗都没开） */
  openedWindows: number
  /** 完整兑现的窗数（末窗 frac < 1 时 = N − 1） */
  fullWindows: number
  /** **末窗兑现比例** frac ∈ [0,1]：`((Σ − b) mod unit) / e` */
  lastFraction: number
  /**
   * **已兑现的等效窗数**（= 施工图 §0 的 `完整窗数 + 末窗兑现比例`，是接数值路径的唯一读数）。
   *
   * ⚠ **不能写成 `fullWindows + lastFraction`**：末窗完整（frac = 1）时 `fullWindows` **已含它**
   * （判据 `continuousStun.test.ts`「Σ = 1.16w ⇒ fullWindows = 1」），再加一次就凭空多一窗。
   * 三档自检（b=1w / e=0.16w）：Σ=1.00w ⇒ 0；Σ=1.08w ⇒ 0.5；Σ=1.16w ⇒ **1**（不是 2）。
   */
  realizedWindows: number
  /** unit = b + e（一窗完整兑现的总成本） */
  unit: number
  /**
   * 余量（失衡值，未开窗时为 0）。
   *
   * ⚠ 2026-10-28 起语义 = **净失衡值的余量**（毛 − 窗内无效），与 `pool.stunCount` 同源。
   */
  remainder: number
  /**
   * **下一窗进度** ∈ [0,1)：玩家口中的「**打完 3 失衡，还积累了 56%**」。
   *
   * = 余量 / boss 失衡值。**这一窗还没开** ⇒ 不占 `StunWindowSlot`、不画窗条；
   * 与「进入第 4 窗但只打了 6s」（时间不够，走 `stunTimeline` 的截断标记）是两件事。
   */
  nextWindowProgress: number
  /**
   * 是否发生过钳位。**恒为 false**（实现改成恒落在 [0,1] 的等价写法后不再需要钳位）；
   * 保留字段是为了让新的消费方显式断言「没有钳位」，见施工图 §1。
   */
  clamped: boolean
}

/**
 * **连续失衡的核心切分**（用户公式，2026-10-25 逐字记录于 `.claude/TASK-continuous-stun.md` §1）：
 *
 * ```
 * unit = b + e                                  // b = 开一窗的失衡值；e = 一窗内被吞掉的量
 * 开窗数 N      = 1 + floor((Σ − b) / unit)
 * 末窗兑现 frac = ((Σ − b) mod unit) / e
 * ```
 *
 * 用户原话（1w / 16s / 每秒 100 点失衡值）：
 * 「想打最后一次完整失衡，其实造成了 1.16w 的失衡」「只造成 1w ⇒ 招式全用来打击破，窗口开了但一秒爆发都没有」
 * 「造成 1.08w ⇒ 打出 1w 开窗后还打出 800 点被吞的失衡值，相当于 8 秒的爆发」。
 *
 * ⚠ 与 `continuousStunProgress` 的分工：那个是**标注**（还差多少），这个是**兑现口径**（够多少）；
 * 两者同源（都吃 Σ/b/e），但本函数**会成为数值路径**，所以单独一个纯函数 + 判据锁。
 *
 * ⚠ 与 `effectiveTime.ts#decomposeStunWindows`（时间口径 room/W）**不是同一把尺**：
 * 那个按"还剩多少战斗时间"，这个按"还剩多少失衡值"。别混用。
 */
export function continuousWindowSplit(input: {
  /** Σ：全队**毛**失衡值（含窗内被吞掉的那部分；= `grossStunBuildUp`） */
  totalBuildUp: number
  /** b：开一窗需要的失衡值（boss 失衡值） */
  bossStunValue: number
  /** e：一窗内被吞掉的失衡值（= `inAxisStunTotal / stunCount`） */
  eatenPerWindow: number
}): ContinuousWindowSplit {
  const b = Math.max(0, finiteOr0(input.bossStunValue))
  const e = Math.max(0, finiteOr0(input.eatenPerWindow))
  const sigma = Math.max(0, finiteOr0(input.totalBuildUp))
  const empty: ContinuousWindowSplit = {
    openedWindows: 0, fullWindows: 0, lastFraction: 0, realizedWindows: 0, unit: b + e, remainder: 0, nextWindowProgress: 0, clamped: false,
  }
  // b/e 缺一就退化为"没有连续量可言"（调用方据此走旧的整数口径）
  if (!(b > 0) || !(e > 0) || sigma < b) return empty
  const unit = b + e
  /**
   * ⚠ **实现用的是与用户公式等价、但恒落在 [0,1] 的写法**（判据见单测 + 施工图 §1）：
   *
   * ```
   * full = floor((Σ − b)/unit) + 1        // 已开窗数（用户式）
   * rem  = (Σ − b) − full0·unit           // 余量 ∈ [0, unit)
   * ```
   *
   * 用户式 `frac = rem / e` 在 **rem > e** 时会 >1（本仓 b/e≈2~4，例子 6.25），
   * 全库普查 95/97 支队落在这一支 ⇒ 直接钳位等于把连续量抹平。
   *
   * 等价改写（同样的 b/e/Σ，同样的 N）：先按 `Σ` 而不是 `Σ − b` 切 unit——
   * `full = floor(Σ/unit)`、`rem = Σ − full·unit`；只有 `rem ≥ b` 时第 `full+1` 窗才会打开，
   * 其兑现 = `(rem − b)/e`，恒 ∈ [0,1]（因为 `rem < unit = b + e`）。`rem < b` ⇒ 没开窗，
   * 那段是「攒向下一窗的进度」，不是"末窗的一部分"（用户的 2.0w 反例：1.16w 打完 + 0.84w 进度，
   * 不是"1 窗 + 6.25 个窗的兑现"）。
   */
  const full = Math.floor(sigma / unit + 1e-9)
  const rem = Math.max(0, sigma - full * unit)
  const opensNext = rem >= b - 1e-9
  const openedWindows = full + (opensNext ? 1 : 0)
  /**
   * 末窗 = **最后一个已开的窗**（不是"下一个窗"）：`rem < b` 时没开新窗 ⇒ 末窗就是第 `full` 个、
   * 且它是完整的（frac 1）；一窗都没开（full=0 且不开新窗）⇒ frac 0。
   * 「攒向下一窗的进度」不在这里表达（那是 `continuousStunProgress.nextWindowProgress` 的活）。
   */
  const lastFraction = opensNext
    ? Math.min(1, Math.max(0, (rem - b) / e))
    : (openedWindows > 0 ? 1 : 0)
  /**
   * 末窗**未**完整 ⇒ `fullWindows = openedWindows − 1`（不含末窗）⇒ 加 frac 折算；
   * 末窗完整（或根本没开新窗）⇒ `fullWindows = openedWindows` 已经含它 ⇒ 直接取 openedWindows。
   * 两臂合起来恰好是「每个完整窗 1 + 末窗 frac」。
   */
  const lastComplete = !(opensNext && lastFraction < 1 - 1e-9)
  return {
    openedWindows,
    fullWindows: lastComplete ? openedWindows : openedWindows - 1,
    lastFraction,
    realizedWindows: lastComplete ? openedWindows : openedWindows - 1 + lastFraction,
    unit,
    remainder: opensNext ? Math.max(0, rem - b) : 0,
    nextWindowProgress: 0,
    clamped: false,
  }
}

/**
 * **`e` 的来源：窗内实际打出的无效失衡**（用户口径 2026-10-28，定案）。
 *
 * ## 用户裁决（逐字）
 * > 「招式虽然自己有失衡数据，但是**打在失衡里是无效的**。失衡内 total 应该只是一个统计数据，
 * >  他表示有多少**无效的失衡值**，所有招式失衡减去这个无效失衡得到净失衡，净失衡有效的作用于失衡积累。」
 *
 * ## 修前为什么错
 * 旧实现写 `e = (全队毛失衡值 / 有效战斗时间) × 窗长`，即假设「**窗内每秒都在产条**」。
 * 这与「打在失衡里无效」直接冲突：窗内打的是爆发招（失衡倍率低），实际每秒只产全队均值的 ~1/4。
 * 实测 `auto-1611-1141-1211`：旧式 `e = 620.386 × 16 = 9926`，真实 `e = 13830 / 6 = 2305`，
 * ⇒ 旧式把该队算成「只够 4 窗」，而池按净失衡报 **6 窗**（`97840 / 15486 = 6.318`）。**池是对的。**
 *
 * ## 现在的口径（与池同源，不再各算一份）
 * `e = inAxisStunTotal / stunCount` —— 即 `stunPool` 已经逐招算出来的「窗内无效失衡」总额除以窗数。
 * 这不是「用无效求有效」的绕路：净失衡（`totalStunBuildUp`）本来就是逐招 `total − inAxisStun` 直接算的，
 * 这里只是读那个**已有的统计量**来回答「一个窗平均吞掉多少」，两者同源、不会互相打架。
 *
 * ⚠ `grossStunBuildUp` 保持纯统计（展示「毛 = 净 + 无效」），**不再参与 `e` 的推导**。
 */
export function continuousStunSplitOf(
  pool: {
    grossStunBuildUp: number
    inAxisStunTotal: number
    stunCount: number
    bossStunValue: number
    /** 缺省兼容旧调用：没给就当 0（无赠送/无返还，等价于旧的 remain/boss） */
    stunGift?: number
    stunRefundRatio?: number
    /** 净失衡值（= 池的 `totalStunBuildUp`）；缺省回退 `gross − inAxis`（与池不同源时的旧近似） */
    totalStunBuildUp?: number
  },
): ContinuousWindowSplit {
  const boss = Math.max(0, finiteOr0(pool.bossStunValue))
  const windows = Math.max(0, finiteOr0(pool.stunCount))
  const inAxis = Math.max(0, finiteOr0(pool.inAxisStunTotal))
  const gross = Math.max(0, finiteOr0(pool.grossStunBuildUp))
  /** 每窗平均被吞掉的**无效**失衡（池已逐招算好，这里只做除法） */
  const eatenPerWindow = windows > 0 ? Math.min(inAxis / windows, boss) : 0
  /** **净**失衡值——首选池的 `totalStunBuildUp`（与 `stunCount` 完全同源）；缺省回退「毛 − 无效」 */
  const net = Math.max(0, finiteOr0(pool.totalStunBuildUp ?? (gross - inAxis)))
  /**
   * ## 两个量分开表达（用户口径 2026-10-28，逐字）
   * > 「描述进度玩家通常说：**打完了 3 失衡，还积累了 56% 的失衡**。
   * >  或者说：**进入第四失衡了，但是只打了 6s 就结束了。**」
   *
   * 1. **开窗数** = `pool.stunCount`（= `floor(净失衡 / b)` 那一族）⇒ 「打完了 3 失衡」；
   * 2. **下一窗进度** = 余量 / b ⇒ 「积累了 56%」；**没开的窗不占 StunWindowSlot**；
   * 3. 「进入第 4 窗但只打了 6s」= **时间**不够 ⇒ 由 `stunTimeline` 的 `clippedByClock` / `truncated` 表达，
   *    与失衡值无关（这里不重复扣）。
   *
   * ⇒ 本函数的 `lastFraction` = **1**（每个开出来的窗在失衡值意义上都是完整的），
   *    「残窗」只可能来自时间轴。
   *
   * ## 下一窗进度的单一尺（2026-10-28 统一到池的计数律）
   * `nextWindowProgress` = `continuousStunCount(pool)` 的小数部分——池的计数律
   * （首次成本 b、之后每窗 b·(1−refund)、含 `stunGift` 抵扣）的小数项，与
   * `continuousStunProgress`（难度曲线/队伍对比页的标注）**同一把尺**；
   * 旧写法 `remain/boss` 在 refund>0（雨果决算返还）时会与标注尺分叉，已废弃。
   */
  const full = boss > 0 ? windows : 0
  const remain = boss > 0 ? Math.max(0, net - full * boss) : 0
  const cont = continuousStunCount({
    totalStunBuildUp: net,
    stunGift: Math.max(0, finiteOr0(pool.stunGift)),
    bossStunValue: boss,
    stunRefundRatio: Math.max(0, Math.min(0.99, finiteOr0(pool.stunRefundRatio))),
  })
  return {
    openedWindows: full,
    fullWindows: full,
    lastFraction: full > 0 ? 1 : 0,
    realizedWindows: full,
    unit: boss + eatenPerWindow,
    remainder: remain,
    nextWindowProgress: boss > 0 ? Math.max(0, Math.min(1, cont - Math.floor(cont))) : 0,
    clamped: false,
  }
}
