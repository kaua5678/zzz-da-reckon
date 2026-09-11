/**
 * Chart 4「菲林经济模拟」图的几何/标度（纯计算，2026-09-12 评审 #14 第四刀）。
 *
 * 口径要点（与抽取前逐条一致；改动即为口径变更）：
 * - 主纵轴 = 队伍强度%（与 Chart 1/3 **共享** `hpRatioAxis` 口径：至少 100、峰值 ×1.05、50/100 步长）；
 * - 副纵轴 = 总金数（**独立**缩放：上限 = `max(各点 totalGold, 6)`，至少 6 起步 —— 换言之右轴永远
 *   从 6 金起画，避免早期节点把线压成贴底）；
 * - 横轴按点序等距（`i/(n-1)`；n ≤ 1 时居中）；
 * - **x 轴标签抽稀与 Chart 1/3 不同**：这里额外保证「末点必被标注」（步长不整除点数时补一个末点）。
 */
import type { FilmSimPoint } from '@/composables/teamTimeline'
import { hpRatioYGridOf, hpRatioYLabelOf, hpRatioYMaxOf, hpRatioYOf, type PlotBox } from './hpRatioAxis'

export interface SimChartPoint {
  x: number
  y: number
  color: string
  label: string
  hpRatio: number
  totalGold: number
}

export interface SimChart {
  svgH: number
  /** 主纵轴上限（血量%） */
  yMax: number
  y(v: number): number
  yGrid: number[]
  yLabel(i: number): number
  /** 副纵轴上限（金数），至少 6 */
  goldMax: number
  goldY(g: number): number
  x(i: number): number
  xTicks: Array<{ index: number; label: string }>
  pts: SimChartPoint[]
  hpLine: string
  goldLine: string
}

/** 副纵轴上限：各点总金数最大值，至少 6 */
export function simGoldMaxOf(golds: ReadonlyArray<number>): number {
  return Math.max(...(golds.length ? golds : [6]), 6)
}

export function buildFilmSimChart(input: {
  points: ReadonlyArray<FilmSimPoint>
  svgW: number
  padL: number
  plotW: number
  box: PlotBox
  /** 队伍 key → 颜色（注入以保持本模块无 catalog 依赖） */
  colorOf: (teamKey: string) => string
}): SimChart {
  const { points, padL, plotW, box, colorOf } = input
  const yMax = hpRatioYMaxOf(points.map(p => p.hpRatio))
  const y = (v: number) => hpRatioYOf(v, yMax, box)
  const yGrid = hpRatioYGridOf(yMax, box)
  const yLabel = (i: number) => hpRatioYLabelOf(i, yMax)

  const goldMax = simGoldMaxOf(points.map(p => p.totalGold))
  const goldY = (g: number) => hpRatioYOf(g, goldMax, box)

  const x = (i: number) => {
    const n = points.length
    if (n <= 1) return padL + plotW / 2
    return padL + (i / (n - 1)) * plotW
  }

  const xTicks: Array<{ index: number; label: string }> = []
  {
    const step = Math.max(1, Math.ceil(points.length / 12))
    for (let i = 0; i < points.length; i += step) xTicks.push({ index: i, label: points[i].label })
    const last = points.length - 1
    if (points.length > 1 && last % step !== 0) xTicks.push({ index: last, label: points[last].label })
  }

  const pts: SimChartPoint[] = points.map((p, i) => ({
    x: x(i),
    y: y(Math.min(p.hpRatio, yMax)),
    color: colorOf(p.team.join(',')),
    label: p.label,
    hpRatio: p.hpRatio,
    totalGold: p.totalGold,
  }))

  return {
    svgH: box.padT + box.plotH + 30,
    yMax, y, yGrid, yLabel,
    goldMax, goldY,
    x, xTicks, pts,
    hpLine: pts.map(p => `${p.x},${p.y}`).join(' '),
    goldLine: points.map((p, i) => `${x(i)},${goldY(Math.min(p.totalGold, goldMax))}`).join(' '),
  }
}
