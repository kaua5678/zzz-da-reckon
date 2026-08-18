/** 数字格式化工具 */

/** 格式化数字，去除多余小数 */
export function fmt(value: number | undefined | null, decimals = 2): string {
  if (value == null || !Number.isFinite(value)) return '-'
  if (decimals === 0) return Math.round(value).toLocaleString()
  return Number(value.toFixed(decimals)).toLocaleString()
}

/** 百分比格式化 */
export function pct(value: number | undefined | null, decimals = 1): string {
  if (value == null || !Number.isFinite(value)) return '-'
  return `${Number(value.toFixed(decimals))}%`
}

/** 紧凑数字格式化 (万/亿) */
export function compact(value: number | undefined | null): string {
  if (value == null || !Number.isFinite(value)) return '-'
  if (Math.abs(value) >= 1e8) return `${(value / 1e8).toFixed(2)}亿`
  if (Math.abs(value) >= 1e4) return `${(value / 1e4).toFixed(2)}万`
  return fmt(value, 0)
}
