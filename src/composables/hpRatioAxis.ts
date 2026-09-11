/**
 * 「血量% 纵轴」共享标度（2026-09-12 评审 #14 第四刀时发现第 3 份拷贝后抽出）。
 *
 * 为什么抽：Chart 1（队伍强度随版本演变）、Chart 3（每期新角色·强队强度）、
 * Chart 4（菲林经济模拟）**三张图的纵轴口径完全相同**——
 *   `上限 = ceil(max(100, 峰值×1.05) / step) * step`，`step = 上限≤200 ? 50 : 100`，0 起底、线性映射。
 * 抽取前这段公式在 `timelineChart.ts` / `versionChartGeometry.ts` 各有一份，Chart 4 内联一份；
 * 三份拷贝意味着「改步长口径」要改三处（且极易漏改 —— 与规则 11 的跨文件常量问题同源）。
 *
 * 口径（三图必须一致；改动即为三图同时变更）：
 * - 上限**至少 100**（击杀线总要可见），峰值预留 5% 余量后向上取整到步长整数倍；
 * - 步长两档：上限 ≤200 用 50，否则 100；
 * - y 映射：0 落在绘图区底边、上限落在顶边（与 Chart 7 的「贴合可见范围」口径**不同**，别混）。
 */

export interface PlotBox {
  padT: number
  plotH: number
}

/** 纵轴上限：至少 100，峰值 ×1.05 后向上取整到 50/100 的整数倍 */
export function hpRatioYMaxOf(ratios: ReadonlyArray<number>): number {
  const maxR = Math.max(...(ratios.length ? ratios : [0]), 0)
  const target = Math.max(100, maxR * 1.05)
  const step = target <= 200 ? 50 : 100
  return Math.ceil(target / step) * step
}

/** 步长（由上限反推，保证与 hpRatioYMaxOf 的取整口径同源） */
export function hpRatioYStepOf(yMax: number): number {
  return yMax <= 200 ? 50 : 100
}

/** 值 → y 像素（0 贴底、上限贴顶） */
export function hpRatioYOf(v: number, yMax: number, box: PlotBox): number {
  return box.padT + box.plotH - (v / yMax) * box.plotH
}

/** 网格线 y 列表（0..上限，步长同上） */
export function hpRatioYGridOf(yMax: number, box: PlotBox): number[] {
  const step = hpRatioYStepOf(yMax)
  const out: number[] = []
  for (let v = 0; v <= yMax; v += step) out.push(hpRatioYOf(v, yMax, box))
  return out
}

/** 第 i 条网格线的**数值**标签（与 hpRatioYGridOf 同源：同一个 step 与起点） */
export function hpRatioYLabelOf(i: number, yMax: number): number {
  return i * hpRatioYStepOf(yMax)
}
