/**
 * R14 / T139：**无轴模式的「失衡易伤集中度」估算**（conc_est）。
 *
 * ## 用户口径（逐字，2026-10-17）
 *
 * > 「**不用自动生成轴**，我只是想让**无轴的易伤更真实，接近有轴**。」
 * > 「**最好可以调整**，因为这种很难确定。」
 *
 * ## 缺口（已量化，见 docs/axis-vuln-uplift-reference.md §十二）
 *
 * 当前无轴模型 stunCoverage = min(1, 失衡次数×单窗/有效时长) ⇒ **全池每招同比例**吃易伤
 * （实测「直伤行实打覆盖」与 stunCoverage 逐位相等，差 ≤0.005）。而真实玩家（即使不捏轴）
 * 会把高倍率招留到失衡窗 ⇒ 实际集中度 ≈ **1.8×**（手动轴中位）⇒ 无轴模型把 ~1.8× 当成了 1.0×。
 *
 *     无轴有效覆盖率 = 时间覆盖率 × conc_est(N) × k
 *
 * ## ★ 落地形态：**闭式估算式**（不是表、不是离线缓存、不跑第二次引擎求值）
 *
 * §10.4 的达标路线 (b)「生成 P1 均分轴 → 引擎求值 → 读 inFracDirect/timeCov」逐格中位误差 8.1%，
 * 但它每格多一次**完整引擎求值**。本仓实测（.zc/perf/T139cost.perf.ts）：**45.6ms/次**
 * （轴模式，8 队中位）⇒ 页面每次交互多 45ms，且它要跟 calcOutput 的不动点循环耦合（易死循环）。
 *
 * 三条候选落地形态的实测对照（980 格 = 35 有轴队 × 4 Boss 期 × lock 1/2/3/4/5/6/8，
 * 靶子 = 手动轴 concPure，见 .zc/perf/T139conc.perf.ts + .zc/perf/T139rows.json）：
 *
 * | 形态 | 逐格中位误差 | p75 | <10% 格数 | 页面成本 |
 * |---|---:|---:|---:|---|
 * | 静态表 N→conc（7 档） | 13.6% | 23.1% | 364/980 | 0 |
 * | 纯算术复现 P1 轴（无引擎） | **38~44%** | 56% | 80/980 | 0 |
 * | **本模块：闭式估算式（tc + 计划侧 HHI + 主槽份额）** | **9.4%** | 17.1% | 515/980 | ~0 |
 * | 路线 (b) 现场跑引擎 | 8.1% | 16.0% | 578/980 | 45.6ms/格 |
 *
 * ⇒ **选本模块**：误差与路线 (b) 同档（9.4% vs 8.1%，判据是「逐档中位 ≤10%」），成本 ≈ 0。
 *
 * ### 为什么纯算术复现 P1 轴不行（诚实归因，别再重做）
 *
 * 试过：把探针的 P1 调度（候选池 + max(1, floor(units/N)) 每窗次数上限 + 逐槽位时间门控）
 * 原样用 TS 重写、伤害从无轴行 totalDamage/count 反推 ⇒ **逐格中位 38~44%**，
 * 且与引擎 P1 的 inFracDirect 差 **1.9~9×**。根因不是调度写错，而是 P1 的轴内伤害
 * **不由「调度了哪些招」决定**：damagePoolDirect 的 axisSplitFor 按 inAxisUnits/totalUnits
 * 拆行（同一 moveId 的轴内单位可以远超调度次数，且 attachedEvents / directRowAxisSplit /
 * stunOverrideForMove 三个模块钩子会改写归属）。
 * ⇒ 「不跑引擎就要复现引擎」这条路**不成立**，别再用「更精确的调度重写」去救。
 *
 * ### 为什么不是静态表
 *
 * N 表（7 档）逐格中位 **13.6%**，且**逐档**只有 1/7 档 <10%（N=1 时 18.4%、N=2 时 17.8%）。
 * 表丢掉了格内信息（同样 N=4，池子集中的队 conc 高、均摊的队 conc 低）。
 *
 * ## 估算式（conc_est）
 *
 *     conc_est = exp(a + b·tc + c·HHI_plan + d·mainShare)
 *
 * - tc = 时间覆盖率（引擎既有 stunCoverage，含决算截断损失秒）；
 * - HHI_plan = **计划侧**伤害集中度（Herfindahl 指数，Σ(份额²)）——每个执行行/连段块的
 *   damageMultiplier × count × 该槽每点倍率的伤害 归一后平方和；**只读执行计划**，
 *   不读伤害池 ⇒ 无循环依赖（伤害池依赖覆盖率，覆盖率若依赖伤害池就成环）；
 * - mainShare = 主 C 槽（总倍率最高的槽）在全队的倍率份额。
 *
 * **N 依赖不是显式项**，而是**通过 tc 与 HHI_plan 进入**：N ↑ ⇒ tc ↑ 且窗内可容纳的
 * 招式种类 ↑ ⇒ HHI ↓ ⇒ conc ↓。实测逐档：N=1 **15.9%**、N=4 **8.0%**、N=6 **6.4%**、
 * N=8 **11.6%**（N=1 与 N=8 的估算值本身差 **2.6 倍**，见单测的反空洞断言）。
 *
 * ⚠ **这是估算，不是物理量**：它拟合的是「典型玩家」的行为，必然有反例（本仓坑 47）。
 * 用户可调系数 k（stunVuln.noAxisConcK）就是为此存在——觉得偏保守/偏激进自己调，
 * 或直接关掉开关回旧口径。
 *
 * ## 硬约束（R14 段 5 条，实现位置）
 *
 * 1. **不污染轴模式**：本模块只被 damagePool 的**非轴分支**调用（isAxis === false）；
 *    轴模式的覆盖率仍是 1/0 两档（真实按轴内位置），不乘 conc_est。
 * 2. **必须可关 + 来源可见**：开关 stunVuln.noAxisConcEstimate（0 = 关，缺省 = 开）+
 *    系数 stunVuln.noAxisConcK（缺省 1.0）。关掉 ⇒ 覆盖率**逐位等于**旧口径（单测钉住）。
 * 3. **N 依赖**：见上（不是常数）。
 * 4. **判据 = 逐档误差**：见本文件头表（以手动轴为靶子）。
 * 5. 只改易伤覆盖率的标量 ⇒ 时间/物化行零 delta（timeGolden / timeFillRatchet 预期零 delta）。
 */
import type { DamagePoolRow } from './resourceCalc/helpers'

/** 机制参数键：无轴易伤估算总开关（0 = 关 = 旧口径；非 0/缺省 = 开） */
export const NO_AXIS_CONC_ENABLED_SETTING = 'stunVuln.noAxisConcEstimate'
/** 机制参数键：用户系数 k（缺省 1.0；conc_est 被乘上它） */
export const NO_AXIS_CONC_K_SETTING = 'stunVuln.noAxisConcK'
/** 用户系数 k 的缺省值（= 数据驱动估算，不额外放大） */
export const DEFAULT_NO_AXIS_CONC_K = 1.0

/**
 * 估算式系数（在 980 格普查上以 ln(conc_A) 为目标做最小二乘，见文件头表）。
 *
 * ⚠ 改这些数 = 改口径：必须重跑 .zc/perf/T139conc.perf.ts 的 dump + 重拟合，
 * 并更新文件头的逐档误差表，否则判据无从复核。
 */
export const CONC_EST_COEFFS = {
  a: 0.782015,
  b: -1.447331,
  c: 1.210691,
  d: 0.351966,
} as const

/** conc_est 的输入：全部来自**无轴**执行计划 + 引擎既有的时间覆盖率 */
export interface ConcEstimateInput {
  /** 时间覆盖率（引擎既有 stunCoverage，含决算截断损失秒） */
  timeCoverage: number
  /** 每个执行行 / 连段块的「伤害权重」= 倍率 × 次数 × 该槽每点倍率的伤害（缺省 1 = 只看倍率） */
  weights: { slot: number; weight: number }[]
}

/** 估算细节（供结果页/单测观察，不进伤害计算） */
export interface ConcEstimateDetail {
  /** 集中度倍数 conc_est（N 依赖；1.0 = 完全均匀） */
  conc: number
  /** 计划侧 Herfindahl 指数（Σ份额²；均摊时 = 1/行数） */
  hhi: number
  /** 主 C 槽（倍率份额最高）的份额 */
  mainShare: number
  /** 有效覆盖率 = min(1, timeCoverage × conc × k)；开关关掉时 = timeCoverage */
  effectiveCoverage: number
  /** 是否走了估算（false = 旧口径，逐位等于 timeCoverage） */
  applied: boolean
}

/**
 * 估算「无轴时高倍率招集中在失衡窗」的集中度倍数 conc_est。
 *
 * **纯函数**：只吃「时间覆盖率 + 执行计划的伤害权重」，不碰 store、不跑引擎、无副作用。
 * 输入退化（无权重 / 覆盖率为 0）⇒ 返回 1.0（= 均匀摊，与旧口径一致）。
 *
 * ⚠ 返回值**不钳到 1**：真实玩家也可能把窗口打空（conc < 1），本仓坑 47 明令
 * 「不许把用户的输入质量写成不变量」——不钉「估算一定 ≥ 均匀摊」。
 */
export function estimateConcentration(input: ConcEstimateInput): { conc: number; hhi: number; mainShare: number } {
  const tc = Number.isFinite(input.timeCoverage) ? Math.max(0, Math.min(1, input.timeCoverage)) : 0
  const items = input.weights.filter(w => Number.isFinite(w.weight) && w.weight > 0)
  const total = items.reduce((s, w) => s + w.weight, 0)
  if (total <= 0) return { conc: 1, hhi: 0, mainShare: 0 }
  // Herfindahl：Σ(份额²)。均摊 n 行 = 1/n，全压一行 = 1
  const hhi = items.reduce((s, w) => s + (w.weight / total) ** 2, 0)
  const bySlot = new Map<number, number>()
  for (const w of items) bySlot.set(w.slot, (bySlot.get(w.slot) ?? 0) + w.weight)
  const mainShare = Math.max(0, ...[...bySlot.values()].map(v => v / total))
  const { a, b, c, d } = CONC_EST_COEFFS
  const raw = Math.exp(a + b * tc + c * hhi + d * mainShare)
  // 有限性护栏：系数是拟合值，极端输入可能给出很大的数，但它随后会被 min(1, ·) 钳住；
  // 这里只拦 NaN/Infinity，**不**替用户判断「合理上限」
  const conc = Number.isFinite(raw) && raw > 0 ? raw : 1
  return { conc, hhi, mainShare }
}

/**
 * 把「无轴覆盖率」按估算式改写：有效覆盖率 = min(1, tc × conc_est × k)。
 *
 * **开关关掉（enabled=false）⇒ 返回的 effectiveCoverage 与传入的 timeCoverage 逐位相同**
 * （这是 R14 硬约束 2 的硬判据，单测逐位钉住）。
 */
export function applyConcEstimate(
  input: ConcEstimateInput,
  opts: { enabled: boolean; k: number },
): ConcEstimateDetail {
  const tc = Number.isFinite(input.timeCoverage) ? input.timeCoverage : 0
  if (!opts.enabled) {
    return { conc: 1, hhi: 0, mainShare: 0, effectiveCoverage: tc, applied: false }
  }
  const est = estimateConcentration(input)
  const k = Number.isFinite(opts.k) ? Math.max(0, opts.k) : DEFAULT_NO_AXIS_CONC_K
  const effectiveCoverage = Math.max(0, Math.min(1, tc * est.conc * k))
  return { conc: est.conc, hhi: est.hhi, mainShare: est.mainShare, effectiveCoverage, applied: true }
}

/**
 * 从**无轴伤害池行**抽「每槽每点倍率的伤害」= 该槽 ΣtotalDamage / Σ(count × multiplier)。
 *
 * 为什么需要它：执行计划的 damageMultiplier 是**裸倍率**，不同槽的每点倍率折成伤害差 10× 以上
 * （面板/增伤/暴击/防御各区不同）。只用裸倍率算 HHI 会把辅助的高倍率大招当成主力
 * （实测：只用裸倍率的 HHI 版本逐格中位 **12.3%**，加权后 **9.4%**）。
 *
 * ⚠ 这里读的是**无轴**伤害池行（每行 stunCoverage 均匀 = timeCoverage），
 * 而 totalDamage 已含该均匀覆盖率下的易伤 ⇒ 各槽被同一比例缩放，
 * **不改变 HHI**（实测：把每行易伤按行 stunMult 反推掉后再算 HHI，|Δ| 中位 5.6e-17、最大 6.6e-3）。
 * ⇒ 用它不会让「覆盖率 → HHI → 覆盖率」成环。
 */
/**
 * R14 / T139：结果页「无轴易伤是估算的」标注（硬约束 2：**必须可关 + 来源可见**）。
 *
 * 判据（三条都满足才显示）：
 * 1. **非轴模式**（`isAxis === false`）——轴模式不乘 `conc_est`，没有「估算」这回事；
 * 2. 开关**开着**（关掉 = 旧口径，不需要标注）；
 * 3. 时间覆盖率 > 0（没有失衡窗 ⇒ 估算无意义）。
 *
 * 文案用**游戏场景措辞**（`docs/axis-vuln-uplift-reference.md` §12.4），不出现「集中度」这种术语。
 * 返回 `null` = 不显示。
 */
export function noAxisConcNoticeOf(opts: {
  isAxis: boolean
  enabled: boolean
  k: number
  timeCoverage: number
  /** 计划侧伤害权重（与引擎同一来源：`damagePool` 的 `damagePerMultiplierBySlot` + 执行计划） */
  weights: { slot: number; weight: number }[]
}): string | null {
  if (opts.isAxis) return null
  if (!opts.enabled) return null
  if (!(opts.timeCoverage > 0)) return null
  const d = applyConcEstimate(
    { timeCoverage: opts.timeCoverage, weights: opts.weights },
    { enabled: true, k: opts.k },
  )
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`
  return `按「你会把大技能留给失衡」估算：时间覆盖 ${pct(opts.timeCoverage)}`
    + ` × 估算 ${d.conc.toFixed(2)}× × 你调的 ${opts.k.toFixed(1)}`
    + ` = ${pct(d.effectiveCoverage)}（关掉这一项就回到「每招均匀」）`
}

export function damagePerMultiplierBySlot(
  rows: (Pick<DamagePoolRow, 'slot' | 'totalDamage' | 'count'> & { multiplier?: number })[],
): Map<number, number> {
  const dmg = new Map<number, number>()
  const mult = new Map<number, number>()
  for (const r of rows) {
    const m = (r.multiplier ?? 0) * Math.max(0, r.count)
    if (!(m > 0)) continue
    dmg.set(r.slot, (dmg.get(r.slot) ?? 0) + Math.max(0, r.totalDamage))
    mult.set(r.slot, (mult.get(r.slot) ?? 0) + m)
  }
  const out = new Map<number, number>()
  for (const [slot, m] of mult) out.set(slot, m > 0 ? (dmg.get(slot) ?? 0) / m : 1)
  return out
}
