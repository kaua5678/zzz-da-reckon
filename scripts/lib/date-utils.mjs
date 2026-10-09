/**
 * 日期工具（scripts 层共享）。
 *
 * 为什么单独成文件（2026-10-09）：`daysBetween` 原先只定义在 `scripts/check-guards.mjs`，
 * 但 `scripts/zc.mjs` 的 `status` 也要用它算「棘轮临近到期还剩几天」。
 * `check-guards.mjs` 已经 `import './zc.mjs'`（用它的 parseFactLine/auditAuthoredFacts），
 * 所以 zc **不能**反向 import check-guards（会成环）⇒ 提取到两者之下的 lib 层。
 *
 * 单一事实源：全仓 `daysBetween` 只此一份；check-guards 转出（保持其公开 API 与
 * `check-guards.d.mts` 声明不变），zc 直接 import 本文件。
 */

/** 两个 ISO 日期（YYYY-MM-DD）之间的天数（b - a）；同日 = 0 */
export function daysBetween(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000)
}
