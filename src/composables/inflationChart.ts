/**
 * 环境膨胀图的几何/标度（纯计算）。
 *
 * 图型：x = 版本节点（等距，复用 `versionXOf`），y = **环境膨胀指数**（%），
 * 折线 = 各版本 Boss 平均血量（归一，首版本 = 100%）；
 * 叠加标记 = 每位限定 S 的**首池节点**（回答「这名角色实装时环境已膨胀到几成」）。
 *
 * 口径要点：
 * - y 轴**不是** `hpRatioAxis` 的「血量%」（那个是伤害/血量 ×100，0 起底）；
 *   本图 y = 指数百分比，**从 100 起底**（首版本基准）更贴题——用「优美步长」1/2/5×10^n
 *   取 4~6 条网格线，起点下取整到步长整数倍（与 Chart 7 的「贴合可见范围」同族手法）。
 * - x 用**版本节点全序**（VERSION_NODES 的索引）而非「只含有数据的版本」：
 *   否则角色实装节点与 Boss 数据版本对不齐（如某版本无 defense 样本会整体左移）。
 * - 角色标记只画有 `environmentIndex` 的（无环境数据的**不画**，不猜位置）。
 */
import { VERSION_NODES } from '@/data/versionTimeline'
import { versionXOf, type PlotBox } from './versionChartGeometry'
import type { InflationPoint, InflationSeries, ReleaseStrengthPoint } from './inflationCurve'

export interface InflationChartLayout extends PlotBox {
  padL: number
  padR: number
  padT: number
  padB: number
  plotW: number
  /** 绘图区底边 y（= padT + plotH） */
  bottom: number
}

export const INFLATION_LAYOUT: InflationChartLayout = {
  padL: 54,
  padR: 16,
  padT: 18,
  padB: 34,
  plotH: 260,
  plotW: 0,   // 由调用方按容器宽算；0 = 未设（scaleX 会退化为 padL）
  bottom: 278,
}

/** 「优美步长」1/2/5 × 10^n，目标 4~6 条网格线 */
export function niceStep(range: number, targetTicks = 5): number {
  if (!(range > 0)) return 1
  const raw = range / Math.max(1, targetTicks)
  const mag = 10 ** Math.floor(Math.log10(raw))
  const norm = raw / mag
  const mult = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10
  return mult * mag
}

export interface InflationYAxis {
  /** 轴下限（≤100，向下取整到步长整数倍） */
  min: number
  /** 轴上限（≥ 峰值，向上取整） */
  max: number
  step: number
  /** 网格线数值（升序） */
  ticks: number[]
}

/**
 * y 轴范围：**下限包含 100 且 100 不贴底**（首版本基准线要看得出来），上限覆盖峰值并留 5% 余量。
 *
 * 为什么 100 不能正好贴底（实测踩到）：首版本 index 恒 = 100，若 `min` 取到 100（步长整除时
 * 必然如此），基准线就落在绘图区底边上、与 x 轴重合 ⇒ 视觉上「没有基准线」，
 * 而这条线正是本图「相对起点涨了多少」的锚。故当 `min === 100` 时**再下探一个步长**
 * （100 → 0 或 50 之类），给基准线留出可辨识的余量。
 */
export function inflationYAxisOf(indexes: ReadonlyArray<number>): InflationYAxis {
  const vals = indexes.filter(v => Number.isFinite(v))
  const peak = vals.length ? Math.max(...vals) : 100
  const low = Math.min(100, ...(vals.length ? vals : [100]))
  const step = niceStep(Math.max(peak * 1.05 - low, 1), 5)
  const max = Math.ceil((peak * 1.05) / step) * step
  let min = Math.floor(low / step) * step
  // 基准线不贴底：min 与 100 重合或过近时再让一档（至少留 8% 绘图高，视觉上可辨）
  if (max - min > 0 && (100 - min) / (max - min) < 0.08) min = 100 - step
  const ticks: number[] = []
  for (let v = min; v <= max + 1e-9; v += step) ticks.push(Number(v.toFixed(6)))
  return { min, max, step, ticks }
}

/** 指数值 → y 像素（min 贴底、max 贴顶） */
export function inflationYOf(v: number, axis: InflationYAxis, box: PlotBox): number {
  const span = axis.max - axis.min
  if (!(span > 0)) return box.padT + box.plotH / 2
  return box.padT + box.plotH - ((v - axis.min) / span) * box.plotH
}

/** 版本 id → x 像素（用 VERSION_NODES 的全序索引；未知版本返回 null） */
export function inflationVersionXOf(version: string, layout: InflationChartLayout): number | null {
  const idx = VERSION_NODES.findIndex(n => n.version === version)
  if (idx < 0) return null
  return versionXOf(idx, VERSION_NODES.length, layout.padL, layout.plotW)
}

export interface InflationChartModel {
  layout: InflationChartLayout
  axis: InflationYAxis
  /** 折线点（含 x/y）；只含能定位到版本节点的点 */
  line: Array<{ version: string; index: number; x: number; y: number; point: InflationPoint }>
  /** `line` 的 polyline points 字符串 */
  linePoints: string
  /** 首版本基准线的 y（若 100 在范围内） */
  baseY: number | null
  /** 角色首池标记（只含有环境指数的） */
  markers: Array<{
    agentId: string
    agentName: string
    version: string
    environmentIndex: number
    x: number
    y: number
    /** 强度锚点百分数（仅展示用；**不是**强度结论，见 inflationCurve 文件头） */
    valuePct: number | null
  }>
  /** x 轴刻度（版本标签，抽稀到 maxTicks） */
  xTicks: Array<{ x: number; label: string }>
}

/**
 * 组装整张图（纯函数：输入数据 + 布局 → 可直绘的坐标）。
 *
 * @param series 膨胀序列（`buildInflationSeries`）
 * @param releases 角色首池锚（`buildReleaseStrengths`；无则传空数组）
 * @param width 容器宽度（算 plotW）
 * @param maxXTicks x 轴标签上限（抽稀）
 */
export function buildInflationChart(
  series: InflationSeries,
  releases: ReadonlyArray<ReleaseStrengthPoint>,
  width: number,
  maxXTicks = 12,
): InflationChartModel {
  const layout: InflationChartLayout = {
    ...INFLATION_LAYOUT,
    plotW: Math.max(120, width - INFLATION_LAYOUT.padL - INFLATION_LAYOUT.padR),
    bottom: INFLATION_LAYOUT.padT + INFLATION_LAYOUT.plotH,
  }
  const axis = inflationYAxisOf(series.points.map(p => p.index))

  const line = series.points
    .map(p => {
      const x = inflationVersionXOf(p.version, layout)
      return x == null ? null : { version: p.version, index: p.index, x, y: inflationYOf(p.index, axis, layout), point: p }
    })
    .filter((v): v is NonNullable<typeof v> => v != null)

  const markers = releases
    .filter(r => r.environmentIndex != null)
    .map(r => {
      const x = inflationVersionXOf(r.version, layout)
      return x == null ? null : {
        agentId: r.agentId, agentName: r.agentName, version: r.version,
        environmentIndex: r.environmentIndex!, x,
        y: inflationYOf(r.environmentIndex!, axis, layout),
        valuePct: r.valuePct,
      }
    })
    .filter((v): v is NonNullable<typeof v> => v != null)

  // x 刻度：只标有数据的版本（避免空版本占位），抽稀
  const step = Math.max(1, Math.ceil(line.length / Math.max(1, maxXTicks)))
  const xTicks = line.filter((_, i) => i % step === 0).map(p => ({ x: p.x, label: p.version }))

  return {
    layout,
    axis,
    line,
    linePoints: line.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' '),
    baseY: 100 >= axis.min && 100 <= axis.max ? inflationYOf(100, axis, layout) : null,
    markers,
    xTicks,
  }
}

/** svg 高度（含 x 轴标签区） */
export function inflationSvgHeight(layout: InflationChartLayout = INFLATION_LAYOUT): number {
  return layout.padT + layout.plotH + layout.padB
}

/** svg 宽度（= 容器宽；布局用 viewBox 时与 plotW 自洽） */
export const INFLATION_SVG_WIDTH = 1200
