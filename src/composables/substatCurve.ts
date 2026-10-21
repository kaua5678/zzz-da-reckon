/**
 * 副词条收益曲线（CC-…，2026-10-21）：横轴 = 该词条的**第 x 步**，纵轴 = 这一步相对当前队伍总伤的**边际提升**。
 *
 * 为什么需要它：原有「副词条优化器」（`composables/substatOptimizer`）只吐一个分配结果
 * （如 `{anomalyProficiency:19, atkPct:13}`），用户看不出**为什么**是这个分法、也看不出某个词条
 * 在哪一步之前值得投、之后不值得。本模块把「每一步值多少」采出来，让自动配比的决定可读：
 * 入选词条的末步边际应当**大致相等**（边际均衡），被舍弃词条的首步边际应当**低于**那个门槛。
 *
 * ## 口径（改之前先读）
 *
 * - **基线 = 自动配比后的分配**（`computeSubstatAllocationForSlot` 的输出），百分比的分母 = 该分配下的队伍总伤。
 *   曲线不动别的词条：采 `{…allocation, [stat]: x}`，于是「第 x 步」= 在这个已经配好的现场上，
 *   再往这一个词条多投 x 步（其余词条留在配比值）。
 * - **不是预算分配图**：x 可以一直走到单词条上限（`statCap`），超出的部分是「越界」（现实中要从此处
 *   别的词条里挪出来）。哪些步真被采用由 `allocatedSteps` 给（圆点位置），不靠曲线自己猜。
 * - **触零止损**：某词条连续 2 步提升 ≈ 0（`ZERO_GAIN_PCT`）就停（省掉无用求值，`stopped = true`）。
 *   止损只砍「恒 0 的尾巴」，不改变已采出的点——判据见 `substatCurve.test.ts`（有收益的词条不被截断）。
 * - **筛选传导**：`curveAxisRange` 只按传入的曲线算上限（隐藏曲线必须退出纵轴），由页面/组件把
 *   「可见」子集传进来——这是 `seriesFilter` 的口径 ②（隐藏必须传导到派生量）。
 * - 成本：每点一次完整求值（实测 50–75ms/次，2026-10-21）；10 个词条 × 上限 20 + 止损 ≈ 6–10s，
 *   故放在显式「计算曲线」按钮后面（与 `impactSampling` 同款），不在进入页面时自动跑。
 *
 * 运行位置：**必须在独立场景上跑**（`withAnalysisScenario`）——本模块只读 `AnalysisContext`
 * （`scenario.config` 上改写分配、读 `scenario.calc.teamTotalDamage`），不碰 UI store，
 * 结束时把场景里的分配还原（`finally`）。判据 `composables/__tests__/analysisScenario.test.ts` 的
 * 源码锁（`MIGRATED_ANALYZERS`）会断言本文件不直接取 UI config store（正则按**原文**匹配，注释里也不能出现那个调用式）。
 */
import type { Agent } from '@/types/catalog'
import type { AnalysisContext } from '@/composables/analysisScenario'
import { batchReporter, isBatchAborted, type BatchTaskOptions } from '@/composables/batchTask'
import { computeSubstatAllocationForSlot } from '@/composables/substatOptimizer'
import { getTemplate, resolveSubstatBudget } from '@/core/substatOptimizer'
import { useCatalogStore } from '@/stores/catalog'

/** 相对基线视为「无提升」的阈值（%）。低于它连续两步即提前止损。 */
export const ZERO_GAIN_PCT = 1e-6
/** 触发止损所需的连续零收益步数 */
export const ZERO_GAIN_RUN = 2
/** 每采样多少点让出一次主线程（一次求值 50–75ms，逐点让出纯属浪费） */
const YIELD_EVERY = 4

/** 一个采样点：x = 该词条的第 x 步 */
export interface SubstatCurvePoint {
  x: number
  /** 这一步相对基线（自动配比后总伤）的提升，% */
  gainPct: number
  /** 这一步之后的队伍总伤 */
  damage: number
}

/** 一条曲线 = 一个词条 */
export interface SubstatCurveSeries {
  stat: string
  points: SubstatCurvePoint[]
  /** 自动配比给该词条的步数（0 = 该词条被舍弃） */
  allocatedSteps: number
  /** 该词条 0 步时的队伍总伤（首点的 Δ 基准；也是「把它全撤掉」的现场） */
  originDamage: number
  /** 累计提升（末点 − 0 步，相对基线 %） */
  cumulativePct: number
  /** 尾部触零提前止损（省掉了恒 0 的采样） */
  stopped: boolean
}

export interface SubstatCurveResult {
  slot: number
  /** 基线分配 = 自动配比的输出 */
  allocation: Record<string, number>
  /** 基线队伍总伤（所有百分比的分子分母基准） */
  baseDamage: number
  /** 单词条上限（x 轴默认上限） */
  statCap: number
  /** 模板总步数（只作说明：曲线不是按这个预算切的，见文件头口径） */
  totalSteps: number
  /** 角色词条模板（决定默认可见集） */
  templateStats: string[]
  series: SubstatCurveSeries[]
  /** 实际求值次数（成本可核对，测试据此断言止损真的省了） */
  evals: number
  /** 被取消 ⇒ false（series 只含已采部分） */
  complete: boolean
  /** 采不出来的原因；空串 = 正常 */
  reason: string
}

export interface SubstatCurveOptions extends BatchTaskOptions {
  slot: number
  /** 只采这些词条（缺省 = 模板词条优先 + 池内其余） */
  stats?: readonly string[]
}

const yieldToMacrotask = () => new Promise<void>(resolve => setTimeout(resolve, 0))

function emptyResult(slot: number, reason: string): SubstatCurveResult {
  return {
    slot,
    allocation: {},
    baseDamage: 0,
    statCap: 0,
    totalSteps: 0,
    templateStats: [],
    series: [],
    evals: 0,
    complete: false,
    reason,
  }
}

/**
 * 候选词条顺序：模板词条在前（它们是自动配比真正会动的范围），其余池内词条在后。
 * 顺序只影响图例/表格顺序，不影响数值。
 */
export function substatCurveCandidates(agent: Agent, pool: readonly string[]): string[] {
  const ordered: string[] = []
  for (const stat of getTemplate(agent).stats) if (pool.includes(stat)) ordered.push(stat)
  for (const stat of pool) if (!ordered.includes(stat)) ordered.push(stat)
  return ordered
}

/**
 * 采样全部候选词条的边际曲线。被取消时在下一个点之前停，返回已采部分（`complete = false`）。
 */
export async function sampleSubstatCurves(
  scenario: AnalysisContext,
  opts: SubstatCurveOptions,
): Promise<SubstatCurveResult> {
  const { config, calc } = scenario
  const catalog = useCatalogStore()
  const slot = opts.slot
  const char = config.team[slot]
  if (!char?.agentId) return emptyResult(slot, '该槽位没有角色')
  const agent = catalog.getAgent(char.agentId)
  if (!agent) return emptyResult(slot, '目录里查不到该角色')

  const template = getTemplate(agent)
  const budget = resolveSubstatBudget(template, config.getMechanicSetting)
  // x 上限 = 预算的单词条上限：再大也没有意义（现实中单词条不允许超上限），
  // 且「越界多少步值得挪」是另一个问题，不在这张图的范围内。
  const maxSteps = Math.max(1, budget.statCap)
  const pool = (catalog.statRules?.driveDisc.subStatPool ?? template.stats).filter(stat => stat.length > 0)
  const stats = opts.stats?.length ? [...opts.stats] : substatCurveCandidates(agent, pool)
  const report = batchReporter(opts)
  const disc = char.driveDisc
  const original = { ...disc.subStatAllocation }
  const planned = stats.length * maxSteps
  let done = 0
  let evals = 0
  let complete = true
  try {
    const allocation = computeSubstatAllocationForSlot(
      slot,
      config,
      catalog,
      { readDamage: () => calc.teamTotalDamage.value },
      calc.effectiveWEngineCoverages.value,
    )
    if (!allocation) return emptyResult(slot, '优化器没有给出分配（角色 / 音擎数据不全）')
    disc.subStatAllocation = { ...allocation }
    const baseDamage = calc.teamTotalDamage.value
    evals++
    if (!(baseDamage > 0)) {
      return { ...emptyResult(slot, '当前配装的队伍总伤为 0：收益百分比没有分母'), allocation, baseDamage }
    }
    const series: SubstatCurveSeries[] = []
    for (const stat of stats) {
      const points: SubstatCurvePoint[] = []
      disc.subStatAllocation = { ...allocation, [stat]: 0 }
      let prev = calc.teamTotalDamage.value
      evals++
      const origin = prev
      let zeroRun = 0
      let stopped = false
      for (let x = 1; x <= maxSteps; x++) {
        if (isBatchAborted(opts.control)) {
          complete = false
          break
        }
        disc.subStatAllocation = { ...allocation, [stat]: x }
        const damage = calc.teamTotalDamage.value
        evals++
        const gainPct = ((damage - prev) / baseDamage) * 100
        points.push({ x, gainPct, damage })
        prev = damage
        zeroRun = Math.abs(gainPct) <= ZERO_GAIN_PCT ? zeroRun + 1 : 0
        done++
        report(done / planned, `采样 ${done}/${planned}（${stat} ×${x}）`)
        if (zeroRun >= ZERO_GAIN_RUN) {
          stopped = true
          break
        }
        if (done % YIELD_EVERY === 0) await yieldToMacrotask()
      }
      series.push({
        stat,
        points,
        allocatedSteps: allocation[stat] ?? 0,
        originDamage: origin,
        cumulativePct: ((prev - origin) / baseDamage) * 100,
        stopped,
      })
      if (!complete) break
    }
    return {
      slot,
      allocation,
      baseDamage,
      statCap: budget.statCap,
      totalSteps: budget.totalSteps,
      templateStats: [...template.stats],
      series,
      evals,
      complete,
      reason: '',
    }
  } finally {
    disc.subStatAllocation = original
  }
}

export interface CurveAxisRange {
  xMax: number
  yMin: number
  yMax: number
}

/**
 * 坐标轴范围：**只按传入的曲线算**（页面/组件必须传「可见」子集，否则隐藏曲线仍撑着纵轴——
 * `seriesFilter` 口径 ②）。yMax 留 8% 余量，全 0 时给 1 防除零。
 */
export function curveAxisRange(series: readonly SubstatCurveSeries[]): CurveAxisRange {
  let xMax = 1
  let yMin = 0
  let yMax = 0
  for (const s of series) {
    for (const p of s.points) {
      if (p.x > xMax) xMax = p.x
      if (p.gainPct > yMax) yMax = p.gainPct
      if (p.gainPct < yMin) yMin = p.gainPct
    }
  }
  return { xMax, yMin, yMax: yMax > 0 ? yMax * 1.08 : 1 }
}

/**
 * 自动配比实际采用的「门槛」= 各入选词条**末步边际的最小值**（`null` = 没有任何词条入选）。
 * 它是这张图的读法核心：曲线在门槛以下 = 这一步不值（配比没选它），见 `substatCurveVerdict`。
 */
export function allocationCutoff(result: SubstatCurveResult): number | null {
  const tails: number[] = []
  for (const s of result.series) {
    if (s.allocatedSteps <= 0) continue
    const at = s.points.find(p => p.x === s.allocatedSteps) ?? s.points[s.points.length - 1]
    if (at) tails.push(at.gainPct)
  }
  return tails.length ? Math.min(...tails) : null
}

/** 图中某条曲线在「自动配比」处的落点（圆点）；空 = 没入选或点被止损砍掉 */
export function allocationMarker(series: SubstatCurveSeries): SubstatCurvePoint | null {
  if (series.allocatedSteps <= 0) return null
  return series.points.find(p => p.x === series.allocatedSteps)
    ?? null
}

/** 某词条相对「自动配比门槛」的判定（表格「判定」列的唯一来源） */
export type SubstatVerdict = 'chosen' | 'dropped' | 'kept-out' | 'flat'

/**
 * - `chosen`：自动配比给了步数；
 * - `dropped`：未入选且首步边际**低于门槛** ⇒ 配比按边际正确舍弃；
 * - `kept-out`：未入选但首步边际**不低于门槛** ⇒ 边际够却没被采纳（值得看一眼的异常信号）；
 * - `flat`：整条曲线无收益（对该配装零贡献，如生存词条）。
 */
export function substatCurveVerdict(series: SubstatCurveSeries, cutoff: number | null): SubstatVerdict {
  if (series.allocatedSteps > 0) return 'chosen'
  const first = series.points[0]
  if (!first || Math.abs(first.gainPct) <= ZERO_GAIN_PCT) return 'flat'
  if (cutoff === null) return 'kept-out'
  return first.gainPct < cutoff - ZERO_GAIN_PCT ? 'dropped' : 'kept-out'
}

/** 默认额外展开的「非模板但有收益」词条条数（保证默认就有多条曲线可比，不至于只剩 1–2 条） */
export const DEFAULT_EXTRA_SERIES = 2

/**
 * 默认可见集 = 模板词条 ∪ 已入选词条 ∪ 首步边际最高的 N 条非模板词条（N = `DEFAULT_EXTRA_SERIES`，零收益除外）。
 *
 * 用户口径 2026-10-21：「想象异常角色的图中有多个曲线，我选择显示了大攻击、精通、小穿透，
 * 看到在不同区间的收益高低关系」——默认要有**多条**可比（只给模板两条看不出高低关系），
 * 但也不能全开（10 条线互相压住，且生存词条是恒 0 的噪声）。于是取「有收益的前 N 条」，
 * 其余由图例点开即可（图例是全量的，`useSeriesFilter` 的 hidden 语义保证新曲线自动可见）。
 */
export function defaultVisibleStats(result: SubstatCurveResult): string[] {
  const visible = new Set<string>(result.templateStats)
  for (const s of result.series) if (s.allocatedSteps > 0) visible.add(s.stat)
  const extras = result.series
    .filter(s => !visible.has(s.stat))
    .map(s => ({ stat: s.stat, first: s.points[0]?.gainPct ?? 0 }))
    .filter(s => s.first > ZERO_GAIN_PCT)
    .sort((a, b) => b.first - a.first)
    .slice(0, DEFAULT_EXTRA_SERIES)
  for (const s of extras) visible.add(s.stat)
  return result.series.filter(s => visible.has(s.stat)).map(s => s.stat)
}
