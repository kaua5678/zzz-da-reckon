/**
 * **命座提升率的成本轴**（B7，用户 2026-10-20 登记：「现在只有收益没有消耗」）。
 *
 * ## 口径（先定清楚，别自己发明成本模型）
 *
 * 成本有两把尺，**分工由用户 2026-10-28 裁决**：
 *
 * | 尺 | 单位 | 用在哪 | 为什么 |
 * |---|---|---|---|
 * | 金（`cinemaCostOf`） | 1 金/级（`goldSteps` 每步 1 金） | 只作**队伍强度的直观表达**（「顶分 3 金」这类社区俗语）、与预设金数对齐 | 社区口径，「听起来强」 |
 * | **菲林**（`cinemaFilmCostOf`） | 一级 = 角色池一个限定命座的期望菲林（`filmEconomy#CINEMA_GOLD_FILM`） | **一切价值计算 / ROI** | 「1 金」本来就代表不同价格（角色池 15000、音擎池 10000），是俗语不是单位 |
 *
 * 用户原话（2026-10-28）：「金数这种不严谨的措辞通常是为了直观表达一个队伍强度……在你做价值计算的时候
 * 可能只用万菲林均强度，准确一些。事实上 1 金本来就代表不同价格，只是社区俗语。」
 *
 * 因此本模块**不做**任何新的价格假设：菲林成本直接引用 `filmEconomy` 的期望常量，金成本沿用 1 金/级。
 * 两列都**只做除法**，不引入折现、不引入权重。**不是**抽卡期望、不是边际效用。
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
import { CINEMA_GOLD_FILM } from '@/data/filmEconomy'

/** 一级命座的成本（金）。恒 1：见文件头，`goldSteps` 每步 = 1 金。**只作直观表达**。 */
export const GOLD_PER_CINEMA_LEVEL = 1

/**
 * 一级命座的**菲林**成本 = 角色池一个限定命座的期望菲林（93.75 抽 × 160）。
 * 单一来源 = `filmEconomy#CINEMA_GOLD_FILM`——本模块不复制数字（规则 11）。
 */
export const FILM_PER_CINEMA_LEVEL = CINEMA_GOLD_FILM

// @fact engine:抽卡成本/价值量纲 口径: 价值与 ROI 一律以「每万菲林」计价（pullPlanner#cardValuePer10kFilm、cinemaUpliftCost#cinemaFilmCostOf 的 per10kFilmPct）；「金」是社区俗语，只用于队伍强度的直观表达——同一个 1 金在角色池 = 15000 菲林、音擎池 = 10000，本来就不是一个价，不得作价值分母 | 据 用户@2026-10-28（「金数这种不严谨的措辞通常是为了直观表达一个队伍强度…做价值计算的时候可能只用万菲林均强度，准确一些。事实上1金本来就代表不同价格，只是社区俗语」） | 验 src/composables/__tests__/cinemaUpliftCost.test.ts | 锚 src/composables/cinemaUpliftCost.ts#FILM_PER_CINEMA_LEVEL + src/composables/pullPlanner.ts#cardValuePer10kFilm + src/data/filmEconomy.ts#CINEMA_GOLD_FILM | 信 确认
// ⟳复核: 若角色池 / 音擎池的期望抽数再度分化、或出现第三种付费单位，复核「万菲林」是否仍是唯一价值量纲 | 到期 2027-03-31

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

/** 逐级成本行（菲林尺） */
export interface CinemaFilmLevelRow {
  level: number
  /** 该级相对上一级的提升率（%；负 = 变差，如实保留） */
  gainPct: number
  /** 该级的菲林成本（恒 `FILM_PER_CINEMA_LEVEL`，留字段是为了将来「某级更贵」时有落点） */
  film: number
  /** 该级每万菲林收益（% / 万菲林）——**价值计算用这一列** */
  per10kFilmPct: number
}

/** 菲林尺的成本汇总（与 `CinemaCostSummary` 同构，单位换成菲林） */
export interface CinemaFilmCostSummary {
  rows: CinemaFilmLevelRow[]
  totalPct: number
  totalFilm: number
  /** 累计每万菲林（`totalPct / (totalFilm/10000)`；0 菲林 ⇒ null，不编 0） */
  per10kFilmTotalPct: number | null
  /** 逐级算术平均每万菲林（`Σ per10kFilmPct / 级数`）——与上一项**不等**（复利 vs 算术，见文件头） */
  per10kFilmMeanPct: number | null
  /** 最划算的一级（每万菲林最高；并列取较低命座） */
  best: CinemaFilmLevelRow | null
  /** 最不划算的一级（每万菲林最低；并列取较高命座） */
  worst: CinemaFilmLevelRow | null
}

/**
 * 把逐级提升率换算成**菲林**成本轴（价值计算口径，用户 2026-10-28）。
 *
 * 与 `cinemaCostOf` 的唯一差别 = 分母：这里用 `FILM_PER_CINEMA_LEVEL`（期望菲林），
 * 于是「每一级命座值多少 %/万菲林」可直接与抽卡规划器的 `cardValuePer10kFilm` 同尺比较。
 * 除零 / NaN / 负值三条行为与金尺**逐条相同**（同一个 `gainPct` 语义，不做单位特有处理）。
 */
export function cinemaFilmCostOf(entries: readonly CinemaUpliftEntry[], totalPct: number): CinemaFilmCostSummary {
  const rows: CinemaFilmLevelRow[] = entries.map((e, i) => {
    const gain = Number.isFinite(e.gainPct) ? e.gainPct : 0
    return {
      level: i + 1,
      gainPct: gain,
      film: FILM_PER_CINEMA_LEVEL,
      per10kFilmPct: FILM_PER_CINEMA_LEVEL > 0 ? gain / (FILM_PER_CINEMA_LEVEL / 10000) : 0,
    }
  })
  const totalFilm = rows.length * FILM_PER_CINEMA_LEVEL
  let best: CinemaFilmLevelRow | null = null
  let worst: CinemaFilmLevelRow | null = null
  for (const r of rows) {
    if (!best || r.per10kFilmPct > best.per10kFilmPct) best = r
    if (!worst || r.per10kFilmPct <= worst.per10kFilmPct) worst = r
  }
  return {
    rows,
    totalPct,
    totalFilm,
    per10kFilmTotalPct: totalFilm > 0 && Number.isFinite(totalPct) ? totalPct / (totalFilm / 10000) : null,
    per10kFilmMeanPct: rows.length > 0
      ? rows.reduce((s, r) => s + r.per10kFilmPct, 0) / rows.length
      : null,
    best,
    worst,
  }
}
