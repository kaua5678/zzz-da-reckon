/**
 * 自由对比 · 视图层（数据集 → 视角）
 *
 * 用户口径（2026-10-17）：「我的不同对比只是预设了不同参数，想从不同的视角分析多次计算的某项数据」。
 * 所以这里**不重新求值**：同一份 `FreeCompareResult` 只做投影——
 * 表格 / 折线 / 切片网格 / 3D / 相对基准差值，全部从同一组 `slices[].series[].values` 读。
 * 视图切换只改 `AnalysisView`，不触发引擎。
 */

import type { FreeCompareResult, FreeCompareSlice } from './engine'

/** 结果页可切换的视角（不新增求值类型；都是同一数据集的投影） */
export type AnalysisView = 'table' | 'long' | 'line' | 'grid' | '3d' | 'delta' | 'step'

export interface AnalysisViewDef {
  id: AnalysisView
  label: string
  hint: string
  /** 需要至少 2 个切片才有意义（单切片 = 与折线重复） */
  needSlices?: boolean
  /** 需要至少 N 个 x 档位才有意义（两档对比至少要 2 档） */
  needLevels?: number
}

export const ANALYSIS_VIEWS: AnalysisViewDef[] = [
  { id: 'table', label: '表格', hint: '当前切片的逐档数值 + 每档最优' },
  { id: 'long', label: '长表', hint: '同一份结果摊平：x × 切片 × 系列，可导出 CSV' },
  { id: 'line', label: '折线', hint: '当前切片的 2D 曲线（系列显隐共用）' },
  { id: 'grid', label: '切片', hint: '全部切片并排，纵轴共用；点面板切当前片', needSlices: true },
  { id: '3d', label: '3D', hint: '切片叠成深度轴；点折线切当前片', needSlices: true },
  { id: 'delta', label: '差值', hint: '相对选中基准**系列**的百分比差（同一档位上 系列 A vs 系列 B）' },
  {
    id: 'step',
    label: '两档对比',
    hint: '选一个起点档和一个终点档（如 30 → 11），逐系列给「绝对值 → 绝对值 / 差值 / 提升%」——不用自己抄数字做除法',
    needLevels: 2,
  },
]

/**
 * 当前结果可用的视角（无切片时隐藏切片/3D；档位不足 2 时隐藏两档对比）。
 * 两个门槛都是**结构性**的（不是偏好）：少于 2 片 / 2 档时那个视角画出来必然与折线重复或全空。
 */
export function availableViews(sliceCount: number, levelCount = Number.POSITIVE_INFINITY): AnalysisView[] {
  return ANALYSIS_VIEWS
    .filter(v => !v.needSlices || sliceCount > 1)
    .filter(v => !v.needLevels || levelCount >= v.needLevels)
    .map(v => v.id)
}

/** 切换结果后若当前视角不再可用（如从多切片回到单切片），回落到折线 */
export function fallbackView(view: AnalysisView, sliceCount: number, levelCount = Number.POSITIVE_INFINITY): AnalysisView {
  return availableViews(sliceCount, levelCount).includes(view) ? view : 'line'
}

/** 当前选中的切片（id 失效时回落第一片；空结果 = null） */
export function selectedSliceOf(result: FreeCompareResult | null, sliceId: string): FreeCompareSlice | null {
  if (!result) return null
  return result.slices.find(s => s.id === sliceId) ?? result.slices[0] ?? null
}

/** 图例项（跨切片相同；取第一片的输出系列，buff 拆分也在这里） */
export function seriesItemsOf(result: FreeCompareResult | null): Array<{ id: string; label: string }> {
  return (result?.series ?? []).map(s => ({ id: s.id, label: s.label }))
}

/** 差值基准候选（全部输出系列，不因图例隐藏而消失——隐藏基准仍可作为比较对象） */
export function baselineOptionsOf(result: FreeCompareResult | null): Array<{ value: string; label: string }> {
  return (result?.series ?? []).map(s => ({ value: s.id, label: s.label }))
}

/** 默认基准 = 第一个输出系列 */
export function defaultBaselineId(result: FreeCompareResult | null): string {
  return result?.series[0]?.id ?? ''
}

export interface DeltaSeries {
  id: string
  label: string
  values: Array<number | null>
}

export interface DeltaPanel {
  id: string
  label: string
  series: DeltaSeries[]
}

/**
 * 相对基准的差值面板：`(值 − 基准值) / |基准值| × 100`。
 * - 基准缺失 / 基准为 0 / 任一值 null ⇒ 该点 null（折线断开，不落到底部伪装成一个值）；
 * - `visibleIds` 只过滤被画的系列，**基准仍按未过滤的系列查**（隐藏基准线不该让差值变成 NaN）；
 * - 无切片时单片 label = 全部，与折线/表格同屏不冲突。
 */
export function deltaPanelsOf(
  result: FreeCompareResult,
  baselineId: string,
  visibleIds?: ReadonlySet<string>,
): DeltaPanel[] {
  return result.slices.map(slice => {
    const base = slice.series.find(s => s.id === baselineId)
    const series = slice.series
      .filter(s => !visibleIds || visibleIds.has(s.id))
      .map(s => ({
        id: s.id,
        label: s.label,
        values: s.values.map((v, i) => {
          const b = base?.values[i]
          if (v === null || b === null || b === undefined || !Number.isFinite(b) || Math.abs(b) < 1e-9) return null
          return ((v - b) / Math.abs(b)) * 100
        }),
      }))
    return { id: slice.id, label: slice.label || '全部', series }
  })
}

/** 差值视图的刻度文本（始终一位小数 + %，避免浮点噪声外露） */
export function formatDeltaPercent(v: number): string {
  return v.toFixed(1) + '%'
}

/**
 * 两档对比只需要「档位 + 每系列的取值」这两样，**不要求整份 FreeCompareResult**
 * （组件传的是「当前切片 + 图例过滤后」的系列子集，不是 `result.series`）。
 */
export interface LevelDeltaSource {
  levels: ReadonlyArray<{ label: string }>
  series: ReadonlyArray<{ id: string; label: string; values: ReadonlyArray<number | null> }>
}

/** 两档对比的一行（一个系列在「起点档 → 终点档」之间的变化） */
export interface LevelDeltaRow {
  seriesId: string
  label: string
  /** 起点档读数（null = 该档无读数） */
  fromValue: number | null
  /** 终点档读数 */
  toValue: number | null
  /** 差值 = 终点 − 起点（与指标同单位）；任一缺失 ⇒ null */
  delta: number | null
  /** 提升% = (终点 − 起点) / |起点| × 100；起点为 0/缺失 ⇒ null（不落成 Infinity 或 0） */
  pct: number | null
}

/**
 * 两档对比：把「同一个系列在起点档 vs 终点档」摊成一行。
 *
 * 用户口径（2026-10-25 逐字）：「我对比了多个配置，我想知道某个配置到某个配置是进步了多少，
 * 现在这个就看不了，还得我抄写数字再做除法。」
 *
 * 与既有的「差值」视角（`deltaPanelsOf`）**不是一回事**，别合并：
 * · 差值 = 同一 x 档位上「系列 A vs 系列 B」——比较的是**队**；
 * · 两档 = 同一系列内「x=A 档 vs x=B 档」——比较的是**配置**。
 * 两者都存在的理由：用户同时会问「这两队谁强」和「这套配置升到那套赚多少」。
 *
 * 口径细节：
 * - 档位下标越界 / 相等 ⇒ 全部行 null（不是回落到相邻档——那会让用户以为比的是他选的）；
 * - 起点 |值| < 1e-9 ⇒ pct 为 null（除零无意义），但 `delta` 仍给（绝对差仍然可读）；
 * - 分母取 |起点|：指标里有「越小越好」的量（前台秒数等），用带符号分母会把方向拧反。
 */
export function levelDeltaRowsOf(
  result: LevelDeltaSource,
  fromIndex: number,
  toIndex: number,
): LevelDeltaRow[] {
  const levels = result.levels.length
  const valid = fromIndex >= 0 && toIndex >= 0 && fromIndex < levels && toIndex < levels && fromIndex !== toIndex
  return result.series.map(s => {
    if (!valid) return { seriesId: s.id, label: s.label, fromValue: null, toValue: null, delta: null, pct: null }
    const a = s.values[fromIndex] ?? null
    const b = s.values[toIndex] ?? null
    if (a === null || b === null) {
      return { seriesId: s.id, label: s.label, fromValue: a, toValue: b, delta: null, pct: null }
    }
    const delta = b - a
    // 分母取 |起点|（见函数注释）；起点为 0 ⇒ 百分比无意义，但绝对差仍可读
    const pct = Math.abs(a) >= 1e-9 ? (delta / Math.abs(a)) * 100 : null
    return { seriesId: s.id, label: s.label, fromValue: a, toValue: b, delta, pct }
  })
}

/**
 * 逐档提升%（**相邻**两档，不是任选两档）——图上的「+x.x%」标注与汇总表小字共用这一份口径。
 *
 * 与 `levelDeltaRowsOf` 的区别：那个比较用户选的起点/终点（比配置），这里固定比「上一档」；
 * 数学完全相同（分母取 |上一档|，除零/缺失 ⇒ null），只是把 6 次两两比较一次摊开。
 * 返回与 `series` 同序；下标 0 恒 null（第一档没有「前面」）。
 */
export function stepGainsOf(
  series: ReadonlyArray<{ values: ReadonlyArray<number | null> }>,
  levelCount: number,
): Array<Array<number | null>> {
  return series.map(s => {
    const out: Array<number | null> = Array.from({ length: levelCount }, () => null)
    for (let i = 1; i < levelCount; i++) {
      const a = s.values[i - 1]
      const b = s.values[i]
      if (a === null || a === undefined || b === null || b === undefined) continue
      if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a) < 1e-9) continue
      out[i] = ((b - a) / Math.abs(a)) * 100
    }
    return out
  })
}

/**
 * 每一档「提升最大」的系列下标（图上只标这一条，避免 3 条线 × 6 档 = 18 个标签糊成一片）。
 * - 无读数的档 ⇒ -1（调用方跳过）；
 * - 升/降方向按指标的 `higherBetter` 判（越小越好的指标，下降才是改进）；
 * - 并列取**先出现的那个**（图例顺序稳定 ⇒ 标注不会闪烁）。
 */
export function bestStepIndexByLevel(
  gains: ReadonlyArray<ReadonlyArray<number | null>>,
  higherBetter = true,
): number[] {
  const levelCount = Math.max(0, ...gains.map(g => g.length))
  const out: number[] = []
  for (let i = 0; i < levelCount; i++) {
    let best = -1
    let bestScore = Number.NEGATIVE_INFINITY
    gains.forEach((g, si) => {
      const v = g[i]
      if (v === null || v === undefined || !Number.isFinite(v)) return
      const score = higherBetter ? v : -v
      if (score > bestScore + 1e-12) {
        bestScore = score
        best = si
      }
    })
    out.push(best)
  }
  return out
}

/** 带符号的提升%文本（+3.4% / -1.2%）；与 `formatDeltaPercent` 同一位数口径 */
export function formatSignedDeltaPercent(v: number): string {
  return (v >= 0 ? '+' : '') + formatDeltaPercent(v)
}

/** 两档对比的档位下拉选项（label 直接用轴档位名，如 30 / 11 / 精3） */
export function levelOptionsOf(result: Pick<FreeCompareResult, 'levels'> | null): Array<{ value: number; label: string }> {
  return (result?.levels ?? []).map((lv, i) => ({ value: i, label: lv.label }))
}

