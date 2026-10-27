/**
 * 折线逐档标注的垂直避让（2026-10-27，从自由对比页抽出）
 *
 * 为什么需要：同一 x 上要标多条线（用户：「一个 x 轴只显示了一个提升幅度，把三个人全显示」），
 * 而同 x 的标签共用圆心 x ⇒ 水平必然重叠，只能按点的 y 从上到下错开。
 * 口径：
 * - 按**点的 y** 升序（屏幕上到下）排，不按系列顺序（否则标签会跳到别的点旁边）；
 * - 相邻标签至少隔 `gap`（默认 13px = 10px 字 + 3px 间隙）；
 * - 靠顶（`y < topBound`）翻到点下方 16px，避免出画；
 * - 纯函数、不改入参，图表页可直接复用；返回 `key = id-level`（与页面 v-for 稳定）。
 */
export interface StepLabelPoint {
  /** 稳定 id（通常 = 系列 id） */
  id: string
  /** 点的屏幕坐标 */
  x: number
  y: number
  /** 原始提升%（由调用方按 stepGainsOf 口径算好） */
  gain: number
  /** 标签颜色（通常 = 系列色） */
  color: string
}

export interface StepLabel {
  key: string
  x: number
  y: number
  text: string
  color: string
}

export interface StepLabelOptions {
  /** 档位下标（拼 key 用） */
  level: number
  /** 屏幕上方安全边界：y 小于它的点把标签翻到下方 */
  topBound: number
  /** 相邻标签最小垂直间距（px），默认 13 */
  gap?: number
  /** 文本格式（如 formatSignedDeltaPercent） */
  format: (gain: number) => string
}

export function layoutStepLabels(
  points: ReadonlyArray<StepLabelPoint>,
  opts: StepLabelOptions,
): StepLabel[] {
  const gap = opts.gap ?? 13
  const sorted = [...points].sort((a, b) => a.y - b.y)
  const out: StepLabel[] = []
  let floor = Number.NEGATIVE_INFINITY
  for (const p of sorted) {
    let y = p.y < opts.topBound ? p.y + 16 : p.y - 9
    if (y < floor + gap) y = floor + gap
    floor = y
    out.push({ key: `${p.id}-${opts.level}`, x: p.x, y, text: opts.format(p.gain), color: p.color })
  }
  return out
}
