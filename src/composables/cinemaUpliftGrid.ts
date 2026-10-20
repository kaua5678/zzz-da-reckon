/**
 * 命座提升率 × 环境网格（用户 2026-10-20 裁决：「在图表类单独给一个，伤害贡献多算几次，
 * 比如一个方框分成 4 个方框或者 9 个方框，2 维属性分别是 boss 选择不同，环境 buff 选择不同」）。
 *
 * ## 为什么要单独立这个（而不是留在资源利用率页）
 * 命座提升率**不是角色的内禀属性**：实测同一支队（`auto-1541-1331-1411`）在主C 锁同一失衡次数下，
 * 队友 C0 时主C 累计提升 **37.6%**、队友 C6 时只有 **25.5%**（分母被队友抬走 + 辅助自带拐力）。
 * 换 Boss 期 / 换环境 buff 牌同样会动。⇒ 单点数字会被读成「这角色的命座值 X%」，那是错的。
 *
 * ## 两个口径同时给（这是本网格的核心）
 * 用户 2026-10-20 指出：**「失衡提升高的命座就吃亏了」** —— 因为资源利用率页为了压掉
 * 「失衡次数自激」的假提升，把 `stunCountLock` 钉死，于是「多打几个窗」这条价值被整条抹掉。
 * 本网格每格跑**两遍**，把这条价值显式量出来：
 *
 * | 口径 | 含义 |
 * |---|---|
 * | `lockedEntries` | 锁 N（N = **该格 C0 基线的自由收敛值**）⇒ 纯净命座收益，跨格可比 |
 * | `freeEntries`   | 不锁 ⇒ 含「命座让失衡次数变化」这条真实通道 |
 * | `stunChannelDelta` | `freeTotal − lockedTotal` = **失衡通道贡献**（正 = 不锁时多拿窗口/攒条更快） |
 *
 * ⚠ **锁值必须由 C0 基线给出、且整表只用这一个**（`freeStunCountAtBase`）：用「当前配置的池」当锁值
 * 会让全01 与全65 的分析锁在不同窗数上（实测 `auto-1371-1481-1451`：全01 锁 6、全65 锁 3，
 * 同队同一批命座的累计提升率因此从 71.0% 变成 68.8%，**差值全部来自锁值而不是命座**）。
 * 用 C0 基线 = 对齐用户口径「低金打 4 失衡基本就是最优选择」——被评估的是「从低金往上加金值不值」。
 *
 * ## 成本与中止
 * 每格 `1 + maxLevel` 次全量求值（锁口径），开 `free` 再翻一倍。默认**只算锁口径**（网格已够大），
 * 需要失衡通道那一列时由调用方显式开 `includeFree`。中止语义走 `BatchControl`（优雅式，保留已算格）。
 */
import type { AnalysisContext } from '@/composables/analysisScenario'
import { applyBossRoom } from '@/composables/bossRoom'
import { applyBuffToStore, applyTeamToStore } from '@/composables/teamCompare'
import { analyzeCinemaUplift, type CinemaUpliftEntry } from '@/composables/cinemaUplift'
import { isBatchAborted, batchReporter, type BatchTaskOptions } from '@/composables/batchTask'
import type { BossPreset, BossPresetPhase, PhaseBuffCard } from '@/types/bossPreset'
import type { TeamPreset } from '@/types/teamPreset'

/** 网格的一行：一个「Boss × 期」。 */
export interface GridRowSpec {
  boss: BossPreset
  phase: BossPresetPhase
}

/** 网格的一列：一份环境 buff（`null` = 不吃）。 */
export interface GridColSpec {
  /** 列 id（`'none'` 或牌名） */
  id: string
  /** 列标签 */
  label: string
  card: PhaseBuffCard | null
}

/** 一个格：某队在某 (Boss × buff) 下的命座提升率。 */
export interface CinemaUpliftGridCell {
  /** `${presetId}|${bossId}|${phaseId}|${colId}` */
  id: string
  presetId: string
  bossId: string
  bossName: string
  phaseId: string
  phaseLabel: string
  /** 列 id（`'none'` = 不吃 buff） */
  colId: string
  colLabel: string
  /**
   * **行级锁值** = 该行第一列（恒「不吃 buff」）在 C0 基线自由收敛的失衡次数。
   *
   * ⚠ 2026-10-20 语义变更：原为「该格自己的 C0 基线」⇒ 同一行内不同 buff 列的锁值不同
   * （实测「异构·基塔布鲁」行：不吃 4 窗、破御/锋刃 5 窗），于是 C1 的基线本身就不一样
   * ⇒ C0→C1 增益 7.04% vs 11.83%，看起来像跳变/算错。锁的意义是**钉死场景**，
   * 所以它必须是行的属性。0 = 该行在 C0 下根本打不出失衡（锁口径退化为不锁）。
   */
  baseStunCount: number
  /**
   * 该格**自己的**自由收敛失衡次数（不受锁影响）= 「吃这张牌让失衡次数变成几次」。
   * 与 `baseStunCount`（行级锁值）的差 = 这张牌/这个 Boss 对失衡次数的实际影响，
   * 是**被观测的效应**，不参与锁。
   */
  ownFreeStunCount: number
  /** 锁口径的逐级提升率（跨格可比） */
  lockedEntries: CinemaUpliftEntry[]
  /** 锁口径的累计提升率（C0→C{maxLevel}，复利式拼接，不是逐级相加） */
  lockedTotalPct: number
  /** 不锁口径（`includeFree` 关时为 null） */
  freeEntries: CinemaUpliftEntry[] | null
  freeTotalPct: number | null
  /** 失衡通道贡献 = free − locked（>0 ⇒ 不锁时命座从失衡次数/攒条上多拿了收益） */
  stunChannelDeltaPct: number | null
  /** 该格不锁口径下 C0 / C6 的自由失衡次数（`includeFree` 关时为 null） */
  freeStunCounts: { base: number; top: number } | null
}

export interface CinemaUpliftGridResult {
  cells: CinemaUpliftGridCell[]
  rowLabels: string[]
  colLabels: string[]
  /** 被评估的槽位（命座提升率按槽位算） */
  slot: number
  agentId: string
  /** 实际用到的最高命座等级 */
  maxLevel: number
}

export interface ComputeCinemaUpliftGridOptions extends BatchTaskOptions {
  /** 要在哪些预设上跑（通常 1 队；多队时网格会按 队→行→列 展开） */
  presets: TeamPreset[]
  rows: GridRowSpec[]
  cols: GridColSpec[]
  /** 把哪些槽位当作「被评估的角色」；缺省 0（主C） */
  slots?: number[]
  maxLevel?: number
  /**
   * 同时跑「不锁」口径（默认 false）。
   * 打开后每格求值次数翻倍 —— 只有需要「失衡通道贡献」那一列时才开。
   */
  includeFree?: boolean
  /**
   * **锁值口径**（2026-10-20 修「提升率跳变」）：
   * - `'row'`（缺省）：整行统一锁值，取该行「不吃 buff」列的 C0 基线；
   * - `'grid'`：**整张网格**统一锁值，取第一行「不吃 buff」列的 C0 基线；
   * - 数字：用户指定。
   *
   * 为什么 `'grid'` 值得提供：锁值一变，**整数台阶型**命座（如克拉蕾 C1「残痕积蓄效率 +20%」，
   * 层数 = floor(积蓄/每层)）的增益会整档跳（实测同队锁 2/3/4/5/6 ⇒ C1 增益
   * 10.4/20.1/17.1/41.9/8.4%）——那是**真实的整数边界效应**，不是算错。
   * 但若每行锁值不同，读者会把它误读成「同一命座在不同 Boss 下差 5 倍」。
   * 用 `'grid'` 至少保证**整张表在同一把尺子下**比较。
   */
  lockMode?: 'row' | 'grid' | number
  resolveName?: (agentId: string, slot: number) => string
}

/** 逐级提升率 → 累计提升率（复利式拼接：`Π(1+gᵢ) − 1`，不是把百分比相加） */
export function cumulativeUpliftPct(entries: readonly CinemaUpliftEntry[]): number {
  let acc = 1
  for (const e of entries) acc *= 1 + e.gainPct / 100
  return (acc - 1) * 100
}

/** 一组「Boss × 期」→ 去重后的行（同一 Boss 同期的多个 phase 只留第一条：网格行是「某 Boss 某期」） */
export function dedupeGridRows(rows: readonly GridRowSpec[]): GridRowSpec[] {
  const seen = new Set<string>()
  const out: GridRowSpec[] = []
  for (const r of rows) {
    const key = `${r.boss.id}|${r.phase.phaseId}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(r)
  }
  return out
}

/**
 * 跑网格。**每格独立建/复用场景**（同一场景内顺序改写，避免 N 个场景同时存活吃内存）：
 * 套队伍 → 进 Boss 房间 → 上 buff → 跑提升率分析。
 *
 * 中止：每格开始前探一次 `isBatchAborted`，中止后**保留已算格**并返回（与难度曲线 / 海选同语义）。
 */
export async function computeCinemaUpliftGrid(
  scenario: AnalysisContext,
  opts: ComputeCinemaUpliftGridOptions,
): Promise<CinemaUpliftGridResult> {
  const { config } = scenario
  const rows = dedupeGridRows(opts.rows)
  const cols = opts.cols
  const slots = opts.slots ?? [0]
  const maxLevel = opts.maxLevel ?? 6
  const includeFree = opts.includeFree === true
  const report = batchReporter(opts)

  const cells: CinemaUpliftGridCell[] = []
  const total = Math.max(1, opts.presets.length * rows.length * cols.length)
  let done = 0

  /**
   * **整张网格统一锁值**（`lockMode: 'grid'` / 数字）：在跑循环**之前**量一次。
   * 取第一行「不吃 buff」列的 C0 基线（`cols[0]` 约定恒为不吃，见 `GridColSpec`）。
   * `lockMode: 'row'`（缺省）时为 `null`，每行各自量。
   */
  const gridLock = opts.lockMode === 'grid'
    ? (rows.length > 0 && opts.presets.length > 0
      ? readRowLock(scenario, opts.presets[0]!, rows[0]!, cols[0])
      : 0)
    : (typeof opts.lockMode === 'number' ? Math.max(0, Math.floor(opts.lockMode)) : null)

  for (const preset of opts.presets) {
    for (const row of rows) {
      /**
       * **整行统一锁值**（2026-10-20 修，用户报「提升有时候会跳变」）。
       *
       * 原实现是**每格各取自己的 C0 基线**当锁值 ⇒ 同一行内不同 buff 列的锁值会不同
       * （实测「异构·基塔布鲁」行：不吃 4 窗、破御/锋刃 5 窗），于是 C1 的**基线本身**就不一样
       * ——C0→C1 增益从 7.04% 跳到 11.83%，看起来像算错，其实是两个不同的场景。
       * 锁的全部意义就是「把场景钉死、只让命座变」⇒ 锁值必须是**行的属性**，不是格的属性。
       *
       * 取哪一列定锁值 = 第一列（约定恒为「不吃 buff」，见 `GridColSpec`）。
       * 这样「吃 buff 让失衡次数变多」不会被顺手当成锁值差异掺进来（它是被观测的效应，不是尺子）。
       */
      const lock = gridLock ?? readRowLock(scenario, preset, row, cols[0])
      for (const col of cols) {
        if (isBatchAborted(opts.control)) {
          return finish(cells, rows, cols, slots[0] ?? 0, maxLevel, opts.presets[0]?.team[slots[0] ?? 0] ?? '')
        }
        report(done / total, `${preset.id} · ${row.boss.name} · ${col.label}`)
        // ① 队伍（复位到预设基础档：0命1精 + 预设音擎/驱动盘/权重/交互）
        applyTeamToStore(config, preset)
        // ② 房间（敌人参数 + 该期关卡固有 buff）
        applyBossRoom(config, row.boss, row.phase)
        // ③ 当期可选牌（整表替换；关卡 buff 由 applyBossRoom 保留）
        applyBuffToStore(config, col.card)

        /**
         * ④ 锁口径的失衡次数 = **整行统一**的 `lock`（见上方注释）。
         * ⚠ 字段名沿用 `baseStunCount`，语义已改为「行级锁值」；同时记下该格自己的自由收敛值
         * `ownFreeStunCount`——它与 `lock` 的差正是「吃这张牌让失衡次数变了几次」，
         * 是**被观测的效应**，不参与锁。
         */
        const baseStunCount = lock
        const ownFreeStunCount = readFreeStunCount(scenario)

        const lockedRows = await analyzeCinemaUplift(scenario, {
          targetStunCount: lock,
          slots,
          maxLevel,
          resolveName: opts.resolveName,
          control: opts.control,
        })
        const lockedEntries = lockedRows[0]?.entries ?? []

        let freeEntries: CinemaUpliftEntry[] | null = null
        let freeStunCounts: { base: number; top: number } | null = null
        if (includeFree) {
          applyTeamToStore(config, preset)
          applyBossRoom(config, row.boss, row.phase)
          applyBuffToStore(config, col.card)
          const freeBase = readFreeStunCount(scenario)
          const freeRows = await analyzeCinemaUplift(scenario, {
            targetStunCount: 0, // 0 = 不锁
            slots,
            maxLevel,
            resolveName: opts.resolveName,
            control: opts.control,
          })
          freeEntries = freeRows[0]?.entries ?? []
          const freeTop = readFreeStunCount(scenario)
          freeStunCounts = { base: freeBase, top: freeTop }
        }

        const lockedTotalPct = cumulativeUpliftPct(lockedEntries)
        const freeTotalPct = freeEntries ? cumulativeUpliftPct(freeEntries) : null
        cells.push({
          id: `${preset.id}|${row.boss.id}|${row.phase.phaseId}|${col.id}`,
          presetId: preset.id,
          bossId: row.boss.id,
          bossName: row.boss.name,
          phaseId: row.phase.phaseId,
          phaseLabel: row.phase.label,
          colId: col.id,
          colLabel: col.label,
          baseStunCount,
          ownFreeStunCount,
          lockedEntries,
          lockedTotalPct,
          freeEntries,
          freeTotalPct,
          stunChannelDeltaPct: freeTotalPct == null ? null : freeTotalPct - lockedTotalPct,
          freeStunCounts,
        })
        done++
      }
    }
  }

  report(1, '完成')
  return finish(cells, rows, cols, slots[0] ?? 0, maxLevel, opts.presets[0]?.team[slots[0] ?? 0] ?? '')
}

/** 收尾：把行/列标签按**实际产物顺序**拼好（中止时只报已算格涉及的行列，不假装全算完） */
function finish(
  cells: CinemaUpliftGridCell[],
  rows: readonly GridRowSpec[],
  cols: readonly GridColSpec[],
  slot: number,
  maxLevel: number,
  agentId: string,
): CinemaUpliftGridResult {
  const seenRows = new Set(cells.map(c => `${c.bossId}|${c.phaseId}`))
  const seenCols = new Set(cells.map(c => c.colId))
  const rowLabels = rows.filter(r => seenRows.has(`${r.boss.id}|${r.phase.phaseId}`)).map(r => `${r.boss.name} · ${r.phase.label}`)
  const colLabels = cols.filter(c => seenCols.has(c.id)).map(c => c.label)
  return { cells, rowLabels, colLabels, slot, agentId, maxLevel }
}

/** 读该场景当前配置自由收敛的失衡次数（`stunCountLock` 必须已复位；`analyzeCinemaUplift` 内部会复位） */
function readFreeStunCount(scenario: AnalysisContext): number {
  return scenario.calc.stunPoolResult.value?.stunCount ?? 0
}

/**
 * **行级锁值**（2026-10-20）：套好队 + 进房间 + 上「定锁」那一列（约定 = 第一列「不吃 buff」），
 * 读 C0 基线的自由失衡次数。
 *
 * 为什么必须整行统一，见 `CinemaUpliftGridCell.baseStunCount` 的注释：
 * 每格各取自己的基线会让同行内 C1 的基线不同，用户看到的是「提升率跳变」。
 */
function readRowLock(
  scenario: AnalysisContext,
  preset: TeamPreset,
  row: GridRowSpec,
  lockCol: GridColSpec | undefined,
): number {
  const { config } = scenario
  applyTeamToStore(config, preset)
  applyBossRoom(config, row.boss, row.phase)
  applyBuffToStore(config, lockCol?.card ?? null)
  return readFreeStunCount(scenario)
}
