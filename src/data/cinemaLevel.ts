/**
 * 影画（命座）等级的唯一归一口（CC-506，r688）。**零 import**：core / mechanics / 编排层 / 展示层共用。
 *
 * 口径：0..6 整数，缺省 0 = 无影画（store `config.ts#setCinemaLevel` 已夹 `Math.max(0, Math.min(6, level))`，
 * UI 滑块 0..6）。此前 agents 下 ≥ 75 处各写一遍 `Math.max(0, Math.floor(Number(cfg.<角色>CinemaLevel ?? 0)))`
 * （phoenix 用 `whole(Number(… ?? 0))`，4 处省掉 `Number`），与 CC-503 潜能等级同一病：规则没有名字就会有第 76 份。
 * 生产输入恒为 0..6 整数，各副本只在垃圾输入上分叉，这里统一为：
 *   - `null` / `undefined` / 非有限数 ⇒ 0（旧 `Math.max(0, Math.floor(Number(NaN)))` 会原样漏出 NaN，`whole` 给 0；按 `whole`）；
 *   - 其余 ⇒ `floor` 后夹到 [0, 6]（旧写法不封顶 6；store 已封顶，生产取不到 > 6）。
 * 不归这里：直接把 store 值透传给钩子 / 面板的 `char.cinemaLevel ?? 0`（那是缺省而非归一；sigrid.ts:256 明示「不 floor / 不 clamp」）。
 * 若日后要改边角语义，只改这里。
 */
export const CINEMA_LEVEL_MIN = 0
export const CINEMA_LEVEL_MAX = 6

export function cinemaLevelOf(value: unknown): number {
  if (value == null) return CINEMA_LEVEL_MIN
  const n = Number(value)
  if (!Number.isFinite(n)) return CINEMA_LEVEL_MIN
  return Math.max(CINEMA_LEVEL_MIN, Math.min(CINEMA_LEVEL_MAX, Math.floor(n)))
}
