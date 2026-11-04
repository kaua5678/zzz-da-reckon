/**
 * **命座 × 难度曲线的「区间提升」口径**（用户 2026-11-04 立项）。
 *
 * 用户逐字：
 * > 「一个命座水平在难度曲线上覆盖**一段 y**，加命座会把 y 区间上移，但区间有重合，
 * >   特定的某个 y1 可以找到更低的 y2。这就是副作用的由来。我想玩家看命座肯定想看这种
 * >   **客观的区间提升**，而不是取两点发现命座说伤害提升了但计算器算出来是负的。」
 *
 * ## 为什么「两点」必然出负值
 *
 * 一个命座水平在难度曲线上不是**一个点**，是**一条前沿**（同一条队、不同操作难度 ⇒ 伤害上界）。
 * 现行 `analyzeCinemaUplift` 是「同场景只变命座」的两点比——那在**同一 x** 上是正确的（死数据自检就靠它），
 * 但它**不是**难度曲线上的比较：两级曲线各自收敛出的落点本来就落在**不同 x**（实测同一支队
 * C3 有 4 点 / C4 有 5 点，x 从 2.9 到 38.1），拿「C3 的第 3 点」比「C4 的第 3 点」等于拿两个不同难度的
 * 数字相比 —— 这正是用户说的「特定的某个 y1 可以找到更低的 y2」。
 *
 * ## 本模块给的两个读法（都返回，不二选一）
 *
 * | 读法 | 定义 | 回答 |
 * |---|---|---|
 * | **同难度比伤害** | 对 C_lo 的每个 x，取 C_hi 在 `x' ≤ x` 内的最高 y | 同样的操作难度，加命座能多打多少 |
 * | **同伤害比难度** | 对 C_lo 的每个 y，取 C_hi 达到 y 所需的最小 x | 打出同样的伤害，加命座能省多少操作 |
 *
 * ⚠ **不许把 `max y(hi)` 与 `max y(lo)` 相比**（那是「两条曲线的端点比端点」，端点落在不同 x 上）。
 * 本模块刻意不提供这个 API：它只给逐参考点的 Δ 与 `min/max/mean` 的**区间读数**，
 * 让读者看到「在这段难度上，提升落在 [min, max] 里」，而不是一个被端点伪造出来的单数。
 *
 * ⚠ **域外必须返回 `null`，不是 0、不是负**：`x` 低于 C_hi 曲线的最低采样点（或 `y` 高于 C_hi 能到的
 * 最高伤害）时，「这一档够不到」是**未定义**。把它当 0 会把「采样没覆盖」渲染成「命座没收益」。
 *
 * ## 边界（必须由调用方保证，本模块不猜）
 *
 * - 两条前沿必须来自**同一套采样口径**（同一批 `(parry, dodge)` 网格，或同一套阶梯档位）；
 *   混用会让 x 根本不是同一把尺子（阶梯落点 vs 固定网格实测差一个量级，见专项文档 §2.1/§2.2）。
 * - 前沿点应已取**上包络**：`upperFrontier` 负责这件事（升序 x + 累积最大 y）。
 *   散点直接喂进来也能算，但那量的是「某个采样点」而不是「这条命座水平的上限」。
 */

/** 前沿上的一个点：`x` = 操作难度（难度曲线的横轴），`y` = 该难度下的伤害。 */
export interface FrontierPoint {
  x: number
  y: number
}

/** 同难度比伤害的一行 */
export interface SameDifficultyDelta {
  /** 参考难度（来自 C_lo 的点） */
  x: number
  /** 该难度下 C_lo 的伤害 */
  loY: number
  /** `x' ≤ x` 内 C_hi 的最高伤害；C_hi 的 x 域不覆盖该点时为 null */
  hiY: number | null
  /** `(hiY − loY) / loY × 100`；域外或 `loY <= 0` 时为 null（**不是 0**） */
  deltaPct: number | null
}

/** 同伤害比难度的一行 */
export interface SameDamageDelta {
  /** 参考伤害（来自 C_lo 的点） */
  loY: number
  /** 该难度下 C_lo 的操作难度 */
  loX: number
  /** C_hi 达到该伤害所需的最小难度；C_hi 够不到该伤害时为 null */
  hiX: number | null
  /** `loX − hiX`（正 = 省下的难度）；够不到时为 null */
  savedX: number | null
}

export interface FrontierComparison {
  atSameDifficulty: SameDifficultyDelta[]
  atSameDamage: SameDamageDelta[]
  /**
   * Δ 的区间读数（只统计**两端都有着落**的参考点）。
   * `pct = null` 表示一个可比的点都没有（两条前沿的 x 域完全不重叠 ⇒ 无从比较，
   * 如实报「不可比」而不是报 0）。
   */
  summary: {
    minPct: number | null
    maxPct: number | null
    meanPct: number | null
    /** 逐点 Δ 为负（`< -eps`）的参考点数——**这是要下钻到行级的信号**，不是「命座变弱」的结论 */
    negativeCount: number
    /** 参与统计的参考点数（= `atSameDifficulty` 里 `deltaPct !== null` 的条数） */
    comparableCount: number
    /** C_lo 的每一个点是否都被 C_hi 的 x 域覆盖（false ⇒ 有参考点够不到，需在 UI 上写明哪些） */
    domainComplete: boolean
  }
}

/** 判定「负」的容差（百分点）。与 `UPLIFT_EPSILON_PCT` 同量级，但本模块不 import 它（保持纯函数无依赖）。 */
const NEG_EPS = 1e-9

/**
 * 取**上包络**：按 x 升序，只保留「伤害比之前所有点都高」的点。
 *
 * 为什么必须取包络：散点里同一个 x 上可能有多个 y（不同 `(parry, dodge)` 组合落到同一难度），
 * 只有最高的那个才是「这条命座水平在该难度能拿到的东西」。不取包络 ⇒ 后一个更低的点会让
 * 「C_hi 在 `x' ≤ x` 内的最高 y」读到一个被污染的值。
 *
 * 相同 x 上的多个点：保留**先出现的最高者**（排序稳定，结果不依赖输入顺序里的同级项）。
 */
export function upperFrontier(points: readonly FrontierPoint[]): FrontierPoint[] {
  const sorted = points
    .filter(p => Number.isFinite(p.x) && Number.isFinite(p.y) && p.y > 0)
    .slice()
    .sort((a, b) => (a.x - b.x) || (b.y - a.y))
  const out: FrontierPoint[] = []
  let best = Number.NEGATIVE_INFINITY
  for (const p of sorted) {
    if (p.y <= best) continue
    best = p.y
    out.push({ x: p.x, y: p.y })
  }
  return out
}

/**
 * 同难度比伤害：`x' ≤ x` 内的最高 y。`x` 低于前沿最低点 ⇒ **null（域外）**。
 * 前沿必须已升序（`upperFrontier` 的产物）。
 */
export function damageAtNoMoreDifficulty(frontier: readonly FrontierPoint[], x: number): number | null {
  if (frontier.length === 0) return null
  if (x < frontier[0].x) return null
  let best: number | null = null
  for (const p of frontier) {
    if (p.x > x) break
    if (best === null || p.y > best) best = p.y
  }
  return best
}

/**
 * 同伤害比难度：达到 `y` 所需的**最小 x**。前沿最高伤害都够不到 `y` ⇒ **null（够不到）**。
 */
export function difficultyForDamage(frontier: readonly FrontierPoint[], y: number): number | null {
  let best: number | null = null
  for (const p of frontier) {
    if (p.y >= y - 1e-6 && (best === null || p.x < best)) best = p.x
  }
  return best
}

/** 两种读法逐参考点算完，并给区间读数。`lo` / `hi` 会先各自取上包络。 */
export function compareFrontiers(
  loPoints: readonly FrontierPoint[],
  hiPoints: readonly FrontierPoint[],
): FrontierComparison {
  const lo = upperFrontier(loPoints)
  const hi = upperFrontier(hiPoints)

  const atSameDifficulty: SameDifficultyDelta[] = lo.map(p => {
    const hiY = damageAtNoMoreDifficulty(hi, p.x)
    const deltaPct = hiY === null || p.y <= 0 ? null : ((hiY - p.y) / p.y) * 100
    return { x: p.x, loY: p.y, hiY, deltaPct }
  })

  const atSameDamage: SameDamageDelta[] = lo.map(p => {
    const hiX = difficultyForDamage(hi, p.y)
    return { loY: p.y, loX: p.x, hiX, savedX: hiX === null ? null : p.x - hiX }
  })

  const comparable = atSameDifficulty.filter((d): d is SameDifficultyDelta & { deltaPct: number } => d.deltaPct !== null)
  const pcts = comparable.map(d => d.deltaPct)
  return {
    atSameDifficulty,
    atSameDamage,
    summary: {
      minPct: pcts.length > 0 ? Math.min(...pcts) : null,
      maxPct: pcts.length > 0 ? Math.max(...pcts) : null,
      meanPct: pcts.length > 0 ? pcts.reduce((a, b) => a + b, 0) / pcts.length : null,
      negativeCount: pcts.filter(v => v < -NEG_EPS).length,
      comparableCount: pcts.length,
      domainComplete: atSameDifficulty.every(d => d.hiY !== null),
    },
  }
}
