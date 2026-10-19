/**
 * R14 / T139：**无轴模式的「失衡易伤集中度」估算**（conc_est）。
 *
 * ## ⛔ 2026-10-19 用户裁决：**非轴不再自动认领易伤**（本模块的 conc_est 已从引擎撤下）
 *
 * > 「轴模式下已经认定了易伤认领啊，非轴模式下想自动认领也不能仅仅靠连携和大招，
 * >  还有其他很多招式啊，所以非轴就只能不做，**让用户自己填易伤贡献率**。」
 *
 * ⇒ 引擎侧（`damagePool`）**不再调用** `applyConcEstimate`；非轴覆盖率改由用户填的
 * 「易伤贡献率」φ 决定（`stunVuln.noAxisVulnShare`，缺省 1 = 旧口径「每招均匀」，逐位不变）。
 * 本文件的纯函数（`estimateConcentration` / `applyConcEstimate` / `noAxisConcNoticeOf`）
 * **保留**：它们是已实测的参考算法（逐档中位误差 9.4%），撤下的只是「引擎静默替用户认领」这个行为。
 * 若要恢复自动估算，需用户重新裁决——不要因为「函数还在」就把它接回生产路径。
 *
 * ## 原用户口径（逐字，2026-10-17）
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
import type { DamagePoolRow } from './helpers'

/** 机制设置键：无轴易伤估算开关（0 = 关）与用户系数 k（**2026-10-19 起不再接生产路径**，见文件头） */
export const NO_AXIS_CONC_ENABLED_SETTING = 'stunVuln.noAxisConcEstimate'
export const NO_AXIS_CONC_K_SETTING = 'stunVuln.noAxisConcK'
export const DEFAULT_NO_AXIS_CONC_K = 1.0

/**
 * **非轴易伤贡献率 φ**（用户裁决 2026-10-19：「非轴就只能不做，让用户自己填易伤贡献率」）。
 *
 * 引擎口径：非轴行级覆盖率 = 时间覆盖率 × φ（钳 [0,1]），在 `damagePool` 建池时一次乘进 `stunCoverage`。
 * 缺省 1 = 旧口径「每招均匀摊」，**逐位不变**（既有 golden / 夹具零漂移）。
 * 轴模式不读 φ —— 轴内 1 / 轴外 0 由引擎按轴实算。
 *
 * ⚠ 为什么不做「自动认领」：非轴没有轴模板，想自动把所有该进窗的招式认出来，
 * 就只能靠连携/大招这类粗代理，漏掉其余招式 ⇒ 用户裁决直接不做，把不确定性交回给用户。
 */
export const NO_AXIS_VULN_SHARE_SETTING = 'stunVuln.noAxisVulnShare'
export const DEFAULT_NO_AXIS_VULN_SHARE = 1

/** 拟合系数（来源与误差表见本文件头注释） */
export const CONC_EST_COEFFS = { a: 0.782015, b: -1.447331, c: 1.210691, d: 0.351966 }

export interface ConcEstimateInput {
  /** 时间覆盖率 = 引擎既有 `stunCoverage`（含决算截断损失秒） */
  timeCoverage: number
  /** 计划侧伤害权重（slot + weight；weight = 倍率 × 次数 × 该槽每点倍率折成的伤害） */
  weights: { slot: number; weight: number }[]
}

export interface ConcEstimateDetail {
  conc: number
  hhi: number
  mainShare: number
  effectiveCoverage: number
  applied: boolean
}

export function estimateConcentration(input: ConcEstimateInput): { conc: number; hhi: number; mainShare: number } {
  const tc = Number.isFinite(input.timeCoverage) ? Math.max(0, Math.min(1, input.timeCoverage)) : 0
  const items = input.weights.filter(w => Number.isFinite(w.weight) && w.weight > 0)
  const total = items.reduce((s, w) => s + w.weight, 0)
  if (total <= 0) return { conc: 1, hhi: 0, mainShare: 0 }
  const hhi = items.reduce((s, w) => s + (w.weight / total) ** 2, 0)
  const bySlot = new Map<number, number>()
  for (const w of items) bySlot.set(w.slot, (bySlot.get(w.slot) ?? 0) + w.weight)
  const mainShare = Math.max(0, ...[...bySlot.values()].map(v => v / total))
  const { a, b, c, d } = CONC_EST_COEFFS
  const raw = Math.exp(a + b * tc + c * hhi + d * mainShare)
  // 只拦 NaN/Infinity，**不**替用户判断「合理上限」（坑 47：不把用户输入质量写成不变量）
  const conc = Number.isFinite(raw) && raw > 0 ? raw : 1
  return { conc, hhi, mainShare }
}

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
