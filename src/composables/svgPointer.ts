/**
 * SVG 指针坐标归一化（2026-09-12 评审 #14 第六刀）。
 *
 * 为什么抽：本页 4 个图的悬浮处理各自抄了同一段换算——
 *   `rect = currentTarget.getBoundingClientRect(); scale = viewBox宽 / rect.width; svgX = (clientX-rect.left)*scale`
 * （Chart 5 是 Y 轴版本）。四份拷贝意味着「响应式缩放 + 视口偏移」的算法一旦要改（例如加触屏支持、
 * 处理 SVG 被 CSS 缩放的非等比情形）就得改四处。
 *
 * 口径（与四处逐条一致）：SVG 用 `viewBox` 逻辑坐标、实际宽度由 CSS 决定，故
 * `用户坐标 = 视口内相对偏移 × (viewBox 尺寸 / 元素实测尺寸)`。
 * 元素尺寸为 0（隐藏/未布局）时**不除零**：此时返回按 1:1 处理的读数（悬浮本就不会触发，仅防御）。
 */
export interface SvgPointerReading {
  /** 视口内相对 SVG 左上角的偏移（CSS px）——悬浮卡定位用它，别用 svg 坐标 */
  relX: number
  relY: number
  /** 换算到 viewBox 用户坐标（与图上点的 x/y 同坐标系） */
  svgX: number
  svgY: number
  /** 元素实测矩形（悬浮卡边界钳制等仍需它） */
  rect: { left: number; top: number; width: number; height: number }
}

/** 元素尺寸 → 缩放比；尺寸为 0 时退化为 1（防除零/NaN） */
function scaleOf(viewBoxSize: number, elementSize: number): number {
  return elementSize > 0 ? viewBoxSize / elementSize : 1
}

/**
 * 把鼠标事件换算成该 SVG 的 rel / svg 坐标。
 * `viewBox` 传该图的逻辑尺寸（宽度与高度），宽高各自独立缩放（不假设等比）。
 */
export function readSvgPointer(
  e: Pick<MouseEvent, 'clientX' | 'clientY' | 'currentTarget'>,
  viewBox: { w: number; h: number },
): SvgPointerReading {
  const el = e.currentTarget as unknown as { getBoundingClientRect(): DOMRect }
  const r = el.getBoundingClientRect()
  const rect = { left: r.left, top: r.top, width: r.width, height: r.height }
  const relX = e.clientX - rect.left
  const relY = e.clientY - rect.top
  return {
    relX,
    relY,
    svgX: relX * scaleOf(viewBox.w, rect.width),
    svgY: relY * scaleOf(viewBox.h, rect.height),
    rect,
  }
}

/**
 * 悬浮卡落点（2026-09-12 评审 #14 第十一刀）。
 *
 * 四张图的悬浮处理各写了一遍同一公式（`x = min(容器宽 − 卡宽, relX + 12)`、`y = relY + 8`），
 * 且**卡宽取值不一致**（Chart 1/3 用 240、Chart 7/4 用 260）——本条注释把这个差异显式化，
 * 抽取时逐字保留，不在重构里"顺手统一"（那会改变卡片贴右边缘时的换位时机）。
 * `offsetX`/`offsetY` 允许覆盖（当前四张图都是 12/8，参数化只为将来单图微调不必再复制公式）。
 */
export function hoverCardPosition(o: {
  relX: number
  relY: number
  /** 图表容器实测宽度（rect.width） */
  containerWidth: number
  /** 卡片预估宽度（用于贴右边缘时左移；各图取值不同） */
  cardWidth: number
  offsetX?: number
  offsetY?: number
}): { x: number; y: number } {
  return {
    x: Math.min(o.containerWidth - o.cardWidth, o.relX + (o.offsetX ?? 12)),
    y: o.relY + (o.offsetY ?? 8),
  }
}
