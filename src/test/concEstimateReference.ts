/**
 * R14 / T139：无轴「失衡易伤集中度」估算（conc_est）——**参考算法，已从引擎撤下**。
 *
 * ## ⛔ 2026-10-19 用户裁决：非轴不再自动认领易伤
 *
 * > 「轴模式下已经认定了易伤认领啊，非轴模式下想自动认领也不能仅仅靠连携和大招，
 * >  还有其他很多招式啊，所以非轴就只能不做，**让用户自己填易伤贡献率**。」
 *
 * ⇒ 引擎（`damagePool`）**不再调用**本文件的任何函数；非轴覆盖率改由用户填的
 * 「易伤贡献率」φ 决定（`stunVuln.noAxisVulnShare`，缺省 1 = 旧口径「每招均匀」，逐位不变）。
 *
 * ## 为什么住在 `src/test/`
 *
 * 这几个纯函数是**已实测的参考算法**（逐档中位误差 9.4%，见 `docs/axis-vuln-uplift-reference.md`），
 * 原注释写着「保留」，所以不删实现；但它们**零生产消费者** ⇒ `deadChannelLs` 判据 ⑫ 会报
 * 「只被测试引用 = 生产死代码」（`4cbd8042` 退役引擎接线时的收尾遗留）。
 * 按该判据的口径「能搬的一律搬到测试侧」，挪到这里：非入口文件、不进候选面，
 * 实现与它的回归测试同处，**将来若要恢复自动估算（需用户重新裁决）从这里搬回去**。
 *
 * ⚠ 不要把 `src` 里的任何生产代码 import 回本文件之外——本文件只服务测试与口径留存。
 */
import type { DamagePoolRow } from '@/composables/resourceCalc/helpers'

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
