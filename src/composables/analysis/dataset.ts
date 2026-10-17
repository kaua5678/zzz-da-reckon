/**
 * 分析长表：把一次求值的结果摊平成「x × 切片 × 系列 → 值」的行，供表格/CSV/后续跨页视图共用。
 *
 * 为什么需要它：工作台的五个视角都从 `FreeCompareResult.slices[].series[].values` 读，
 * 但「一份结果」在数据层没有统一形状——每加一个页面/分析类型就要再写一套透视。
 * 长表是中间层：求值器只产出它，视图只消费行；新增分析类型（队伍加金/时间线/膨胀）
 * 只需实现「结果 → 行」的适配器，表格/CSV/差值等视图不必知道来源。
 *
 * 本文件是纯函数，不碰 store/组件；UI 的单元格格式化仍留在页面（`formatMetric`）。
 */
import { DEFAULT_AXIS_ID, type AxisLevel } from '@/composables/freeCompare/axes'
import type { FreeCompareResult, FreeCompareSeries, FreeCompareSlice } from '@/composables/freeCompare/engine'
import type { TimelineNodeResult } from '@/composables/teamTimeline'

/** 长表适配只需这些字段（完整 FreeCompareResult 结构性兼容，便于调用方直传） */
export type FreeCompareDatasetInput = Pick<
  FreeCompareResult,
  'levels' | 'slices' | 'axisLabel' | 'sliceLabel' | 'metricId' | 'metricLabel'
>

export interface AnalysisRow {
  /** x 的排序键（数值；标签另存，避免把「21」当数字） */
  x: number
  xLabel: string
  sliceId: string
  /** 无切片时为空串（视图显示「全部」） */
  sliceLabel: string
  seriesId: string
  seriesLabel: string
  value: number | null
  /** 来源系列（buff 拆分后同组共享；跨页适配也用它认原始实体） */
  baseId: string
  /** 该行吃的当期 buff 牌标题；null = 本体 */
  buffTitle: string | null
}

export interface AnalysisDataset {
  rows: AnalysisRow[]
  xLabel: string
  /** 切片维度名；null = 单切片（没有切片维度） */
  sliceLabel: string | null
  measure: {
    id: string
    label: string
    /** 展示格式（导入结果用；百分比读数这里用 0~100，unit 留空，避免 formatMetric 再乘 100） */
    unit?: '' | '%' | ' /s'
    digits?: number
    higherBetter?: boolean
  }
}

/**
 * 自由对比结果 → 长表。顺序 = x 档位 → 切片 → 系列（与汇总表/切片表同源），
 * 保证 CSV 与界面逐行一致；缺失读数保留 null（不填 0，否则差值/均值会静默读错）。
 */
export function datasetFromFreeCompare(input: FreeCompareDatasetInput): AnalysisDataset {
  const rows: AnalysisRow[] = []
  input.levels.forEach((level, i) => {
    for (const slice of input.slices) {
      for (const s of slice.series) {
        rows.push({
          x: level.x,
          xLabel: level.label,
          sliceId: slice.id,
          sliceLabel: slice.label,
          seriesId: s.id,
          seriesLabel: s.label,
          value: s.values[i] ?? null,
          baseId: s.baseId,
          buffTitle: s.buffTitle,
        })
      }
    }
  })
  return {
    rows,
    xLabel: input.axisLabel,
    sliceLabel: input.sliceLabel,
    measure: { id: input.metricId, label: input.metricLabel },
  }
}

export type TeamGoldMetric = 'damage' | 'hpRatio'

export interface TeamGoldPointInput {
  presetId: string
  presetName: string
  goldCount: number
  damage: number
  hpRatio: number
  buffTitle?: string
}

/** 队伍对比结果 → 长表：x = 限定金，系列 = 队伍；一行一个「队伍 × 金数」 */
export function datasetFromTeamGold(
  points: ReadonlyArray<TeamGoldPointInput>,
  opts: { metric: TeamGoldMetric },
): AnalysisDataset {
  const measure = opts.metric === 'damage'
    ? { id: 'teamGoldDamage', label: '队伍加金伤害', digits: 0, higherBetter: true }
    : { id: 'teamGoldHpRatio', label: '伤害/血量%', digits: 1, higherBetter: true }
  const order = new Map<string, number>()
  for (const p of points) if (!order.has(p.presetId)) order.set(p.presetId, order.size)
  const rows = points.map(p => ({
    x: p.goldCount,
    xLabel: p.goldCount + '金',
    sliceId: '',
    sliceLabel: '',
    seriesId: p.presetId,
    seriesLabel: p.presetName,
    value: opts.metric === 'damage' ? p.damage : p.hpRatio,
    baseId: p.presetId,
    buffTitle: p.buffTitle ?? null,
  })).sort((a, b) => a.x - b.x || (order.get(a.seriesId) ?? 0) - (order.get(b.seriesId) ?? 0))
  return { rows, xLabel: '限定金', sliceLabel: null, measure }
}

export interface TimelineDatasetInput {
  /** 时间图表固定主C；系列按主C收敛成一条「每期最优队」包络线 */
  mainAgentId: string
  mainName: string
  nodes: ReadonlyArray<Pick<TimelineNodeResult, 'nodeLabel' | 'damage' | 'hpRatio'>>
}

/** 时间图表结果 → 长表：x = 版本/期数序号，系列 = 主C（值 = 当期最优队的伤害/血量%） */
export function datasetFromTimeline(
  input: TimelineDatasetInput,
  opts: { metric: 'damage' | 'hpRatio' },
): AnalysisDataset {
  const measure = opts.metric === 'damage'
    ? { id: 'timelineDamage', label: '队伍伤害', digits: 0, higherBetter: true }
    : { id: 'timelineHpRatio', label: '伤害/血量%', digits: 1, higherBetter: true }
  const rows = input.nodes.map((n, i) => ({
    x: i,
    xLabel: n.nodeLabel,
    sliceId: '',
    sliceLabel: '',
    seriesId: input.mainAgentId,
    seriesLabel: input.mainName,
    value: opts.metric === 'damage' ? n.damage : n.hpRatio,
    baseId: input.mainAgentId,
    buffTitle: null,
  }))
  return { rows, xLabel: '版本/期数', sliceLabel: null, measure }
}

export interface BossInflationSeriesInput {
  id: string
  name: string
  points: ReadonlyArray<{ seasonIdx: number; coeff: number }>
}

/** 血量膨胀图 → 长表：x = 期数序号，系列 = Boss；值 = 版本血量系数 */
export function datasetFromBossInflation(
  series: ReadonlyArray<BossInflationSeriesInput>,
  opts: { seasonLabel: (idx: number) => string },
): AnalysisDataset {
  const rows = series.flatMap(s => s.points.map(p => ({
    x: p.seasonIdx,
    xLabel: opts.seasonLabel(p.seasonIdx) || String(p.seasonIdx),
    sliceId: '',
    sliceLabel: '',
    seriesId: s.id,
    seriesLabel: s.name,
    value: p.coeff,
    baseId: s.id,
    buffTitle: null,
  }))).sort((a, b) => a.x - b.x)
  return {
    rows,
    xLabel: '期数',
    sliceLabel: null,
    measure: { id: 'bossHpCoeff', label: '血量版本系数%', digits: 1, higherBetter: true },
  }
}

/**
 * 长表 → 合成 FreeCompareResult：让导入结果直接复用工作台的表格/折线/差值/长表视图
 * （不跑引擎；求值次数为 0，环境摘要明确写「导入」）。
 * - x 升序；切片/系列按首次出现序；缺失组合补 null（不填 0）；
 * - 系列取所有切片的并集，`series` = 第一片（与 FreeCompareResult 的契约一致）。
 */
export function resultFromDataset(dataset: AnalysisDataset): FreeCompareResult {
  const xValues = [...new Set(dataset.rows.map(r => r.x))].sort((a, b) => a - b)
  const xLabels = new Map<number, string>()
  for (const r of dataset.rows) if (!xLabels.has(r.x)) xLabels.set(r.x, r.xLabel)
  const levels: AxisLevel[] = xValues.map(x => ({
    x,
    label: xLabels.get(x) ?? String(x),
    override: {},
  }))
  const sliceOrder: Array<{ id: string; label: string }> = []
  const seriesOrder: Array<{ id: string; label: string; baseId: string; buffTitle: string | null }> = []
  for (const r of dataset.rows) {
    if (!sliceOrder.some(s => s.id === r.sliceId)) sliceOrder.push({ id: r.sliceId, label: r.sliceLabel })
    if (!seriesOrder.some(s => s.id === r.seriesId)) {
      seriesOrder.push({ id: r.seriesId, label: r.seriesLabel, baseId: r.baseId, buffTitle: r.buffTitle })
    }
  }
  const valueAt = new Map<string, number | null>()
  for (const r of dataset.rows) valueAt.set(r.x + '\u0000' + r.sliceId + '\u0000' + r.seriesId, r.value)
  const slices: FreeCompareSlice[] = sliceOrder.map(sl => ({
    id: sl.id,
    label: sl.label,
    series: seriesOrder.map(s => {
      const values = xValues.map(x => valueAt.get(x + '\u0000' + sl.id + '\u0000' + s.id) ?? null)
      return {
        id: s.id,
        label: s.label,
        baseId: s.baseId,
        buffTitle: s.buffTitle,
        values,
        skipped: values.filter(v => v === null).length,
      } satisfies FreeCompareSeries
    }),
  }))
  const series = slices[0]?.series ?? []
  return {
    axisId: DEFAULT_AXIS_ID,
    axisLabel: dataset.xLabel,
    levels,
    series,
    slices,
    sliceLabel: dataset.sliceLabel,
    metricId: dataset.measure.id,
    metricLabel: dataset.measure.label,
    durationMs: 0,
    evaluations: 0,
    skipped: series.reduce((n, s) => n + s.skipped, 0),
    pickEvaluations: 0,
    environmentSummary: '导入自其他页面的分析结果（只读，未重新求值）',
  }
}
/** CSV 单元格：逗号/引号/换行必须转义（RFC 4180），否则一行会被拆成两列或两行 */
function csvCell(text: string): string {
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text
}

/**
 * 长表 → CSV（UTF-8 BOM + CRLF，Excel 打开中文不乱码）。
 * 数值保留原始精度（分析用），不在这里做展示格式化——展示格式化是视图的事。
 */
export function datasetCsv(dataset: AnalysisDataset): string {
  const head = ['x', 'x标签', '切片', '系列', '值（' + dataset.measure.label + '）']
  const lines = [head.map(csvCell).join(',')]
  for (const r of dataset.rows) {
    lines.push([
      String(r.x),
      r.xLabel,
      r.sliceLabel || '全部',
      r.seriesLabel,
      r.value === null ? '' : String(r.value),
    ].map(csvCell).join(','))
  }
  return '\ufeff' + lines.join('\r\n') + '\r\n'
}
