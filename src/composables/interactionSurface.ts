/**
 * **交互 × 合轴 二维面**（用户口径 2026-10-18）：
 *
 * > 「操作难度有多个维度，比如从 0 延伸到最难交互有多条路，先交互拉到平A为0或者上限后，把合轴拉满，
 * >   如果有时间并且交互没上限就再把剩余交互拉满。或者先拉满合轴率，再动态交互。
 * >   中间有两个点，一个是合轴拉满，一个是没有合轴」
 *
 * ## 为什么需要它（一维扫描解释不了的事）
 *
 * 一维「交互扫描」只回答「在我这个合轴率下，加一次交互会怎样」——实测同一条扫描线在 r 的
 * 不同取值下**符号相反**（般琉卢 180s：r=0 时弹刀 0→2 掉 11.7M；r=0.8 时弹刀 0→12 涨 17.5M）。
 * ⇒ 交互与合轴**不是两个独立旋钮**，它们在同一张面上互相让步：合轴给交互腾出时间，交互给合轴提供内容。
 * 只看一条线会把「这个旋钮没用」读成结论，而真相是「另一个旋钮没跟上」。
 *
 * ## 面的定义
 *
 * - x = 某类交互的次数（三槽同值，与一维扫描同口径；同一次求值里其它类保持基线）
 * - y = 合轴吸收率 `comboAlignAbsorbRatio`（0 → 上限 `absorbCap`）
 * - z = 队总伤害
 * - 每格附「可行性标记」：弃轴 / 降配 ×N / 挤压 N 份 / 平A秒数 —— 这三条是**阶跃**的，
 *   它们就是面上那些「掉档」的来源（实测锯齿 = 挤压臂与降配臂的离散切换，不是循环震荡）。
 *
 * ## 两条参考路径（用户描述的两条走法）
 *
 * - **路径 A「先交互」**：从 (起点, r=0) 出发，先把交互加到「最后一格仍干净」的位置，再抬 r；
 * - **路径 B「先合轴」**：从 (起点, r=0) 出发，先把 r 抬到上限，再加交互。
 * 两条路径分别连成折线叠在面上——实测 A 会**先掉下去再爬**（交互抢时间但没合轴兜底 ⇒ 弃轴/降配），
 * B 单调上升。这正是用户要看的「哪条路不该走」。
 *
 * ## 最优梯度线（ridge）
 *
 * 对每个交互次数取「扫过的 r 里伤害最高的那一格」= 列最优；把它们连起来就是**在给定交互量下的上限**。
 * ⚠ 它是**上界**不是**可达路径**（相邻列最优的 r 可能往回跳）——所以另给 `frontier`：
 * 按 (交互次数, r) 双关键字排序后「伤害严格递增且两项都不下降」的帕累托子集，那才是**可以一步不回头走完**的线。
 */
import type { AnalysisContext } from '@/composables/analysisScenario'
import { COMBO_ALIGN_ABSORB_RATIO_SETTING } from '@/data/resourceDefaults'
import { frontlineOccupationBreakdown } from '@/core/resource/timeOccupation'
import type { TeamPreset } from '@/types/teamPreset'
import type { BossPreset, BossPresetPhase } from '@/types/bossPreset'
import { SWEEP_INTERACTION_KEYS, SWEEP_INTERACTION_LABEL, type SweepInteractionKey } from './interactionSweep'

/** 面上的一格 */
export interface SurfaceCell {
  /** x = 三槽该交互字段的值（与一维扫描同口径：只改基线非零槽 + 槽 0） */
  count: number
  /** y = 合轴吸收率 */
  ratio: number
  /** 队总伤害 */
  dmg: number
  /** 轴退化（弃轴） */
  fallback: boolean
  /** 非轴降配比例（undefined = 未降配） */
  downscale?: number
  /** 挤压臂削掉的「自动多打」份数 */
  trim: number
  /** 平A总秒数（三槽相加） */
  basicTime: number
  /** 前台净占用（超时判定口径） */
  net: number
  /** 三槽实打交互次数（降配后与 `count` 可能不等 —— 见 `SweepSurfaceNote.downscaleLeak`） */
  actualCount: number
  /**
   * **干净格** = 没弃轴 ∧ 没降配。挤压臂不算脏（它是「按剩余预算打满」，是设计行为），
   * 但 `trim` 单独报出来 —— 实测它就是面上 −12M 那一级的来源。
   */
  clean: boolean
}

/** 一条面上的参考路径（折线，按走法顺序排列） */
export interface SurfacePath {
  /** `interact-first` = 先交互后合轴；`absorb-first` = 先合轴后交互 */
  kind: 'interact-first' | 'absorb-first'
  label: string
  /** 依次经过的格（终点 = 两条路径各自的落点） */
  cells: SurfaceCell[]
  /** 起点 → 终点的伤害变化 */
  gain: number
  /** 路径上的最低点（< 起点 = 中途掉下去过） */
  worst: SurfaceCell
}

export interface SurfaceSeries {
  key: SweepInteractionKey
  label: string
  /** x 取值（升序） */
  counts: number[]
  /** y 取值（升序） */
  ratios: number[]
  /** `cells[ratioIdx][countIdx]`（行列与 counts/ratios 对齐，便于直接取格） */
  cells: SurfaceCell[][]
  /** 列最优：每个交互次数下，扫过的 r 里伤害最高的那格 */
  columnBest: SurfaceCell[]
  /** 帕累托前沿（可一步不回头走完的最优线） */
  frontier: SurfaceCell[]
  /** 全局最优格 */
  best: SurfaceCell
  /** 两条参考路径 */
  paths: SurfacePath[]
  /** 可行域边界：每个 r 上「最后一个干净格」的交互次数（-1 = 该行第一格就不干净） */
  cleanLimitByRatio: number[]
  /** 每个交互次数上「平A归零」的 r（-1 = 该列扫到底也没归零） */
  basicZeroRatioByCount: number[]
}

export interface SweepSurface {
  presetId: string
  presetName: string
  bossName: string
  phaseLabel: string
  series: SurfaceSeries[]
  /** 求值次数（诊断：告诉用户这张面花了多少次全队求值） */
  evaluations: number
  /** 本次扫描的合轴率上限 */
  absorbCap: number
  /**
   * **降配泄漏标记**（2026-10-18 探针实测的既有缺陷，如实上报而不是静默）：
   * Boss 弹刀反推（`parrySplit`）用 **store 原值** 覆盖 `merged.parryCount`，在
   * `interactionScale` 缩放**之后**注入 ⇒ 弹刀这一类交互的降配**对实打次数不生效**
   * （实测 n=10 设置 10/10 × 降配 0.375 = 4/4 → 实打 10/10）。带上 `parryCount` 时本标志为 true。
   */
  downscaleLeak: boolean
}

export interface SurfaceOptions {
  preset: TeamPreset
  boss: BossPreset
  phase: BossPresetPhase
  /** x 上界（缺省 20） */
  maxCount?: number
  /** x 步长（缺省 2 —— 面上密度优先，1 会让求值次数翻倍） */
  countStep?: number
  /** y 上限（缺省 = 当前 mechanic setting 的 absorbCap） */
  absorbCap?: number
  /** y 采样点数（缺省 6 ⇒ r = 0, 0.2, …, cap） */
  ratioSteps?: number
  /** 只扫这些类型（缺省全部「本队真的有」的类型） */
  keys?: readonly SweepInteractionKey[]
}

/** 读某槽某交互类型的当前值 */
function readKey(ctx: AnalysisContext, slot: number, key: SweepInteractionKey): number {
  const row = ctx.config.team[slot] as unknown as Record<string, number | undefined> | undefined
  return row?.[key] ?? 0
}

/** 采一格（只读一次求值，字段全部同源） */
function captureCell(ctx: AnalysisContext, count: number, ratio: number): SurfaceCell {
  const rr = ctx.calc.resourceResult.value
  const occ = rr ? frontlineOccupationBreakdown(rr) : null
  const basicTime = rr ? rr.characters.reduce((a, c) => a + c.timeAllocation.basicAttackTime, 0) : 0
  const fallback = rr?.convergence.axisFallback === true
  const downscale = rr?.convergence.interactionScale
  return {
    count,
    ratio,
    dmg: ctx.calc.teamTotalDamage.value,
    fallback,
    ...(downscale !== undefined ? { downscale } : {}),
    trim: rr?.convergence.axisAutoTrimmed ?? 0,
    basicTime,
    net: occ?.net ?? 0,
    actualCount: rr ? interactionsOfSlots(ctx) : 0,
    clean: !fallback && downscale === undefined,
  }
}

/** 三槽实打交互总数（读执行行，降配后与设置值可能不同） */
function interactionsOfSlots(ctx: AnalysisContext): number {
  const rr = ctx.calc.resourceResult.value
  if (!rr) return 0
  let acc = 0
  for (const ch of rr.characters) {
    for (const e of ch.executions) {
      if (e.category !== 'dodge' && e.category !== 'assist') continue
      acc += e.count
    }
  }
  return acc
}

/**
 * 跑一次二维面扫描（同步，调用方负责在独立场景里调用，见 `analysisScenario#withAnalysisScenario`）。
 *
 * ⚠ **每格都从基线重放**（与一维扫描同纪律）：先写回基线交互值、再写本格值；扫完必须还原
 * 交互与合轴率两项，否则会污染调用方后续的读数。
 */
export function runInteractionSurface(ctx: AnalysisContext, options: SurfaceOptions): SweepSurface {
  const maxCount = Math.max(2, Math.trunc(options.maxCount ?? 20))
  const countStep = Math.max(1, Math.trunc(options.countStep ?? 2))
  const ratioSteps = Math.max(2, Math.trunc(options.ratioSteps ?? 6))
  const capRaw = options.absorbCap ?? Number(ctx.config.getMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, 0.4))
  const absorbCap = Number.isFinite(capRaw) ? Math.min(1, Math.max(0, capRaw)) : 0.4
  const ratios = Array.from({ length: ratioSteps }, (_, i) =>
    // 端点必须落准（0 与 cap），中间等分 —— 四舍五入到 3 位避免 0.30000000000000004 进缓存键
    Math.round((absorbCap * (i / (ratioSteps - 1))) * 1000) / 1000)
  const counts = Array.from({ length: Math.floor((maxCount - 0) / countStep) + 1 }, (_, i) => i * countStep)

  const requested = options.keys ?? SWEEP_INTERACTION_KEYS
  // 与一维扫描同一条「只扫本队真的有的交互类型」过滤（判据 = 三槽基线非零）
  const keys = options.keys !== undefined
    ? requested
    : requested.filter(key => [0, 1, 2].some(slot => readKey(ctx, slot, key) > 0))

  let evaluations = 0
  const series: SurfaceSeries[] = []

  for (const key of keys) {
    const base = [0, 1, 2].map(slot => readKey(ctx, slot, key))
    const rows: SurfaceCell[][] = []
    for (const ratio of ratios) {
      ctx.config.setMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, ratio)
      const row: SurfaceCell[] = []
      for (const count of counts) {
        // 每格从基线重放
        for (let slot = 0; slot < 3; slot++) ctx.config.setActionCount(slot, key, base[slot] ?? 0)
        // 本格值：只改「基线非零的槽」+ 槽 0（主C 恒有交互），与一维扫描同口径
        for (let slot = 0; slot < 3; slot++) {
          if ((base[slot] ?? 0) > 0 || slot === 0) ctx.config.setActionCount(slot, key, count)
        }
        row.push(captureCell(ctx, count, ratio))
        evaluations++
      }
      rows.push(row)
    }
    // 还原基线（交互 + 合轴率）
    for (let slot = 0; slot < 3; slot++) ctx.config.setActionCount(slot, key, base[slot] ?? 0)
    ctx.config.setMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, capRaw)

    // 列最优：每个交互次数下扫过的 r 里伤害最高
    const columnBest: SurfaceCell[] = counts.map((_, ci) => {
      let best = rows[0]![ci]!
      for (let ri = 1; ri < rows.length; ri++) if (rows[ri]![ci]!.dmg > best.dmg) best = rows[ri]![ci]!
      return best
    })
    // 全局最优
    let best = rows[0]![0]!
    for (const row of rows) for (const cell of row) if (cell.dmg > best.dmg) best = cell
    // 可行边界：每行最后一个干净格
    const cleanLimitByRatio = rows.map(row => {
      let last = -1
      for (let ci = 0; ci < row.length; ci++) if (row[ci]!.clean) last = ci
      return last < 0 ? -1 : counts[last]!
    })
    // 平A归零点：每列「第一个 basic = 0」的 r
    const basicZeroRatioByCount = counts.map((_, ci) => {
      for (let ri = 0; ri < rows.length; ri++) if (rows[ri]![ci]!.basicTime <= 0.05) return rows[ri]![ci]!.ratio
      return -1
    })
    series.push({
      key,
      label: SWEEP_INTERACTION_LABEL[key],
      counts,
      ratios,
      cells: rows,
      columnBest,
      frontier: paretoFrontier(rows, counts),
      best,
      paths: buildPaths(rows, counts),
      cleanLimitByRatio,
      basicZeroRatioByCount,
    })
  }

  return {
    presetId: options.preset.id,
    presetName: options.preset.name,
    bossName: options.boss.name,
    phaseLabel: options.phase.label,
    series,
    evaluations,
    absorbCap,
    // 弹刀这一类只要有降配格、且实打次数 ≠ 设置次数 ⇒ 命中已知泄漏（见 SweepSurface.downscaleLeak）
    downscaleLeak: series.some(s => s.key === 'parryCount'
      && s.cells.some(row => row.some(c => c.downscale !== undefined && Math.abs(c.actualCount - c.count) > 0.5))),
  }
}

/**
 * **帕累托前沿**：按 (x = 交互次数, y = 合轴率) 双关键字**从小到大**扫描，只保留
 * 「伤害严格大于此前最大值」的格 ⇒ 得到的线**每一步 x、y 都不回头**，是真正能走的梯度线。
 *
 * 为什么不是「列最优连线」：列最优里相邻两点的 r 可能往回跳（实测 r 0.4 → 0.2），
 * 那不是路径而是上界包络；两者都报出来（`columnBest` vs `frontier`）。
 */
function paretoFrontier(rows: SurfaceCell[][], counts: number[]): SurfaceCell[] {
  const flat: SurfaceCell[] = []
  for (let ri = 0; ri < rows.length; ri++) for (let ci = 0; ci < counts.length; ci++) flat.push(rows[ri]![ci]!)
  // 双关键字升序：先比 r，再比 count（同一 r 内左→右）
  flat.sort((a, b) => (a.ratio - b.ratio) || (a.count - b.count))
  const out: SurfaceCell[] = []
  let bestDmg = -Infinity
  for (const c of flat) {
    if (c.dmg > bestDmg + 1e-9) { out.push(c); bestDmg = c.dmg }
  }
  return out
}

/**
 * 两条参考路径（用户口述的两种走法）。共同起点 = **面左下角**（交互最低、r=0）。
 *
 * - `absorb-first`（先合轴）：交互固定在 0，沿 r 升到上限，**再沿上限行把交互走到底**；
 * - `interact-first`（先交互）：合轴固定在 0，沿交互**走到上限**（该掉就掉），**再把 r 抬到上限**。
 *
 * ⚠ 两条都**走到底**、不在「最后一个干净格」停：用户的走法是「拉到上限」，
 * 而拉到上限这件事本身就会穿过不可行区——那正是要展示的「掉下去」。
 *
 * 路径上的格**取自已算好的面**，不额外求值；遇到中间掉档也如实保留（那正是要展示的东西）。
 */
function buildPaths(rows: SurfaceCell[][], counts: number[]): SurfacePath[] {
  const lastRi = rows.length - 1
  const lastCi = counts.length - 1
  const out: SurfacePath[] = []

  const summarize = (cells: SurfaceCell[], kind: SurfacePath['kind'], label: string): SurfacePath => {
    const gain = cells[cells.length - 1]!.dmg - cells[0]!.dmg
    let worst = cells[0]!
    for (const c of cells) if (c.dmg < worst.dmg) worst = c
    return { kind, label, cells, gain, worst }
  }

  // 先合轴：交互固定在 0，沿 r 升到上限，**再沿上限行把交互走到底**
  {
    const cells: SurfaceCell[] = []
    for (let ri = 0; ri <= lastRi; ri++) cells.push(rows[ri]![0]!)
    for (let ci = 1; ci <= lastCi; ci++) cells.push(rows[lastRi]![ci]!)
    out.push(summarize(cells, 'absorb-first', '先合轴后交互'))
  }

  // 先交互：合轴固定在 0，沿交互**走到上限**（该掉就掉），**再把 r 抬到上限**
  {
    const cells: SurfaceCell[] = []
    for (let ci = 0; ci <= lastCi; ci++) cells.push(rows[0]![ci]!)
    for (let ri = 1; ri <= lastRi; ri++) cells.push(rows[ri]![lastCi]!)
    out.push(summarize(cells, 'interact-first', '先交互后合轴'))
  }

  return out
}
