/**
 * Chart 1「队伍强度随版本演变」时间线图的几何/标度（纯计算，2026-09-12 评审 #14 第二刀）。
 *
 * 为什么抽出来：这段 ~100 行此前内联在 `views/TimeChartsPage.vue`（3216 行，仓库最大文件）里，
 * 与响应式状态混在一起；抽出后可用**合成节点序列**单测边界（单节点 / 空数据 / 换人段标签 /
 * 轴抽稀 / y 轴步长两档 / 泳道单元格起点）。
 *
 * 口径要点（与抽取前逐条一致；改动即为口径变更）：
 * - 横向**按节点索引等距**（与直伤系数图的"按宽度权重"不同，别混）：`xOf(i) = padL + i/(n-1)*plotW`，
 *   单节点退化为居中；
 * - y 轴上限：`max(100, 峰值×1.05)` 向上取整到 50 或 100 的整数倍（≤200 用 50 步长，否则 100）；
 * - 泳道格子 x：**首格贴 padL**（`i===0 ? padL : padL + i*cellW`，避免浮点误差让首格偏右）；
 * - 换人标签只在该槽位角色**变化处**打一个（连续同角色不重复打）；
 * - x 轴标签按节点数抽稀到 ~14 个，并**保证末节点必被标注**。
 */
import type { TimelineNodeResult } from '@/composables/teamTimeline'

/** 画布留白与泳道尺寸（padT/plotH 与本页 Chart 2/3 共享；改动会同时影响它们） */
export const TIMELINE_LAYOUT = {
  padL: 54,
  padR: 14,
  padT: 26,
  plotH: 300,
  laneH: 22,
  laneGap: 6,
  /** 绘图区与泳道区之间的固定间隔（原字面量 12） */
  laneGapTop: 12,
  xLabelH: 26,
} as const

/** 泳道条数（主C / 队友1 / 队友2） */
export const TIMELINE_LANE_COUNT = 3

/** 三泳道总高度 */
export function timelineLaneTotalH(): number {
  const { laneH, laneGap } = TIMELINE_LAYOUT
  return laneH * TIMELINE_LANE_COUNT + laneGap * (TIMELINE_LANE_COUNT - 1)
}

/** 第 4 条车道（Boss 排期）的 y */
export function timelineBossLaneY(): number {
  const { padT, plotH, laneGapTop, laneGap } = TIMELINE_LAYOUT
  return padT + plotH + laneGapTop + timelineLaneTotalH() + laneGap
}

/** 整体高度 */
export function timelineSvgH(): number {
  const { padT, plotH, laneH, laneGapTop, laneGap, xLabelH } = TIMELINE_LAYOUT
  return padT + plotH + laneGapTop + timelineLaneTotalH() + laneGap + laneH + xLabelH
}

/** 画布宽度：随视口收缩，钳在 480..1180（SSR/无 window 时回落 960） */
export function timelineSvgWidth(innerWidth: number | undefined): number {
  const w = typeof innerWidth === 'number' ? innerWidth : 960
  return Math.max(480, Math.min(1180, w - 120))
}

/** 角色配色板（顺序即哈希取模顺序，改动会改全图配色） */
export const AGENT_PALETTE = [
  '#63e2b7', '#63b3ed', '#f6ad55', '#f687b3', '#b794f4', '#f6e05e', '#4fd1c5', '#fc8181',
  '#68d391', '#90cdf4', '#fbd38d', '#fbb6ce', '#d6bcfa', '#fefcbf', '#81e6d9', '#feb2b2',
] as const

/** agentId → 配色（稳定哈希；空 id 也能得到确定色） */
export function agentColorOf(agentId: string): string {
  let h = 0
  for (let i = 0; i < agentId.length; i++) h = (h * 31 + agentId.charCodeAt(i)) >>> 0
  return AGENT_PALETTE[h % AGENT_PALETTE.length]
}

export interface TimelineLaneCell {
  x: number
  color: string
  /** 该格角色显示名（由调用方注入的 nameOf 解析） */
  name: string
}
export interface TimelineLane {
  key: string
  label: string
  y: number
  cells: TimelineLaneCell[]
  /** 换人标签：每段连续同角色只在本段首格显示 */
  labels: Array<{ x: number; text: string }>
}
export interface TimelineChartPoint {
  x: number
  y: number
  color: string
  isSwap: boolean
}

export interface TimelineChart {
  nodeCount: number
  plotW: number
  cellW: number
  xOf(i: number): number
  yMax: number
  yOf(v: number): number
  /** 各刻度线的 y 坐标（值由 yLabel 给出） */
  yTicks: number[]
  yLabel(i: number): number
  chartPts: TimelineChartPoint[]
  linePoints: string
  swapGuides: Array<{ x: number }>
  laneDefs: TimelineLane[]
  xTicks: Array<{ x: number; label: string }>
  svgH: number
}

/**
 * 组装时间线图的全部几何/标度读数。纯函数：给定 (nodes, svgW, 显示名解析) 输出确定结果。
 * `nameOf` 注入是为了不把 catalog 依赖带进本模块（页面传 `id => catalog.getAgent(id)?.name.zhCN ?? id`）。
 */
export function buildTimelineChart(input: {
  nodes: ReadonlyArray<TimelineNodeResult>
  svgW: number
  nameOf: (agentId: string) => string
  colorOf?: (agentId: string) => string
}): TimelineChart {
  const { nodes, svgW, nameOf } = input
  const color = input.colorOf ?? agentColorOf
  const { padL, padR, padT, plotH, laneGap } = TIMELINE_LAYOUT

  const nodeCount = nodes.length
  const plotW = svgW - padL - padR
  const cellW = nodeCount > 1 ? plotW / nodeCount : plotW
  const xOf = (i: number): number => {
    if (nodeCount <= 1) return padL + plotW / 2
    return padL + (i / (nodeCount - 1)) * plotW
  }

  const maxR = Math.max(...nodes.map(n => n.hpRatio), 0)
  const target = Math.max(100, maxR * 1.05)
  const yStep = target <= 200 ? 50 : 100
  const yMax = Math.ceil(target / yStep) * yStep
  const yOf = (v: number): number => padT + plotH - (v / yMax) * plotH
  const yTicks: number[] = []
  for (let v = 0; v <= yMax; v += yStep) yTicks.push(yOf(v))
  const yLabel = (i: number): number => i * yStep

  const chartPts: TimelineChartPoint[] = nodes.map((n, i) => ({
    x: xOf(i),
    y: yOf(Math.min(n.hpRatio, yMax)),
    color: color(n.team[0]),
    isSwap: !!n.swappedIn,
  }))
  const linePoints = chartPts.map(p => `${p.x},${p.y}`).join(' ')

  const swapGuides = nodes
    .map((n, i) => (n.swappedIn ? { x: xOf(i) } : null))
    .filter((p): p is { x: number } => p !== null)

  const makeLane = (key: string, label: string, slotOf: (n: TimelineNodeResult) => string): TimelineLane => {
    const cells: TimelineLaneCell[] = nodes.map((n, i) => ({
      x: i === 0 ? padL : padL + i * cellW,
      color: color(slotOf(n)),
      name: nameOf(slotOf(n)),
    }))
    // 换人标签：每段连续同色块首格显示角色名
    const labels: Array<{ x: number; text: string }> = []
    let prev: string | null = null
    nodes.forEach((n, i) => {
      const id = slotOf(n)
      if (id !== prev) {
        labels.push({ x: padL + i * cellW + 4, text: nameOf(id) })
        prev = id
      }
    })
    return { key, label, y: 0, cells, labels }
  }
  const laneY = (idx: number) => padT + plotH + TIMELINE_LAYOUT.laneGapTop + idx * (TIMELINE_LAYOUT.laneH + laneGap)
  const laneDefs: TimelineLane[] = [
    { ...makeLane('main', '主C', n => n.team[0]), y: laneY(0) },
    { ...makeLane('t1', '队友1', n => n.team[1]), y: laneY(1) },
    { ...makeLane('t2', '队友2', n => n.team[2]), y: laneY(2) },
  ]

  // X 轴标签：节点多时抽稀（保证末节点必标注）
  const xTicks: Array<{ x: number; label: string }> = []
  if (nodes.length > 0) {
    const step = Math.max(1, Math.ceil(nodes.length / 14))
    for (let i = 0; i < nodes.length; i += step) {
      xTicks.push({ x: xOf(i), label: nodes[i].nodeLabel })
    }
    if ((nodes.length - 1) % step !== 0) {
      xTicks.push({ x: xOf(nodes.length - 1), label: nodes[nodes.length - 1].nodeLabel })
    }
  }

  return {
    nodeCount, plotW, cellW, xOf,
    yMax, yOf, yTicks, yLabel,
    chartPts, linePoints, swapGuides, laneDefs, xTicks,
    svgH: timelineSvgH(),
  }
}
