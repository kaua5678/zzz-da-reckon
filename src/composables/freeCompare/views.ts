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
export type AnalysisView = 'table' | 'long' | 'line' | 'grid' | '3d' | 'delta'

export interface AnalysisViewDef {
  id: AnalysisView
  label: string
  hint: string
  /** 需要至少 2 个切片才有意义（单切片 = 与折线重复） */
  needSlices?: boolean
}

export const ANALYSIS_VIEWS: AnalysisViewDef[] = [
  { id: 'table', label: '表格', hint: '当前切片的逐档数值 + 每档最优' },
  { id: 'long', label: '长表', hint: '同一份结果摊平：x × 切片 × 系列，可导出 CSV' },
  { id: 'line', label: '折线', hint: '当前切片的 2D 曲线（系列显隐共用）' },
  { id: 'grid', label: '切片', hint: '全部切片并排，纵轴共用；点面板切当前片', needSlices: true },
  { id: '3d', label: '3D', hint: '切片叠成深度轴；点折线切当前片', needSlices: true },
  { id: 'delta', label: '差值', hint: '相对选中基准的百分比差（看增幅/差距，不看绝对值）' },
]

/** 当前结果可用的视角（无切片时隐藏切片/3D，避免与折线重复） */
export function availableViews(sliceCount: number): AnalysisView[] {
  return ANALYSIS_VIEWS
    .filter(v => !v.needSlices || sliceCount > 1)
    .map(v => v.id)
}

/** 切换结果后若当前视角不再可用（如从多切片回到单切片），回落到折线 */
export function fallbackView(view: AnalysisView, sliceCount: number): AnalysisView {
  return availableViews(sliceCount).includes(view) ? view : 'line'
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

