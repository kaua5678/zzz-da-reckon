/**
 * 失衡窗口两个模块级小算子（CC-493，r677）。
 *
 * 1. `forEachSlotAxisAction`：轴内**计划口径**扫描——按 `AgentAxisContext.axes × windows` 枚举某槽位的轴块，
 *    回调拿到块本体与该轴分到的窗口数 `wins`；块在本轮的计划次数 = `act.count × wins`（乘法留给调用方，
 *    `act.count * wins` / `dur * act.count * wins` 的结合顺序逐位保留）。
 *    ⚠ 与 `AgentAxisContext.actionCountsBySlot` **不是同一个量**：后者是资源门控后的**实际执行**集合
 *    （`convergence.ts` 的 `axisExecutedStack`，窗口数读上一轮池整数）；首轮/资源充足时两者相等，资源不足时执行集合更小。
 *    读哪一个是各模块的产品口径（般岳读执行集合；春正/朱鸢/希格/伊德海莉/比利/仪玄读计划口径）——本 helper 只把
 *    6 份同一段 `axes.forEach((ax, ai) => { const wins = windows[ai] ?? 0; for (act) … if (slot) … })` 收成一份。
 *    **不跳过 0 窗**（比利依赖 0 窗也写键，见 starlightBilly.ts 注释）；春正/朱鸢原有的 `wins <= 0` 提前返回只是
 *    省一次 `+= count × 0`，去掉后数值逐位相同（zd 零差）。
 * 2. `stunWindowCoverage`：失衡窗口覆盖率 = min(1, floor(失衡次数) × 单次窗口秒 / max(1, 战斗秒))。
 *    春正（16 s）/ 朱鸢（16 s）同式各写一份 ⇒ 一份。
 */

export interface AxisScanLike<A extends { readonly slot: number }> {
  readonly axes: ReadonlyArray<{ readonly actions: ReadonlyArray<A> }>
  readonly windows: ReadonlyArray<number>
}

/** 枚举 `slot` 在各轴里的块；`wins` = 该轴分到的窗口数（缺省 0，不跳过）。 */
export function forEachSlotAxisAction<A extends { readonly slot: number }>(
  axis: AxisScanLike<A>,
  slot: number,
  visit: (act: A, wins: number) => void,
): void {
  axis.axes.forEach((ax, ai) => {
    const wins = axis.windows[ai] ?? 0
    for (const act of ax.actions) {
      if (act.slot !== slot) continue
      visit(act, wins)
    }
  })
}

/** 失衡窗口覆盖率：min(1, floor(次数) × 窗口秒 / max(1, 战斗秒))。次数与战斗时间都由派发器给（number；r726 前按 unknown 收、兜 0 次 / 180 s）。 */
export function stunWindowCoverage(stunCount: number, windowSeconds: number, combatTime: number): number {
  const resolvedStun = Math.max(0, Math.floor(stunCount))
  const battle = Math.max(1, combatTime)
  return Math.min(1, resolvedStun * windowSeconds / battle)
}
