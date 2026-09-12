/** 数字与本地化字符串格式化工具 */

/**
 * LocalizedString 显示值的**单一事实源**（catalog 里 `name`/`label` 等字段类型声明为
 * `{ zhCN?, en? }`，真实数据常直接给字符串——两种形态都要吃）。
 *
 * 仓库中另有 ~25 处同约定手抄（含 5 个页面局部助手）——本函数是收口落点，新代码禁止再造
 * 第 N 个副本；迁移清单见 .claude 账本 Open。对象分支是 **nullish 链**（空串 zhCN 算有效值、
 * 不回退 en，防"en 未录时闪英文"的误回退），其余形态一律 fallback。
 *
 * @fact utils/format/localized 口径: LocalizedString 解析=字符串原样；对象按 zhCN→en→fallback 的 nullish 链（空串 zhCN 有效不回退）；其余形态给 fallback | 据 终态核对@2026-09-12 | 验 src/utils/__tests__/format.test.ts | 锚 src/utils/format.ts#localized | 信 高
 */
export function localized(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') {
    const v = value as { zhCN?: string; en?: string }
    const picked = v.zhCN ?? v.en
    if (picked !== undefined) return picked
  }
  return fallback
}

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
