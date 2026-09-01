/**
 * 保底进度定价：把「抽卡成本」从常量升级为**状态的函数** c(pity, guarantee)。
 *
 * ── 为什么存在（2026-08-31）──────────────────────────────────────────────────
 * 规划器（composables/pullPlanner.ts）目前把每金当作固定价买：CINEMA_GOLD_FILM=15000
 * 菲林 = 93.75 抽。这个期望价**本身没错**，但它把随机性压成了常量，于是模型无法表达
 * 玩家真正在做的那个判断：
 *   「我已经垫了 70 抽 / 我上把歪了下把必中」——此时下一个限定的边际成本只有满价的一小截。
 * 保底进度不是噪声，是**资产**：它可以被攒、被消耗、被浪费（换池就贬值）。状态里没有它，
 * 规划器就永远算不出「先垫刀再上车」「这期忍住把保底留给下期强卡」这类真实策略。
 *
 * 本模块只做一件事：给定 (已垫抽数, 是否大保底)，算出「拿到下一个限定 UP」的期望抽数/菲林。
 * 它是纯函数、无依赖、可解析验证，供规划器把 TIER_COSTS 的常量替换成价格函数。
 *
 * ── 模型与口径 ──────────────────────────────────────────────────────────────
 * 单池模型 = 「恒定基础出率 p + 第 N 抽硬保底」的截断几何分布：T = min(Geom(p), N)，
 * E[T] = (1-(1-p)^N)/p。p **不是**另录的数据，而是由仓库既有唯一事实源反解出来的：
 * 让 E[T] 等于 filmEconomy 的综合出率口径（角色池 62.5 抽/金、音擎池 50 抽/金）。
 * 于是本模块与 CINEMA_GOLD_FILM / WEAPON_GOLD_FILM 在 pity=0 处**恒等**（有测试锁死），
 * 只是在 pity>0 处给出常量给不出的信息。
 *
 * debt: 真实软保底爬坡（后段逐抽提概率）未建模，用恒定 p 拟合同一均值——均值精确、
 * 中段形状偏保守（真实曲线在 70+ 抽更陡，本模型会略高估该区间的剩余成本）；
 * 升级路径 = 拿到官方/实测逐抽出率曲线后把 hazard 换成分段函数，接口不变。
 */
import { CINEMA_GOLD_FILM, PULL_FILM, WEAPON_GOLD_FILM } from '@/data/filmEconomy'

/** 卡池参数（硬保底抽数 + 歪的概率 + 期望抽数口径全部来自 filmEconomy 单一事实源） */
export interface PoolSpec {
  /** 硬保底：第几抽必出 S */
  hardPity: number
  /** 出 S 后是 UP 的概率（角色池 50/50、音擎池 75/25） */
  upRate: number
  /** 一个限定 UP 的期望抽数（含歪与大保底），= filmEconomy 的金价 / 单抽价 */
  meanPullsPerLimited: number
}

// @fact engine:gacha/池参数单一事实源 口径: 角色池/音擎池的期望抽数一律由 filmEconomy 的金价反解，本模块不另录出率常量 | 据 实测@2026-09-01复核 | 验 src/core/__tests__/gachaCost.test.ts | 锚 src/core/gachaCost.ts#CHAR_POOL | 信 确认
export const CHAR_POOL: PoolSpec = {
  hardPity: 90,
  upRate: 0.5,
  meanPullsPerLimited: CINEMA_GOLD_FILM / PULL_FILM, // 93.75
}

export const WENGINE_POOL: PoolSpec = {
  hardPity: 80,
  upRate: 0.75,
  meanPullsPerLimited: WEAPON_GOLD_FILM / PULL_FILM, // 62.5
}

/** 一个限定 = 期望多少次金（50/50 → 1.5 次；75/25 → 1.25 次） */
export function goldPerLimited(pool: PoolSpec): number {
  return 1 + (1 - pool.upRate)
}

/** 截断几何分布的均值：E[min(Geom(p), N)] = (1-(1-p)^N)/p */
export function truncatedGeomMean(p: number, n: number): number {
  if (n <= 0) return 0
  if (p <= 0) return n
  if (p >= 1) return 1
  return (1 - Math.pow(1 - p, n)) / p
}

/**
 * 反解基础出率：找 p 使 E[min(Geom(p), hardPity)] = 目标均值。
 * 均值对 p 单调递减 → 二分必收敛；不引入新数据，只是把既有均值口径展开成逐抽 hazard。
 */
export function solveBaseRate(meanPulls: number, hardPity: number): number {
  if (meanPulls >= hardPity) return 0 // 均值不可能超过硬保底
  let lo = 1e-6
  let hi = 1
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2
    if (truncatedGeomMean(mid, hardPity) > meanPulls) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/** 池的逐抽基础出率（由均值反解，带缓存——纯函数、同参同值） */
const rateCache = new Map<string, number>()
export function baseRateOf(pool: PoolSpec): number {
  const meanPullsPerS = pool.meanPullsPerLimited / goldPerLimited(pool)
  const key = pool.hardPity + ':' + meanPullsPerS
  let r = rateCache.get(key)
  if (r == null) {
    r = solveBaseRate(meanPullsPerS, pool.hardPity)
    rateCache.set(key, r)
  }
  return r
}

/** 从已垫 pity 抽出发，期望还要多少抽才出下一个 S（不问是否 UP） */
export function expectedPullsToS(pool: PoolSpec, pity: number): number {
  const remain = Math.max(0, pool.hardPity - Math.max(0, Math.floor(pity)))
  return truncatedGeomMean(baseRateOf(pool), remain)
}

/**
 * 从状态 (pity, 大保底) 出发，期望还要多少抽拿到**限定 UP**。
 * 非大保底时：这次出 S 有 (1-upRate) 概率歪 → 歪掉后从 pity=0 起、且下次必 UP。
 */
export function expectedPullsToLimited(pool: PoolSpec, pity = 0, guaranteed = false): number {
  const first = expectedPullsToS(pool, pity)
  if (guaranteed) return first
  return first + (1 - pool.upRate) * expectedPullsToS(pool, 0)
}

/** 同上，换算成菲林（规划器的记账单位） */
export function expectedFilmToLimited(pool: PoolSpec, pity = 0, guaranteed = false): number {
  return expectedPullsToLimited(pool, pity, guaranteed) * PULL_FILM
}

/**
 * 保底进度值多少钱：相对「零进度非大保底」满价的折扣率（0 = 满价，0.8 = 只要两成价）。
 * 这是规划器该看见、而当前常量价看不见的那部分信息。
 */
export function pityDiscount(pool: PoolSpec, pity = 0, guaranteed = false): number {
  const full = expectedPullsToLimited(pool, 0, false)
  if (full <= 0) return 0
  return 1 - expectedPullsToLimited(pool, pity, guaranteed) / full
}
