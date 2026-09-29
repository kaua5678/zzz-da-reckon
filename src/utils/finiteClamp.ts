/**
 * 数值钳位的单一实现（CC-280，第 295 轮）。
 *
 * 此前 20 个角色模块各自私抄了同一对 3 行 helper（jscpd 跨文件克隆的主体）。这里只收**逐字同义**的版本：
 * 非有限值（NaN / ±Infinity / undefined）一律按 0 处理。
 *
 * ⚠ 故意**没有**收进来的同名 / 近名 helper（语义不同，合并会改行为）：
 * - `clamp01(v) = max(0, min(1, v))`（severian / phoenix / lycaon / sigrid / data/deadlyAssaultScore）与 hugo 的
 *   `clampRatio`：不挡 NaN（NaN 进 NaN 出），+Infinity → 1；
 * - anby 的 `clampRatio`：`Number(v) || 0`，+Infinity → 1；
 * - ben 的 `clamp01(value, fallback = 1)`：非有限值回落到 fallback（默认 1，不是 0）。
 */

/** 比例钳到 [0, 1]；非有限值 → 0。 */
export function clampRatio(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
}

/** 向下取整到非负整数；非有限值 / undefined → 0。 */
export function whole(value: number | undefined): number {
  const n = value ?? 0
  return Math.max(0, Math.floor(Number.isFinite(n) ? n : 0))
}
