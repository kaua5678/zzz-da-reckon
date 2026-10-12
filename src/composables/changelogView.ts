/**
 * 更新日志弹层的**视图模型**（纯函数；`components/ChangelogDialog.vue` 只做渲染）。
 *
 * 为什么抽出来：筛选 / 搜索 / 分组 / 虚拟列表展平都是**可判定的逻辑**，而 `.vue` 模板在
 * 本仓库不参与单测（见 `check-guards` 判据 20 的说明）。把它们留在组件里 = 没有判据；
 * 放在这里则能用 vitest 直接断言（`__tests__/changelogView.test.ts`）。
 *
 * 数据源 `ChangelogFile` 由 `stores/catalog.ts#loadChangelog` 提供（git 历史生成的静态 JSON）。
 */
import type { ChangelogEntry, ChangelogFile } from '@/types/changelog'

/**
 * 虚拟列表的一行：日期分隔条 **或** 一条日志。
 *
 * 两者**行高相同**（见组件里的 `ROW_HEIGHT`）—— naive-ui 的 `n-virtual-list` 用固定
 * `item-size`，混排不同行高需要 `item-resizable` + 逐行测量，对本场景不值得。
 * 日期条靠底色与字重区分，不靠高度。
 */
export type ChangelogRow =
  | { type: 'day'; key: string; day: string; count: number }
  | { type: 'entry'; key: string; entry: ChangelogEntry }

/** 筛选条件。`kind` 为空串 = 不筛（全部）。 */
export interface ChangelogFilter {
  keyword?: string
  kind?: string
}

/** 关键词归一：去空白 + 小写（中文不受影响，英文/十六进制 hash 大小写不敏感）。 */
function normalizeKeyword(raw: string | undefined): string {
  return (raw ?? '').trim().toLowerCase()
}

/**
 * 单条是否命中关键词。
 *
 * 搜索面 = 摘要 + 类型名 + hash。**有意包含 hash**：用户常拿着一个 commit 号来问
 * 「这条是什么」，而摘要里没有它。
 *
 * ⚠ 关键词在**函数内部**归一（trim + 小写），不要求调用方先处理 —— 本函数是导出的公开
 * 接口，靠「调用方记得先归一」的约定会漏（实测：直接传大写 hash 会假阴性）。
 */
export function matchEntry(entry: ChangelogEntry, keyword: string): boolean {
  const kw = normalizeKeyword(keyword)
  if (!kw) return true
  return entry.s.toLowerCase().includes(kw)
    || entry.t.toLowerCase().includes(kw)
    || entry.h.toLowerCase().includes(kw)
}

/**
 * 筛选 + 展平成虚拟列表的行序列（日期条在前，其下是该日命中的条目）。
 *
 * 口径：
 * - **空日期不出现**：某天全部条目被筛掉时，不留下一个只有标题的空日期条
 *   （否则筛「功能」时会看到一串 0 条的日期，读起来像坏了）。
 * - 日期顺序沿用产物（已是倒序），不在前端重排。
 */
export function buildChangelogRows(file: ChangelogFile | null, filter: ChangelogFilter = {}): ChangelogRow[] {
  if (!file) return []
  const keyword = normalizeKeyword(filter.keyword)
  const kind = filter.kind ?? ''
  const rows: ChangelogRow[] = []
  for (const day of file.days) {
    const hit = day.entries.filter(e => (kind ? e.k === kind : true) && matchEntry(e, keyword))
    if (hit.length === 0) continue
    rows.push({ type: 'day', key: `d:${day.d}`, day: day.d, count: hit.length })
    for (const entry of hit) rows.push({ type: 'entry', key: `e:${day.d}:${entry.h}`, entry })
  }
  return rows
}
/** 命中的条目总数（不含日期条）——用于「共 N 条」提示。 */
export function countEntries(rows: ChangelogRow[]): number {
  return rows.reduce((n, r) => n + (r.type === 'entry' ? 1 : 0), 0)
}

/**
 * 各 kind 在当前**关键词**下的条数（供筛选按钮显示计数）。
 *
 * 为什么计数要随关键词变：筛「功能」+ 搜「般岳」时，按钮上的数字若不跟着变，
 * 就会出现「按钮说 333 条、点进去只有 12 条」的假信息。
 */
export function kindCounts(file: ChangelogFile | null, keyword: string | undefined): Record<string, number> {
  const kw = normalizeKeyword(keyword)
  const out: Record<string, number> = {}
  if (!file) return out
  for (const day of file.days) {
    for (const e of day.entries) {
      if (!matchEntry(e, kw)) continue
      out[e.k] = (out[e.k] ?? 0) + 1
    }
  }
  return out
}
