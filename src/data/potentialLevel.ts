/**
 * 潜能觉醒等级的唯一归一口（CC-503，r685）。**零 import**：core / mechanics / 编排层 / 展示层共用。
 *
 * 口径：1..6 整数，缺省 6 = 满档（UI 滑块 `TeamConfigPage.vue` min 1 / max 6、store 默认 6）。
 * 此前这条规则在 agents 下 ≥ 12 处各写一遍 `Math.max(1, Math.min(6, Math.floor(Number(potentialLevel ?? 6))))`
 * （harumasa 用 `whole`、jane 自带 `clampPotential`、anbyZero 无缺省），core/panel.ts 还有一份不 floor 的——
 * 生产输入恒为 1..6 整数，各副本只在垃圾输入上分叉，这里统一为：
 *   - `null` / `undefined` / 非有限数 ⇒ 缺省 6（与 jane `clampPotential` 一致）；
 *   - 其余 ⇒ `floor` 后夹到 [1, 6]（0 ⇒ 1；harumasa 旧 `|| 6` 曾把 0 当缺省，生产取不到 0，按多数派）。
 * 若日后要改边角语义，只改这里。
 */
export const POTENTIAL_LEVEL_MIN = 1
export const POTENTIAL_LEVEL_MAX = 6
export const POTENTIAL_LEVEL_DEFAULT = 6

export function potentialLevelOf(value: unknown): number {
  if (value == null) return POTENTIAL_LEVEL_DEFAULT
  const n = Number(value)
  if (!Number.isFinite(n)) return POTENTIAL_LEVEL_DEFAULT
  return Math.max(POTENTIAL_LEVEL_MIN, Math.min(POTENTIAL_LEVEL_MAX, Math.floor(n)))
}
