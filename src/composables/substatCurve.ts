/**
 * 副词条收益曲线（CC-…，2026-10-21）：横轴 = 该词条的**第 x 步**，纵轴 = 这一步的**边际提升**。
 *
 * **两种纵轴口径（用户 2026-10-24 裁决，缺一不可）**：
 * - `base`（**相比于基础**）：`(总伤(x) − 总伤(x−1)) / 自动配比后总伤`。分母固定 ⇒ 加算词条（暴伤/大攻击/小攻击）
 *   是**一条直线**——这不是模型漏了递减，而是「一步的绝对增量」本来就是常数。
 * - `step`（**相比于上一步**）：`(总伤(x) − 总伤(x−1)) / 总伤(x−1)`。分母随步数长大 ⇒ 曲线单调下弯，
 *   **这才是玩家直观意义上的边际效用递减**（实测暴伤 0.923% → 0.785%/步，20 步）。
 * 两把尺子各回答一件事：`base` 是**跨词条可比**的（同分母，配比门槛只在它上面成立），`step` 是**同一条曲线内**
 * 的递减读数。拿 `step` 跨词条比较是错的（每条线分母不同）——「下一步堆谁」必须用 `base`（`nextStepMarginals`）。
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
 * - **轴态标注**（2026-10-21，用户报「锯齿 + 负数」）：词条**可能**改变失衡次数——实测琉音
 *   `critRate=0` ⇒ stun=6、`critRate=20` ⇒ stun=7（核心被动「初始暴击率超 50% 每 1% 转 2 冲击力」）。
 *   一次失衡跳变 = 整窗易伤差 ⇒ 曲线上出现 2% 尖刺、累计到上限变负（那是**轴态变了**，不是词条收益为负）。
 *   故每个点同时记录 `stunCount` / `coverage`，与基线不同即标 `axisChanged`：
 *   图上是空心警示圈 + tooltip，累计只累**轴态不变的前缀**（`axisStableSteps`）。
 *   其余词条实测**不影响**轴（`critDmg`/`atkPct`/`penFlat` 改到 0 或上限，stun 与 coverage 逐位相同）。
 * - **为什么逐点硬算、不做解析近似**（用户 2026-10-21 提议「固定轴 + 边际×占比」）：解析式在乘法乘区上成立
 *   （`critDmg` 一步：真实 0.2683M / 解析 0.2683M，逐位相同），但 **`penFlat` 差 46 倍**——
 *   穿透值在防御区 `794/(effDef+794)` 里是非线性项；`critRate`/转模角色也各有 3–4% 偏差。
 *   更关键：**边际不是词条的固有属性**——它取决于其余词条的取值（`critRate × critDmg` 互补）。
 *   实测「按已采边际做贪心」的终点比真实配比**差 7.5%**（94.08M vs 101.745M）⇒ 任何「用占比/贪心反推」的
 *   图都会与配比自相矛盾。所以这张图 = 在**配比现场**逐点真实求值，只标注轴态、不猜。
 * - 成本：每点一次完整求值（实测 50–75ms/次，2026-10-21）；有用词条 ~20 点 + 恒 0 词条 2 点止损
 *   ≈ 90 次求值 ≈ 5–8s，故放在显式「计算曲线」按钮后面（与 `impactSampling` 同款），不在进入页面时自动跑。
 *
 * @fact ui:副词条收益曲线/两种纵轴 口径: 同一批采样点画两张图——「相比于基础」= Δ总伤/现场总伤（分母固定 ⇒ 加算词条是直线、跨词条可比，配比门槛与「下一步该堆谁」只认它）；「相比于上一步」= Δ总伤/上一步总伤（分母随步数长大 ⇒ 边际效用递减的读数，**不可**跨词条比高低）。现场可由玩家手填（allocation），基线总伤 = 现场总伤 | 据 用户@2026-10-24「词条的显示应该显示当前x对于x-1的进步幅度…分两个图，按照基础的来标题就写相比于基础…体现边际效用递减…玩家可以看到当我在多少词条a还有多少词条b的情况下，该继续堆叠什么词条」·实测@2026-10-24（暴伤 20 步：base 恒 0.785%/步；step 0.923→0.785%/步） | 验 src/composables/__tests__/substatCurve.test.ts | 锚 src/composables/substatCurve.ts#pointGain + src/composables/substatCurve.ts#nextStepMarginals | 信 确认
 * ⟳复核: 新词条（转模/新乘区）接入后，「相比于基础」是否仍对加算词条成直线、「相比于上一步」是否仍单调下弯（非单调 = 该词条有阈值） | 到期 2026-12-31
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
import { computePanelPhases } from '@/composables/resourceCalc/panelPhases'
import { useCatalogStore } from '@/stores/catalog'

/** 相对基线视为「无提升」的阈值（%）。低于它连续两步即提前止损。 */
export const ZERO_GAIN_PCT = 1e-6
/** 触发止损所需的连续零收益步数 */
export const ZERO_GAIN_RUN = 2
/** 每采样多少点让出一次主线程（一次求值 50–75ms，逐点让出纯属浪费） */
const YIELD_EVERY = 4

/** 一个采样点的轴态（失衡次数 + 易伤覆盖率）：两者一起才足以识别「轴变了」 */
export interface SubstatAxisSignature {
  stunCount: number
  coverage: number
}

/** 一个采样点：x = 该词条的第 x 步 */
export interface SubstatCurvePoint {
  x: number
  /**
   * **相比于基础**：这一步相对基线（自动配比后总伤）的提升，%。分母固定 ⇒ 加算词条成直线；
   * 它是**跨词条可比**的（同分母），配比门槛与「下一步该堆谁」都只认它。
   */
  gainPct: number
  /**
   * **相比于上一步**：`(总伤(x) − 总伤(x−1)) / 总伤(x−1)`，%。分母随步数长大 ⇒ 单调下弯
   * （用户 2026-10-24：「按照上一个的来就能体现边际效用递减」）。
   * ⚠ 每条线的分母不同 ⇒ **不能拿它跨词条比较**，只用于看同一词条「堆到多少开始不值」。
   */
  gainStepPct: number
  /** 这一步之后的队伍总伤 */
  damage: number
  /** 该点的轴态（失衡次数 / 易伤覆盖率） */
  axis: SubstatAxisSignature
  /**
   * 该点相对**上一点**轴态发生跳变（失衡次数变了，或易伤覆盖率一步跳 >1 个百分点）。
   *
   * 为什么按「相邻点」而不是「相对基线」判定（2026-10-21 第一版就踩了）：轴**连续**随词条漂移
   * （实测琉音 critRate 每步都抬冲击力 ⇒ 覆盖率 24.1%→29.3% 平滑上升）是**真实收益**，必须计入；
   * 而**离散跳变**（失衡 6→7 次）会让这一步一次吞下整窗易伤，那不是「这一步值多少」。
   * 按基线判定会把整条曲线全标红（实测 19/19 点全命中 = 无信息）。
   */
  axisJump: boolean
}

/** 一条曲线 = 一个词条 */
export interface SubstatCurveSeries {
  stat: string
  points: SubstatCurvePoint[]
  /** 自动配比给该词条的步数（0 = 该词条被舍弃） */
  allocatedSteps: number
  /** 该词条 0 步时的队伍总伤（首点的 Δ 基准；也是「把它全撤掉」的现场） */
  originDamage: number
  /**
   * **到配比步数为止**的累计提升（相对基线 %）。未入选词条（步数 0）= 0。
   * ⚠ 不是「到上限为止」：那张表的「配比步数 / 首步边际 / 累计提升」三列必须说同一件事
   * （2026-10-21 用户抓到「爆伤 18 步却累计 2.03%」——旧口径按上限 20 步算，与相邻两列对不上）。
   */
  cumulativePct: number
  /** **到上限为止**的累计提升（相对基线 %）。只作「再往上堆还值不值」的参考，不与步数列并读 */
  cumulativeToCapPct: number
  /**
   * 轴态**不变**的连续前缀步数（0 = 第 1 步就变轴了）。
   * 「到该步累计」只累这一段：轴变了之后的点混进整窗易伤差，加进去就不再是词条收益。
   */
  axisStableSteps: number
  /** 该曲线是否出现过轴态变化（图上给警示 / 表格给说明用） */
  axisChangedAt: number[]
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
  /** 基线（自动配比现场）的轴态；曲线点的 `axisChanged` 就是与它比较 */
  baseAxis: SubstatAxisSignature
  /** 被取消 ⇒ false（series 只含已采部分） */
  complete: boolean
  /** 采不出来的原因；空串 = 正常 */
  reason: string
}

export interface SubstatCurveOptions extends BatchTaskOptions {
  slot: number
  /** 只采这些词条（缺省 = 模板词条优先 + 池内其余） */
  stats?: readonly string[]
  /**
   * **采样现场**（缺省 = 自动配比 computeSubstatAllocationForSlot 的输出）。
   *
   * 用户 2026-10-24：「玩家可以看到当我在多少词条 a 还有多少词条 b 的情况下，该继续堆叠什么词条」
   * ⇒ 现场可以由玩家给（页面上每个词条一个步数输入）。给了就不再跑优化器：
   * 基线总伤 = 这份现场的总伤，所有百分比的分母、门槛、nextStepMarginals 都以它为起点。
   */
  allocation?: Record<string, number>
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
    baseAxis: { stunCount: -1, coverage: 0 },
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
    const readAxis = (): SubstatAxisSignature => ({
      stunCount: calc.stunPoolResult.value?.stunCount ?? -1,
      coverage: calc.stunCoverage.value,
    })
    /**
     * 轴态「跳变」判定：失衡次数变（离散窗口数）+ 覆盖率一步 >1 个百分点（整窗易伤一次性进出）。
     * 覆盖率的小幅连续漂移是真实的（词条抬冲击力 ⇒ 攒得更快），不算跳变。
     */
    const COVERAGE_JUMP = 0.01
    const axisJumped = (prevAxis: SubstatAxisSignature, next: SubstatAxisSignature) =>
      prevAxis.stunCount !== next.stunCount || Math.abs(next.coverage - prevAxis.coverage) > COVERAGE_JUMP
    // 现场：玩家给了就用玩家的（步数输入框），否则跑自动配比。基线 = 这份现场的总伤。
    const allocation = opts.allocation
      ? { ...opts.allocation }
      : computeSubstatAllocationForSlot(
        slot,
        config,
        catalog,
        { readDamage: () => calc.teamTotalDamage.value },
        calc.effectiveWEngineCoverages.value,
      )
    if (!allocation) return emptyResult(slot, '优化器没有给出分配（角色 / 音擎数据不全）')
    disc.subStatAllocation = { ...allocation }
    const baseDamage = calc.teamTotalDamage.value
    const baseAxis = readAxis()
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
      const originAxis = readAxis()
      const axisChangedAt: number[] = []
      let zeroRun = 0
      let stopped = false
      for (let x = 1; x <= maxSteps; x++) {
        if (isBatchAborted(opts.control)) {
          complete = false
          break
        }
        // 暴击词条的百暴截断（用户口径 2026-10-24：「别让人觉得百暴后还能堆高收益暴击」）：
        // 该步**之前**的局内暴击已 ≥100 ⇒ 堆词条视角的边际记 0（不再跑引擎）。
        // 乘区里的溢出→爆伤转化是「**换**词条」的收益（模拟配平终态），不属于「**堆**暴击」——
        // 若不截断，转化补偿会让暴击曲线在百暴后仍显示 ≈ 爆伤/步的假收益。
        if (stat === 'critRate') {
          const inCombatCrit = computePanelPhases(slot, config, catalog)?.inCombat.critRate ?? 0
          if (inCombatCrit >= 100) {
            points.push({ x, gainPct: 0, gainStepPct: 0, damage: prev, axis: readAxis(), axisJump: false })
            zeroRun += 1
            done++
            report(done / planned, `采样 ${done}/${planned}（${stat} ×${x}，百暴后截断）`)
            if (zeroRun >= ZERO_GAIN_RUN) {
              stopped = true
              break
            }
            continue
          }
        }
        disc.subStatAllocation = { ...allocation, [stat]: x }
        const damage = calc.teamTotalDamage.value
        const axis = readAxis()
        evals++
        const gainPct = ((damage - prev) / baseDamage) * 100
        // 「相比于上一步」：分母 = 上一步的总伤（不是基线）。prev 在 x=1 时就是 0 步的现场。
        const gainStepPct = prev > 0 ? ((damage - prev) / prev) * 100 : 0
        const prevAxis = points.length ? points[points.length - 1]!.axis : originAxis
        const axisJump = axisJumped(prevAxis, axis)
        if (axisJump) axisChangedAt.push(x)
        points.push({ x, gainPct, gainStepPct, damage, axis, axisJump })
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
      const steps = allocation[stat] ?? 0
      /** 只累「无跳变」的步（连续漂移照常计入——那是真实收益） */
      const gainAt = (n: number) => points
        .slice(0, Math.max(0, Math.min(n, points.length)))
        .reduce((a, p) => a + (p.axisJump ? 0 : p.gainPct), 0)
      let stable = 0
      for (const p of points) {
        if (p.axisJump) break
        stable++
      }
      series.push({
        stat,
        points,
        allocatedSteps: steps,
        originDamage: origin,
        cumulativePct: gainAt(steps),
        cumulativeToCapPct: ((prev - origin) / baseDamage) * 100,
        axisStableSteps: stable,
        axisChangedAt,
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
      baseAxis,
      evals,
      complete,
      reason: '',
    }
  } finally {
    disc.subStatAllocation = original
  }
}

/** 纵轴口径（用户 2026-10-24 裁决：两种都要，各自成图） */
export type SubstatCurveReading = 'base' | 'step'

/** 取某点在某口径下的纵坐标（%） */
export function pointGain(p: SubstatCurvePoint, reading: SubstatCurveReading): number {
  return reading === 'step' ? p.gainStepPct : p.gainPct
}

export interface CurveAxisRange {
  xMax: number
  yMin: number
  yMax: number
}

/**
 * 坐标轴范围：**只按传入的曲线算**（页面/组件必须传「可见」子集，否则隐藏曲线仍撑着纵轴——
 * `seriesFilter` 口径 ②）。yMax 留 8% 余量，全 0 时给 1 防除零。
 * `reading` = 纵轴口径：两张图各自算轴（同一批曲线、不同尺子 ⇒ 轴范围必须分开）。
 */
export function curveAxisRange(series: readonly SubstatCurveSeries[], reading: SubstatCurveReading = 'base'): CurveAxisRange {
  let xMax = 1
  let yMin = 0
  let yMax = 0
  for (const s of series) {
    for (const p of s.points) {
      const y = pointGain(p, reading)
      if (p.x > xMax) xMax = p.x
      if (y > yMax) yMax = y
      if (y < yMin) yMin = y
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

/**
 * 轴态变化的一句话说明（空串 = 该曲线全程轴态不变）。
 * 用户 2026-10-21 报「锯齿 / 负数」时，答案就在这里：那几步的词条**改了失衡次数**，不是收益为负。
 */
export function axisChangeNote(series: SubstatCurveSeries): string {
  if (!series.axisChangedAt.length) return ''
  const steps = series.axisChangedAt
  const first = steps[0]!
  const at = series.points.find(p => p.x === first)!
  const before = series.points.find(p => p.x === first - 1)?.axis ?? at.axis
  const parts: string[] = []
  if (at.axis.stunCount !== before.stunCount) parts.push(`失衡 ${before.stunCount} → ${at.axis.stunCount} 次`)
  if (Math.abs(at.axis.coverage - before.coverage) > 0.01) {
    parts.push(`易伤覆盖 ${(before.coverage * 100).toFixed(1)}% → ${(at.axis.coverage * 100).toFixed(1)}%`)
  }
  const more = steps.length > 1 ? `（共 ${steps.length} 步跳变：第 ${steps.join('、')} 步）` : ''
  return `第 ${first} 步跳变（${parts.join('，')}）${more}`
}

/**
 * 现场**下一步**各词条的边际（用户 2026-10-24：「玩家可以看到当我在多少词条 a 还有多少词条 b 的情况下，
 * 该继续堆叠什么词条」）——这张表的每行 = 「如果不是堆这一个词条，下一步值多少」。
 *
 * 口径：`points[x = 现场步数 + 1]`，分母仍是**现场总伤**（与 `gainPct` 同尺）⇒ **跨词条可比**，可直接排序。
 * 用 `gainStepPct` 排序是错的（每条线分母不同，堆得多的天然显得便宜）。
 * 现场步数已到上限 / 该词条被止损砍掉 / 没有采样点 ⇒ `nextGainPct = null`（不是 0）。
 */
export interface SubstatNextStep {
  stat: string
  /** 现场给该词条的步数 */
  steps: number
  /** 再 +1 步的边际（%，分母 = 现场总伤）；null = 到上限 / 未采样 */
  nextGainPct: number | null
  /** 是否已经到单词条上限 */
  atCap: boolean
}

export function nextStepMarginals(result: SubstatCurveResult): SubstatNextStep[] {
  return result.series.map(s => {
    const steps = s.allocatedSteps
    const atCap = steps >= result.statCap
    const next = atCap ? undefined : s.points.find(p => p.x === steps + 1)
    return { stat: s.stat, steps, nextGainPct: next ? next.gainPct : null, atCap }
  })
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
