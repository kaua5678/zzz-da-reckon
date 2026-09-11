/**
 * 版本轴上的两张图的几何/标度：Chart 3「每期新角色 · 强队强度」与 Chart 7「同槽位角色对比」
 * （纯计算，2026-09-12 评审 #14 第三刀）。
 *
 * 为什么两张图放一起：它们**共用同一条版本轴**——Chart 7 的散点 x 直接用 Chart 3 的
 * `chart3X`（`scPts` 里的 `chart3X(idx) + offset`）。拆成两个模块会把这条共享轴复制两份，
 * 故此处显式提供 `versionXOf` / `versionXTicksOf` 作为两图共用的单一事实源。
 *
 * 口径要点（与抽取前逐条一致；改动即为口径变更）：
 * - 版本轴按**节点索引等距**（`i/(total-1)`；total ≤ 1 时居中），x 轴标签按 `ceil(total/maxTicks)` 抽稀；
 * - Chart 3 纵轴：0 起、上限 = `ceil(max(100, 峰值×1.05)/step)*step`（step 50 或 100）；
 * - Chart 7 纵轴**不看 Boss 血量**，只贴合可见折线的伤害范围并留 ±8% 边距；
 *   范围退化（max-min < 1e-9）时向两侧各撑 1，避免除零；
 * - Chart 7 刻度用「优美步长」1/2/5×10^n（目标 4~5 条网格线），起点上取整到步长整数倍；
 * - 两图散点都按「同节点多队伍横向错开」：Chart 3 间距 7px、Chart 7 间距 14px（刻意不同）。
 */
import type { VersionNode } from '@/data/versionTimeline'
import {
  hpRatioYGridOf,
  hpRatioYLabelOf,
  hpRatioYMaxOf,
  hpRatioYOf,
  hpRatioYStepOf,
  type PlotBox,
} from './hpRatioAxis'

// 纵轴口径与 Chart 1/Chart 4 共享（见 hpRatioAxis.ts）；此处保留同名导出以免调用方改动
export type { PlotBox }

// ---------------- 共享：版本轴 ----------------

/** 版本轴 x：按节点索引等距；total ≤ 1 时居中 */
export function versionXOf(index: number, total: number, padL: number, plotW: number): number {
  if (total <= 1) return padL + plotW / 2
  return padL + (index / (total - 1)) * plotW
}

/** 版本号刻度：抽稀到 maxTicks 个（保留前若干个索引 + 标签） */
export function versionXTicksOf(
  versionNodes: ReadonlyArray<VersionNode>,
  maxTicks: number,
): Array<{ index: number; label: string }> {
  const step = Math.max(1, Math.ceil(versionNodes.length / maxTicks))
  const out: Array<{ index: number; label: string }> = []
  for (let i = 0; i < versionNodes.length; i += step) out.push({ index: i, label: versionNodes[i].label })
  return out
}

// ---------------- Chart 3：每期新角色 · 强队强度 ----------------

/** 纵轴上限：0 起，向上取整到 50/100 的整数倍（与 Chart 1 同款口径） */
// 委托共享纵轴（Chart 1/3/4 同口径，单一事实源在 hpRatioAxis.ts）
export const chart3YMaxOf = hpRatioYMaxOf
export const chart3YStepOf = hpRatioYStepOf
export const chart3YOf = hpRatioYOf
export const chart3YGridOf = hpRatioYGridOf
export const chart3YLabelOf = hpRatioYLabelOf

export interface Chart3ScatterInput<P> {
  points: ReadonlyArray<P>
  /** 节点 id → 版本轴下标 */
  nodeIndexOf: (nodeId: string) => number
  yMax: number
  box: PlotBox
  padL: number
  plotW: number
  versionTotal: number
  /** 队伍 → 颜色（注入以保持本模块无 catalog 依赖） */
  colorOf: (teamKey: string) => string
  nameOf: (agentId: string) => string
}

/**
 * Chart 3 散点：同节点多队伍横向错开（7px）。返回项含渲染与悬浮卡所需字段。
 */
export function buildChart3Scatter<P extends { nodeId: string; hpRatio: number; team: string[]; charName: string; nodeLabel: string; teamIndex: number; damage: number; goldLabel: string }>(
  input: Chart3ScatterInput<P>,
): Array<{
  x: number; y: number; color: string; charName: string; nodeLabel: string
  teamNames: string[]; teamNo: number; damage: number; hpRatio: number; goldLabel: string
}> {
  const { points, nodeIndexOf, yMax, box, padL, plotW, versionTotal, colorOf, nameOf } = input
  const perNode = new Map<string, number>()
  for (const p of points) perNode.set(p.nodeId, (perNode.get(p.nodeId) ?? 0) + 1)
  const seen = new Map<string, number>()
  return points.map(p => {
    const idx = nodeIndexOf(p.nodeId)
    const total = perNode.get(p.nodeId) ?? 1
    const k = seen.get(p.nodeId) ?? 0
    seen.set(p.nodeId, k + 1)
    const offset = (k - (total - 1) / 2) * 7
    return {
      x: versionXOf(idx, versionTotal, padL, plotW) + offset,
      y: chart3YOf(Math.min(p.hpRatio, yMax), yMax, box),
      color: colorOf(p.team.join(',')),
      charName: p.charName,
      nodeLabel: p.nodeLabel,
      teamNames: p.team.map(nameOf),
      teamNo: p.teamIndex + 1,
      damage: p.damage,
      hpRatio: p.hpRatio,
      goldLabel: p.goldLabel,
    }
  })
}

// ---------------- Chart 7：同槽位角色对比 ----------------

export interface YRange { min: number; max: number }

/** 纵轴范围：只贴合可见折线的伤害（±8% 边距）；退化范围向两侧撑 1 防除零 */
export function scYRangeOf(visibleValues: ReadonlyArray<number>): YRange {
  const vals = visibleValues
  if (vals.length === 0) return { min: 0, max: 1 }
  let min = Math.min(...vals)
  let max = Math.max(...vals)
  if (max - min < 1e-9) {
    min -= 1
    max += 1
  }
  const pad = (max - min) * 0.08
  return { min: min - pad, max: max + pad }
}

/** 优美刻度步长（1/2/5×10^n），目标 4~5 条网格线 */
export function niceStep(raw: number): number {
  if (raw <= 0) return 1
  const pow = Math.pow(10, Math.floor(Math.log10(raw)))
  const m = raw / pow
  const nice = m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10
  return nice * pow
}

export function scYStepOf(range: YRange): number {
  return niceStep((range.max - range.min) / 4)
}

export function scYOf(v: number, range: YRange, box: PlotBox): number {
  return box.padT + box.plotH - ((v - range.min) / (range.max - range.min)) * box.plotH
}

/** 网格线起点（上取整到步长整数倍） */
export function scGridStartOf(range: YRange, step: number): number {
  return Math.ceil(range.min / step) * step
}

export function scYGridOf(range: YRange, box: PlotBox): number[] {
  const step = scYStepOf(range)
  const start = scGridStartOf(range, step)
  const out: number[] = []
  for (let v = start; v <= range.max + 1e-9; v += step) out.push(scYOf(v, range, box))
  return out
}

export function scYLabelOf(i: number, range: YRange, fmt: (n: number) => string): string {
  const step = scYStepOf(range)
  return fmt(scGridStartOf(range, step) + i * step)
}

export interface SlotComparePointLike {
  nodeId: string
  damageA: number
  damageB: number
}

/** Chart 7 散点：同节点多支援组合横向错开（14px，刻意与 Chart 3 的 7px 不同） */
export function buildScPts<P extends SlotComparePointLike>(
  points: ReadonlyArray<P>,
  opts: {
    nodeIndexOf: (nodeId: string) => number
    range: YRange
    box: PlotBox
    padL: number
    plotW: number
    versionTotal: number
  },
): Array<P & { x: number; yA: number; yB: number }> {
  const { nodeIndexOf, range, box, padL, plotW, versionTotal } = opts
  const perNode = new Map<string, number>()
  for (const p of points) perNode.set(p.nodeId, (perNode.get(p.nodeId) ?? 0) + 1)
  const seen = new Map<string, number>()
  return points.map(p => {
    const idx = nodeIndexOf(p.nodeId)
    const total = perNode.get(p.nodeId) ?? 1
    const k = seen.get(p.nodeId) ?? 0
    seen.set(p.nodeId, k + 1)
    const offset = (k - (total - 1) / 2) * 14
    return {
      ...p,
      x: versionXOf(idx, versionTotal, padL, plotW) + offset,
      yA: scYOf(p.damageA, range, box),
      yB: scYOf(p.damageB, range, box),
    }
  })
}

/** 折线 points 串（SVG polyline 用） */
export function linePointsOf<T>(pts: ReadonlyArray<T>, pick: (p: T) => { x: number; y: number }): string {
  return pts.map(p => { const { x, y } = pick(p); return `${x},${y}` }).join(' ')
}
