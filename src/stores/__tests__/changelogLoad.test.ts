/**
 * 更新日志**接线**的判据（数据 → store → 视图模型），以及 JSON 入口扫描器的自证。
 *
 * 分三层，缺一层就有一种「静默失效」能溜过去：
 *   ① **产物 ↔ 类型契约**：`public/static/changelog.json` 必须真的符合
 *      `src/types/changelog.ts` 的 `ChangelogFile`（`validate:data` 的 r725 契约负责，
 *      这里用同一份 JSON 做一次「字段确实存在」的实测，防契约登记漏掉本文件）；
 *   ② **store 取数**：`catalog.loadChangelog()` 真的会 fetch 并落进 `changelogFile`
 *      （只写 loader 不接线 = 弹层永远空，而类型检查全绿）；
 *   ③ **入口扫描器**：`findUncoveredJsonEntries` 必须看得见 `fetch(withBase(...))` ——
 *      这是本次实测发现的**既有盲区**：旧正则只认 `fetch('/static/…')` 紧邻字面量，
 *      而本仓库 5 个静态入口全部走 `withBase(...)` ⇒ 判据「新入口不能绕过契约」实际是空的。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { newPinia, mockStaticFetch } from '@/test/harness'
import { useCatalogStore } from '@/stores/catalog'
import { buildChangelogRows, countEntries } from '@/composables/changelogView'

const FILE_URL = new URL('../../../public/static/changelog.json', import.meta.url)
const RAW = JSON.parse(readFileSync(FILE_URL, 'utf8'))

describe('产物契约：public/static/changelog.json 的形态', () => {
  it('顶层字段齐全且类型正确', () => {
    expect(typeof RAW.generatedFrom).toBe('string')
    expect(typeof RAW.head).toBe('string')
    expect(typeof RAW.total).toBe('number')
    expect(Array.isArray(RAW.kinds)).toBe(true)
    expect(Array.isArray(RAW.days)).toBe(true)
  })

  it('kinds 与 days 里的条目自洽（total == 条目数；kinds[].count 之和 == total）', () => {
    const entryCount = RAW.days.reduce((n: number, d: { entries: unknown[] }) => n + d.entries.length, 0)
    expect(RAW.total).toBe(entryCount)
    const sum = RAW.kinds.reduce((n: number, k: { count: number }) => n + k.count, 0)
    expect(sum).toBe(RAW.total)
  })

  it('每条都有展示必需字段（h / t / k / s），日期在分组上', () => {
    for (const day of RAW.days) {
      expect(typeof day.d).toBe('string')
      expect(day.d).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(day.entries.length).toBeGreaterThan(0) // 空日期不进产物
      for (const e of day.entries) {
        expect(typeof e.h).toBe('string')
        expect(e.h.length).toBeGreaterThan(0)
        expect(typeof e.t).toBe('string')
        expect(typeof e.k).toBe('string')
        expect(typeof e.s).toBe('string')
        expect(e.s.length).toBeGreaterThan(0)
        // 日期不在条目上（外层承载，防两份不一致）
        expect(e).not.toHaveProperty('d')
      }
    }
  })

  it('日期严格倒序（新的在前）——UI 不再重排，顺序由产物保证', () => {
    const days = RAW.days.map((d: { d: string }) => d.d)
    expect(days).toEqual([...days].sort().reverse())
  })

  it('k 取值都落在声明的 kind 集合里', () => {
    const allowed = new Set(['feature', 'fix', 'refactor', 'docs', 'other'])
    for (const day of RAW.days) {
      for (const e of day.entries) expect(allowed.has(e.k), e.k).toBe(true)
    }
  })

  /**
   * ★ 实测踩到：`ui-check` 的 DOM 体检把页面文本里的 `NaN` / `Infinity` 判为
   * 「未格式化数值」并让实机点通失败（`rawNumberLeaks`）。而仓库里真有两提交标题
   * 含这两个词（`feat(ui-check): … NaN / Infinity 即失败`、`… 含 +Infinity 透传`）
   * ⇒ 日志弹层一打开，页面文本里就有 `NaN`，实机点通必然红。
   * 产物侧把它换成可读写法，这条锁住「别再混进来」。
   */
  it('摘要里不得出现会触发 ui-check 数值体检的 NaN / Infinity 字面词', () => {
    const bad: string[] = []
    for (const day of RAW.days) {
      for (const e of day.entries) {
        if (/\bNaN\b|\bInfinity\b/.test(e.s)) bad.push(`${day.d} ${e.h} ${e.s}`)
      }
    }
    expect(bad).toEqual([])
  })
})

describe('store 取数：loadChangelog 真的接线', () => {
  beforeEach(() => {
    newPinia()
    mockStaticFetch()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('按需加载：初始为 null，调用后落进 changelogFile', async () => {
    const catalog = useCatalogStore()
    expect(catalog.changelogFile).toBeNull()
    const data = await catalog.loadChangelog()
    expect(catalog.changelogFile).toBe(data)
    expect(data.total).toBe(RAW.total)
    expect(data.days.length).toBe(RAW.days.length)
  })

  it('并发调用共享同一次请求（去重）', async () => {
    const catalog = useCatalogStore()
    const [a, b] = await Promise.all([catalog.loadChangelog(), catalog.loadChangelog()])
    expect(a).toBe(b)
  })

  it('已加载后不再重复请求（缓存）', async () => {
    const catalog = useCatalogStore()
    await catalog.loadChangelog()
    const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length
    await catalog.loadChangelog()
    expect((globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(calls)
  })

  it('请求的是带 base 前缀的路径（子路径部署下不能写死根路径）', async () => {
    const catalog = useCatalogStore()
    await catalog.loadChangelog()
    const url = String((globalThis.fetch as unknown as { mock: { calls: string[][] } }).mock.calls[0][0])
    expect(url).toContain('/static/changelog.json')
  })

  it('产物能被视图模型直接吃下（端到端：真实数据 → 行序列）', async () => {
    const catalog = useCatalogStore()
    const data = await catalog.loadChangelog()
    const rows = buildChangelogRows(data)
    // 每天一条日期条 + 全部条目
    expect(rows.length).toBe(data.total + data.days.length)
    expect(countEntries(rows)).toBe(data.total)
  })
})

describe('JSON 入口扫描器：fetch(withBase(...)) 必须可见（本次实测发现的盲区）', () => {
  /**
   * 扫描器的实现面在 `scripts/lib/json-contract.mjs`（无手写 `.d.mts`，不为测试新建一个）。
   * 这里用**源码文本**取证，而不是 import 那个 .mjs。
   *
   * 盲区原委：旧正则 `/fetch\(\s*['"`]\/static\//` 只认路径紧邻字面量，而本仓库 6 个静态入口
   * 全部是 `fetch(withBase('/static/…'))`（withBase = 子路径部署前缀，2026-10-11）
   * ⇒ 扫描面**一个都看不见**，判据「新入口不能绕过契约」实际是空的。
   */
  const CONTRACT_SRC = readFileSync(new URL('../../../scripts/lib/json-contract.mjs', import.meta.url), 'utf8')
  const STORE_SRC = readFileSync(new URL('../catalog.ts', import.meta.url), 'utf8')

  /** 与实现面同一形态：`fetch(` + 可选一层包装函数 `(` + 路径字面量 */
  const FETCH_RE = /fetch\(\s*(?:[A-Za-z_$][\w$]*\(\s*)?['"`]\/static\/([^'"`]+\.json)['"`]/g

  it('扫描器源码用的是容忍包装函数的形态（防被改回只认紧邻字面量）', () => {
    expect(CONTRACT_SRC).toContain('[A-Za-z_$][\\w$]*\\(\\s*)?')
  })

  it('6 个静态入口全部被扫描器看得见（含 changelog.json）', () => {
    expect([...STORE_SRC.matchAll(FETCH_RE)].map(m => m[1]).sort()).toEqual([
      'boss-presets.json',
      'build-recommendations.json',
      'catalog.json',
      'changelog.json',
      'run-archive.json',
      'teammate-buffs.json',
    ])
  })

  it('每个入口都在 JSON_CONTRACTS 里登记（真值由 validate:data 的 ok 行给出）', () => {
    for (const json of ['catalog', 'teammate-buffs', 'build-recommendations', 'boss-presets', 'run-archive', 'changelog']) {
      expect(CONTRACT_SRC, `${json}.json 未登记进 JSON_CONTRACTS`).toContain(`public/static/${json}.json`)
    }
  })
})
