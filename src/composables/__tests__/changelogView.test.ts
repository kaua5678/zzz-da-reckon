/**
 * 更新日志**视图模型**的判据（`src/composables/changelogView.ts`）。
 *
 * 为什么这些逻辑不留在 `.vue` 里：本仓库的 `.vue` 模板不参与单测（`check-guards` 判据 20
 * 的说明里有原委），留在组件里就等于没有判据。筛选 / 搜索 / 空日期消除 / 计数
 * 全是可判定的纯逻辑，抽出来后逐条断言。
 *
 * 数据形态直接取自真实产物（`public/static/changelog.json` 的字段与取值），
 * 不是假想结构 —— 契约面由 `validate:data` 的 JSON 契约另测。
 */
import { describe, it, expect } from 'vitest'
import { buildChangelogRows, countEntries, kindCounts, matchEntry } from '@/composables/changelogView'
import type { ChangelogFile, ChangelogEntry } from '@/types/changelog'

const e = (h: string, t: string, k: string, s: string, bc?: number): ChangelogEntry =>
  bc ? { h, t, k, s, bc } : { h, t, k, s }

/** 三天数据，覆盖「同一天多个 kind」「某天只有一种 kind」两种形态；total 与条目数必须自洽 */
const FILE: ChangelogFile = {
  generatedFrom: 'git log --no-merges',
  head: 'e0bb5422',
  total: 5,
  kinds: [
    { id: 'feature', label: '功能', order: 10, count: 2 },
    { id: 'fix', label: '修复', order: 20, count: 1 },
    { id: 'docs', label: '文档', order: 40, count: 2 },
  ],
  days: [
    {
      d: '2026-10-12',
      entries: [
        e('aaaa111', '新功能', 'feature', '更新日志弹层'),
        e('bbbb222', '问题修复', 'fix', '般岳：嘲讽取消改为自动抬', 1),
      ],
    },
    {
      d: '2026-10-11',
      entries: [e('cccc333', '文档', 'docs', '同步口径')],
    },
    {
      d: '2026-10-10',
      entries: [
        e('dddd444', '新功能', 'feature', '预设队伍选择器'),
        e('eeee555', '文档', 'docs', '补文档'),
      ],
    },
  ],
}

describe('matchEntry：搜索面 = 摘要 + 类型名 + hash', () => {
  const entry = e('e0bb5422', '问题修复', 'fix', '般岳：嘲讽取消改为自动抬')

  it('空关键词一律命中', () => {
    expect(matchEntry(entry, '')).toBe(true)
  })

  it('命中摘要子串（中文）', () => {
    expect(matchEntry(entry, '嘲讽')).toBe(true)
    expect(matchEntry(entry, '不存在的词')).toBe(false)
  })

  it('命中类型名与 hash（用户常拿 commit 号来问「这条是什么」）', () => {
    expect(matchEntry(entry, '问题修复')).toBe(true)
    expect(matchEntry(entry, 'e0bb5422')).toBe(true)
    expect(matchEntry(entry, 'e0bb')).toBe(true)
  })

  it('英文 / hash 大小写不敏感', () => {
    expect(matchEntry(entry, 'E0BB5422')).toBe(true)
    expect(matchEntry(e('abc', '新功能', 'feature', 'Add Changelog Dialog'), 'changelog')).toBe(true)
  })
})

describe('buildChangelogRows：筛选 + 展平', () => {
  it('无筛选时：每天一条日期条 + 该天全部条目，顺序沿用产物', () => {
    const rows = buildChangelogRows(FILE)
    expect(rows.map(r => r.type)).toEqual(['day', 'entry', 'entry', 'day', 'entry', 'day', 'entry', 'entry'])
    expect(rows[0]).toMatchObject({ type: 'day', day: '2026-10-12', count: 2 })
    expect(rows[1]).toMatchObject({ type: 'entry' })
    expect(countEntries(rows)).toBe(5)
  })

  it('按 kind 筛选只留命中条目', () => {
    const rows = buildChangelogRows(FILE, { kind: 'feature' })
    expect(countEntries(rows)).toBe(2)
    expect(rows.filter(r => r.type === 'entry').map(r => (r as { entry: ChangelogEntry }).entry.h))
      .toEqual(['aaaa111', 'dddd444'])
  })

  /**
   * ★ 空日期必须消失：某天全被筛掉时若还留着日期条，用户会看到一串「0 条」的日期，
   * 读起来像页面坏了（这是最容易漏的一条，故单独断言）。
   */
  it('某天全部被筛掉时不留空日期条', () => {
    // fix 只在 2026-10-12 有 ⇒ 另两天的日期条必须消失
    const rows = buildChangelogRows(FILE, { kind: 'fix' })
    expect(rows.map(r => r.type)).toEqual(['day', 'entry'])
    expect(rows[0]).toMatchObject({ day: '2026-10-12', count: 1 })
  })

  it('kind + 关键词同时生效（交集）', () => {
    const rows = buildChangelogRows(FILE, { kind: 'feature', keyword: '预设' })
    expect(countEntries(rows)).toBe(1)
    expect(rows[0]).toMatchObject({ type: 'day', day: '2026-10-10', count: 1 })
  })

  it('关键词先 trim 再匹配（首尾空格不该把结果搜没）', () => {
    expect(countEntries(buildChangelogRows(FILE, { keyword: '  嘲讽  ' }))).toBe(1)
    expect(countEntries(buildChangelogRows(FILE, { keyword: '   ' }))).toBe(5)
  })

  it('无命中时返回空数组（组件据此显示空态）', () => {
    expect(buildChangelogRows(FILE, { keyword: '绝不可能出现的词' })).toEqual([])
  })

  it('数据未加载（null）时返回空数组，不抛错', () => {
    expect(buildChangelogRows(null)).toEqual([])
    expect(buildChangelogRows(null, { keyword: 'x', kind: 'fix' })).toEqual([])
  })

  it('行 key 唯一（虚拟列表要求；同日同 hash 不会撞）', () => {
    const keys = buildChangelogRows(FILE).map(r => r.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('kindCounts：筛选按钮上的计数', () => {
  it('无关键词时等于各 kind 的总数', () => {
    expect(kindCounts(FILE, '')).toEqual({ feature: 2, fix: 1, docs: 2 })
  })

  /**
   * ★ 计数必须随关键词变：否则会出现「按钮说 2 条、点进去只有 1 条」的假信息。
   */
  it('随关键词收窄（按钮数字与点进去的结果一致）', () => {
    expect(kindCounts(FILE, '预设')).toEqual({ feature: 1 })
    expect(kindCounts(FILE, '嘲讽')).toEqual({ fix: 1 })
    expect(kindCounts(FILE, '不可能出现的词')).toEqual({})
  })

  it('null 数据返回空对象', () => {
    expect(kindCounts(null, 'x')).toEqual({})
  })
})

describe('countEntries', () => {
  it('只数日志行，不数日期条', () => {
    expect(countEntries(buildChangelogRows(FILE))).toBe(5)
    expect(countEntries([])).toBe(0)
  })
})
