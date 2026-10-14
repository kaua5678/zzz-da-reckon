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
