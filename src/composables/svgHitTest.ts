/**
 * SVG 最近点命中测试（2026-09-12 评审 #14 第九刀，与第六刀的坐标归一化同族）。
 *
 * 为什么抽：Chart 1/3/4/7 的悬浮处理各自抄了同一段「按 x 找最近点」循环
 * （`let best=-1; let bestDist=Infinity; pts.forEach((p,i)=>{ const d=Math.abs(p.x-svgX); if(d<bestDist){...} })`），
 * 连同各自的容差阈值一起复制了四份。
 *
 * ⚠ **容差系数是有差异的，本模块把它显式参数化**（不是所有图都用 2）：
 * - Chart 1（时间线）：`plotW / 点数`（**factor = 1**）
 * - Chart 3/7（版本轴）：`(plotW / 点数) × 2`（factor = 2）
 * - Chart 4（菲林经济）：`(plotW / 点数) × 2`（factor = 2）
 * 抽取时**逐字保留**各自系数（零行为）；Chart 1 用 1 倍是否属有意（节点更密）未经确认，
 * 故不做统一，只在调用点显式写出系数，便于将来核对。
 */
export interface NearestByX {
  /** 最近点的下标；无点时 -1 */
  index: number
  /** 该点到目标 x 的距离；无点时为 Infinity */
  distance: number
}

/** 按 x 找最近点（并列时取先出现的，与 forEach + `<` 的原始语义一致） */
export function nearestIndexByX(points: ReadonlyArray<{ x: number }>, svgX: number): NearestByX {
  let index = -1
  let distance = Infinity
  for (let i = 0; i < points.length; i++) {
    const d = Math.abs(points[i].x - svgX)
    if (d < distance) {
      distance = d
      index = i
    }
  }
  return { index, distance }
}

/**
 * x 命中容差：`(plotW / max(1, 点数)) × factor`。
 * 点数 0 时用 max(1,…) 防除零（与原始实现一致）。
 */
export function xHitTolerance(plotW: number, count: number, factor: number): number {
  return (plotW / Math.max(1, count)) * factor
}
