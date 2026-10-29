/**
 * 失衡轴编辑器（StunAxisPage）读取的轴派生量（CC-50，2026-09-27，判据 7 还款）。
 *
 * ⚠ 诚实标注：`axisWindowCounts` 目前是 core `allocateAxisWindows` 的**纯转发**，只是把依赖挪到编排层，
 *    耦合没有实质降低。之所以不能改读 useResourceCalc 的现成结果：页面在手动模式下用的是**编辑中的**
 *    `configStore.stunAxes`，而求解侧 `resolvedAxes` 在求解器回退（forceNoAxis）时会被清空，两者不总相等。
 *    日后若有其它编辑器派生量（窗口起止、轴内时长等），也放在这里。
 */
import { allocateAxisWindows, axisKindOf } from '@/core/stunAxisStack'
import type { StunAxisKind } from '@/types/resource'

/**
 * 各轴实际分到的失衡窗口数（与栈引擎同口径）。
 * 分配规则见 `core/stunAxisStack#allocateAxisWindows`：**末尾优先（tail 先占 1 窗）→ 固定次数
 * → 尽量打（bestEffort 0-1 窗）→ 兜底（末条 fallback 吃剩余）**。
 */
export function axisWindowCounts(
  axes: ReadonlyArray<{ readonly kind?: StunAxisKind; readonly count?: number }>,
  stunCount: number,
): number[] {
  return allocateAxisWindows(axes, stunCount)
}

/**
 * 轴类型（缺省标签时按 `count` 推断，与引擎同源）。
 * 页面用它显示类型标签 —— 用户口径 2026-10-14：「加标签吧，**不要隐藏逻辑**」。
 */
export function axisKindOfView(axis: { readonly kind?: StunAxisKind; readonly count?: number }): StunAxisKind {
  return axisKindOf(axis)
}

/**
 * @fact ui:失衡轴页/块标签 口径: 动作块宽 = 招式时长 ⇒ 名字放不下时**不许切字**：放得下写块里、放不下排到该角色道下方的标签行（同排不重叠）；「放得下」按**实测轴宽**折算的每字秒数判，且只判**名字**（时长是可收缩尾巴，块里放不下时先挤掉它） | 据 用户@2026-10-29（「动作块也短小，写字也不清不楚」） | 验 src/composables/__tests__/stunAxisView.test.ts | 锚 src/composables/stunAxisView.ts#layoutBlockLabels | 信 确认
 * ⟳复核: 若把标签行改回「块内截断」、或块内字号/轴宽口径变了（每字秒数 = 字号×窗口时长÷轴宽），复核本条与 layoutBlockLabels 的两个分母 | 到期 2027-04-30
 *
 * 动作块标签的**分行**（2026-10-29，用户报「捏轴这里动作块也短小，写字也不清不楚」）。
 *
 * 病灶：块宽 = 招式时长。0.3s 的平A 在 20s 窗口里只有约 2% 宽（≈20px），而「强特：焚夜·曦生」
 * 要 88px —— 旧实现在块内 `overflow:hidden` + 省略号**切掉**，名字永远读不全。
 *
 * 口径：**名字不许被切**。放得下就写在块里（`inside[i] = true`），放不下就排到道下方的
 * **标签行**（同一排不重叠，行号从 0 起）。
 *
 * ⚠ 判定与分行都用**秒**，不测像素——与 `stunAxisEventLanes#layoutEventMarkers` 同一口径
 *   （页面上不引 ResizeObserver）。每字占秒数 = `字符宽 × 窗口时长 ÷ 假定轴宽`，
 *   假定轴宽缺省 **1000px**（本仓数据密集页面的保守下限）：宁可多排一行，也不重叠。
 *   一个汉字 ≈ 1em ⇒ 字宽取 11px（= 块内字号），拉丁字符更窄 ⇒ 偏保守。
 */
export function layoutBlockLabels(
  blocks: ReadonlyArray<{ start: number; dur: number; text: string }>,
  maxDur: number,
  assumedPx = 1000,
  charPx = 11,
): { rows: number; inside: boolean[]; row: number[]; need: number[]; at: number[] } {
  const win = Math.max(0, Number(maxDur) || 0)
  const charSec = win * charPx / Math.max(1, assumedPx)
  const need = blocks.map(b => b.text.length * charSec)
  // 放得下 = 块时长 ≥ 文字需要的时长（含 ×次数 与时长后缀，由调用方一起算进 text）
  const inside = blocks.map((b, i) => (Number(b.dur) || 0) >= need[i]!)
  const row: number[] = blocks.map(() => 0)
  /** 标签实际落点（秒）：贴着窗口右端的块左移到「还放得下」处，避免整条名字捅出轴外 */
  const at: number[] = blocks.map(b => Math.max(0, Number(b.start) || 0))
  const rowEnds: number[] = []
  blocks.forEach((b, i) => {
    if (inside[i]) return // 块内文字不占标签行，也不参与它的分行
    const start = Math.min(Math.max(0, Number(b.start) || 0), Math.max(0, win - need[i]!))
    at[i] = start
    let r = 0
    while (r < rowEnds.length && start < rowEnds[r]! + 0.05) r += 1
    rowEnds[r] = start + need[i]!
    row[i] = r
  })
  return { rows: rowEnds.length, inside, row, need, at }
}
