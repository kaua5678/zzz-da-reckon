/**
 * 「限定 S 首次 UP × 版本直伤系数」图的几何与标度（纯计算，2026-09-12 评审 #14 抽取）。
 *
 * 为什么抽出来：这段逻辑原先内联在 `views/TimeChartsPage.vue`（3319 行，仓库最大文件）里，
 * 约 140 行，与模板/响应式状态混在一起，只能靠「起 dev server 点开图表」验证；
 * 抽成纯函数工厂后可用合成输入单测边界（合并卡池 2 格宽、空数据回落到 0.7/1.3、
 * 同节点标签纵向错开、跨版本刻度只标首个节点、测试服节点最少 8px 宽）。
 *
 * 口径要点（与抽取前逐条一致，改动即为口径变更）：
 * - 横轴按**节点宽度权重**排布：合并卡池（phaseLabel='合并'）占 2 格，上半/下半各 1 格
 *   （修「合并版视觉偏窄」：按索引等距时合并版只有普通版一半宽）；
 * - 纵轴范围**至少**覆盖 0.7~1.3，再按数据外扩 ±0.03（即 clamp 后的自适应）；
 * - 三档语义由阈值定义：>1.05 加强 / <0.95 削弱 / 其余持平（颜色与图例筛选同一把尺）；
 * - 标签只在 |v-1| > 0.05 时出现；同节点多个标签按**加入顺序**纵向错开 13px。
 */
import type { VersionNode } from '@/data/versionTimeline'
import type { DirectDamagePoint } from '@/composables/multiplierCoefficients'

/** 画布留白与高度（常量：改动会改变该图观感，故集中在此并配单测） */
export const DD_CHART_LAYOUT = {
  padL: 46,
  padR: 18,
  padT: 18,
  padB: 32,
  svgH: 268,
} as const

/** 纵轴固定刻度（与自适应范围正交：刻度线只画在这些位置） */
export const DD_Y_TICKS = [0.75, 0.9, 1.0, 1.1, 1.25] as const

/** 三档 id（散点颜色即档位语义） */
export const DD_BAND = { boost: 'boost', flat: 'flat', weak: 'weak' } as const
export type DDBandId = (typeof DD_BAND)[keyof typeof DD_BAND]

/** 图例定义（顺序即图例顺序） */
export const DD_BAND_DEFS = [
  { id: DD_BAND.boost, label: '加强档 >105%', desc: '当期直伤特调上调', color: '#7dd3fc' },
  { id: DD_BAND.flat, label: '持平 ≈100%', desc: '无直伤特调', color: 'var(--fg-3)' },
  { id: DD_BAND.weak, label: '削弱档 <95%', desc: '当期直伤特调下调', color: '#fdba74' },
] as const

/** 某点属于哪一档（null 值点无档位语义，调用方应先过滤） */
export function ddBandOf(v: number): DDBandId {
  if (v > 1.05) return DD_BAND.boost
  if (v < 0.95) return DD_BAND.weak
  return DD_BAND.flat
}

/** 散点颜色（与分档阈值同源：>1.05 / <0.95 / 其余） */
export function ddColor(v: number): string {
  if (v > 1.05) return '#7dd3fc'
  if (v < 0.95) return '#fdba74'
  return 'var(--wa-550)'
}

/** 是否给该点标数值（偏离 1 超过 5% 才标，避免标注糊成一片） */
export function ddNeedLabel(v: number): boolean {
  return Math.abs(v - 1) > 0.05
}

/** 角色名截断（去书名号；超过 6 字截断加省略号） */
export function ddShortName(name: string): string {
  const cleaned = name.replace(/「|」/g, '')
  return cleaned.length > 6 ? `${cleaned.slice(0, 6)}…` : cleaned
}

/** 同节点散点的水平抖动（对 agentId 做稳定哈希 → [-12, +12] 内 4 的倍数，同角色恒定） */
export function ddJitter(agentId: string): number {
  let h = 0
  for (let i = 0; i < agentId.length; i++) h = (h * 31 + agentId.charCodeAt(i)) | 0
  return ((h % 7) - 3) * 4
}

/** 节点宽度权重：合并卡池占 2 格，其余 1 格 */
export function ddNodeWidthsOf(versionNodes: ReadonlyArray<VersionNode>): number[] {
  return versionNodes.map(n => (n.phaseLabel === '合并' ? 2 : 1))
}

/** 每个版本只保留首个节点（版本号刻度用） */
export function ddXTicksOf(versionNodes: ReadonlyArray<VersionNode>): Array<{ index: number; label: string }> {
  const seen = new Set<string>()
  return versionNodes
    .map((n, index) => ({ index, label: n.version }))
    .filter(({ label }) => {
      if (seen.has(label)) return false
      seen.add(label)
      return true
    })
}

/** 同节点多标签的纵向槽位（agentId → 槽序号，按 ddPoints 顺序分配） */
export function ddLabelSlotsOf(points: ReadonlyArray<DirectDamagePoint>): Map<string, number> {
  const groups = new Map<number, string[]>()
  for (const p of points) {
    if (p.value == null || !ddNeedLabel(p.value)) continue
    const arr = groups.get(p.nodeIndex) ?? []
    arr.push(p.agentId)
    groups.set(p.nodeIndex, arr)
  }
  const m = new Map<string, number>()
  for (const [, ids] of groups) ids.forEach((id, i) => m.set(id, i))
  return m
}

export interface DirectDamageChart {
  padL: number
  padR: number
  padT: number
  padB: number
  svgH: number
  plotBottom: number
  nodeWidths: number[]
  totalWidth: number
  /** 节点列左缘/中心（占绘图区宽度的比例） */
  lefts: number[]
  centers: number[]
  /** 绘图区宽度（= svgW - padL - padR） */
  plotSpan: number
  /** 节点列左缘像素 */
  x(nodeIndex: number): number
  /** 节点列中心像素（散点 / 标签） */
  cx(nodeIndex: number): number
  /** 版本列中心像素（tick 文字；firstIndex = 该版本首节点下标） */
  tickCenterX(firstIndex: number): number
  vMin: number
  vMax: number
  y(v: number): number
  yTicks: readonly number[]
  xTicks: Array<{ index: number; label: string }>
  /** 测试服节点阴影矩形（最少 8px 宽） */
  testServerRects: Array<{ x: number; w: number }>
  /** 标签槽位（全量计算，不随图例筛选变化） */
  labelSlots: Map<string, number>
  /** 标签纵坐标（≥1 标上方、<1 标下方，按槽位再错开） */
  labelY(p: DirectDamagePoint): number
}

/**
 * 组装该图的全部几何/标度读数。纯函数：给定 (points, svgW, versionNodes) 输出确定结果。
 */
export function buildDirectDamageChart(input: {
  points: ReadonlyArray<DirectDamagePoint>
  svgW: number
  versionNodes: ReadonlyArray<VersionNode>
}): DirectDamageChart {
  const { points, svgW, versionNodes } = input
  const { padL, padR, padT, padB, svgH } = DD_CHART_LAYOUT
  const plotBottom = svgH - padB

  const nodeWidths = ddNodeWidthsOf(versionNodes)
  const totalWidth = nodeWidths.reduce((a, b) => a + b, 0)
  const lefts: number[] = []
  const centers: number[] = []
  {
    let acc = 0
    for (const w of nodeWidths) {
      lefts.push(acc / totalWidth)
      centers.push((acc + w / 2) / totalWidth)
      acc += w
    }
  }

  const plotSpan = svgW - padL - padR
  const x = (nodeIndex: number) => padL + (lefts[nodeIndex] ?? 0) * plotSpan
  const cx = (nodeIndex: number) => padL + (centers[nodeIndex] ?? 0) * plotSpan
  const tickCenterX = (firstIndex: number) => {
    let w = 0
    for (let j = firstIndex; j < versionNodes.length && versionNodes[j].version === versionNodes[firstIndex].version; j++) w += nodeWidths[j]
    // 量纲必须一致：lefts 是**比例**（0..1），故半宽 w/2 也要除以 totalWidth 才是比例。
    // 2026-09-12 修复（抽取时由单测发现）：原式写成 `lefts[first] + w/2`，把「格数」当「比例」用，
    // 真实数据下刻度被推到画布外（首个版本 982 vs 应为 70，偏差 912px ⇒ 刻度文字不可见）。
    return padL + (lefts[firstIndex] + (w / 2) / totalWidth) * plotSpan
  }

  // 纵轴：至少覆盖 0.7~1.3，再按数据外扩 ±0.03
  const vs = points.map(p => p.value).filter((v): v is number => v != null)
  const vMin = Math.min(0.7, ...(vs.length ? vs : [0.7])) - 0.03
  const vMax = Math.max(1.3, ...(vs.length ? vs : [1.3])) + 0.03
  const y = (v: number) => {
    const span = vMax - vMin
    return padT + (1 - (v - vMin) / span) * (plotBottom - padT)
  }

  const testServerRects: Array<{ x: number; w: number }> = []
  versionNodes.forEach((n, index) => {
    if (!(n.note ?? '').includes('测试服')) return
    const w = (nodeWidths[index] / totalWidth) * plotSpan
    testServerRects.push({ x: x(index), w: Math.max(8, w) })
  })

  const labelSlots = ddLabelSlotsOf(points)
  const labelY = (p: DirectDamagePoint) => {
    const v = p.value ?? 1
    const slot = labelSlots.get(p.agentId) ?? 0
    return v >= 1 ? y(v) - (9 + slot * 13) : y(v) + 16 + slot * 13
  }

  return {
    padL, padR, padT, padB, svgH, plotBottom,
    nodeWidths, totalWidth, lefts, centers, plotSpan,
    x, cx, tickCenterX,
    vMin, vMax, y, yTicks: DD_Y_TICKS, xTicks: ddXTicksOf(versionNodes),
    testServerRects, labelSlots, labelY,
  }
}
