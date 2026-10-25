/**
 * **命座提升率的成本轴**（B7，用户 2026-10-20 登记：「现在只有收益没有消耗」）。
 *
 * ## 口径（先定清楚，别自己发明成本模型）
 *
 * 本仓的成本单位只有一个：**限定金**。而命座的成本是常数——
 * `TeamPreset.goldSteps` 的每一步都算 **1 金**（`src/types/teamPreset.ts` 头注释逐字：
 * 「一步 = 一个角色 +1 影画，一把音擎 +1 精炼，或一把音擎本体（都算金）」）。
 * ⇒ **C0→C1 到 C5→C6 每一级都是 1 金**，不存在「这一级更贵」。
 *
 * 因此本模块**不做**任何新的价格假设，只把「同一条命座链上逐级收益 ÷ 逐级金数」算出来，
 * 让「这一级值不值一金」可直接读。**不是**抽卡期望、不是边际效用——那是另一张卡的事。
 *
 * ## 为什么不能只看 `lockedTotalPct`
 *
 * `lockedTotalPct` 是 C0→C{n} 的**累计**提升率。用它除以 n 得到的是「平均每金」，
 * 会掩盖「C4 是废命座、C6 是大头」这种**逐级形状**——而那正是用户在问的
 * 「命座提升率」到底该不该按每金算。⇒ 本模块给**逐级**与**累计**两列，并把
 * 「最划算的一级 / 最不划算的一级」点出来。
 *
 * ## 判据（`__tests__/cinemaUpliftCost.test.ts`）
 *
 * - 「每金」= Δ提升率 ÷ Δ金数，Δ金恒 1 ⇒ 数值上等于逐级提升率（**别加隐藏权重**）；
 * - 累计每金 = 累计提升率 ÷ 级数（与「逐级算术平均」**不等**，因为提升率是复利拼接的——
 *   实测两者会差，这正是不能拿累计算平均的理由）；
 * - 负值要如实保留（命座让伤害变低是可能的，不许 clamp 到 0）；
 * - 空数组 / 单级都要有确定行为（不除零、不返回 NaN）。
 */
import type { CinemaUpliftEntry } from '@/composables/cinemaUplift'

/** 一级命座的成本（金）。恒 1：见文件头，`goldSteps` 每步 = 1 金。 */
export const GOLD_PER_CINEMA_LEVEL = 1

/** 逐级成本行 */
export interface CinemaLevelCostRow {
  /** 这一级命座序号（1..6；= `entries` 里第 i 项的「升到第 i+1 命」） */
  level: number
  /** 该级相对上一级的提升率（%；负 = 变差，如实保留） */
  gainPct: number
  /** 该级的金数（恒 `GOLD_PER_CINEMA_LEVEL`，留字段是为了将来「某级更贵」时有落点） */
  gold: number
  /** 该级每金收益（% / 金） */
  perGoldPct: number
}

export interface CinemaCostSummary {
  rows: CinemaLevelCostRow[]
  /** 累计提升率（C0→C{maxLevel}，复利拼接后；与 `cinemaUplift#cumulativeUpliftPct` 同源，调用方传入） */
  totalPct: number
  /** 总金数（= 级数 × `GOLD_PER_CINEMA_LEVEL`） */
  totalGold: number
  /** 累计每金（`totalPct / totalGold`；0 金 ⇒ null，不编 0） */
  perGoldTotalPct: number | null
  /** 逐级算术平均每金（`Σ perGoldPct / 级数`）——与上一项**不等**，见文件头 */
  perGoldMeanPct: number | null
  /** 最划算的一级（每金最高；并列取较低命座）。空 ⇒ null */
  best: CinemaLevelCostRow | null
  /** 最不划算的一级（每金最低；并列取较高命座，便于看出「最后那一级最水」）。空 ⇒ null */
  worst: CinemaLevelCostRow | null
}

/**
 * 把逐级提升率换算成成本轴。
 *
 * @param entries `CinemaUpliftEntry[]`（`cinemaUplift` 的输出；只用 `gainPct`）
 * @param totalPct 累计提升率（调用方已有；不在这里再拼一次，避免两套复利口径）
 */
export function cinemaCostOf(entries: readonly CinemaUpliftEntry[], totalPct: number): CinemaCostSummary {
  const rows: CinemaLevelCostRow[] = entries.map((e, i) => {
    const gain = Number.isFinite(e.gainPct) ? e.gainPct : 0
    return {
      level: i + 1,
      gainPct: gain,
      gold: GOLD_PER_CINEMA_LEVEL,
      perGoldPct: GOLD_PER_CINEMA_LEVEL > 0 ? gain / GOLD_PER_CINEMA_LEVEL : 0,
    }
  })
  const totalGold = rows.length * GOLD_PER_CINEMA_LEVEL
  let best: CinemaLevelCostRow | null = null
  let worst: CinemaLevelCostRow | null = null
  for (const r of rows) {
    if (!best || r.perGoldPct > best.perGoldPct) best = r
    if (!worst || r.perGoldPct <= worst.perGoldPct) worst = r
  }
  return {
    rows,
    totalPct,
    totalGold,
    perGoldTotalPct: totalGold > 0 && Number.isFinite(totalPct) ? totalPct / totalGold : null,
    perGoldMeanPct: rows.length > 0
      ? rows.reduce((s, r) => s + r.perGoldPct, 0) / rows.length
      : null,
    best,
    worst,
  }
}
