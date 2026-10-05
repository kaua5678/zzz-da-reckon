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

/** 非 number / 非有限值 → 0，其余原值（CC-461：此前 qingyi/yixuan/lycaon/billy/anton/norma/yidhari/resourceIncome/rowAccounting 各私抄一份
 *  同一行 `typeof/Number.isFinite` 三元，锁见 finiteClampSingleSource.test.ts）。⚠ 与 `Number(v)` 强转版（crossAgentEnergy `num` / xide `xideNum`：字符串可转、null→0）语义不同，不收。 */
export function finiteOr0(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}
/** 比例钳到 [0, 1]；非有限值 → 0。 */
export function clampRatio(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
}

/** 向下取整到非负整数；非有限值 / undefined → 0。 */
export function whole(value: number | undefined): number {
  const n = value ?? 0
  return Math.max(0, Math.floor(Number.isFinite(n) ? n : 0))
}
/**
 * 用户填的「按键计数表」归一（CC-481）：每项 `Number(v) || 0` 强转后向下取整，非正项丢弃，返回新对象。
 * 此前 banyue / yixuan / starlightBilly 三个模块各私抄一份同体 `readAxisEx*`（jscpd 10 行 ×3，r666 普查）。
 * ⚠ 故意用 `Number(v) || 0` 而不是 `finiteOr0`：历史语义（字符串 '3' 可转、null → 0）逐字保持；锁见 finiteClampSingleSource.test.ts。
 */
export function positiveWholeCounts(raw: Readonly<Record<string, unknown>> | undefined): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(raw ?? {})) {
    const n = Math.max(0, Math.floor(Number(v) || 0))
    if (n > 0) out[k] = n
  }
  return out
}
